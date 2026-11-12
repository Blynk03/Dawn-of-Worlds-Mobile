-- Tests for 20261114000000_civilization_powers.sql: Create Subrace (DOW-43), Purify / Corrupt (DOW-46, DOW-40) and Advance City / Civilization (DOW-47).
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
  ('00000000-0000-0000-0000-0000000a0041', 'civ-host@example.com'),
  ('00000000-0000-0000-0000-0000000b0042', 'civ-bob@example.com');

-- A world with two gods.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0041');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Civworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Solara', '{Light}', '#E3B05B', '☀');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0042');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');


reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c0043', 'civ-outsider@example.com');

-- A 10×8 grassland map with one ocean hex at (9,7), and a started game.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0041');
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


create function pg_temp.w() returns uuid language sql as $$ select current_setting('test.w')::uuid $$;
create function pg_temp.id_of(n text) returns uuid language sql as $$
  select id from public.world_entities where world_id = pg_temp.w() and name = n
$$;
create function pg_temp.last_action() returns jsonb language sql as $$
  select payload from public.world_events where world_id = pg_temp.w() and type = 'action_taken'
  order by seq desc limit 1
$$;

-- The Dwarves on (4,4) with the city of Karak on (5,4).
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.set_power(100);
select public.create_race(pg_temp.w(), 'Dwarves', 'Stout folk', '', 1, 4, 4);
select public.found_city(pg_temp.w(), pg_temp.id_of('Dwarves'), 'Karak', 5, 4, 'A hall in the hill');

-- DOW-43: Create Subrace.
create function pg_temp.subrace(name text, x int, y int, parent text default 'Dwarves', alignment int default 0)
returns text language sql as $$
  select format($q$select public.create_subrace(%L, %L, %L, 'Splinter folk', '', %s, %s, %s)$q$,
    pg_temp.w(), coalesce(pg_temp.id_of(parent), '00000000-0000-0000-0000-000000000000'), name, alignment, x, y)
$$;
select pg_temp.expect_error(pg_temp.subrace('Deep Dwarves', 6, 4, 'Nobody'), 'Choose one of this world''s races',
  'a subrace needs a real parent race');
select pg_temp.expect_error(pg_temp.subrace('Deep Dwarves', 6, 4, 'Karak'), 'Choose one of this world''s races',
  'a city can''t have subraces');
select pg_temp.expect_error(pg_temp.subrace('Deep Dwarves', 8, 6), 'must start next to Dwarves''s land',
  'a subrace starts next to its ancestors');
select pg_temp.expect_error(pg_temp.subrace('Deep Dwarves', 4, 4), 'already lives', 'not on the homeland itself');
select pg_temp.expect_error(pg_temp.subrace('Deep Dwarves', 5, 4), 'already lives', 'not in a city');
select pg_temp.expect_error(pg_temp.subrace('Deep Dwarves', 9, 7), 'water', 'subraces live on land');
select pg_temp.expect_error(pg_temp.subrace('Karak', 6, 4), 'already called', 'names are unique');
select pg_temp.expect_error(pg_temp.subrace('Deep Dwarves', 6, 4, 'Dwarves', 2), 'good, neutral or evil',
  'a subrace starts at -1, 0 or +1');
select pg_temp.set_power(11);
select pg_temp.expect_error(pg_temp.subrace('Deep Dwarves', 6, 4), 'costs 12 power; you have 11',
  'Create Subrace costs 12 in the First Age');
select pg_temp.set_power(30);
select public.create_subrace(pg_temp.w(), pg_temp.id_of('Dwarves'), 'Deep Dwarves', 'They delve too deep',
  'Pale and silent', -1, 6, 4);
reset role;
select pg_temp.check(pg_temp.power() = 18, 'creating a subrace spends 12');
select pg_temp.check(
  (select kind = 'race' and parent_race_id = pg_temp.id_of('Dwarves') and alignment = -1 and hex_x = 6 and hex_y = 4
   from public.world_entities where id = pg_temp.id_of('Deep Dwarves')),
  'the subrace is a race with its lineage, next to its ancestors'' city');
select pg_temp.check(
  (select count(*) = 1 from public.world_entities where kind = 'order' and race_id = pg_temp.id_of('Deep Dwarves')),
  'its creator gets a sect');
