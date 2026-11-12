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

-- Takes an action as whoever is active (with enough power to afford it).
create function pg_temp.act(w uuid, p text, hexes jsonb, choice text, d text) returns void language plpgsql as $$
declare g uuid; u uuid;
begin
  reset role;
  select s.turn_order[s.active_position] into g from public.world_state s where s.world_id = w;
  select user_id into u from public.gods where id = g;
  update public.god_power set power = power + 30 where god_id = g;
  perform pg_temp.act_as(u);
  perform public.take_action(w, p, hexes, choice, d);
  reset role;
end $$;

-- Runs any action call as the active god, after topping up their power.
create function pg_temp.act_sql(w uuid, stmt text) returns void language plpgsql as $$
declare g uuid; u uuid;
begin
  reset role;
  select s.turn_order[s.active_position] into g from public.world_state s where s.world_id = w;
  select user_id into u from public.gods where id = g;
  update public.god_power set power = power + 30 where god_id = g;
  perform pg_temp.act_as(u);
  execute stmt;
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
-- A small, fixed starting landmass (10x8): ocean border, grassland inside.
select public.set_initial_map('11111111-1111-1111-1111-111111111111', 10, 8,
  array(select case when x in (0, 9) or y in (0, 7) then 'ocean' else 'grassland' end
        from generate_series(0, 7) y, generate_series(0, 9) x order by y, x));
select public.start_world('11111111-1111-1111-1111-111111111111');

-- Round 1, first god: raise mountains, then bring snow to one of them.
select pg_temp.act('11111111-1111-1111-1111-111111111111', 'shapeLand', '[[2,2],[3,2],[4,2]]', 'mountains', 'The Spine of the World rises');
select pg_temp.act('11111111-1111-1111-1111-111111111111', 'shapeClimate', '[[3,2]]', 'snow', 'Snow crowns the tallest peak');

-- Round 1: end, pass, end (the last with a low pool so a bonus is earned).
select pg_temp.play('11111111-1111-1111-1111-111111111111', false, false);
select pg_temp.play('11111111-1111-1111-1111-111111111111', true, false);
select pg_temp.play('11111111-1111-1111-1111-111111111111', false, true);
-- Round 2: a forest on the same hex as before, one turn taken, then a timeout.
select pg_temp.act('11111111-1111-1111-1111-111111111111', 'shapeLand', '[[2,2],[5,5]]', 'forest', 'Old woods spread');
-- DOW-34/35: a race on (4,4), then a city next to its homeland.
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.create_race('11111111-1111-1111-1111-111111111111', 'Dwarves', 'Stout folk of the deep halls',
    'Short and bearded', 1, 4, 4)$q$);
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.found_city('11111111-1111-1111-1111-111111111111',
    (select id from public.world_entities where name = 'Dwarves'), 'Karak', 5, 4, 'A hall is carved into the hill')$q$);
-- DOW-43/46/47: a subrace beside Karak, an advancement, and alignment changes.
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.create_subrace('11111111-1111-1111-1111-111111111111',
    (select id from public.world_entities where name = 'Dwarves'), 'Deep Dwarves', 'They delve too deep',
    'Pale and silent', -1, 6, 4)$q$);
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.advance('11111111-1111-1111-1111-111111111111',
    (select id from public.world_entities where name = 'Dwarves'), 'Steel', 'The forges never cool')$q$);
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.change_alignment('11111111-1111-1111-1111-111111111111', 'city',
    (select id from public.world_entities where name = 'Karak'), null, null, 1, 'Pilgrims come')$q$);
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.change_alignment('11111111-1111-1111-1111-111111111111', 'region', null, 2, 2, -1,
    'A blight in the woods')$q$);
-- DOW-44/45: an order, a command to it, an avatar, and the avatar's deed.
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.create_order('11111111-1111-1111-1111-111111111111',
    (select id from public.world_entities where name = 'Dwarves'), 'Hammers of the Deep', 'knights',
    'Guard the mountain gates')$q$);
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.command_order('11111111-1111-1111-1111-111111111111',
    (select id from public.world_entities where name = 'Hammers of the Deep'), 'Ride to the border')$q$);
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.create_avatar('11111111-1111-1111-1111-111111111111', 'Durin', 'Dwarf king',
    'The deathless king', (select id from public.world_entities where name = 'Dwarves'), 4, 4)$q$);
select pg_temp.act_sql('11111111-1111-1111-1111-111111111111', $q$
  select public.command_avatar('11111111-1111-1111-1111-111111111111',
    (select id from public.world_entities where name = 'Durin'), 'deed',
    '{"description": "Durin slays the wyrm of the north"}')$q$);
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
    from public.god_power where world_id = '11111111-1111-1111-1111-111111111111'),
  'entities', (select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'race_id', race_id,
      'god_id', god_id, 'alignment', alignment, 'hex_x', hex_x, 'hex_y', hex_y, 'parent_race_id', parent_race_id,
      'status', status, 'order_type', order_type, 'purpose', purpose, 'avatar_type', avatar_type)
      order by created_seq, kind desc)
    from public.world_entities where world_id = '11111111-1111-1111-1111-111111111111'),
  'advancements', (select coalesce(jsonb_agg(jsonb_build_object('entity_id', entity_id, 'field', field,
      'god_id', god_id) order by created_seq), '[]') from public.world_advancements
    where world_id = '11111111-1111-1111-1111-111111111111'),
  'map', (select jsonb_build_object('width', width, 'height', height, 'terrain', to_jsonb(terrain), 'climate', to_jsonb(climate),
    'alignment', to_jsonb(coalesce(alignment, '{}'::int[])))
    from public.world_map where world_id = '11111111-1111-1111-1111-111111111111')
));
