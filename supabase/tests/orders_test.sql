-- Tests for 20261115000000_orders_and_avatars.sql: Orders (DOW-44), Avatars (DOW-45), presence to command (DOW-38) and the surcharge for commanding others' orders (DOW-39).
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
  ('00000000-0000-0000-0000-0000000a0051', 'ord-host@example.com'),
  ('00000000-0000-0000-0000-0000000b0052', 'ord-bob@example.com');

-- A world with two gods.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0051');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Orderworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Solara', '{Light}', '#E3B05B', '☀');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0052');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');


reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c0053', 'ord-outsider@example.com');

-- A 10×8 grassland map with one ocean hex at (9,7), and a started game.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0051');
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
create function pg_temp.last_payload() returns jsonb language sql as $$
  select payload from public.world_events where world_id = pg_temp.w() and type = 'action_taken'
  order by seq desc limit 1
$$;
-- Sets a god's power as the admin, then goes back to acting as whoever we were.
create function pg_temp.give(god uuid, n int) returns void language plpgsql as $$
declare was text := current_user;
begin
  execute 'reset role';
  update public.god_power set power = n where god_id = god;
  execute format('set role %I', was);
end $$;
create function pg_temp.power_of(god uuid) returns int language plpgsql as $$
declare was text := current_user; n int;
begin
  execute 'reset role';
  select power into n from public.god_power where god_id = god;
  execute format('set role %I', was);
  return n;
end $$;
-- Makes it `god`'s turn in a new round (each god acts once a round).
create function pg_temp.next_round(god uuid) returns void language plpgsql as $$
declare was text := current_user;
begin
  execute 'reset role';
  update public.world_state set round = round + 1, active_position = array_position(turn_order, god)
  where world_id = pg_temp.w();
  execute format('set role %I', was);
end $$;
select set_config('test.waiter', (select id::text from public.gods
  where world_id = pg_temp.w() and id <> current_setting('test.actor')::uuid), false);
create function pg_temp.a() returns uuid language sql as $$ select current_setting('test.actor')::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select current_setting('test.waiter')::uuid $$;

-- The actor creates the Dwarves (and so gets a sect among them) and the city of Karak.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 100);
select public.create_race(pg_temp.w(), 'Dwarves', 'Stout folk', '', 1, 4, 4);
select public.found_city(pg_temp.w(), pg_temp.id_of('Dwarves'), 'Karak', 5, 4, 'A hall in the hill');
reset role;
select pg_temp.check((select order_type = 'religious' and god_id = pg_temp.a() from public.world_entities
  where kind = 'order' and race_id = pg_temp.id_of('Dwarves')), 'a race''s creator gets a religious sect');

-- DOW-38: presence. The other god has nothing among the Dwarves, so can't command them.
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.give(pg_temp.b(), 100);
select pg_temp.expect_error(format($q$select public.found_city(%L, %L, 'Westwatch', 3, 4, 'x')$q$, pg_temp.w(),
  pg_temp.id_of('Dwarves')), 'To command the Dwarves, you need an order or avatar among them',
  'Command Race needs an order or avatar among the race');
select pg_temp.check(pg_temp.power_of(pg_temp.b()) = 100, 'a refused command costs nothing');

-- DOW-44: Create Order.
create function pg_temp.order_sql(race text, name text, kind text, purpose text) returns text language sql as $$
  select format($q$select public.create_order(%L, %L, %L, %L, %L)$q$, pg_temp.w(), pg_temp.id_of(race), name, kind, purpose)
$$;
select pg_temp.expect_error(pg_temp.order_sql('Karak', 'Wardens', 'knights', 'Guard'), 'Choose one of this world''s races',
  'orders are created within a race');
select pg_temp.expect_error(pg_temp.order_sql('Dwarves', ' ', 'knights', 'Guard'), 'Give the order a name', 'an order needs a name');
select pg_temp.expect_error(pg_temp.order_sql('Dwarves', 'Wardens', 'wizards', 'Guard'), 'what kind of order',
  'orders are sects, knights, thieves, brigands, pirates or other');
select pg_temp.expect_error(pg_temp.order_sql('Dwarves', 'Wardens', 'knights', ' '), 'what the order is for',
  'an order needs a purpose');
