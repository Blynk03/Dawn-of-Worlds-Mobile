-- Tests for 20261113000000_notifications.sql: push tokens, turn and round notices, joins, mutes, nudges and reminders (DOW-16/28).
\set ON_ERROR_STOP on
\o /dev/null

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(user_id::text, ''), false);
  if user_id is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

create function pg_temp.expect_error(stmt text, expected text, label text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAILED: % (no error)', label;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  if position(lower(expected) in lower(sqlerrm)) = 0 then
    raise exception 'FAILED: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'ok - %', label;
end $$;

create function pg_temp.active_user(w uuid) returns uuid language sql as $$
  select g.user_id from public.world_state s join public.gods g on g.id = s.turn_order[s.active_position]
  where s.world_id = w
$$;
create function pg_temp.active_god(w uuid) returns uuid language sql as $$
  select s.turn_order[s.active_position] from public.world_state s where s.world_id = w
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0031', 'push-host@example.com'),
  ('00000000-0000-0000-0000-0000000b0032', 'push-bob@example.com');

-- A world with two gods.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0031');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Pushworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Solara', '{Light}', '#E3B05B', '☀');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0032');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');


reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c0033', 'push-outsider@example.com');


create function pg_temp.outbox(kind text, who uuid) returns setof public.push_outbox language sql as $$
  select * from public.push_outbox
  where world_id = current_setting('test.w')::uuid and push_outbox.kind = outbox.kind and user_id = who
  order by id
$$;
create function pg_temp.count(kind text, who uuid) returns int language sql as $$
  select count(*)::int from pg_temp.outbox(kind, who)
$$;
select set_config('test.host', '00000000-0000-0000-0000-0000000a0031', false);
select set_config('test.bob', '00000000-0000-0000-0000-0000000b0032', false);

-- DOW-16: the host hears when someone joins.
select pg_temp.check(pg_temp.count('joined', current_setting('test.host')::uuid) = 1
  and (select title like '% joined Pushworld' from pg_temp.outbox('joined', current_setting('test.host')::uuid)),
  'the host is told when a friend joins');
select pg_temp.check(pg_temp.count('joined', current_setting('test.bob')::uuid) = 0, 'the joiner isn''t told about themselves');

-- Devices.
select pg_temp.act_as(current_setting('test.host')::uuid);
select public.register_push_token('ExponentPushToken[host-phone]', 'android');
select public.register_push_token('ExponentPushToken[host-tablet]', 'android');
select pg_temp.expect_error($q$select public.register_push_token('not-a-token', 'android')$q$, 'check constraint',
  'only Expo push tokens are accepted');
select pg_temp.expect_error($q$select public.register_push_token('ExponentPushToken[x]', 'windows')$q$, 'check constraint',
  'only Android and iOS devices');
select pg_temp.check((select count(*) = 2 from public.push_tokens), 'you see your own devices');
select pg_temp.act_as(current_setting('test.bob')::uuid);
select pg_temp.check((select count(*) = 0 from public.push_tokens), 'you can''t see other players'' devices');
-- A device that changes hands (sign out, sign in as someone else) follows the new player.
select public.register_push_token('ExponentPushToken[host-tablet]', 'android');
select pg_temp.check((select count(*) = 1 from public.push_tokens), 'a shared device moves to whoever signed in');
reset role;
select pg_temp.check((select count(*) = 1 from public.push_tokens where user_id = current_setting('test.host')::uuid),
  'and stops going to the old player');

-- Starting the game: the first god hears it's their turn; the other hears a round began.
select pg_temp.act_as(current_setting('test.host')::uuid);
select public.set_initial_map(current_setting('test.w')::uuid, 10, 8,
  array(select 'grassland' from generate_series(1, 80)));
select public.start_world(current_setting('test.w')::uuid);
reset role;
select set_config('test.first', pg_temp.active_user(current_setting('test.w')::uuid)::text, false);
select set_config('test.second', (case when current_setting('test.first') = current_setting('test.host')
  then current_setting('test.bob') else current_setting('test.host') end), false);
select pg_temp.check(pg_temp.count('your_turn', current_setting('test.first')::uuid) = 1,
  'the first god is told it''s their turn');
