-- DOW-16 + DOW-28: push notifications (your turn, new round, someone joined), nudges and
-- automatic turn reminders.
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations. It turns on two Supabase extensions: pg_net (to call Expo's push
-- service) and pg_cron (to check for slow turns every 15 minutes).
--
-- How it works: when something happens, _notify() writes a row to push_outbox and, when pg_net
-- is available, posts it to Expo's push service for each of that player's devices. Expo then
-- delivers it through Firebase (Android). Muted worlds are skipped.

------------------------------------------------------------------------------------------------
-- Extensions (already installed on Supabase, but off by default). Skipped where unavailable,
-- e.g. the local test database, where notifications just stay in the outbox.
------------------------------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net is not available here (%); notifications will not be sent', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available here (%); turn reminders will not run', sqlerrm;
  end;
end
$$;

------------------------------------------------------------------------------------------------
-- Devices: one Expo push token per installed app, owned by whoever signed in on it last.
------------------------------------------------------------------------------------------------
create table public.push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[.+\]$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- Per-world mute.
create table public.world_notification_settings (
  world_id uuid not null references public.worlds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted boolean not null default false,
  primary key (world_id, user_id)
);

-- Hours a turn can sit before everyone's reminded (0 = never). The host chooses.
alter table public.worlds add column reminder_hours int not null default 24
  check (reminder_hours in (0, 6, 12, 24, 48));
grant update (reminder_hours) on public.worlds to authenticated;

-- When the current turn's reminder went out.
alter table public.world_state add column turn_reminded_at timestamptz;

-- Nudges: any player can nudge whoever is taking their turn, once every 12 hours.
create table public.world_nudges (
  id bigint generated always as identity primary key,
  world_id uuid not null references public.worlds (id) on delete cascade,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_god uuid not null references public.gods (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index world_nudges_idx on public.world_nudges (world_id, from_user, created_at desc);

-- Everything sent (or that would have been sent), for troubleshooting.
create table public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  world_id uuid references public.worlds (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  devices int not null default 0,
  request_id bigint
);

-- The last turn and round we told players about, so each is announced once.
create table public.turn_notices (
  world_id uuid primary key references public.worlds (id) on delete cascade,
  round int not null,
  active_position int not null,
  turn_started_at timestamptz
);

alter table public.push_tokens enable row level security;
alter table public.world_notification_settings enable row level security;
alter table public.world_nudges enable row level security;
alter table public.push_outbox enable row level security;
alter table public.turn_notices enable row level security;

create policy "push_tokens: see your own devices"
  on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy "world_notification_settings: see your own"
  on public.world_notification_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy "world_nudges: members read"
  on public.world_nudges for select to authenticated using (public.is_world_member(world_id));
-- push_outbox and turn_notices: server only (no policies).

revoke insert, update, delete on public.push_tokens from anon, authenticated;
revoke insert, update, delete on public.world_notification_settings from anon, authenticated;
revoke insert, update, delete on public.world_nudges from anon, authenticated;
revoke all on public.push_outbox, public.turn_notices from anon, authenticated;

------------------------------------------------------------------------------------------------
-- Sending.
------------------------------------------------------------------------------------------------

-- Posts an outbox row to Expo's push service for each of the player's devices.
create or replace function public._send_push(outbox_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.push_outbox%rowtype;
  messages jsonb;
  device_count int;
  req bigint;
begin
  select * into n from public.push_outbox where id = outbox_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'to', t.token,
      'title', n.title,
      'body', n.body,
      'data', n.data,
      'sound', 'default',
      'channelId', 'turns',
      'priority', 'high'
    )), '[]'::jsonb), count(*)
    into messages, device_count
  from public.push_tokens t where t.user_id = n.user_id;

  if device_count > 0 and to_regproc('net.http_post') is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      into req
      using 'https://exp.host/--/api/v2/push/send',
            messages,
            '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb;
    update public.push_outbox
      set sent_at = now(), devices = device_count, request_id = req
      where id = outbox_id;
  elsif device_count = 0 then
    -- Nobody to tell (no app installed, or signed out everywhere).
    update public.push_outbox set sent_at = now() where id = outbox_id;
  end if;
end;
$$;