select public.create_order(pg_temp.w(), pg_temp.id_of('Dwarves'), 'Wardens of the West', 'knights', 'Guard the western road');
select pg_temp.check(pg_temp.power_of(pg_temp.b()) = 92, 'Create Order costs 8 in the First Age');
reset role;
select pg_temp.check(
  (select kind = 'order' and order_type = 'knights' and purpose = 'Guard the western road' and god_id = pg_temp.b()
          and race_id = pg_temp.id_of('Dwarves') and status = 'active'
   from public.world_entities where id = pg_temp.id_of('Wardens of the West')),
  'the order is recorded with its creator, kind and purpose');
select pg_temp.check(
  (select payload->>'power' = 'createOrder' and payload->'order'->>'order_type' = 'knights'
          and payload->'order'->>'race_id' = pg_temp.id_of('Dwarves')::text and payload->'hexes' = '[[4,4]]'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the new order is logged');

-- DOW-38: now the other god has presence among the Dwarves.
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select public.found_city(pg_temp.w(), pg_temp.id_of('Dwarves'), 'Westwatch', 3, 4, 'A watchtower');
select pg_temp.check(pg_temp.id_of('Westwatch') is not null, 'an order among the race lets a god command it');
reset role;
update public.world_entities set status = 'destroyed' where id = pg_temp.id_of('Wardens of the West');
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(format($q$select public.found_city(%L, %L, 'Eastwatch', 6, 4, 'x')$q$, pg_temp.w(),
  pg_temp.id_of('Dwarves')), 'need an order or avatar', 'a destroyed order is no presence');

-- DOW-44 + DOW-39: Command Order, with a surcharge for someone else's order.
select pg_temp.expect_error(format($q$select public.command_order(%L, %L, 'Ride out')$q$, pg_temp.w(),
  pg_temp.id_of('Wardens of the West')), 'Wardens of the West is no more', 'a destroyed order can''t be commanded');
reset role;
update public.world_entities set status = 'active' where id = pg_temp.id_of('Wardens of the West');
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.give(pg_temp.b(), 50);
select public.command_order(pg_temp.w(), pg_temp.id_of('Wardens of the West'), 'Ride to the border');
select pg_temp.check(pg_temp.power_of(pg_temp.b()) = 46, 'commanding your own order costs 4 in the First Age');
select pg_temp.check(
  (select payload->>'power' = 'commandOrder' and payload->>'choice' = 'Wardens of the West'
          and payload->>'description' = 'Ride to the border' and (payload->>'surcharge')::int = 0
          and payload->'target'->>'kind' = 'order'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the command is logged with its directive');
select pg_temp.expect_error(format($q$select public.command_order(%L, %L, '  ')$q$, pg_temp.w(),
  pg_temp.id_of('Wardens of the West')), 'Describe', 'a command needs a directive');
select public.command_order(pg_temp.w(),
  (select id from public.world_entities where kind = 'order' and god_id = pg_temp.a()), 'Convert the waverers');
select pg_temp.check(pg_temp.power_of(pg_temp.b()) = 32, 'someone else''s religious sect costs +10 (4 + 10)');
select pg_temp.check((pg_temp.last_payload()->>'surcharge')::int = 10, 'the surcharge is logged');
reset role;
select pg_temp.next_round(pg_temp.a());
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 50);
select public.command_order(pg_temp.w(), pg_temp.id_of('Wardens of the West'), 'Stand down');
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 41, 'someone else''s other order costs +5 (4 + 5)');

-- DOW-45: Create Avatar.
create function pg_temp.avatar_sql(name text, kind text, race text, x int, y int) returns text language sql as $$
  select format($q$select public.create_avatar(%L, %L, %L, 'A legend', %L, %s, %s)$q$,
    pg_temp.w(), name, kind, pg_temp.id_of(race), x, y)
$$;
select pg_temp.give(pg_temp.a(), 100);
select pg_temp.expect_error(pg_temp.avatar_sql('Durin', ' ', 'Dwarves', 4, 4), 'Say what the avatar is',
  'an avatar needs a kind');
select pg_temp.expect_error(pg_temp.avatar_sql('Durin', 'King', 'Dwarves', 10, 0), 'off the map', 'avatars are on the map');
select pg_temp.expect_error(pg_temp.avatar_sql('Durin', 'King', 'Karak', 4, 4), 'Choose one of this world''s races',
  'an avatar walks among a race, not a city');
select public.create_avatar(pg_temp.w(), 'Durin', 'Dwarf king', 'The deathless king', pg_temp.id_of('Dwarves'), 4, 4);
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 90, 'Create Avatar costs 10 in the First Age');
-- An avatar needn't belong to a race, nor stand on land.
select public.create_avatar(pg_temp.w(), 'Leviathan', 'Sea dragon', 'It sleeps beneath the waves', null, 9, 7);
reset role;
select pg_temp.check(
  (select kind = 'avatar' and avatar_type = 'Dwarf king' and race_id = pg_temp.id_of('Dwarves') and god_id = pg_temp.a()
          and hex_x = 4 and hex_y = 4 and status = 'active'
   from public.world_entities where id = pg_temp.id_of('Durin')),
  'the avatar is recorded with its kind, race, place and creator');
select pg_temp.check((select race_id is null from public.world_entities where id = pg_temp.id_of('Leviathan')),
  'an avatar may belong to no race');
select pg_temp.check(
  (select payload->'avatar'->>'name' = 'Leviathan' and payload->'avatar'->>'avatar_type' = 'Sea dragon'
          and payload->'hexes' = '[[9,7]]' from public.world_events
   where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the new avatar is logged');

-- DOW-45: Command Avatar.
create function pg_temp.command(avatar text, intent text, args jsonb) returns text language sql as $$
  select format($q$select public.command_avatar(%L, %L, %L, %L)$q$, pg_temp.w(), pg_temp.id_of(avatar), intent, args)
$$;
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.command_avatar(pg_temp.w(), pg_temp.id_of('Durin'), 'deed', '{"description": "Durin slays the wyrm"}');
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 78, 'Command Avatar costs 2 in the First Age');
reset role;
select pg_temp.check(
  (select payload->>'power' = 'commandAvatar' and payload->>'intent' = 'deed'
          and payload->'avatar'->>'name' = 'Durin' and payload->>'description' = 'Durin slays the wyrm'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'a mortal deed is logged');
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.expect_error(pg_temp.command('Durin', 'deed', '{"description": "Again"}'), 'Durin has already acted this turn',
  'an avatar acts once a turn');
-- Another avatar can still act this turn: purify Karak through Leviathan.
select public.command_avatar(pg_temp.w(), pg_temp.id_of('Leviathan'), 'purifyCity',
  jsonb_build_object('city', pg_temp.id_of('Karak'), 'description', 'The sea blesses the hall'));
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 76, 'an avatar''s immortal action costs Command Avatar (2), not Purify City (4)');
select pg_temp.check((select alignment = 2 from public.world_entities where id = pg_temp.id_of('Karak')),
  'the avatar''s purification counts');
select pg_temp.expect_error(format($q$select public.change_alignment(%L, 'city', %L, null, null, 1, 'Again')$q$,
  pg_temp.w(), pg_temp.id_of('Karak')), 'already changed the alignment of Karak this turn',
  'a change through an avatar counts toward once per target per turn');
-- The other god can't command these avatars.
reset role;
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(pg_temp.command('Durin', 'deed', '{"description": "Mine now"}'),
  'Only the god who created Durin can command them', 'only an avatar''s creator commands it');

-- Through an avatar: found a city (no presence needed: the avatar is there), create and command orders.
reset role;
select pg_temp.next_round(pg_temp.a());
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 20);
select public.command_avatar(pg_temp.w(), pg_temp.id_of('Durin'), 'foundCity',
  jsonb_build_object('race', pg_temp.id_of('Dwarves'), 'name', 'Durinhall', 'x', 4, 'y', 5, 'description', 'Durin builds a hall'));
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 18, 'founding a city through an avatar costs 2');
select pg_temp.check((select race_id = pg_temp.id_of('Dwarves') from public.world_entities where id = pg_temp.id_of('Durinhall')),
  'the avatar''s city belongs to the race');
