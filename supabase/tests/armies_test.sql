-- Tests for 20261116000000_armies_and_battles.sql: Command City (DOW-48), battles (DOW-54/55) and total destruction (DOW-41).
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
  ('00000000-0000-0000-0000-0000000a0061', 'war-host@example.com'),
  ('00000000-0000-0000-0000-0000000b0062', 'war-bob@example.com');

-- A world with two gods.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0061');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Warworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Solara', '{Light}', '#E3B05B', '☀');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0062');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');


reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c0063', 'war-outsider@example.com');

-- A 10×8 grassland map with one ocean hex at (9,7), and a started game.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0061');
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


-- Scripted dice: queue the rolls a test wants; anything else rolls for real. Restored at the end.
create table pg_temp.dice (n serial, value int);
alter function public._roll_die(int) rename to _roll_die_real;
create function public._roll_die(sides int) returns int language plpgsql set search_path = '' as $$
declare v int; k int;
begin
  select n, value into k, v from pg_temp.dice order by n limit 1;
  if k is null then return public._roll_die_real(sides); end if;
  delete from pg_temp.dice where n = k;
  return v;
end $$;
create function pg_temp.queue(vals int[]) returns void language sql as $$
  insert into pg_temp.dice (value) select unnest(vals)
$$;
create function pg_temp.battle() returns jsonb language sql as $$
  select payload->'battle' from public.world_events where world_id = pg_temp.w() and type = 'action_taken'
  order by seq desc limit 1
$$;
create function pg_temp.status(n text) returns text language sql as $$
  select status from public.world_entities where world_id = pg_temp.w() and name = n
$$;

-- The actor: the Dwarves on (4,4), Karak on (5,4) and Durinhall on (4,5). The other god: the Elves
-- on (1,1) with Elfhame on (2,1).
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 200);
select public.create_race(pg_temp.w(), 'Dwarves', 'Stout folk', '', 1, 4, 4);
select public.found_city(pg_temp.w(), pg_temp.id_of('Dwarves'), 'Karak', 5, 4, 'A hall in the hill');
select public.found_city(pg_temp.w(), pg_temp.id_of('Dwarves'), 'Durinhall', 4, 5, 'A second hall');
reset role;
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.give(pg_temp.b(), 200);
select public.create_race(pg_temp.w(), 'Elves', 'Fair folk', '', 1, 1, 1);
select public.found_city(pg_temp.w(), pg_temp.id_of('Elves'), 'Elfhame', 2, 1, 'Under the trees');

-- DOW-48: Command City needs presence among the city's race.
select pg_temp.expect_error(format($q$select public.command_city(%L, %L, 'build', %L)$q$, pg_temp.w(),
  pg_temp.id_of('Karak'), '{"name": "x", "structure_type": "wall", "description": "x"}'),
  'To command the Dwarves, you need an order or avatar among them', 'commanding a city needs presence among its race');

-- Building.
reset role;
select pg_temp.next_round(pg_temp.a());
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 100);
create function pg_temp.city_sql(city text, action text, args jsonb) returns text language sql as $$
  select format($q$select public.command_city(%L, %L, %L, %L)$q$, pg_temp.w(), pg_temp.id_of(city), action, args)
$$;
select pg_temp.expect_error(pg_temp.city_sql('Karak', 'build', '{"name": "Iron Wall", "structure_type": "moat", "description": "x"}'),
  'Choose what to build', 'structures are wonders, walls, schools, towers, temples or other');
select pg_temp.expect_error(pg_temp.city_sql('Karak', 'summon', '{}'), 'build something or raise an army',
  'a city builds or raises an army');
select public.command_city(pg_temp.w(), pg_temp.id_of('Karak'), 'build',
  '{"name": "The Iron Wall", "structure_type": "wall", "description": "Walls of black iron"}');
select pg_temp.check(pg_temp.power_of(pg_temp.a()) = 94, 'Command City costs 6 in the First Age');
reset role;
select pg_temp.check(
  (select kind = 'structure' and structure_type = 'wall' and city_id = pg_temp.id_of('Karak')
          and race_id = pg_temp.id_of('Dwarves') and hex_x = 5 and hex_y = 4
   from public.world_entities where id = pg_temp.id_of('The Iron Wall')),
  'the structure belongs to the city');
