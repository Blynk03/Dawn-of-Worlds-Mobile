-- Tests for 20261121000000_events_and_catastrophes.sql (DOW-49, DOW-50).
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

-- Ash (a0121) attacks; Bryn (b0122) defends; Cole (c0123) is the third god.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0121', 'fate-ash@example.com'),
  ('00000000-0000-0000-0000-0000000b0122', 'fate-bryn@example.com'),
  ('00000000-0000-0000-0000-0000000c0123', 'fate-cole@example.com');

select pg_temp.act_as('00000000-0000-0000-0000-0000000a0121');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Fateworld') returning id, invite_code into w, c;
  perform set_config('t.w', w::text, false);
  perform set_config('t.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('t.w')::uuid, 'Ash', '{War}', '#E3B05B', '✶');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0122');
select public.join_world(current_setting('t.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('t.w')::uuid, 'Bryn', '{Stone}', '#EF4444', '▲');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0123');
select public.join_world(current_setting('t.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('t.w')::uuid, 'Cole', '{Sea}', '#3B82F6', '≈');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0121');
select public.set_initial_map(current_setting('t.w')::uuid, 10, 8,
  array(select 'grassland' from generate_series(1, 80) i));
select public.start_world(current_setting('t.w')::uuid);
reset role;

create function pg_temp.w() returns uuid language sql as $$ select current_setting('t.w')::uuid $$;
create function pg_temp.god(n text) returns uuid language sql as $$
  select id from public.gods where world_id = pg_temp.w() and name = n
$$;
create function pg_temp.as_god(n text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform pg_temp.act_as((select user_id from public.gods where world_id = pg_temp.w() and name = n));
end $$;
-- Make it a god's turn (and give them power).
create function pg_temp.turn(n text) returns void language plpgsql as $$
begin
  execute 'reset role';
  update public.world_state
  set active_position = array_position(turn_order, pg_temp.god(n))
  where world_id = pg_temp.w();
  update public.god_power set power = 100 where god_id = pg_temp.god(n);
  perform pg_temp.as_god(n);
end $$;
create function pg_temp.id_of(n text) returns uuid language sql as $$
  select id from public.world_entities where world_id = pg_temp.w() and name = n
$$;
create function pg_temp.status_of(n text) returns text language sql as $$
  select status from public.world_entities where world_id = pg_temp.w() and name = n
$$;
create function pg_temp.power_of(n text) returns int language sql as $$
  select power from public.god_power where god_id = pg_temp.god(n)
$$;
create function pg_temp.price(p text) returns int language sql as $$
  select public._power_cost(pg_temp.w(), p)
$$;
create function pg_temp.last(t text) returns jsonb language sql as $$
  select payload from public.world_events where world_id = pg_temp.w() and type = t order by seq desc limit 1
$$;

-- Ash's Host of Ember (from Emberfall); Bryn's Stone Guard holds Stonehold.
select pg_temp.turn('Ash');
select public.create_race(pg_temp.w(), 'Emberfolk', 'Fiery', '', 0, 1, 1);
select public.found_city(pg_temp.w(), pg_temp.id_of('Emberfolk'), 'Emberfall', 2, 1, 'A forge town');
select public.command_city(pg_temp.w(), pg_temp.id_of('Emberfall'), 'raiseArmy',
  '{"name": "Host of Ember", "description": "They march"}');
select pg_temp.turn('Bryn');
select public.create_race(pg_temp.w(), 'Stonefolk', 'Stubborn', '', 0, 6, 5);
select public.found_city(pg_temp.w(), pg_temp.id_of('Stonefolk'), 'Stonehold', 7, 5, 'Walls of rock');
select public.command_city(pg_temp.w(), pg_temp.id_of('Stonehold'), 'raiseArmy',
  '{"name": "Stone Guard", "description": "They hold"}');
reset role;


-- Ash also has an order among the Emberfolk, an avatar, and advancements; Emberfall has a wall.
select pg_temp.turn('Ash');
select public.create_order(pg_temp.w(), pg_temp.id_of('Emberfolk'), 'Ashen Choir', 'religious', 'Sing the fire');
select public.create_avatar(pg_temp.w(), 'Cinder', 'Fire spirit', 'Walks in flame', pg_temp.id_of('Emberfolk'), 2, 1);
select public.advance(pg_temp.w(), pg_temp.id_of('Emberfolk'), 'Bronze', 'They smelt');
select public.advance(pg_temp.w(), pg_temp.id_of('Emberfall'), 'Masonry', 'They build');
reset role;
create function pg_temp.adv(f text) returns uuid language sql as $$
  select id from public.world_advancements where world_id = pg_temp.w() and field = f
$$;

------------------------------------------------------------------------------------------------
-- Events.
------------------------------------------------------------------------------------------------
select pg_temp.turn('Bryn');
select public.trigger_event(pg_temp.w(), 'race', pg_temp.id_of('Emberfolk'), 'Gold found', '{}',
  'A vein of gold in the hills');
reset role;
select pg_temp.check(pg_temp.power_of('Bryn') = 100 - pg_temp.price('event'), 'an event costs Event');
select pg_temp.check(pg_temp.last('action_taken') @> jsonb_build_object('power', 'event', 'choice', 'Gold found',
  'event_kind', 'Gold found', 'fates', '[]'::jsonb, 'advancements_lost', '[]'::jsonb),
  'a story event changes nothing but the chronicle');

select pg_temp.turn('Bryn');
select public.trigger_event(pg_temp.w(), 'race', pg_temp.id_of('Emberfolk'), 'Technology lost',
  jsonb_build_object('lose_advancement', pg_temp.adv('Bronze')), 'The smiths forget');
reset role;
select pg_temp.check(pg_temp.adv('Bronze') is null, 'an event can take an advancement away');
select pg_temp.check(pg_temp.last('action_taken') -> 'advancements_lost' -> 0 ->> 'field' = 'Bronze', 'logged');

select pg_temp.turn('Bryn');
select pg_temp.expect_error(format($q$select public.trigger_event(%L, 'race', %L, 'Plague', %L, 'x')$q$,
  pg_temp.w(), pg_temp.id_of('Emberfolk'), jsonb_build_object('lose_advancement', pg_temp.adv('Masonry'))),
  'isn''t emberfolk''s', 'only the target''s own advancements');
select pg_temp.expect_error(format($q$select public.trigger_event(%L, 'race', %L, 'Plague', '{"fate": "slain"}', 'x')$q$,
  pg_temp.w(), pg_temp.id_of('Emberfolk')), 'can''t happen', 'a civilization isn''t slain');
select pg_temp.expect_error(format($q$select public.trigger_event(%L, 'army', %L, 'Plague', '{}', 'x')$q$,
  pg_temp.w(), pg_temp.id_of('Host of Ember')), 'strikes an avatar', 'armies meet catastrophes, not events');
select pg_temp.expect_error(format($q$select public.trigger_event(%L, 'city', %L, ' ', '{}', 'x')$q$,
  pg_temp.w(), pg_temp.id_of('Emberfall')), 'name the event', 'an event has a name');

select public.trigger_event(pg_temp.w(), 'avatar', pg_temp.id_of('Cinder'), 'Plague', '{"fate": "slain"}',
  'Even spirits sicken');
reset role;
select pg_temp.check(pg_temp.status_of('Cinder') = 'destroyed', 'an event can slay an avatar (it can be brought back)');

select set_config('t.p', pg_temp.power_of('Bryn')::text, false);
select pg_temp.as_god('Bryn');
select public.trigger_event(pg_temp.w(), 'order', pg_temp.id_of('Ashen Choir'), 'Schism', '{"fate": "disbanded"}',
  'The choir splits');
reset role;
select pg_temp.check(pg_temp.status_of('Ashen Choir') = 'destroyed'
  and pg_temp.power_of('Bryn') = current_setting('t.p')::int - pg_temp.price('event') - pg_temp.price('createOrder'),
  'breaking up an order costs what it cost to create, on top');
select pg_temp.check((pg_temp.last('action_taken') ->> 'cost')::int = pg_temp.price('event') + pg_temp.price('createOrder'),
  'the logged cost includes it');

select pg_temp.turn('Bryn');
select public.trigger_event(pg_temp.w(), 'city', pg_temp.id_of('Stonehold'), 'Fire', '{"fate": "ruined"}', 'It burns');
reset role;
select pg_temp.check(pg_temp.status_of('Stonehold') = 'ruined', 'a city can be left in ruins');
select pg_temp.as_god('Bryn');
select pg_temp.expect_error(format($q$select public.trigger_event(%L, 'city', %L, 'Fire', '{}', 'x')$q$,
  pg_temp.w(), pg_temp.id_of('Stonehold')), 'already gone', 'not twice');
reset role;

------------------------------------------------------------------------------------------------
-- Catastrophes.
------------------------------------------------------------------------------------------------
-- Emberfall (2,1), the Host of Ember (still at Emberfall) and the Emberfolk homeland (1,1).
select pg_temp.turn('Bryn');
select pg_temp.expect_error(format($q$select public.catastrophe(%L, '[[2,1]]', 'Quake', null,
  '[{"id": "%s", "fate": "scattered"}]', '[]', 'x')$q$, pg_temp.w(), pg_temp.id_of('Stone Guard')),
  'stricken hexes', 'only what stands there');
select pg_temp.expect_error(format($q$select public.catastrophe(%L, '[[2,1]]', 'Quake', null,
  '[{"id": "%s", "fate": "slain"}]', '[]', 'x')$q$, pg_temp.w(), pg_temp.id_of('Emberfall')),
  'can''t happen', 'cities aren''t slain');
select pg_temp.expect_error(format($q$select public.catastrophe(%L, '[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0]]',
  'Quake', null, '[]', '[]', 'x')$q$, pg_temp.w()), 'at most 7', 'up to 7 hexes');
select pg_temp.expect_error(format($q$select public.catastrophe(%L, '[[2,1]]', 'Quake', 'lava', '[]', '[]', 'x')$q$,
  pg_temp.w()), 'valid terrain', 'real terrain only');
select pg_temp.expect_error(format($q$select public.catastrophe(%L, '[[5,5]]', 'Quake', null, '[]', %L, 'x')$q$,
  pg_temp.w(), jsonb_build_array(pg_temp.adv('Masonry'))), 'stricken hexes', 'only advancements of what''s struck');

select set_config('t.p', pg_temp.power_of('Bryn')::text, false);
select public.catastrophe(pg_temp.w(), '[[2,1],[1,1]]', 'Eruption', 'mountains',
  format('[{"id": "%s", "fate": "destroyed"}, {"id": "%s", "fate": "destroyed"}]',
    pg_temp.id_of('Emberfall'), pg_temp.id_of('Host of Ember'))::jsonb,
  jsonb_build_array(pg_temp.adv('Masonry')), 'The mountain wakes');
reset role;
select pg_temp.check((select terrain[1 * 10 + 2 + 1] = 'mountains' and terrain[1 * 10 + 1 + 1] = 'mountains'
  from public.world_map where world_id = pg_temp.w()), 'the land changes');
select pg_temp.check(pg_temp.status_of('Emberfall') = 'destroyed' and pg_temp.status_of('Host of Ember') = 'destroyed',
  'the city and the army are destroyed');
select pg_temp.check((select hex_x is null from public.world_entities where world_id = pg_temp.w() and name = 'Host of Ember'),
  'a destroyed army leaves the map');
select pg_temp.check(pg_temp.status_of('Emberfolk') = 'active', 'the civilization survives (it wasn''t chosen)');
select pg_temp.check(pg_temp.adv('Masonry') is null, 'Emberfall''s Masonry is lost');
select pg_temp.check(pg_temp.power_of('Bryn') = current_setting('t.p')::int
  - 2 * pg_temp.price('catastrophe') - pg_temp.price('commandRace') - pg_temp.price('commandCity'),
  'two hexes, plus destroying the city and the army utterly');
select pg_temp.check(pg_temp.last('action_taken') @> jsonb_build_object('power', 'catastrophe', 'choice', 'Eruption',
  'terrain', 'mountains', 'destruction_cost', pg_temp.price('commandRace') + pg_temp.price('commandCity'))
  and jsonb_array_length(pg_temp.last('action_taken') -> 'fates') = 2, 'logged');
select pg_temp.check((select count(*) = 0 from public.world_undo_log where world_id = pg_temp.w() and action_seq is null),
  'every change belongs to its action (so it can be objected to)');

\o
\echo All event and catastrophe checks passed.