select pg_temp.check(
  (select title = 'Your turn in Pushworld'
          and body = g.name || ' has ' || p.power || ' power. Round 1, First Age.'
          and data->>'url' = '/world/' || current_setting('test.w')
   from pg_temp.outbox('your_turn', current_setting('test.first')::uuid) o
   join public.gods g on g.user_id = o.user_id and g.world_id = o.world_id
   join public.god_power p on p.god_id = g.id),
  'the turn notice includes their power and opens the world');
select pg_temp.check(pg_temp.count('new_round', current_setting('test.second')::uuid) = 1
  and pg_temp.count('new_round', current_setting('test.first')::uuid) = 0
  and pg_temp.count('your_turn', current_setting('test.second')::uuid) = 0,
  'everyone else hears a new round began');
select pg_temp.check((select body like '% goes first. % is #2 in the turn order.'
  from pg_temp.outbox('new_round', current_setting('test.second')::uuid)), 'with their place in the order');

-- Sending: devices are counted; without pg_net (as here) the notice waits in the outbox.
select pg_temp.check(
  (select bool_and((sent_at is null) = exists (select 1 from public.push_tokens t where t.user_id = o.user_id))
   from public.push_outbox o where world_id = current_setting('test.w')::uuid and kind <> 'joined'),
  'players with devices have notices queued; players without any are skipped');

-- Ending a turn: the next god is told; no new round yet.
select pg_temp.act_as(current_setting('test.first')::uuid);
select public.end_turn(current_setting('test.w')::uuid);
reset role;
select pg_temp.check(pg_temp.count('your_turn', current_setting('test.second')::uuid) = 1
  and pg_temp.count('new_round', current_setting('test.first')::uuid) = 0,
  'the next god is told it''s their turn');

-- Mute: the second player mutes this world and hears nothing more from it.
select pg_temp.act_as(current_setting('test.second')::uuid);
select public.set_world_muted(current_setting('test.w')::uuid, true);
select pg_temp.check((select muted from public.world_notification_settings), 'you can mute a world');
select public.end_turn(current_setting('test.w')::uuid);
reset role;
select set_config('test.r2first', pg_temp.active_user(current_setting('test.w')::uuid)::text, false);
select pg_temp.check((select round = 2 from public.world_state where world_id = current_setting('test.w')::uuid),
  'the round ended');
select pg_temp.check(
  pg_temp.count('your_turn', current_setting('test.second')::uuid)
    + pg_temp.count('new_round', current_setting('test.second')::uuid) = 2,
  'a muted player hears nothing new');
select pg_temp.check(
  pg_temp.count('your_turn', current_setting('test.first')::uuid)
    + pg_temp.count('new_round', current_setting('test.first')::uuid) = 2,
  'the other player hears about round 2 once (their turn, or the new round)');
select pg_temp.act_as(current_setting('test.second')::uuid);
select public.set_world_muted(current_setting('test.w')::uuid, false);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0033');
select pg_temp.expect_error(format($q$select public.set_world_muted(%L, true)$q$, current_setting('test.w')),
  'not in this world', 'outsiders can''t mute a world');

-- DOW-28: nudges.
reset role;
select set_config('test.active', pg_temp.active_user(current_setting('test.w')::uuid)::text, false);
select set_config('test.waiting', (case when current_setting('test.active') = current_setting('test.host')
  then current_setting('test.bob') else current_setting('test.host') end), false);
select pg_temp.act_as(current_setting('test.active')::uuid);
select pg_temp.expect_error(format($q$select public.nudge(%L)$q$, current_setting('test.w')), 'your own turn',
  'you can''t nudge yourself');
select pg_temp.act_as(current_setting('test.waiting')::uuid);
select pg_temp.check(public.nudge(current_setting('test.w')::uuid) > now() + interval '11 hours',
  'nudging says when you can nudge again');
select pg_temp.expect_error(format($q$select public.nudge(%L)$q$, current_setting('test.w')),
  'nudge again in 12 hours', 'one nudge per player every 12 hours');
reset role;
select pg_temp.check(
  (select count(*) = 1 and bool_and(title like '% nudged you in Pushworld' and body like '%still your turn%')
   from pg_temp.outbox('nudge', current_setting('test.active')::uuid)),
  'the active player is nudged');