select pg_temp.check(
  (select payload->>'intent' = 'build' and payload->'structure'->>'structure_type' = 'wall'
          and payload->'target'->>'name' = 'Karak'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the building is logged');

-- Raising armies: one per city per turn, a second through an avatar.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.command_city(pg_temp.w(), pg_temp.id_of('Karak'), 'raiseArmy',
  '{"name": "Host of Karak", "description": "The halls empty for war"}');
select pg_temp.expect_error(pg_temp.city_sql('Karak', 'raiseArmy', '{"name": "Second Host", "description": "x"}'),
  'Karak has already raised an army this turn', 'one army per city per turn');
select public.create_avatar(pg_temp.w(), 'Durin', 'Dwarf king', 'The deathless king', pg_temp.id_of('Dwarves'), 4, 4);
select public.command_avatar(pg_temp.w(), pg_temp.id_of('Durin'), 'commandCity',
  jsonb_build_object('city', pg_temp.id_of('Karak'), 'action', 'raiseArmy', 'name', 'Durin''s Guard',
    'description', 'The king calls his own'));
reset role;
select pg_temp.check(
  (select count(*) = 2 and bool_and(city_id = pg_temp.id_of('Karak') and race_id = pg_temp.id_of('Dwarves')
          and hex_x = 5 and hex_y = 4 and status = 'active' and alignment = 1)
   from public.world_entities where world_id = pg_temp.w() and kind = 'army'),
  'through an avatar, a city raises a second army in a turn');
select pg_temp.check(
  (select payload->>'power' = 'commandAvatar' and payload->>'intent' = 'raiseArmy'
          and payload->'army'->>'name' = 'Durin''s Guard' and payload->'avatar'->>'name' = 'Durin'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the avatar''s army is logged');

-- The Elves raise an army and march it toward Karak.
reset role;
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.give(pg_temp.b(), 100);
select public.command_city(pg_temp.w(), pg_temp.id_of('Elfhame'), 'raiseArmy',
  '{"name": "Elf Guard", "description": "Archers of the wood"}');
select pg_temp.expect_error(format($q$select public.march_army(%L, %L, 9, 7, 'x')$q$, pg_temp.w(), pg_temp.id_of('Elf Guard')),
  'water', 'armies march on land');
select pg_temp.expect_error(format($q$select public.march_army(%L, %L, 6, 4, 'x')$q$, pg_temp.w(), pg_temp.id_of('Host of Karak')),
  'need an order or avatar', 'marching an army is Command Race: it needs presence');
select public.march_army(pg_temp.w(), pg_temp.id_of('Elf Guard'), 6, 4, 'To the hills by Karak');
select pg_temp.check(pg_temp.power_of(pg_temp.b()) = 86, 'raising (6) and marching (Command Race, 8) an army');
reset role;
select pg_temp.check((select hex_x = 6 and hex_y = 4 from public.world_entities where id = pg_temp.id_of('Elf Guard')),
  'the army moves');
select pg_temp.check(
  (select payload->>'intent' = 'march' and payload->'march'->'from' = '[2,1]' and payload->'march'->'to' = '[6,4]'
   from public.world_events where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the march is logged');

-- DOW-54/55: the Elf Guard attacks Karak, defended by both its armies.
create function pg_temp.attack_sql(army text, kind text, target text, att jsonb, def jsonb, utter boolean) returns text language sql as $$
  select format($q$select public.attack(%L, %L, %L, %L, %L, %L, %L, 'War!')$q$,
    pg_temp.w(), pg_temp.id_of(army), kind, pg_temp.id_of(target), att, def, utter)
$$;
reset role;
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.give(pg_temp.b(), 50);
select pg_temp.expect_error(pg_temp.attack_sql('Elf Guard', 'city', 'Karak', '["x","x","x","x","x","x","x","x","x","x","x"]', '[]', false),
  'Up to 10 modifiers', 'at most 10 modifiers a side');
select pg_temp.expect_error(pg_temp.attack_sql('Elf Guard', 'city', 'Karak', '[" "]', '[]', false),
  'short reason', 'a modifier needs a reason');
select pg_temp.expect_error(pg_temp.attack_sql('Elf Guard', 'army', 'Elf Guard', '[]', '[]', false),
  'another army', 'an army can''t attack itself');
select pg_temp.expect_error(pg_temp.attack_sql('Host of Karak', 'city', 'Elfhame', '[]', '[]', false),
  'need an order or avatar', 'attacking needs presence among the army''s race');
reset role;
-- Battle 1: Elves 6+5 +1 = 12 vs Dwarves 2+3 +1 = 6. Battle 2 (tired, -1): 3+3 +1 -1 = 6 vs 1+4 +1 = 6,
-- a tie, fought again: 6+6 +1 -1 = 12 vs 1+1 +1 = 3.
select pg_temp.queue(array[6, 5, 2, 3,  3, 3, 1, 4,  6, 6, 1, 1]);
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.check(public.attack(pg_temp.w(), pg_temp.id_of('Elf Guard'), 'city', pg_temp.id_of('Karak'),
  '["Elven war magic"]', '["The Iron Wall"]', false, 'The Elves fall upon Karak') = 'won', 'the attacker wins');
select pg_temp.check(pg_temp.power_of(pg_temp.b()) = 42, 'attacking is Command Race (8); no destruction, no more to pay');
reset role;
select pg_temp.check((select count(*) = 0 from pg_temp.dice), 'all the scripted dice were used');
select pg_temp.check(
  (select jsonb_array_length(b->'battles') = 2
          and b->'battles'->0->'attacker_dice' = '[6,5]' and (b->'battles'->0->>'attacker_total')::int = 12
          and (b->'battles'->0->>'defender_total')::int = 6 and (b->'battles'->0->>'fatigue')::int = 0
          and b->'battles'->0->>'winner' = 'attacker'
          and b->'battles'->1->'attacker_dice' = '[6,6]' and (b->'battles'->1->>'fatigue')::int = 1
          and (b->'battles'->1->>'attacker_total')::int = 12 and (b->'battles'->1->>'defender_total')::int = 3
          and b->>'outcome' = 'won' and b->>'city_outcome' = 'ruined'
          and b->'attacker_modifiers' = '["Elven war magic"]' and b->'defender_modifiers' = '["The Iron Wall"]'
   from pg_temp.battle() b),
  'each defending army is a separate battle; the attacker tires; ties are fought again');
select pg_temp.check(pg_temp.status('Host of Karak') = 'scattered' and pg_temp.status('Durin''s Guard') = 'scattered',
  'beaten armies are scattered (survivors remain)');
select pg_temp.check(pg_temp.status('Karak') = 'ruined', 'a city with no defenders left is ruined');
select pg_temp.check((select hex_x = 5 and hex_y = 4 and status = 'active' from public.world_entities
  where id = pg_temp.id_of('Elf Guard')), 'the victors hold the city');

-- A ruined city can't be commanded or attacked again; a scattered army can't fight.
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(pg_temp.attack_sql('Elf Guard', 'city', 'Karak', '[]', '[]', false), 'already lies in ruins',
  'a ruined city can''t be taken again');
select pg_temp.expect_error(pg_temp.attack_sql('Elf Guard', 'army', 'Host of Karak', '[]', '[]', false), 'already scattered',
  'a scattered army can''t be attacked');
reset role;
select pg_temp.next_round(pg_temp.a());
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 100);
select pg_temp.expect_error(pg_temp.city_sql('Karak', 'raiseArmy', '{"name": "x", "description": "x"}'), 'Karak lies in ruins',
  'a ruined city can''t be commanded');
select pg_temp.expect_error(format($q$select public.march_army(%L, %L, 4, 4, 'x')$q$, pg_temp.w(), pg_temp.id_of('Host of Karak')),
  'is scattered', 'a scattered army can''t march');

-- A battle the attacker loses: the Iron Legion from Durinhall attacks the Elf Guard.
select public.command_city(pg_temp.w(), pg_temp.id_of('Durinhall'), 'raiseArmy',
  '{"name": "Iron Legion", "description": "Vengeance for Karak"}');
reset role;
select pg_temp.queue(array[1, 1, 6, 6]);
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.check(public.attack(pg_temp.w(), pg_temp.id_of('Iron Legion'), 'army', pg_temp.id_of('Elf Guard'),
  '[]', '[]', false, 'For Karak!') = 'lost', 'the attacker can lose');
reset role;
select pg_temp.check(pg_temp.status('Iron Legion') = 'scattered' and pg_temp.status('Elf Guard') = 'active',
  'the losing attacker is scattered');
select pg_temp.check(
  (select (hex_x, hex_y) = (4, 5) from public.world_entities where id = pg_temp.id_of('Iron Legion')),
  'a beaten attacker doesn''t advance');
select pg_temp.check((select b->>'outcome' = 'lost' and b->'scattered' = to_jsonb(array[pg_temp.id_of('Iron Legion')])
  from pg_temp.battle() b), 'the loss is logged');

-- DOW-41: total destruction costs the creation cost, and only what's actually destroyed.
reset role;
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.give(pg_temp.b(), 15);
select pg_temp.expect_error(pg_temp.attack_sql('Elf Guard', 'city', 'Durinhall', '[]', '[]', true),
  'could cost 16 power; you have 15', 'you must be able to pay for total destruction');
select pg_temp.give(pg_temp.b(), 30);
-- Durinhall has no army left (the Iron Legion is scattered): it falls without a battle.
select pg_temp.check(public.attack(pg_temp.w(), pg_temp.id_of('Elf Guard'), 'city', pg_temp.id_of('Durinhall'),
  '[]', '[]', true, 'Raze it') = 'won', 'an undefended city falls');
select pg_temp.check(pg_temp.power_of(pg_temp.b()) = 14, 'Command Race (8) plus the city''s creation cost (8)');
reset role;
select pg_temp.check(
  (select status = 'destroyed' and hex_x is null from public.world_entities where id = pg_temp.id_of('Durinhall')),
  'an utterly destroyed city is gone from the map');
select pg_temp.check(
  (select b->'battles' = '[]' and b->>'city_outcome' = 'destroyed' and (b->>'destruction_cost')::int = 8
          and b->'destroyed' = to_jsonb(array[pg_temp.id_of('Durinhall')])
   from pg_temp.battle() b),
  'the destruction is logged with what it cost');
select pg_temp.check(
  (select (payload->>'cost')::int = 16 from public.world_events
   where world_id = pg_temp.w() and type = 'action_taken' order by seq desc limit 1),
  'the action''s cost includes the destruction');
-- Its hex is free again.
select pg_temp.next_round(pg_temp.a());
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.give(pg_temp.a(), 100);
select public.found_city(pg_temp.w(), pg_temp.id_of('Dwarves'), 'New Durinhall', 4, 5, 'Rebuilt');
select pg_temp.check(pg_temp.id_of('New Durinhall') is not null, 'a destroyed city''s hex can be built on again');
-- Utterly destroying an army costs Command City (6).
select public.command_city(pg_temp.w(), pg_temp.id_of('New Durinhall'), 'raiseArmy',
  '{"name": "Last Stand", "description": "x"}');
reset role;
select pg_temp.next_round(pg_temp.b());
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.give(pg_temp.b(), 40);
reset role;
select pg_temp.queue(array[6, 6, 1, 1]);
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select public.attack(pg_temp.w(), pg_temp.id_of('Elf Guard'), 'army', pg_temp.id_of('Last Stand'), '[]', '[]', true, 'No survivors');
select pg_temp.check(pg_temp.power_of(pg_temp.b()) = 26, 'Command Race (8) plus the army''s creation cost (6)');
reset role;
select pg_temp.check(pg_temp.status('Last Stand') = 'destroyed', 'the army is utterly destroyed');

-- Players can't add armies directly; outsiders can't act.
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(format(
  $q$insert into public.world_entities (world_id, kind, name, race_id, created_seq) values (%L, 'army', 'Fake', %L, 1)$q$,
  pg_temp.w(), pg_temp.id_of('Elves')), 'permission denied', 'armies only come from Command City');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0063');
select pg_temp.expect_error(pg_temp.city_sql('Elfhame', 'raiseArmy', '{"name": "x", "description": "x"}'), 'isn''t your turn',
  'outsiders can''t act');
reset role;

-- Put the real dice back.
drop function public._roll_die(int);
alter function public._roll_die_real(int) rename to _roll_die;

\echo 'All army and battle checks passed.'
