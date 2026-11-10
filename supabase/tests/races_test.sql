-- Tests for 20261111000000_races_and_cities.sql: Create Race (DOW-34) and founding cities (DOW-35).
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
  ('00000000-0000-0000-0000-0000000a0011', 'race-host@example.com'),
  ('00000000-0000-0000-0000-0000000b0012', 'race-bob@example.com');

-- A world with two gods.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0011');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Raceworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Solara', '{Light}', '#E3B05B', '☀');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0012');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');


reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c0013', 'race-outsider@example.com');

-- A 10×8 grassland map with one ocean hex at (9,7), and a started game.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0011');
select public.set_initial_map(current_setting('test.w')::uuid, 10, 8,
  array(select case when i = 80 then 'ocean' else 'grassland' end from generate_series(1, 80) i));
select public.start_world(current_setting('test.w')::uuid);
reset role;
select set_config('test.actor', pg_temp.active_god(current_setting('test.w')::uuid)::text, false);
select set_config('test.actor_user', pg_temp.active_user(current_setting('test.w')::uuid)::text, false);
select set_config('test.waiter_user', (select user_id::text from public.gods
  where world_id = current_setting('test.w')::uuid and id <> current_setting('test.actor')::uuid), false);
-- Sets the active god's power as the admin, then goes back to acting as whoever we were.
create function pg_temp.set_power(n int) returns void language plpgsql as $$
declare was text := current_user;
begin
  execute 'reset role';
  update public.god_power set power = n where god_id = current_setting('test.actor')::uuid;
  execute format('set role %I', was);
end $$;
create function pg_temp.power() returns int language plpgsql as $$
declare was text := current_user; n int;
begin
  execute 'reset role';
  select power into n from public.god_power where god_id = current_setting('test.actor')::uuid;
  execute format('set role %I', was);
  return n;
end $$;
create function pg_temp.race(name text, x int, y int, alignment int default 0) returns text language sql as $$
  select format($q$select public.create_race(%L, %L, 'A people', '', %s, %s, %s)$q$,
    current_setting('test.w'), name, alignment, x, y)
$$;

-- Hex adjacency matches neighbors() in src/map/hex.ts (odd rows shift right).
select pg_temp.check(public._hex_adjacent(4, 4, 5, 4) and public._hex_adjacent(4, 4, 3, 3)
  and public._hex_adjacent(4, 4, 4, 3) and public._hex_adjacent(4, 4, 3, 5) and public._hex_adjacent(4, 4, 4, 5),
  'even-row neighbors touch');
select pg_temp.check(not public._hex_adjacent(4, 4, 5, 5) and not public._hex_adjacent(4, 4, 5, 3)
  and not public._hex_adjacent(4, 4, 4, 4) and not public._hex_adjacent(4, 4, 4, 6),
  'even-row non-neighbors do not');
select pg_temp.check(public._hex_adjacent(3, 5, 4, 4) and public._hex_adjacent(3, 5, 4, 6)
  and public._hex_adjacent(3, 5, 3, 6) and not public._hex_adjacent(3, 5, 2, 6),
  'odd-row neighbors touch');

-- DOW-34: Create Race.
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(pg_temp.race('Elves', 1, 1), 'isn''t your turn', 'only the active player can create a race');

select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.set_power(100);
select pg_temp.expect_error(pg_temp.race('  ', 1, 1), 'Give the race a name', 'a race needs a name');
select pg_temp.expect_error(format($q$select public.create_race(%L, 'Elves', ' ', '', 0, 1, 1)$q$,
  current_setting('test.w')), 'Describe the race', 'a race needs a description');
select pg_temp.expect_error(pg_temp.race('Elves', 1, 1, 2), 'good, neutral or evil', 'alignment is -1, 0 or +1');
select pg_temp.expect_error(pg_temp.race('Elves', 9, 7), 'water', 'races live on land');
select pg_temp.expect_error(pg_temp.race('Elves', 10, 0), 'off the map', 'races live on the map');
select pg_temp.set_power(21);
select pg_temp.expect_error(pg_temp.race('Elves', 1, 1), 'costs 22 power; you have 21',
  'Create Race costs 22 in the First Age');
select pg_temp.check(pg_temp.power() = 21, 'a failed action costs nothing');

select pg_temp.set_power(30);
select public.create_race(current_setting('test.w')::uuid, '  Dwarves ', 'Stout folk of the deep halls',
  'Short and bearded', 1, 4, 4);
reset role;
select pg_temp.check(pg_temp.power() = 8, 'creating a race spends 22 power');
select pg_temp.check(
  (select count(*) = 1 from public.world_entities
   where world_id = current_setting('test.w')::uuid and kind = 'race' and name = 'Dwarves'
     and alignment = 1 and hex_x = 4 and hex_y = 4 and appearance = 'Short and bearded'
     and god_id = current_setting('test.actor')::uuid),
  'the race is placed on its homeland');
select pg_temp.check(
  (select count(*) = 1 from public.world_entities o join public.world_entities r on r.id = o.race_id
   join public.gods g on g.id = o.god_id
   where o.world_id = current_setting('test.w')::uuid and o.kind = 'order' and r.name = 'Dwarves'
     and o.name = 'Faithful of ' || g.name and o.god_id = current_setting('test.actor')::uuid),
  'the creator gets a sect in the new race');