select pg_temp.check(
  (select payload->>'power' = 'commandAvatar' and payload->>'intent' = 'foundCity' and payload->'city'->>'name' = 'Durinhall'
          and payload->'avatar'->>'id' = pg_temp.id_of('Durin')::text
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the city is logged as the avatar''s deed');
select public.command_avatar(pg_temp.w(), pg_temp.id_of('Leviathan'), 'createOrder',
  jsonb_build_object('race', pg_temp.id_of('Dwarves'), 'name', 'Deepwatch', 'order_type', 'pirates', 'purpose', 'Raid the coast'));
select pg_temp.check((select order_type = 'pirates' and god_id = pg_temp.a() from public.world_entities
  where id = pg_temp.id_of('Deepwatch')), 'an avatar can create an order');
reset role;
select pg_temp.next_round(pg_temp.a());
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 20);
select public.command_avatar(pg_temp.w(), pg_temp.id_of('Durin'), 'commandOrder',
  jsonb_build_object('order', pg_temp.id_of('Wardens of the West'), 'directive', 'Durin rallies the knights'));
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 18, 'commanding even someone else''s order through an avatar costs 2');

-- Create Race through an avatar: once per avatar, ever.
select public.command_avatar(pg_temp.w(), pg_temp.id_of('Leviathan'), 'createRace',
  jsonb_build_object('name', 'Merfolk', 'description', 'Children of the deep', 'appearance', '', 'alignment', 0, 'x', 1, 'y', 1));
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 16, 'creating a race through an avatar costs 2');
select pg_temp.check((select count(*) = 1 from public.world_entities where kind = 'order' and race_id = pg_temp.id_of('Merfolk')),
  'and its god gets a sect in it');
