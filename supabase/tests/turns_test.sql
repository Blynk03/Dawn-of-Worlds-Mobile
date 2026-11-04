-- Tests for 20261104000000_turns_and_rounds.sql: the event log, server dice, rounds, turn order
-- and turns. Dice are random, so checks assert rules and invariants rather than exact values.
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

-- Owner of the god whose turn it is (run as the database owner).
create function pg_temp.active_user(w uuid) returns uuid language sql as $$
  select g.user_id from public.world_state s join public.gods g on g.id = s.turn_order[s.active_position]
  where s.world_id = w
$$;

create function pg_temp.active_god(w uuid) returns uuid language sql as $$
  select s.turn_order[s.active_position] from public.world_state s where s.world_id = w
$$;

-- Plays one turn as whoever is active.
create function pg_temp.play_turn(w uuid, pass boolean default false) returns void language plpgsql as $$
declare u uuid;
begin
  reset role;
  u := pg_temp.active_user(w);
  perform pg_temp.act_as(u);
  perform public.end_turn(w, pass);
  reset role;
end $$;

-- Dice: every roll is a fair d6 face.
do $$
declare faces int[] := array[0,0,0,0,0,0]; r int;
begin
  for i in 1..1200 loop
    r := public._roll_die(6);
    if r < 1 or r > 6 then raise exception 'FAILED: die rolled %', r; end if;
    faces[r] := faces[r] + 1;
  end loop;
  perform pg_temp.check((select min(f) from unnest(faces) f) > 100, 'server d6 rolls 1-6 and every face comes up');
end $$;

-- Setup: three players, three gods.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'host@example.com'),
  ('00000000-0000-0000-0000-00000000bb02', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000cc03', 'carol@example.com'),
  ('00000000-0000-0000-0000-00000000dd04', 'outsider@example.com');

select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Turnworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Solara', '{Light}', '#E3B05B', '☀');
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');
select pg_temp.act_as('00000000-0000-0000-0000-00000000cc03');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Thalassa', '{Sea}', '#0D9488', '⚓');

-- Hosts can't skip the start ceremony by editing the status, or create an active world.
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select pg_temp.expect_error(format($q$update public.worlds set status = 'active' where id = %L$q$, current_setting('test.w')),
  'permission denied', 'host cannot set the status directly');
select pg_temp.expect_error($q$insert into public.worlds (name, status) values ('Cheat', 'active')$q$,
  'row-level security', 'cannot create a world that is already active');
update public.worlds set turn_time_limit_hours = 24 where id = current_setting('test.w')::uuid;
reset role;
select pg_temp.check((select turn_time_limit_hours from public.worlds where id = current_setting('test.w')::uuid) = 24,
  'host can set a turn time limit');

-- Start: round 1 begins.
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select public.start_world(current_setting('test.w')::uuid);
reset role;

select pg_temp.check(
  (select round = 1 and age = 1 and year = 0 and active_position = 1 and cardinality(turn_order) = 3
   from public.world_state where world_id = current_setting('test.w')::uuid),
  'starting the game begins round 1 of the First Age at year 0');
select pg_temp.check(
  (select count(distinct t) = 3 from public.world_state s, unnest(s.turn_order) t
   where s.world_id = current_setting('test.w')::uuid),
  'turn order contains every god once');
select pg_temp.check(
  (select bool_and(power between 2 and 12 and low_pool_bonus = 0) from public.god_power
   where world_id = current_setting('test.w')::uuid),
  'each god gains 2d6 power in round 1');
select pg_temp.check(
  (select turn_deadline > now() + interval '23 hours' from public.world_state where world_id = current_setting('test.w')::uuid),
  'the active turn gets a deadline from the time limit');

-- The log: gap-free sequence, game_started first, a logged roll per god, then round_started.
select pg_temp.check(
  (select max(seq) = count(*) and min(seq) = 1 from public.world_events where world_id = current_setting('test.w')::uuid),
  'event sequence numbers are 1..N with no gaps');
select pg_temp.check(
  (select type from public.world_events where world_id = current_setting('test.w')::uuid and seq = 1) = 'game_started',
  'the log starts with game_started');
select pg_temp.check(
  (select count(*) from public.world_events
   where world_id = current_setting('test.w')::uuid and type = 'dice_rolled' and payload->>'purpose' = 'income') = 3,
  'every income roll is logged');
select pg_temp.check(
  (select bool_and(jsonb_array_length(payload->'dice') = 2
                   and (payload->>'total')::int = (payload->'dice'->>0)::int + (payload->'dice'->>1)::int)
   from public.world_events where world_id = current_setting('test.w')::uuid and type = 'dice_rolled'),
  'logged rolls record each die and the total');
select pg_temp.check(
  (select bool_and((i->>'power')::int = p.power and (i->>'gained')::int = (i->>'roll')::int + (i->>'bonus')::int)
   from public.world_events e, jsonb_array_elements(e.payload->'incomes') i
   join public.god_power p on p.god_id = (i->>'god_id')::uuid
   where e.world_id = current_setting('test.w')::uuid and e.type = 'round_started'),
  'round_started records each god''s roll, bonus and resulting power');

-- Turn order follows the income roll (highest first); ties were re-rolled and logged.
select pg_temp.check(
  (with ord as (
     select t.god_id, t.pos, (i->>'roll')::int as roll
     from public.world_state s, unnest(s.turn_order) with ordinality t(god_id, pos),
          public.world_events e, jsonb_array_elements(e.payload->'incomes') i
     where s.world_id = current_setting('test.w')::uuid and e.world_id = s.world_id
       and e.type = 'round_started' and (i->>'god_id')::uuid = t.god_id)
   select bool_and(a.roll >= b.roll) from ord a join ord b on b.pos = a.pos + 1),
  'turn order goes from highest income roll to lowest');
select pg_temp.check(
  (with rolls as (
     select (i->>'roll')::int r from public.world_events e, jsonb_array_elements(e.payload->'incomes') i
     where e.world_id = current_setting('test.w')::uuid and e.type = 'round_started')
   select (select count(*) - count(distinct r) from rolls) = 0
       or exists (select 1 from public.world_events where world_id = current_setting('test.w')::uuid
                  and payload->>'purpose' = 'turn_order_tiebreak')),
  'tied income rolls are broken with logged re-rolls');

-- Players can read the game but never write it.
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select pg_temp.check((select count(*) from public.world_events) > 0, 'members can read the game log');
select pg_temp.check((select count(*) from public.god_power) = 3, 'members can read every god''s power');
select pg_temp.expect_error(format($q$insert into public.world_events (world_id, seq, age, round, type) values (%L, 999, 1, 1, 'fake')$q$,
  current_setting('test.w')), 'row-level security', 'players cannot write to the log');
update public.god_power set power = 999;
reset role;
select pg_temp.check((select max(power) from public.god_power where world_id = current_setting('test.w')::uuid) <= 12,
  'players cannot change power');
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select pg_temp.expect_error('select public._roll_die(6)', 'permission denied', 'players cannot call internal dice functions');
select pg_temp.act_as('00000000-0000-0000-0000-00000000dd04');
select pg_temp.check((select count(*) from public.world_events) = 0, 'outsiders cannot read the log');
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.world_state) = 0, 'signed-out users cannot read game state');

