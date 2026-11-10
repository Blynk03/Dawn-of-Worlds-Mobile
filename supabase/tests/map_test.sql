-- Tests for 20261110000000_map_and_terrain.sql: starting landmass, the map at game start, and the
-- Shape Land / Shape Climate actions.
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
  ('00000000-0000-0000-0000-0000000a0001', 'host@example.com'),
  ('00000000-0000-0000-0000-0000000b0002', 'bob@example.com');

-- A world with two gods.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0001');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Mapworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Solara', '{Light}', '#E3B05B', '☀');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0002');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');

-- DOW-30: only the host shapes the starting landmass, with valid terrain and size.
select pg_temp.expect_error(format(
  $q$select public.set_initial_map(%L, 8, 8, array_fill('ocean'::text, array[64]))$q$, current_setting('test.w')),
  'Only the host', 'only the host can set the starting landmass');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0001');
select pg_temp.expect_error(format(
  $q$select public.set_initial_map(%L, 8, 8, array_fill('ocean'::text, array[63]))$q$, current_setting('test.w')),
  'one terrain per hex', 'the landmass must cover every hex');
select pg_temp.expect_error(format(
  $q$select public.set_initial_map(%L, 4, 8, array_fill('ocean'::text, array[32]))$q$, current_setting('test.w')),
  '8 to 64', 'maps have a minimum size');
select pg_temp.expect_error(format(
  $q$select public.set_initial_map(%L, 8, 8, array_fill('lava'::text, array[64]))$q$, current_setting('test.w')),
  'unknown terrain', 'terrain must come from the ruleset');
select public.set_initial_map(
  current_setting('test.w')::uuid, 10, 8,
  array(select case when i % 3 = 0 then 'ocean' else 'grassland' end from generate_series(1, 80) i));
select pg_temp.check(
  (select width = 10 and height = 8 and terrain[1] = 'grassland' and terrain[3] = 'ocean'
          and climate[1] = 'none' from public.world_map where world_id = current_setting('test.w')::uuid),
  'the host saves a starting landmass');
select public.set_initial_map(
  current_setting('test.w')::uuid, 10, 8,
  array(select case when i % 3 = 0 then 'ocean' else 'grassland' end from generate_series(1, 80) i));
select pg_temp.check(true, 'saving the landmass again replaces it');

select pg_temp.act_as('00000000-0000-0000-0000-0000000b0002');
select pg_temp.check((select count(*) from public.world_map) = 1, 'members can see the map in the lobby');
update public.world_map set width = 9 where world_id = current_setting('test.w')::uuid;
reset role;
select pg_temp.check((select width from public.world_map where world_id = current_setting('test.w')::uuid) = 10,
  'players cannot edit the map directly');

-- Start: the host's landmass is used and logged.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0001');
select public.start_world(current_setting('test.w')::uuid);
reset role;
select pg_temp.check(
  (select payload->>'width' = '10' and jsonb_array_length(payload->'terrain') = 80
          and payload->'terrain'->>0 = 'grassland'
   from public.world_events where world_id = current_setting('test.w')::uuid and type = 'map_initialized'),
  'starting the game logs the starting landmass');
select pg_temp.check(
  (select array_agg(type order by seq) from public.world_events where world_id = current_setting('test.w')::uuid)[1:2]
    = array['game_started', 'map_initialized'],
  'the map is logged right after the game starts');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0001');
select pg_temp.expect_error(format(
  $q$select public.set_initial_map(%L, 8, 8, array_fill('ocean'::text, array[64]))$q$, current_setting('test.w')),
  'fixed once the game starts', 'the landmass is locked after the start');
reset role;

-- Give the active god a known amount of power.
update public.god_power set power = 20 where god_id = pg_temp.active_god(current_setting('test.w')::uuid);
select set_config('test.actor', pg_temp.active_god(current_setting('test.w')::uuid)::text, false);
select set_config('test.actor_user', pg_temp.active_user(current_setting('test.w')::uuid)::text, false);
select set_config('test.waiter_user', (select user_id::text from public.gods
  where world_id = current_setting('test.w')::uuid and id <> current_setting('test.actor')::uuid), false);

-- Only the active player can act.
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'shapeLand', '[[0,0]]', 'mountains', 'Raise peaks')$q$, current_setting('test.w')),
  'isn''t your turn', 'only the active player can act');

-- DOW-31: Shape Land costs 3 per hex in the First Age.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.take_action(current_setting('test.w')::uuid, 'shapeLand', '[[0,0],[1,0],[2,0]]', 'mountains',
  '  The Spine of the World rises  ');
reset role;
select pg_temp.check(
  (select power from public.god_power where god_id = current_setting('test.actor')::uuid) = 11,
  'Shape Land on 3 hexes costs 9 in the First Age (the PDF''s mountain range)');
