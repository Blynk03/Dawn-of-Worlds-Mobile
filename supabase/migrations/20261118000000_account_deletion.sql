-- DOW-17 (Google Play): deleting your account, which Play requires both in the app and online.
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- What delete_my_account() does:
-- * Deletes your sign-in (and with it your email address), your devices for notifications, your
--   notification settings and nudges, your comments, reactions and read markers.
-- * Worlds that haven't started: you leave them. One you host passes to the player who joined
--   next; if nobody else is in it, it's deleted.
-- * Worlds in play or finished: your god's past actions stay in the world's history, so the other
--   players' chronicle and map still make sense, but your god is marked as departed: it takes no
--   more turns, gets no power, and doesn't count in votes. If you host the world, the player who
--   joined next becomes host. Your name in those worlds becomes "Departed player".

-- Gods whose player deleted their account.
alter table public.gods add column departed_at timestamptz;

-- A profile can outlive its sign-in (anonymised), so the worlds it played in stay whole.
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.profiles'::regclass and con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  w record;
  heir uuid;
  st public.world_state%rowtype;
  my_god uuid;
  idx int;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;

  -- Personal data.
  delete from public.push_tokens where user_id = me;
  delete from public.world_notification_settings where user_id = me;
  delete from public.world_nudges where from_user = me;
  delete from public.push_outbox where user_id = me;
  delete from public.action_comments where user_id = me;
  delete from public.action_reactions where user_id = me;
  delete from public.world_reads where user_id = me;

  for w in
    select wd.id, wd.status, wd.created_by from public.worlds wd
    join public.world_members m on m.world_id = wd.id and m.user_id = me
  loop
    -- Who takes over as host: whoever joined next and is still playing.
    select m.user_id into heir from public.world_members m
    where m.world_id = w.id and m.user_id <> me
      and not exists (
        select 1 from public.gods g
        where g.world_id = m.world_id and g.user_id = m.user_id and g.departed_at is not null
      )
    order by m.joined_at
    limit 1;

    if w.status = 'lobby' then
      if w.created_by = me and heir is null then
        delete from public.worlds where id = w.id;
        continue;
      end if;
      if w.created_by = me then
        update public.worlds set created_by = heir where id = w.id;
        update public.world_members set role = 'host' where world_id = w.id and user_id = heir;
      end if;
      delete from public.gods where world_id = w.id and user_id = me;
      delete from public.world_members where world_id = w.id and user_id = me;
      continue;
    end if;

    -- In play or finished: the god stays in the history, departed.
    if w.created_by = me and heir is not null then
      update public.worlds set created_by = heir where id = w.id;
      update public.world_members set role = 'host' where world_id = w.id and user_id = heir;
      update public.world_members set role = 'player' where world_id = w.id and user_id = me;
    end if;
    select g.id into my_god from public.gods g where g.world_id = w.id and g.user_id = me;
    if my_god is null then
      continue;
    end if;
    update public.gods set departed_at = now() where id = my_god;
    perform public._append_event(w.id, 'god_departed', jsonb_build_object('god_id', my_god), my_god);
    if w.status <> 'active' then
      continue;
    end if;

    if heir is null then
      -- Nobody left to play: the game ends here.
      update public.worlds set status = 'finished' where id = w.id;
      continue;
    end if;

    -- If it's this god's turn, pass it (a new round leaves the god out).
    select * into st from public.world_state s where s.world_id = w.id for update;
    if st.turn_order[st.active_position] = my_god then
      perform public._finish_turn(w.id, 'pass');
      select * into st from public.world_state s where s.world_id = w.id for update;
    end if;
    -- ...and take it out of the rest of this round's order.
    idx := array_position(st.turn_order, my_god);
    if idx is not null then
      update public.world_state
      set turn_order = array_remove(st.turn_order, my_god),
          active_position = case when idx < st.active_position then st.active_position - 1 else st.active_position end
      where world_id = w.id;
    end if;
  end loop;

  update public.profiles set display_name = 'Departed player', avatar_url = null where id = me;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