-- Only the active god's player can end the turn.
reset role;
select set_config('test.waiting', (select g.user_id::text from public.gods g
  where g.world_id = current_setting('test.w')::uuid and g.id <> pg_temp.active_god(current_setting('test.w')::uuid) limit 1), false);
select pg_temp.act_as(current_setting('test.waiting')::uuid);
select pg_temp.expect_error(format('select public.end_turn(%L)', current_setting('test.w')),
  'isn''t your turn', 'players cannot end someone else''s turn');
reset role;

-- Active player ends their turn; play moves to the next god.
select set_config('test.first', pg_temp.active_god(current_setting('test.w')::uuid)::text, false);
select pg_temp.play_turn(current_setting('test.w')::uuid);
select pg_temp.check(
  (select active_position = 2 from public.world_state where world_id = current_setting('test.w')::uuid),
  'ending a turn moves play to the next god');
select pg_temp.check(
  (select payload->>'how' = 'end' and god_id = current_setting('test.first')::uuid
          and (payload->>'next_god_id')::uuid = pg_temp.active_god(current_setting('test.w')::uuid)
   from public.world_events where world_id = current_setting('test.w')::uuid order by seq desc limit 1),
  'turn_ended is logged with the next god');

-- Second god passes; third ends. Round 2 starts automatically, 500 years later.
select set_config('test.power_before', (select sum(power)::text from public.god_power where world_id = current_setting('test.w')::uuid), false);
select pg_temp.play_turn(current_setting('test.w')::uuid, true);
select pg_temp.check(
  (select payload->>'how' from public.world_events where world_id = current_setting('test.w')::uuid and type = 'turn_ended' order by seq desc limit 1) = 'pass',
  'passing is logged as a pass');
select pg_temp.play_turn(current_setting('test.w')::uuid);
select pg_temp.check(
  (select round = 2 and year = 500 and active_position = 1 from public.world_state where world_id = current_setting('test.w')::uuid),
  'when everyone has played, round 2 begins 500 years later (First Age)');
select pg_temp.check(
  (select sum(power) from public.god_power where world_id = current_setting('test.w')::uuid)
    >= current_setting('test.power_before')::int + 6,
  'round 2 adds another 2d6 to every god');
