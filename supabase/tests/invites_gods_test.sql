-- Tests for 20261103000000_invites_and_gods.sql: invite codes, joining, gods, starting a game.
-- Run with scripts/test-db.sh. Any failed check raises an exception and stops the script.
\set ON_ERROR_STOP on
\o /dev/null

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(user_id::text, ''), false);
  if user_id is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

-- Expects `stmt` to fail with an error whose message contains `expected`.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'host@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'bob@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'carol@example.com'),
  ('00000000-0000-0000-0000-0000000000d4', 'dave@example.com');

-- Host creates a world; it gets an invite code.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Aerth') returning id, invite_code into w, c;
  perform pg_temp.check(c ~ '^[A-HJKMNP-Z2-9]{6}$', 'new world gets a 6-character code without look-alikes');
  perform set_config('test.world', w::text, false);
  perform set_config('test.code', c, false);
end $$;

-- Bob joins by code, typed loosely (lowercase, spaces, dash).
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.check(
  public.join_world(lower(substr(current_setting('test.code'), 1, 3)) || ' - ' || lower(substr(current_setting('test.code'), 4)))
    = current_setting('test.world')::uuid,
  'join_world accepts a loosely typed code');
select pg_temp.check((select count(*) from public.worlds) = 1, 'joined player can read the world');
select pg_temp.check(
  public.join_world(current_setting('test.code')) = current_setting('test.world')::uuid,
  'joining twice is harmless');
select pg_temp.check(
  (select count(*) from public.world_members where world_id = current_setting('test.world')::uuid) = 2,
  'joining twice does not duplicate membership');
select pg_temp.expect_error($q$select public.join_world('ZZZZZZ')$q$, 'No world has that invite code', 'wrong code is rejected');

-- Signed-out users cannot join.
select pg_temp.act_as(null);
select pg_temp.expect_error(format('select public.join_world(%L)', current_setting('test.code')),
  'permission denied', 'anon cannot call join_world');

-- Gods.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
insert into public.gods (world_id, name, spheres, color, sigil, personality)
values (current_setting('test.world')::uuid, 'Solara', '{Light,Fire}', '#E3B05B', '☀', 'Proud and warm');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_error(format(
  $q$insert into public.gods (world_id, name, spheres, color, sigil) values (%L, 'Umbra', '{Darkness}', '#E3B05B', '☾')$q$,
  current_setting('test.world')), 'gods_world_id_color_key', 'two gods cannot share a color');
select pg_temp.expect_error(format(
  $q$insert into public.gods (world_id, name, spheres, color, sigil) values (%L, 'solara ', '{Darkness}', '#3B82F6', '☾')$q$,
  current_setting('test.world')), 'gods_world_name_idx', 'two gods cannot share a name (ignoring case/spaces)');
select pg_temp.expect_error(format(
  $q$insert into public.gods (world_id, name, spheres, color, sigil) values (%L, 'Umbra', '{A,B,C,D}', '#3B82F6', '☾')$q$,
  current_setting('test.world')), 'gods_spheres_check', 'at most 3 spheres');
select pg_temp.expect_error(format(
  $q$insert into public.gods (world_id, name, spheres, color, sigil) values (%L, 'Umbra', '{}', '#3B82F6', '☾')$q$,
  current_setting('test.world')), 'gods_spheres_check', 'at least 1 sphere');
select pg_temp.expect_error(format(
  $q$insert into public.gods (world_id, user_id, name, spheres, color, sigil) values (%L, '00000000-0000-0000-0000-0000000000a1', 'Fake', '{War}', '#3B82F6', '⚔')$q$,
  current_setting('test.world')), 'row-level security', 'cannot create a god for someone else');

-- Bob cannot start the game yet: not the host.
select pg_temp.expect_error(format('select public.start_world(%L)', current_setting('test.world')),
  'Only the host', 'only the host can start');

-- Host cannot start with one god.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error(format('select public.start_world(%L)', current_setting('test.world')),
  'At least 2 gods', 'needs at least 2 gods');

-- Carol (not a member) can't see gods; Dave joins without a god.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select pg_temp.check((select count(*) from public.gods) = 0, 'non-member cannot read gods');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select public.join_world(current_setting('test.code'));