------------------------------------------------------------------------------------------------
-- Departed gods take no more turns and don't count in votes (as 20261117000000, with
-- `departed_at is null` added).
------------------------------------------------------------------------------------------------
create or replace function public._begin_round(target_world uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
  cfg jsonb;
  dice_count int;
  sides int;
  new_year int;
  god record;
  roll int[];
  roll_total int;
  incomes jsonb := '[]'::jsonb;
  order_ids uuid[];
  gm_god uuid;
  limit_hours int;
  lapsed public.world_proposals;
begin
  select * into st from public.world_state s where s.world_id = target_world for update;

  select r.config, w.turn_time_limit_hours into cfg, limit_hours
  from public.worlds w join public.rulesets r on r.id = w.ruleset_id
  where w.id = target_world;
  dice_count := (cfg #>> '{income,dice,count}')::int;
  sides := (cfg #>> '{income,dice,sides}')::int;

  -- The first round starts at year 0; each later round moves time on by the current age's scale.
  new_year := case
    when st.round = 0 then 0
    else st.year + (cfg -> 'ages' -> (st.age - 1) ->> 'yearsPerRound')::int
  end;
  update public.world_state
  set round = st.round + 1, year = new_year
  where world_id = target_world;

  -- DOW-52: a vote on the next age that hasn't passed lapses with the round.
  for lapsed in
    select * from public.world_proposals x
    where x.world_id = target_world and x.kind = 'advance_age' and x.status = 'open'
  loop
    perform public._finish_proposal(lapsed, 'expired', null, null);
  end loop;
  -- ...and one that has passed begins now.
  if st.age_pending then
    update public.world_state
    set age = st.age + 1, age_started_round = st.round + 1, age_pending = false
    where world_id = target_world;
    st.age := st.age + 1;
    perform public._append_event(
      target_world,
      'age_advanced',
      jsonb_build_object(
        'age', st.age,
        'name', cfg -> 'ages' -> (st.age - 1) ->> 'name',
        'years_per_round', (cfg -> 'ages' -> (st.age - 1) ->> 'yearsPerRound')::int,
        'round', st.round + 1
      )
    );
  end if;

  -- Scratch table for working out turn order (per connection, emptied each round).
  if to_regclass('pg_temp._dow_order') is null then
    create temp table _dow_order (god_id uuid primary key, keys int[] not null);
  end if;
  delete from pg_temp._dow_order where true; -- explicit WHERE: Supabase's pg-safeupdate rejects DELETE without one

  for god in
    select g.id, p.power, p.low_pool_bonus
    from public.gods g join public.god_power p on p.god_id = g.id
    where g.world_id = target_world and g.departed_at is null
    order by g.created_at
  loop
    roll := public._roll_dice(dice_count, sides);
    roll_total := public._log_roll(target_world, god.id, 'income', roll);
    update public.god_power
    set power = power + roll_total + god.low_pool_bonus
    where god_id = god.id;
    incomes := incomes || jsonb_build_object(
      'god_id', god.id,
      'roll', roll_total,
      'bonus', god.low_pool_bonus,
      'gained', roll_total + god.low_pool_bonus,
      'power', god.power + roll_total + god.low_pool_bonus
    );
    insert into pg_temp._dow_order values (god.id, array[roll_total]);
  end loop;

  -- Ties: tied gods roll again (and again) until every position is decided.
  loop
    exit when not exists (
      select 1 from pg_temp._dow_order group by keys having count(*) > 1
    );
    for god in
      select o.god_id from pg_temp._dow_order o
      where (select count(*) from pg_temp._dow_order o2 where o2.keys = o.keys) > 1
      order by o.god_id
    loop
      roll := public._roll_dice(dice_count, sides);
      roll_total := public._log_roll(target_world, god.god_id, 'turn_order_tiebreak', roll);
      update pg_temp._dow_order set keys = keys || roll_total where god_id = god.god_id;
    end loop;
  end loop;

  select g.id into gm_god
  from public.gods g
  join public.world_members m on m.world_id = g.world_id and m.user_id = g.user_id
  where g.world_id = target_world and m.is_gm and g.departed_at is null
  limit 1;

  select array_agg(o.god_id order by (o.god_id = gm_god) desc nulls last, o.keys desc)
  into order_ids
  from pg_temp._dow_order o;

  update public.world_state
  set turn_order = order_ids,
      active_position = 1,
      turn_started_at = now(),
      turn_deadline = case when limit_hours is null then null else now() + make_interval(hours => limit_hours) end
  where world_id = target_world;

  perform public._append_event(
    target_world,
    'round_started',
    jsonb_build_object(
      'round', st.round + 1,
      'age', st.age,
      'year', new_year,
      'incomes', incomes,
      'turn_order', to_jsonb(order_ids),
      'deadline', (select s.turn_deadline from public.world_state s where s.world_id = target_world)
    )
  );
end;
$$;

create or replace function public._tally(p public.world_proposals, closing boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  gods int;
  cast_votes int;
  yes int; keep int; undo int; coin int;
  decided text;
  flip int;
begin
  select count(*) into gods from public.gods g
  where g.world_id = p.world_id and g.departed_at is null;
  select count(*),
         count(*) filter (where choice = 'yes'),
         count(*) filter (where choice = 'keep'),
         count(*) filter (where choice = 'undo'),
         count(*) filter (where choice = 'coin')
  into cast_votes, yes, keep, undo, coin
  from public.world_votes where proposal_id = p.id;

  if p.kind = 'advance_age' then
    if yes * 2 > gods then
      return public._finish_proposal(p, 'passed', null, null);
    elsif (yes + gods - cast_votes) * 2 <= gods then
      return public._finish_proposal(p, 'failed', null, null);
    elsif closing then
      return public._finish_proposal(p, 'expired', null, null);
    end if;
    return 'open';
  end if;

  -- Objections.
  if keep * 2 > gods then
    decided := 'kept';
  elsif undo * 2 > gods then
    decided := 'undone';
  elsif coin * 2 > gods then
    decided := 'coin';
  elsif closing or cast_votes >= gods then
    decided := case
      when coin > keep and coin > undo then 'coin'
      when keep > undo then 'kept'
      when undo > keep then 'undone'
      else 'coin'
    end;
  else
    return 'open';
  end if;

  if decided = 'coin' then
    flip := public._coin_flip(p.world_id, p.god_id);
    decided := case when flip = 1 then 'kept' else 'undone' end;
  end if;
  return public._finish_proposal(
    p, decided, flip,
    case when decided = 'undone' then public._retcon(p.world_id, p.target_seq, p.id) end
  );
end;
$$;

revoke execute on function public._begin_round(uuid) from public, anon, authenticated;
revoke execute on function public._tally(public.world_proposals, boolean) from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- No notifications for players who have left (as 20261113000000, with the account check).
------------------------------------------------------------------------------------------------
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
  -- Nobody to tell: no user, or one who has deleted their account (DOW-17).
  if target_user is null or not exists (select 1 from auth.users u where u.id = target_user) then
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

revoke execute on function public._notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;