update public.world_nudges set created_at = now() - interval '13 hours'
  where world_id = current_setting('test.w')::uuid;
select pg_temp.act_as(current_setting('test.waiting')::uuid);
select public.nudge(current_setting('test.w')::uuid);
select pg_temp.check((select count(*) = 2 from public.world_nudges), 'members can see nudges; 12 hours later you can nudge again');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0033');
select pg_temp.expect_error(format($q$select public.nudge(%L)$q$, current_setting('test.w')),
  'not in this world', 'outsiders can''t nudge');

-- DOW-28: automatic reminders after the world's reminder_hours (default 24).
reset role;
select pg_temp.check((select reminder_hours = 24 from public.worlds where id = current_setting('test.w')::uuid),
  'reminders default to 24 hours');
update public.world_state set turn_started_at = now() - interval '7 hours'
  where world_id = current_setting('test.w')::uuid;
select pg_temp.check(public.send_turn_reminders() = 0, 'no reminder before the time is up');
select pg_temp.act_as(current_setting('test.bob')::uuid);
update public.worlds set reminder_hours = 6 where id = current_setting('test.w')::uuid;
reset role;
select pg_temp.check((select reminder_hours = 24 from public.worlds where id = current_setting('test.w')::uuid),
  'only the host can change reminders');
select pg_temp.act_as(current_setting('test.host')::uuid);
update public.worlds set reminder_hours = 6 where id = current_setting('test.w')::uuid;
select pg_temp.expect_error(format($q$update public.worlds set reminder_hours = 5 where id = %L$q$,
  current_setting('test.w')), 'check constraint', 'reminders are off, 6, 12, 24 or 48 hours');
reset role;
select pg_temp.check(public.send_turn_reminders() = 1, 'a slow turn gets a reminder');
select pg_temp.check(
  (select count(*) = 1 and bool_and(title = 'Still your turn in Pushworld' and body like '%started 7 hours ago%')
   from pg_temp.outbox('reminder', current_setting('test.active')::uuid)),
  'the reminder goes to the active player');
select pg_temp.check(public.send_turn_reminders() = 0, 'each turn is reminded once');
select pg_temp.check(
  (select count(*) = 0 from pg_temp.outbox('your_turn', current_setting('test.active')::uuid) o
   where o.created_at > now() - interval '1 minute' and o.body like '%Round 2%' and o.id > (
     select max(id) from public.push_outbox where kind = 'reminder')),
  'recording the reminder doesn''t re-announce the turn');
select pg_temp.act_as(current_setting('test.host')::uuid);
update public.worlds set reminder_hours = 0 where id = current_setting('test.w')::uuid;
reset role;
update public.world_state set turn_started_at = now() - interval '3 days', turn_reminded_at = null
  where world_id = current_setting('test.w')::uuid;
select pg_temp.check(public.send_turn_reminders() = 0, 'the host can turn reminders off');

-- Signing out removes the device.
select pg_temp.act_as(current_setting('test.host')::uuid);
select public.unregister_push_token('ExponentPushToken[host-phone]');
select pg_temp.check((select count(*) = 0 from public.push_tokens), 'signing out stops notifications to that device');

-- Players can't read or write the server's notification tables.
select pg_temp.expect_error('select * from public.push_outbox', 'permission denied', 'players can''t read the outbox');
select pg_temp.expect_error($q$insert into public.push_tokens (token, user_id, platform)
  values ('ExponentPushToken[z]', '00000000-0000-0000-0000-0000000b0032', 'android')$q$,
  'permission denied', 'devices only go through register_push_token');
select pg_temp.expect_error(format($q$insert into public.world_nudges (world_id, from_user, to_god) values (%L, %L, %L)$q$,
  current_setting('test.w'), current_setting('test.host'), pg_temp.active_god(current_setting('test.w')::uuid)),
  'permission denied', 'nudges only go through nudge()');
select pg_temp.act_as(null);
select pg_temp.expect_error($q$select public.register_push_token('ExponentPushToken[q]', 'android')$q$,
  'permission denied', 'signed-out visitors can''t register devices');
reset role;

\echo 'All notification checks passed.'