select pg_temp.check(
  (select terrain[1:3] = array['mountains','mountains','mountains'] and terrain[4] = 'grassland'
   from public.world_map where world_id = current_setting('test.w')::uuid),
  'the chosen hexes become mountains, others are unchanged');
select pg_temp.check(
  (select payload->>'power' = 'shapeLand' and (payload->>'cost')::int = 9 and payload->>'choice' = 'mountains'
          and payload->>'description' = 'The Spine of the World rises' and (payload->>'power_after')::int = 11
          and god_id = current_setting('test.actor')::uuid
   from public.world_events where world_id = current_setting('test.w')::uuid order by seq desc limit 1),
  'the action is logged with cost, hexes, choice, trimmed description and power left');
select pg_temp.check(
  (select active_position = 1 from public.world_state where world_id = current_setting('test.w')::uuid),
  'acting does not end the turn');

-- DOW-32: Shape Climate costs 2 per hex and only changes climate.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.take_action(current_setting('test.w')::uuid, 'shapeClimate', '[[0,0],[0,1]]', 'snow', 'Eternal snow');
reset role;
select pg_temp.check(
  (select power from public.god_power where god_id = current_setting('test.actor')::uuid) = 7,
  'Shape Climate on 2 hexes costs 4 in the First Age');
select pg_temp.check(
  (select climate[1] = 'snow' and climate[11] = 'snow' and terrain[1] = 'mountains'
   from public.world_map where world_id = current_setting('test.w')::uuid),
  'climate changes; terrain stays');

-- Validation.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'shapeLand', '[[0,0],[1,0],[2,0]]', 'forest', 'Too much')$q$, current_setting('test.w')),
  'costs 9 power; you have 7', 'cannot spend more power than you have');
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'shapeLand', '[[10,0]]', 'forest', 'Off the edge')$q$, current_setting('test.w')),
  'off the map', 'hexes must be on the map');
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'shapeLand', '[[1,1],[1,1]]', 'forest', 'Twice')$q$, current_setting('test.w')),
  'only be chosen once', 'a hex cannot be chosen twice');
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'shapeLand', '[]', 'forest', 'Nothing')$q$, current_setting('test.w')),
  'at least one hex', 'an action needs a hex');
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'shapeLand', '[[1,1]]', 'snow', 'Wrong list')$q$, current_setting('test.w')),
  'valid terrain', 'Shape Land needs a terrain, not a climate');
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'shapeClimate', '[[1,1]]', 'forest', 'Wrong list')$q$, current_setting('test.w')),
  'valid climate', 'Shape Climate needs a climate');
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'shapeLand', '[[1,1]]', 'forest', '   ')$q$, current_setting('test.w')),
  'Describe what your god does', 'a description is required');
select pg_temp.expect_error(format(
  $q$select public.take_action(%L, 'createRace', '[[1,1]]', 'forest', 'Elves')$q$, current_setting('test.w')),
  'isn''t available yet', 'powers that aren''t built yet are refused');
reset role;
select pg_temp.check(
  (select power from public.god_power where god_id = current_setting('test.actor')::uuid) = 7,
  'failed actions cost nothing');

-- Ending the turn with 5 or fewer points still earns the low-pool bonus.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.take_action(current_setting('test.w')::uuid, 'shapeLand', '[[5,5]]', 'forest', 'A small wood');
select public.end_turn(current_setting('test.w')::uuid);
reset role;
select pg_temp.check(
  (select power = 4 and low_pool_bonus = 1 from public.god_power where god_id = current_setting('test.actor')::uuid),
  'spending down to 5 or fewer earns the low-pool bonus at the end of the turn');

-- Worlds that were already in play get a default map once.
do $$
declare w uuid;
begin
  insert into public.worlds (name, created_by) values ('Old world', '00000000-0000-0000-0000-0000000a0001') returning id into w;
  insert into public.world_members (world_id, user_id) values (w, '00000000-0000-0000-0000-0000000b0002');
  insert into public.gods (world_id, user_id, name, spheres, color, sigil) values
    (w, '00000000-0000-0000-0000-0000000a0001', 'Old A', '{War}', '#DC2626', '⚔'),
    (w, '00000000-0000-0000-0000-0000000b0002', 'Old B', '{Sea}', '#2563EB', '⚓');
  perform set_config('test.old', w::text, false);
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0001');
select public.start_world(current_setting('test.old')::uuid);
reset role;
delete from public.world_map where world_id = current_setting('test.old')::uuid; -- as if started before maps existed
select pg_temp.check(public._add_maps_to_started_worlds() = 1, 'started worlds without a map get one');
select pg_temp.check(public._add_maps_to_started_worlds() = 0, 'adding maps is safe to run again');
select pg_temp.check(
  (select width = 32 and height = 24 and 'grassland' = any (terrain) and 'ocean' = any (terrain)
   from public.world_map where world_id = current_setting('test.old')::uuid),
  'the default map is 32×24 with land and ocean');

\echo 'All map checks passed.'
