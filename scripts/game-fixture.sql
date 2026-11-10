-- Plays a short game with the real server functions and prints a JSON fixture: the event log plus
-- the server's resulting state. src/game/__tests__/project.test.ts checks that the app's
-- projection of those events matches the server exactly.
-- Regenerate (needs a local Postgres, see scripts/test-db.sh):
--   ./scripts/make-game-fixture.sh > src/game/__tests__/fixtures/server-game.json
\set ON_ERROR_STOP on
\o /dev/null
set client_min_messages = warning;

create function pg_temp.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
  execute 'set role authenticated';
end $$;

create function pg_temp.play(w uuid, pass boolean, low boolean) returns void language plpgsql as $$
declare g uuid; u uuid;
begin
  reset role;
  select s.turn_order[s.active_position] into g from public.world_state s where s.world_id = w;
  select user_id into u from public.gods where id = g;
  if low then update public.god_power set power = 2 where god_id = g; end if;
  perform pg_temp.act_as(u);
  perform public.end_turn(w, pass);
  reset role;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@example.com');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
insert into public.worlds (id, name, turn_time_limit_hours)
values ('11111111-1111-1111-1111-111111111111', 'Fixture', 48);
insert into public.gods (id, world_id, name, spheres, color, sigil)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Solara', '{Light}', '#E3B05B', '☀');
reset role;
select set_config('fixture.code', invite_code, false) from public.worlds where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select public.join_world(current_setting('fixture.code'));
insert into public.gods (id, world_id, name, spheres, color, sigil)
values ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Umbra', '{Darkness}', '#7C3AED', '☾');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select public.join_world(current_setting('fixture.code'));
insert into public.gods (id, world_id, name, spheres, color, sigil)
values ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Thalassa', '{Sea}', '#0D9488', '⚓');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.start_world('11111111-1111-1111-1111-111111111111');

-- Round 1: end, pass, end (the last with a low pool so a bonus is earned).
select pg_temp.play('11111111-1111-1111-1111-111111111111', false, false);
select pg_temp.play('11111111-1111-1111-1111-111111111111', true, false);
select pg_temp.play('11111111-1111-1111-1111-111111111111', false, true);
-- Round 2: one turn taken, then a timeout.
select pg_temp.play('11111111-1111-1111-1111-111111111111', false, false);
reset role;
update public.world_state set turn_deadline = now() - interval '1 minute'
where world_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.skip_timed_out_turn('11111111-1111-1111-1111-111111111111');
reset role;

\o
\t on
\pset format unaligned
select jsonb_pretty(jsonb_build_object(
  'events', (select jsonb_agg(jsonb_build_object(
      'seq', seq, 'type', type, 'age', age, 'round', round, 'god_id', god_id,
      'payload', payload, 'created_at', '2026-11-04T00:00:00Z') order by seq)
    from public.world_events where world_id = '11111111-1111-1111-1111-111111111111'),
  'state', (select to_jsonb(s) - 'world_id' - 'turn_started_at' from public.world_state s
    where world_id = '11111111-1111-1111-1111-111111111111'),
  'powers', (select jsonb_object_agg(god_id, jsonb_build_object('power', power, 'lowPoolBonus', low_pool_bonus))
    from public.god_power where world_id = '11111111-1111-1111-1111-111111111111')
));