select pg_temp.check(
  (select e.type = 'action_taken' and e.payload->>'power' = 'createRace' and (e.payload->>'cost')::int = 22
          and (e.payload->>'power_after')::int = 8 and e.payload->'hexes' = '[[4,4]]'
          and e.payload->'race'->>'name' = 'Dwarves' and (e.payload->'race'->>'alignment')::int = 1
          and (e.payload->'race'->>'id')::uuid = r.id and r.created_seq = e.seq
          and e.payload->'order'->>'name' like 'Faithful of %'
   from public.world_events e join public.world_entities r
     on r.world_id = e.world_id and r.kind = 'race' and r.name = 'Dwarves'
   where e.world_id = current_setting('test.w')::uuid order by e.seq desc limit 1),
  'the new race is logged with the action');

select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.set_power(100);
select pg_temp.expect_error(pg_temp.race('DWARVES', 1, 1), 'already called', 'race names are unique');
select pg_temp.expect_error(pg_temp.race('Gnomes', 4, 4), 'already lives', 'two races can''t share a homeland');

-- DOW-35: Command Race to found a city.
select set_config('test.dwarves', (select id::text from public.world_entities
  where world_id = current_setting('test.w')::uuid and name = 'Dwarves'), false);
create function pg_temp.city(name text, x int, y int) returns text language sql as $$
  select format($q$select public.found_city(%L, %L, %L, %s, %s, 'They build walls')$q$,
    current_setting('test.w'), current_setting('test.dwarves'), name, x, y)
$$;
select pg_temp.expect_error(format($q$select public.found_city(%L, %L, 'Nowhere', 4, 4, 'x')$q$,
  current_setting('test.w'), current_setting('test.actor')), 'Choose one of this world''s races',
  'a city needs a real race');
select pg_temp.expect_error(pg_temp.city('Farhold', 7, 7), 'on or next to Dwarves''s land',
  'cities must be on or next to the race''s land');
select pg_temp.expect_error(pg_temp.city('Farhold', 5, 5), 'on or next to', 'a diagonal that isn''t a neighbor is too far');
select pg_temp.expect_error(pg_temp.city('Dwarves', 4, 4), 'already called', 'a city can''t share a race''s name');
select pg_temp.set_power(7);
select pg_temp.expect_error(pg_temp.city('Karak', 4, 4), 'costs 8 power; you have 7',
  'Command Race costs 8 in the First Age');
select pg_temp.set_power(20);
select public.found_city(current_setting('test.w')::uuid, current_setting('test.dwarves')::uuid,
  'Karak', 4, 4, '  The dwarves raise a hall in the mountain  ');
select pg_temp.check(pg_temp.power() = 12, 'founding a city spends 8 power');
select pg_temp.expect_error(pg_temp.city('Karak Two', 4, 4), 'already a city', 'one city per hex');
select pg_temp.expect_error(pg_temp.city('karak', 5, 4), 'already called', 'city names are unique');
select public.found_city(current_setting('test.w')::uuid, current_setting('test.dwarves')::uuid,
  'Irondeep', 5, 4, 'A second hall');
select pg_temp.set_power(20);
select public.found_city(current_setting('test.w')::uuid, current_setting('test.dwarves')::uuid,
  'Stonegate', 6, 4, 'The realm grows east');
select pg_temp.check(true, 'a race''s land grows with its cities');
reset role;
select pg_temp.check(
  (select count(*) = 3 and bool_and(c.alignment = 1) and bool_and(c.god_id = current_setting('test.actor')::uuid)
   from public.world_entities c where c.world_id = current_setting('test.w')::uuid and c.kind = 'city'
     and c.race_id = current_setting('test.dwarves')::uuid),
  'cities belong to their race and start with its alignment');
select pg_temp.check(
  (select payload->>'power' = 'commandRace' and payload->>'intent' = 'foundCity' and (payload->>'cost')::int = 8
          and payload->'city'->>'name' = 'Stonegate' and payload->'city'->>'race_id' = current_setting('test.dwarves')
          and payload->'hexes' = '[[6,4]]' and payload->>'description' = 'The realm grows east'
   from public.world_events where world_id = current_setting('test.w')::uuid order by seq desc limit 1),
  'the new city is logged with the action');

select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.expect_error(pg_temp.race('Gnomes', 5, 4), 'already lives', 'races can''t settle in a city');
reset role;

-- Any god can command any race: the other god founds a city for the Dwarves on their turn.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.end_turn(current_setting('test.w')::uuid);
reset role;
select pg_temp.check(pg_temp.active_god(current_setting('test.w')::uuid) <> current_setting('test.actor')::uuid,
  'the turn passes to the other god');
update public.god_power set power = 20 where god_id = pg_temp.active_god(current_setting('test.w')::uuid);
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select public.found_city(current_setting('test.w')::uuid, current_setting('test.dwarves')::uuid,
  'Westwatch', 3, 4, 'A watchtower on the western road');
reset role;
select pg_temp.check(
  (select god_id = pg_temp.active_god(current_setting('test.w')::uuid) from public.world_entities
   where name = 'Westwatch'),
  'another god can command the race');

-- Who can see and change races and cities.
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.check((select count(*) from public.world_entities) = 6, 'members see races, sects and cities');
select pg_temp.expect_error($q$update public.world_entities set name = 'Hacked' where kind = 'race'$q$,
  'permission denied', 'players can''t rename races directly');
select pg_temp.expect_error(format(
  $q$insert into public.world_entities (world_id, kind, name, created_seq) values (%L, 'race', 'Fake', 1)$q$,
  current_setting('test.w')), 'permission denied', 'players can''t add races directly');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0013');
select pg_temp.check((select count(*) from public.world_entities) = 0, 'outsiders see nothing');
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.world_entities) = 0, 'signed-out visitors see nothing');
reset role;

\echo 'All races checks passed.'
