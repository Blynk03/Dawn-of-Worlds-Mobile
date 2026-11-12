-- Tests for 20261119000000_battle_reactions.sql: the reaction window before a battle (DOW-56)
-- and bonuses the table can dispute (DOW-54).
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

-- Ash (a0091) attacks; Bryn (b0092) defends; Cole (c0093) is the third god.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0091', 'ash@example.com'),
  ('00000000-0000-0000-0000-0000000b0092', 'bryn@example.com'),
  ('00000000-0000-0000-0000-0000000c0093', 'cole@example.com');

select pg_temp.act_as('00000000-0000-0000-0000-0000000a0091');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Warworld') returning id, invite_code into w, c;
  perform set_config('t.w', w::text, false);
  perform set_config('t.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('t.w')::uuid, 'Ash', '{War}', '#E3B05B', '✶');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0092');
select public.join_world(current_setting('t.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('t.w')::uuid, 'Bryn', '{Stone}', '#EF4444', '▲');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0093');
select public.join_world(current_setting('t.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('t.w')::uuid, 'Cole', '{Sea}', '#3B82F6', '≈');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0091');
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

------------------------------------------------------------------------------------------------
-- Declaring.
------------------------------------------------------------------------------------------------
select pg_temp.turn('Ash');
select pg_temp.check(public.declare_attack(pg_temp.w(), pg_temp.id_of('Host of Ember'), 'city',
  pg_temp.id_of('Stonehold'), '["Steel"]', '["Walls"]', true, 'Embers on the wind') = 'pending',
  'an attack is declared, not rolled');
reset role;
select set_config('t.b', (select id::text from public.world_battles where world_id = pg_temp.w()), false);
select set_config('t.reserve', (pg_temp.price('commandCity') + pg_temp.price('commandRace'))::text, false);
select pg_temp.check(pg_temp.power_of('Ash') = 100 - pg_temp.price('commandRace') - current_setting('t.reserve')::int,
  'the attack is paid for, and the most destroying everything could cost set aside');
select pg_temp.check(pg_temp.status_of('Stonehold') = 'active' and pg_temp.status_of('Stone Guard') = 'active',
  'nothing has happened yet');
select pg_temp.check((select closes_at between now() + interval '11 hours 59 minutes' and now() + interval '12 hours 1 minute'
  from public.world_battles where id = current_setting('t.b')::uuid), 'the window is 12 hours');
select pg_temp.check((pg_temp.last('battle_declared') ->> 'reserved')::int = current_setting('t.reserve')::int
  and pg_temp.last('battle_declared') #>> '{target,name}' = 'Stonehold', 'the declaration is logged');
select pg_temp.check((select count(*) = 2 from public.world_events where world_id = pg_temp.w() and type = 'bonus_proposed'),
  'with the bonuses Ash proposed');
select pg_temp.check((select count(*) = 2 from public.push_outbox where world_id = pg_temp.w() and kind = 'battle'),
  'the other gods are told');
select pg_temp.check(not exists (select 1 from public.world_events where world_id = pg_temp.w() and type = 'action_taken'
  and payload ->> 'intent' = 'attack'), 'no battle in the chronicle yet');

select pg_temp.as_god('Ash');
select pg_temp.expect_error(format($q$select public.declare_attack(%L, %L, 'army', %L, '[]', '[]', false, 'Again')$q$,
  pg_temp.w(), pg_temp.id_of('Host of Ember'), pg_temp.id_of('Stone Guard')), 'already marching', 'one battle at a time per army');
select pg_temp.expect_error(format('select public.waive_reaction(%L, %L)', pg_temp.w(), current_setting('t.b')),
  'the others can waive', 'the attacker doesn''t waive');
select pg_temp.expect_error(format('select public.close_battle(%L, %L)', pg_temp.w(), current_setting('t.b')),
  'when the window closes', 'the battle waits for the window');
reset role;

------------------------------------------------------------------------------------------------
-- Bonuses: proposed, disputed, voted on.
------------------------------------------------------------------------------------------------
select pg_temp.as_god('Bryn');
select public.propose_bonus(pg_temp.w(), current_setting('t.b')::uuid, 'defender', 'Higher ground');
select pg_temp.expect_error(format($q$select public.propose_bonus(%L, %L, 'defender', 'Higher ground')$q$,
  pg_temp.w(), current_setting('t.b')), 'already there', 'no duplicate bonuses');
select pg_temp.expect_error(format($q$select public.propose_bonus(%L, %L, 'both', 'Rain')$q$,
  pg_temp.w(), current_setting('t.b')), 'attackers or the defenders', 'a bonus is for one side');
select pg_temp.expect_error(format('select public.dispute_bonus(%L, %L)', pg_temp.w(),
  (select id from public.world_battle_bonuses where label = 'Higher ground')), 'you proposed', 'you can''t dispute your own bonus');

select pg_temp.as_god('Cole');
select set_config('t.steel', public.dispute_bonus(pg_temp.w(),
  (select id from public.world_battle_bonuses where label = 'Steel'))::text, false);
select pg_temp.check((select status = 'disputed' from public.world_battle_bonuses where label = 'Steel'), 'Cole disputes Steel');
select pg_temp.expect_error(format('select public.dispute_bonus(%L, %L)', pg_temp.w(),
  (select id from public.world_battle_bonuses where label = 'Steel')), 'already been disputed', 'once');
select pg_temp.expect_error(format('select public.vote(%L, %L, ''undo'')', pg_temp.w(), current_setting('t.steel')),
  'isn''t a choice', 'a bonus vote is keep or drop');
select pg_temp.as_god('Ash');
select pg_temp.check(public.vote(pg_temp.w(), current_setting('t.steel')::uuid, 'keep') = 'open', 'one each');
select pg_temp.as_god('Bryn');
select pg_temp.check(public.vote(pg_temp.w(), current_setting('t.steel')::uuid, 'keep') = 'kept',
  'two of three keep Steel');
select pg_temp.check((select status = 'kept' from public.world_battle_bonuses where label = 'Steel'), 'Steel counts');

select pg_temp.as_god('Cole');
select set_config('t.hill', public.dispute_bonus(pg_temp.w(),
  (select id from public.world_battle_bonuses where label = 'Higher ground'))::text, false);
-- Left open: it's settled when the battle is rolled (one drop, no keep: dropped).

------------------------------------------------------------------------------------------------
-- Everyone waives: the battle is rolled.
------------------------------------------------------------------------------------------------
reset role;
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
insert into pg_temp.dice (value) values (6), (6), (1), (1); -- Host 12 + 1 vs Guard 2 + 1

select pg_temp.as_god('Bryn');
select pg_temp.check(public.waive_reaction(pg_temp.w(), current_setting('t.b')::uuid) = 'pending', 'one waiver of two');
select pg_temp.as_god('Cole');
select pg_temp.check(public.waive_reaction(pg_temp.w(), current_setting('t.b')::uuid) = 'won',
  'when everyone else has waived, the battle is rolled');
reset role;
select pg_temp.check((select status = 'dropped' from public.world_battle_bonuses where label = 'Higher ground'),
  'the open dispute was settled first: Higher ground dropped');
select pg_temp.check(pg_temp.last('action_taken') #> '{battle,attacker_modifiers}' = '["Steel"]'
  and pg_temp.last('action_taken') #> '{battle,defender_modifiers}' = '["Walls"]', 'only the bonuses that stood count');
select pg_temp.check(pg_temp.last('action_taken') ->> 'battle_id' = current_setting('t.b'), 'the battle is linked');
select pg_temp.check(pg_temp.status_of('Stone Guard') = 'destroyed' and pg_temp.status_of('Stonehold') = 'destroyed',
  'utterly destroyed');
select pg_temp.check(pg_temp.power_of('Ash') = 100 - pg_temp.price('commandRace') - current_setting('t.reserve')::int,
  'the reserve paid for the destruction');
select pg_temp.check((pg_temp.last('action_taken') ->> 'cost')::int = pg_temp.price('commandRace') + current_setting('t.reserve')::int,
  'the logged cost is the attack and the destruction');
select pg_temp.check(pg_temp.last('battle_resolved') ->> 'outcome' = 'won', 'the outcome is logged');
select pg_temp.check((select status = 'resolved' from public.world_battles where id = current_setting('t.b')::uuid), 'done');
select pg_temp.check((select count(*) = 0 from public.world_undo_log where world_id = pg_temp.w() and action_seq is null),
  'the battle''s changes belong to its action (so it can be objected to)');
select pg_temp.as_god('Cole');
select pg_temp.expect_error(format('select public.waive_reaction(%L, %L)', pg_temp.w(), current_setting('t.b')),
  'already been fought', 'a fought battle takes no more');
reset role;

------------------------------------------------------------------------------------------------
-- Called off: the target is gone by the time the window closes.
------------------------------------------------------------------------------------------------
update public.world_state set round = round + 1 where world_id = pg_temp.w();
select pg_temp.turn('Bryn');
select public.found_city(pg_temp.w(), pg_temp.id_of('Stonefolk'), 'Deepdelve', 5, 5, 'Under the hill');
select public.command_city(pg_temp.w(), pg_temp.id_of('Deepdelve'), 'raiseArmy',
  '{"name": "Delvers", "description": "Pickaxes"}');
select pg_temp.turn('Ash');
select pg_temp.check(public.declare_attack(pg_temp.w(), pg_temp.id_of('Host of Ember'), 'army',
  pg_temp.id_of('Delvers'), '[]', '[]', false, 'Hunt them') = 'pending', 'Ash declares on the Delvers');
reset role;
select set_config('t.b2', (select id::text from public.world_battles where world_id = pg_temp.w() and status = 'pending'), false);
update public.world_entities set status = 'scattered' where name = 'Delvers' and world_id = pg_temp.w();
update public.world_battles set closes_at = now() - interval '1 minute' where id = current_setting('t.b2')::uuid;
select pg_temp.check(public.close_expired_proposals() >= 1, 'the scheduled job rolls battles whose window has closed');
select pg_temp.check((select status = 'cancelled' from public.world_battles where id = current_setting('t.b2')::uuid),
  'the target was gone: called off');
select pg_temp.check(pg_temp.power_of('Ash') = 100 and (pg_temp.last('battle_cancelled') ->> 'refund')::int = pg_temp.price('commandRace'),
  'and refunded');

------------------------------------------------------------------------------------------------
-- No window in this world: attacks are rolled at once.
------------------------------------------------------------------------------------------------
update public.worlds set reaction_hours = 0 where id = pg_temp.w();
update public.world_entities set status = 'active' where name = 'Delvers' and world_id = pg_temp.w();
insert into pg_temp.dice (value) values (1), (1), (6), (6);
select pg_temp.turn('Ash');
select pg_temp.check(public.declare_attack(pg_temp.w(), pg_temp.id_of('Host of Ember'), 'army',
  pg_temp.id_of('Delvers'), '[]', '[]', false, 'Hunt them now') = 'lost', 'rolled straight away');
reset role;
select pg_temp.check(pg_temp.status_of('Host of Ember') = 'scattered', 'and lost');

select pg_temp.check((select count(*) = 0 from pg_temp.dice), 'all the scripted dice were used');
drop function public._roll_die(int);
alter function public._roll_die_real(int) rename to _roll_die;

-- Reading, not writing.
select pg_temp.as_god('Cole');
select pg_temp.check((select count(*) = 2 from public.world_battles), 'members read battles');
select pg_temp.expect_error('delete from public.world_battle_bonuses where true', 'permission denied', 'no writing bonuses directly');
reset role;

\o
\echo All battle reaction checks passed.