-- Queues and sends a notification, unless the player muted that world.
create or replace function public._notify(
  target_user uuid,
  target_world uuid,
  kind text,
  title text,
  body text,
  url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id bigint;
begin
  if target_user is null then
    return;
  end if;
  if target_world is not null and exists (
    select 1 from public.world_notification_settings s
    where s.world_id = target_world and s.user_id = target_user and s.muted
  ) then
    return;
  end if;
  insert into public.push_outbox (user_id, world_id, kind, title, body, data)
  values (target_user, target_world, kind, title, body,
          jsonb_build_object('url', url, 'worldId', target_world, 'kind', kind))
  returning id into new_id;
  perform public._send_push(new_id);
end;
$$;

------------------------------------------------------------------------------------------------
-- Your turn and new rounds. Runs at commit, so it sees the turn as it ended up (ending the last
-- turn of a round starts the next round in the same transaction) and each player's final power.
------------------------------------------------------------------------------------------------
create or replace function public._announce_turn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
  last public.turn_notices%rowtype;
  w public.worlds%rowtype;
  active_god public.gods%rowtype;
  active_power int;
  age_name text;
  member record;
begin
  select * into st from public.world_state where world_id = new.world_id;
  select * into w from public.worlds where id = new.world_id;
  if w.status is distinct from 'active' or st.round < 1 or cardinality(st.turn_order) = 0 then
    return null;
  end if;
  select * into last from public.turn_notices where world_id = st.world_id;
  if last.world_id is not null and last.round = st.round
     and last.active_position = st.active_position
     and last.turn_started_at is not distinct from st.turn_started_at then
    return null; -- already announced
  end if;
  insert into public.turn_notices (world_id, round, active_position, turn_started_at)
  values (st.world_id, st.round, st.active_position, st.turn_started_at)
  on conflict (world_id) do update
    set round = excluded.round, active_position = excluded.active_position,
        turn_started_at = excluded.turn_started_at;

  select * into active_god from public.gods where id = st.turn_order[st.active_position];
  select power into active_power from public.god_power where god_id = active_god.id;
  age_name := case st.age when 1 then 'First' when 2 then 'Second' else 'Third' end || ' Age';

  perform public._notify(
    active_god.user_id, st.world_id, 'your_turn',
    'Your turn in ' || w.name,
    active_god.name || ' has ' || coalesce(active_power, 0) || ' power. Round ' || st.round
      || ', ' || age_name || '.',
    '/world/' || st.world_id
  );

  -- A new round: tell everyone else where they stand.
  if last.world_id is null or st.round > last.round then
    for member in
      select g.user_id, g.name, p.power, array_position(st.turn_order, g.id) as place
      from public.gods g join public.god_power p on p.god_id = g.id
      where g.world_id = st.world_id and g.id <> active_god.id
    loop
      perform public._notify(
        member.user_id, st.world_id, 'new_round',
        'Round ' || st.round || ' begins in ' || w.name,
        active_god.name || ' goes first. ' || member.name || ' has ' || member.power
          || ' power and is #' || member.place || ' in the turn order.',
        '/world/' || st.world_id
      );
    end loop;
  end if;
  return null;
end;
$$;

create constraint trigger world_state_announce_turn
  after insert or update on public.world_state
  deferrable initially deferred
  for each row execute function public._announce_turn();

------------------------------------------------------------------------------------------------
-- Someone joined: tell the host.
------------------------------------------------------------------------------------------------
create or replace function public._announce_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.worlds%rowtype;
  who text;
begin
  if new.role = 'host' then
    return null;
  end if;
  select * into w from public.worlds where id = new.world_id;
  select coalesce(p.display_name, 'A friend') into who from public.profiles p where p.id = new.user_id;
  perform public._notify(
    m.user_id, new.world_id, 'joined',
    who || ' joined ' || w.name,
    'They can create their god now.',
    '/world/' || new.world_id
  )
  from public.world_members m
  where m.world_id = new.world_id and m.role = 'host' and m.user_id <> new.user_id;
  return null;
end;
$$;

create trigger world_members_announce_join
  after insert on public.world_members
  for each row execute function public._announce_join();

------------------------------------------------------------------------------------------------
-- Functions the app calls.
------------------------------------------------------------------------------------------------
create or replace function public.register_push_token(token text, platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (register_push_token.token, (select auth.uid()), register_push_token.platform, now())
  on conflict on constraint push_tokens_pkey do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

-- On sign-out: stop sending to this device.
create or replace function public.unregister_push_token(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens t
  where t.token = unregister_push_token.token and t.user_id = (select auth.uid());
$$;

create or replace function public.set_world_muted(target_world uuid, muted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_world_member(target_world) then
    raise exception 'You''re not in this world' using errcode = 'insufficient_privilege';
  end if;
  insert into public.world_notification_settings (world_id, user_id, muted)
  values (target_world, (select auth.uid()), set_world_muted.muted)
  on conflict (world_id, user_id) do update set muted = excluded.muted;
end;
$$;

-- DOW-28: nudge whoever is taking their turn. Each player can nudge once every 12 hours per world.
-- Returns when you can nudge again.
create or replace function public.nudge(target_world uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
  w public.worlds%rowtype;
  active_god public.gods%rowtype;
  last_nudge timestamptz;
  who text;
begin
  if not public.is_world_member(target_world) then
    raise exception 'You''re not in this world' using errcode = 'insufficient_privilege';
  end if;
  select * into w from public.worlds where id = target_world;
  if w.status is distinct from 'active' then
    raise exception 'This game is not in play' using errcode = 'check_violation';
  end if;
  select * into st from public.world_state where world_id = target_world;
  select * into active_god from public.gods where id = st.turn_order[st.active_position];
  if active_god.user_id = (select auth.uid()) then
    raise exception 'It''s your own turn' using errcode = 'check_violation';
  end if;
  select max(n.created_at) into last_nudge from public.world_nudges n
  where n.world_id = target_world and n.from_user = (select auth.uid());
  if last_nudge > now() - interval '12 hours' then
    raise exception 'You can nudge again in % hours',
      ceil(extract(epoch from (last_nudge + interval '12 hours' - now())) / 3600)::int
      using errcode = 'check_violation';
  end if;

  insert into public.world_nudges (world_id, from_user, to_god)
  values (target_world, (select auth.uid()), active_god.id);
  select coalesce(p.display_name, 'A friend') into who from public.profiles p
  where p.id = (select auth.uid());
  perform public._notify(
    active_god.user_id, target_world, 'nudge',
    who || ' nudged you in ' || w.name,
    'The world awaits ' || active_god.name || '. It''s still your turn.',
    '/world/' || target_world
  );
  return now() + interval '12 hours';
end;
$$;

-- DOW-28: remind whoever's turn it is once it has waited the world's reminder_hours. Run by
-- pg_cron every 15 minutes; each turn is reminded once.
create or replace function public.send_turn_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  sent int := 0;
begin
  for t in
    select s.world_id, w.name as world_name, g.user_id, g.name as god_name, s.turn_started_at
    from public.world_state s
    join public.worlds w on w.id = s.world_id
    join public.gods g on g.id = s.turn_order[s.active_position]
    where w.status = 'active' and w.reminder_hours > 0
      and s.turn_started_at < now() - make_interval(hours => w.reminder_hours)
      and (s.turn_reminded_at is null or s.turn_reminded_at < s.turn_started_at)
    for update of s skip locked
  loop
    perform public._notify(
      t.user_id, t.world_id, 'reminder',
      'Still your turn in ' || t.world_name,
      t.god_name || '''s turn started '
        || floor(extract(epoch from (now() - t.turn_started_at)) / 3600)::int
        || ' hours ago. Use your powers, or pass.',
      '/world/' || t.world_id
    );
    update public.world_state set turn_reminded_at = now() where world_id = t.world_id;
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

-- Worlds already in play: start tracking from their current turn, without announcing it.
insert into public.turn_notices (world_id, round, active_position, turn_started_at)
select s.world_id, s.round, s.active_position, s.turn_started_at
from public.world_state s join public.worlds w on w.id = s.world_id
where w.status = 'active'
on conflict (world_id) do nothing;

------------------------------------------------------------------------------------------------
-- Permissions and the reminder schedule.
------------------------------------------------------------------------------------------------
revoke execute on function public._send_push(bigint) from public, anon, authenticated;
revoke execute on function public._notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public._announce_turn() from public, anon, authenticated;
revoke execute on function public._announce_join() from public, anon, authenticated;
revoke execute on function public.send_turn_reminders() from public, anon, authenticated;

revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
revoke execute on function public.set_world_muted(uuid, boolean) from public, anon;
revoke execute on function public.nudge(uuid) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
grant execute on function public.set_world_muted(uuid, boolean) to authenticated;
grant execute on function public.nudge(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'dow-turn-reminders'$q$;
    execute $q$select cron.schedule('dow-turn-reminders', '*/15 * * * *',
      'select public.send_turn_reminders()')$q$;
  end if;
end
$$;