-- Bob makes his god.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.world')::uuid, 'Umbra', '{Darkness,Dreams}', '#3B82F6', '☾');
select pg_temp.check((select count(*) from public.gods) = 2, 'members see every god in the world');

-- Dave has no god, so the game can't start.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error(format('select public.start_world(%L)', current_setting('test.world')),
  'Every player needs a god', 'every player needs a god');

-- Host removes Dave in the lobby.
delete from public.world_members where user_id = '00000000-0000-0000-0000-0000000000d4';
reset role;
select pg_temp.check(
  not exists (select 1 from public.world_members where user_id = '00000000-0000-0000-0000-0000000000d4'),
  'host can remove a player in the lobby');

-- Start.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.start_world(current_setting('test.world')::uuid);
reset role;
select pg_temp.check(
  (select status from public.worlds where id = current_setting('test.world')::uuid) = 'active',
  'host starts the game');

-- After the start: no joining, no new gods, no removing players, locked god fields.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select pg_temp.expect_error(format('select public.join_world(%L)', current_setting('test.code')),
  'already started', 'cannot join a started world');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
update public.gods set name = 'Umbra the Veiled', personality = 'Quiet' where name = 'Umbra';
select pg_temp.check((select name from public.gods where color = '#3B82F6') = 'Umbra the Veiled',
  'name stays editable after the start');
select pg_temp.expect_error(
  $q$update public.gods set color = '#10B981' where name = 'Umbra the Veiled'$q$,
  'locked once the game has started', 'color is locked after the start');
select pg_temp.expect_error(
  $q$update public.gods set spheres = '{War}' where name = 'Umbra the Veiled'$q$,
  'locked once the game has started', 'spheres are locked after the start');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
delete from public.world_members where user_id = '00000000-0000-0000-0000-0000000000b2';
reset role;
select pg_temp.check(
  exists (select 1 from public.world_members where user_id = '00000000-0000-0000-0000-0000000000b2'),
  'host cannot remove players after the start');

-- A full world (8 players) rejects a 9th.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Crowded') returning id, invite_code into w, c;
  perform set_config('test.full_world', w::text, false);
  perform set_config('test.full_code', c, false);
end $$;
reset role;
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-00000000f0' || lpad(i::text, 2, '0'))::uuid, 'p' || i || '@example.com'
from generate_series(1, 8) i;
insert into public.world_members (world_id, user_id)
select current_setting('test.full_world')::uuid, ('00000000-0000-0000-0000-00000000f0' || lpad(i::text, 2, '0'))::uuid
from generate_series(1, 7) i;
select pg_temp.act_as('00000000-0000-0000-0000-00000000f008');
select pg_temp.expect_error(format('select public.join_world(%L)', current_setting('test.full_code')),
  'full', 'a world with 8 players is full');

-- GM role: the host can mark themselves GM in the lobby, and a GM without a god may start.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$
declare w uuid;
begin
  insert into public.worlds (name) values ('GM World') returning id into w;
  perform set_config('test.gm_world', w::text, false);
end $$;
select public.set_my_gm_role(current_setting('test.gm_world')::uuid, true);
reset role;
insert into public.world_members (world_id, user_id) values
  (current_setting('test.gm_world')::uuid, '00000000-0000-0000-0000-0000000000b2'),
  (current_setting('test.gm_world')::uuid, '00000000-0000-0000-0000-0000000000c3');
insert into public.gods (world_id, user_id, name, spheres, color, sigil) values
  (current_setting('test.gm_world')::uuid, '00000000-0000-0000-0000-0000000000b2', 'B', '{War}', '#3B82F6', '⚔'),
  (current_setting('test.gm_world')::uuid, '00000000-0000-0000-0000-0000000000c3', 'C', '{Sea}', '#10B981', '⚓');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.start_world(current_setting('test.gm_world')::uuid);
reset role;
select pg_temp.check(
  (select status from public.worlds where id = current_setting('test.gm_world')::uuid) = 'active',
  'a GM without a god can start a game for 2 players');

\echo 'All invite and god checks passed.'