reset role;
select pg_temp.next_round(pg_temp.a());
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.expect_error(pg_temp.command('Leviathan', 'createRace',
  '{"name": "Seafolk", "description": "x", "appearance": "", "alignment": 0, "x": 1, "y": 2}'),
  'Leviathan has already created a race; an avatar may only do that once', 'Create Race (ONCE)');
select pg_temp.expect_error(pg_temp.command('Durin', 'gatherArmy', '{}'), 'can''t do that', 'unknown avatar actions are refused');

-- DOW-45: resurrection.
select pg_temp.expect_error(format($q$select public.resurrect_avatar(%L, %L, 'Rise')$q$, pg_temp.w(), pg_temp.id_of('Durin')),
  'Durin isn''t slain', 'only the slain can be resurrected');
reset role;
update public.world_entities set status = 'destroyed' where id = pg_temp.id_of('Durin');
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.expect_error(pg_temp.command('Durin', 'deed', '{"description": "x"}'), 'Durin is slain', 'the slain can''t act');
reset role;
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(format($q$select public.resurrect_avatar(%L, %L, 'Rise')$q$, pg_temp.w(), pg_temp.id_of('Durin')),
  'Only an avatar''s creator', 'only its creator can bring an avatar back');
reset role;
select pg_temp.next_round(pg_temp.a());
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 20);
select public.resurrect_avatar(pg_temp.w(), pg_temp.id_of('Durin'), 'Durin returns from the halls of stone');
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 15, 'resurrecting an avatar costs 5');
reset role;
select pg_temp.check((select status = 'active' from public.world_entities where id = pg_temp.id_of('Durin')),
  'the avatar is back');
select pg_temp.check(
  (select payload->>'power' = 'resurrectAvatar' and payload->'avatar'->>'status' = 'active'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the resurrection is logged');

-- DOW-38: an avatar among a race is presence too.
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.give(pg_temp.b(), 100);
reset role;
update public.world_entities set status = 'destroyed' where id = pg_temp.id_of('Wardens of the West');
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(format($q$select public.found_city(%L, %L, 'Eastwatch', 6, 4, 'x')$q$, pg_temp.w(),
  pg_temp.id_of('Dwarves')), 'need an order or avatar', 'without an order there, the other god has no presence');
select public.create_avatar(pg_temp.w(), 'Halla', 'Wandering seer', 'She walks among the dwarves', pg_temp.id_of('Dwarves'), 3, 5);
select public.found_city(pg_temp.w(), pg_temp.id_of('Dwarves'), 'Eastwatch', 6, 4, 'Halla guides them east');
select pg_temp.check(pg_temp.id_of('Eastwatch') is not null, 'an avatar among the race is presence');

-- Players can't add orders or avatars directly.
select pg_temp.expect_error(format(
  $q$insert into public.world_entities (world_id, kind, name, race_id, created_seq) values (%L, 'order', 'Fake', %L, 1)$q$,
  pg_temp.w(), pg_temp.id_of('Dwarves')), 'permission denied', 'orders only come from the powers');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0053');
select pg_temp.expect_error(format($q$select public.create_order(%L, %L, 'x', 'knights', 'x')$q$, pg_temp.w(),
  pg_temp.id_of('Dwarves')), 'isn''t your turn', 'outsiders can''t act');
reset role;

\echo 'All order and avatar checks passed.'