select pg_temp.check(
  (select max(seq) = count(*) from public.world_events where world_id = current_setting('test.w')::uuid),
  'the log stays gap-free across rounds');

-- Low-pool bonus: ending a turn with 5 or fewer points earns +1 next round.
select set_config('test.poor', pg_temp.active_god(current_setting('test.w')::uuid)::text, false);
update public.god_power set power = 3 where god_id = current_setting('test.poor')::uuid;
select pg_temp.play_turn(current_setting('test.w')::uuid);
select pg_temp.check(
  (select low_pool_bonus = 1 from public.god_power where god_id = current_setting('test.poor')::uuid),
  'ending a turn with 5 or fewer points earns a +1 bonus');
select pg_temp.play_turn(current_setting('test.w')::uuid);
select pg_temp.play_turn(current_setting('test.w')::uuid);
select pg_temp.check(
  (select (i->>'bonus')::int = 1 and (i->>'gained')::int = (i->>'roll')::int + 1
   from public.world_events e, jsonb_array_elements(e.payload->'incomes') i
   where e.world_id = current_setting('test.w')::uuid and e.type = 'round_started'
     and (i->>'god_id')::uuid = current_setting('test.poor')::uuid
   order by e.seq desc limit 1),
  'the bonus is added to the next round''s income');

-- Timeouts: nobody can skip a turn early; once the deadline passes, any player can.
select set_config('test.slow', pg_temp.active_god(current_setting('test.w')::uuid)::text, false);
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select pg_temp.expect_error(format('select public.skip_timed_out_turn(%L)', current_setting('test.w')),
  'hasn''t run out of time', 'turns cannot be skipped before the deadline');
reset role;
update public.world_state set turn_deadline = now() - interval '1 minute' where world_id = current_setting('test.w')::uuid;
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select public.skip_timed_out_turn(current_setting('test.w')::uuid);
reset role;
select pg_temp.check(
  (select payload->>'how' = 'timeout' and god_id = current_setting('test.slow')::uuid
   from public.world_events where world_id = current_setting('test.w')::uuid and type = 'turn_ended' order by seq desc limit 1),
  'a timed-out turn is skipped and logged as a timeout');
select pg_temp.act_as('00000000-0000-0000-0000-00000000dd04');
select pg_temp.expect_error(format('select public.skip_timed_out_turn(%L)', current_setting('test.w')),
  'not in this world', 'outsiders cannot skip turns');
reset role;

-- A GM's god always goes first.
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('GM goes first') returning id, invite_code into w, c;
  perform set_config('test.gw', w::text, false);
  perform set_config('test.gcode', c, false);
end $$;
select public.set_my_gm_role(current_setting('test.gw')::uuid, true);
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.gw')::uuid, 'Narrator', '{Fate}', '#E3B05B', '★');
select pg_temp.act_as('00000000-0000-0000-0000-00000000bb02');
select public.join_world(current_setting('test.gcode'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.gw')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');
select pg_temp.act_as('00000000-0000-0000-0000-00000000aa01');
select public.start_world(current_setting('test.gw')::uuid);
reset role;
select pg_temp.check(
  (select g.name = 'Narrator' from public.world_state s join public.gods g on g.id = s.turn_order[1]
   where s.world_id = current_setting('test.gw')::uuid),
  'the GM''s god goes first');
select pg_temp.check(
  (select turn_deadline is null from public.world_state where world_id = current_setting('test.gw')::uuid),
  'no time limit means no deadline');

-- Worlds started before turns existed get set up by the migration.
do $$
declare w uuid;
begin
  insert into public.worlds (name, created_by, status)
  values ('Started early', '00000000-0000-0000-0000-00000000aa01', 'lobby') returning id into w;
  insert into public.world_members (world_id, user_id)
  values (w, '00000000-0000-0000-0000-00000000bb02');
  insert into public.gods (world_id, user_id, name, spheres, color, sigil) values
    (w, '00000000-0000-0000-0000-00000000aa01', 'Early A', '{War}', '#DC2626', '⚔'),
    (w, '00000000-0000-0000-0000-00000000bb02', 'Early B', '{Sea}', '#2563EB', '⚓');
  update public.worlds set status = 'active' where id = w; -- the old start_world only did this
  perform set_config('test.early', w::text, false);
end $$;
select pg_temp.check(public._set_up_started_worlds() = 1, 'the migration finds worlds started before turns existed');
select pg_temp.check(
  (select round = 1 and cardinality(turn_order) = 2 from public.world_state where world_id = current_setting('test.early')::uuid),
  'those worlds begin round 1');
select pg_temp.check(public._set_up_started_worlds() = 0, 'setting up started worlds is safe to run again');

\echo 'All turn and round checks passed.'