select pg_temp.check(
  (select payload->>'power' = 'createSubrace' and (payload->>'cost')::int = 12
          and payload->'race'->>'parent_id' = pg_temp.id_of('Dwarves')::text
          and payload->'race'->>'name' = 'Deep Dwarves' and payload->'hexes' = '[[6,4]]'
          and payload->'order'->>'name' like 'Faithful of %'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the subrace is logged with its parent');
-- A subrace is a race: it can found cities of its own.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.found_city(pg_temp.w(), pg_temp.id_of('Deep Dwarves'), 'Underhold', 7, 4, 'Into the dark');
select pg_temp.check(pg_temp.id_of('Underhold') is not null, 'subraces found cities');

-- DOW-47: Advance Civilization / Advance City.
select pg_temp.set_power(100);
select pg_temp.expect_error(format($q$select public.advance(%L, %L, 'Steel', 'x')$q$, pg_temp.w(),
  (select id from public.world_entities where kind = 'order' limit 1)), 'races or cities', 'orders can''t be advanced');
select pg_temp.expect_error(format($q$select public.advance(%L, %L, '  ', 'x')$q$, pg_temp.w(), pg_temp.id_of('Dwarves')),
  'greatest at', 'an advancement needs a field');
select pg_temp.expect_error(format($q$select public.advance(%L, %L, 'Steel', ' ')$q$, pg_temp.w(), pg_temp.id_of('Dwarves')),
  'Describe', 'and a description');
select public.advance(pg_temp.w(), pg_temp.id_of('Dwarves'), ' Steel ', 'The forges never cool');
select pg_temp.check(pg_temp.power() = 90, 'Advance Civilization costs 10 in the First Age');
select public.advance(pg_temp.w(), pg_temp.id_of('Karak'), 'Writing', 'Runes on every wall');
select pg_temp.check(pg_temp.power() = 82, 'Advance City costs 8 in the First Age');
select pg_temp.expect_error(format($q$select public.advance(%L, %L, 'STEEL', 'Rivals')$q$, pg_temp.w(), pg_temp.id_of('Karak')),
  'Dwarves is already the greatest in the world at STEEL', 'only one can be the greatest at a field');
select pg_temp.check(pg_temp.power() = 82, 'a refused advancement costs nothing');
reset role;
select pg_temp.check(
  (select count(*) = 2 from public.world_advancements a
   where a.world_id = pg_temp.w() and ((a.entity_id = pg_temp.id_of('Dwarves') and a.field = 'Steel')
      or (a.entity_id = pg_temp.id_of('Karak') and a.field = 'Writing'))),
  'advancements are recorded against the race or city');
select pg_temp.check(
  (select payload->>'power' = 'advanceCity' and payload->>'choice' = 'Writing'
          and payload->'target'->>'kind' = 'city' and payload->'target'->>'id' = pg_temp.id_of('Karak')::text
          and payload->'advancement'->>'field' = 'Writing' and payload->'hexes' = '[[5,4]]'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the advancement is logged with its target');

-- DOW-46 + DOW-40: Purify / Corrupt, once per target per turn.
create function pg_temp.align(kind text, target text, x int, y int, direction int) returns text language sql as $$
  select format($q$select public.change_alignment(%L, %L, %L, %s, %s, %s, 'The gods meddle')$q$,
    pg_temp.w(), kind, pg_temp.id_of(target), coalesce(x::text, 'null'), coalesce(y::text, 'null'), direction)
$$;
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.set_power(100);
select pg_temp.check(public.change_alignment(pg_temp.w(), 'race', pg_temp.id_of('Dwarves'), null, null, 1, 'Blessed') = 2,
  'purifying a civilization raises its alignment');
select pg_temp.check(pg_temp.power() = 95, 'Purify Civilization costs 5 in the First Age');
select pg_temp.expect_error(pg_temp.align('race', 'Dwarves', null, null, -1), 'already changed the alignment of Dwarves this turn',
  'only once per civilization per turn, purify or corrupt');
select pg_temp.check(public.change_alignment(pg_temp.w(), 'city', pg_temp.id_of('Karak'), null, null, -1, 'Greed') = 0,
  'corrupting a city lowers its alignment');
select pg_temp.check(pg_temp.power() = 92, 'Corrupt City costs 3 in the First Age');
select pg_temp.expect_error(pg_temp.align('city', 'Karak', null, null, 1), 'already changed', 'once per city per turn');
select pg_temp.check(public.change_alignment(pg_temp.w(), 'region', null, 2, 2, 1, 'A holy grove') = 1,
  'purifying a region raises that hex''s alignment');
select pg_temp.check(pg_temp.power() = 88, 'Purify Region costs 4 in the First Age (priced like a city)');
select pg_temp.check(public.change_alignment(pg_temp.w(), 'region', null, 3, 2, -1, 'A cursed bog') = -1,
  'corrupting another region lowers it');
select pg_temp.check(pg_temp.power() = 85, 'Corrupt Region costs 3 in the First Age');
select pg_temp.expect_error(pg_temp.align('region', 'x', 2, 2, -1), 'already changed the alignment of the region at 2, 2',
  'once per region per turn');
select pg_temp.expect_error(pg_temp.align('region', 'x', 10, 0, 1), 'off the map', 'regions are on the map');
select pg_temp.expect_error(pg_temp.align('order', 'Dwarves', null, null, 1), 'civilization, a city or a region',
  'only civilizations, cities and regions');
select pg_temp.expect_error(pg_temp.align('city', 'Dwarves', null, null, 1), 'Choose one of this world''s cities',
  'a race isn''t a city');
select pg_temp.expect_error(pg_temp.align('race', 'Dwarves', null, null, 2), 'purify (+1) or corrupt (-1)', 'one step at a time');
reset role;
select pg_temp.check(
  (select alignment[2 * 10 + 2 + 1] = 1 and alignment[2 * 10 + 3 + 1] = -1 and alignment[1] = 0
   from public.world_map where world_id = pg_temp.w()),
  'region alignment is stored per hex');
select pg_temp.check(
  (select payload->>'power' = 'corruptRegion' and payload->'target'->>'kind' = 'region'
          and payload->'target'->>'key' = '3,2' and (payload->'alignment'->>'delta')::int = -1
          and (payload->'alignment'->>'after')::int = -1 and payload->'hexes' = '[[3,2]]'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken'
     and payload->>'power' = 'corruptRegion'),
  'alignment changes are logged with the target and the new value');

-- Another god may still purify the same target this turn... once it's their turn.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.end_turn(pg_temp.w());
reset role;
update public.god_power set power = 50 where god_id = pg_temp.active_god(pg_temp.w());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.check(public.change_alignment(pg_temp.w(), 'race', pg_temp.id_of('Dwarves'), null, null, -1, 'Whispers') = 1,
  'the limit is per god: another god can change the same target');
reset role;
-- And the first god can again in a later round. (Simulate the next round.)
update public.world_state set round = round + 1, active_position = array_position(turn_order, current_setting('test.actor')::uuid)
  where world_id = pg_temp.w();
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.check(public.change_alignment(pg_temp.w(), 'race', pg_temp.id_of('Dwarves'), null, null, 1, 'Again') = 2,
  'next turn, the same god can change it again');
reset role;
-- No cap on alignment.
update public.world_entities set alignment = 10 where id = pg_temp.id_of('Karak');
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.check(public.change_alignment(pg_temp.w(), 'city', pg_temp.id_of('Karak'), null, null, 1, 'Saintly') = 11,
  'there is no limit to how far alignment can go');

-- Who can see and write.
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.check((select count(*) from public.world_advancements) = 2, 'members see advancements');
select pg_temp.expect_error(format(
  $q$insert into public.world_advancements (world_id, entity_id, field, created_seq) values (%L, %L, 'Magic', 1)$q$,
  pg_temp.w(), pg_temp.id_of('Dwarves')), 'permission denied', 'advancements only go through advance()');
update public.world_map set alignment = null where true;
reset role;
select pg_temp.check((select alignment is not null from public.world_map where world_id = pg_temp.w()),
  'players can''t edit region alignment directly');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0043');
select pg_temp.check((select count(*) from public.world_advancements) = 0, 'outsiders see no advancements');
select pg_temp.expect_error(format($q$select public.advance(%L, %L, 'Magic', 'x')$q$, pg_temp.w(), pg_temp.id_of('Dwarves')),
  'isn''t your turn', 'outsiders can''t act');
reset role;

\echo 'All civilization checks passed.'
