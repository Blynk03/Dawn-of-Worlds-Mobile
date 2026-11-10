-- Row-level security tests for 20261102000000_profiles_worlds.sql.
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
  if user_id is null then
    execute 'set role anon';
  else
    execute 'set role authenticated';
  end if;
end $$;

-- Three users sign up. Profiles are created by the trigger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alexi@example.com', '{"display_name": "Alexi"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com', '{"full_name": "Carol C"}');

select pg_temp.check(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Alexi',
  'profile uses display_name from sign-up metadata');
select pg_temp.check(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'bob',
  'profile falls back to the email name');
select pg_temp.check(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000c') = 'Carol C',
  'profile falls back to full_name (e.g. from Google)');

-- Alexi creates a world and gets the row back (insert ... returning must pass RLS).
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$
declare new_id uuid;
begin
  insert into public.worlds (name) values ('Aerth') returning id into new_id;
  perform pg_temp.check(new_id is not null, 'creator can insert a world and read it back');
  perform set_config('test.world_id', new_id::text, false);
end $$;

select pg_temp.check(
  (select role from public.world_members
    where world_id = current_setting('test.world_id')::uuid
      and user_id = '00000000-0000-0000-0000-00000000000a') = 'host',
  'creator is added as host');
select pg_temp.check(
  (select created_by from public.worlds where id = current_setting('test.world_id')::uuid)
    = '00000000-0000-0000-0000-00000000000a',
  'created_by defaults to the signed-in user');

-- Alexi cannot create a world on someone else's behalf.
do $$
begin
  insert into public.worlds (name, created_by) values ('Forged', '00000000-0000-0000-0000-00000000000b');
  raise exception 'FAILED: should not create a world as another user';
exception when insufficient_privilege then
  perform pg_temp.check(true, 'cannot create a world as someone else');
end $$;

-- Alexi cannot add members directly (joining is via invites, DOW-22).
do $$
begin
  insert into public.world_members (world_id, user_id)
  values (current_setting('test.world_id')::uuid, '00000000-0000-0000-0000-00000000000b');
  raise exception 'FAILED: direct member insert should be blocked';
exception when insufficient_privilege then
  perform pg_temp.check(true, 'cannot add members directly');
end $$;

-- Simulate Bob joining through the (future) invite flow, as the database owner.
reset role;
insert into public.world_members (world_id, user_id)
values (current_setting('test.world_id')::uuid, '00000000-0000-0000-0000-00000000000b');

-- Bob (member) can read the world, its members, and Alexi's profile.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.worlds) = 1, 'member can read the world');
select pg_temp.check((select count(*) from public.world_members) = 2, 'member can see who is in the world');
select pg_temp.check(
  (select count(*) from public.profiles) = 2,
  'member can read world-mates'' profiles but not strangers''');

-- Bob is not the host, so he cannot rename or delete the world.
update public.worlds set name = 'Bobland' where id = current_setting('test.world_id')::uuid;
delete from public.worlds where id = current_setting('test.world_id')::uuid;
reset role;
select pg_temp.check(
  (select name from public.worlds where id = current_setting('test.world_id')::uuid) = 'Aerth',
  'non-host cannot rename or delete the world');

-- Carol (not a member) sees nothing.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.worlds) = 0, 'non-member cannot read the world');
select pg_temp.check((select count(*) from public.world_members) = 0, 'non-member cannot read members');
select pg_temp.check((select count(*) from public.profiles) = 1, 'non-member sees only their own profile');

-- Carol cannot edit Bob's profile, only her own.
update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set display_name = 'Carol the Kind' where id = '00000000-0000-0000-0000-00000000000c';
reset role;
select pg_temp.check(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'bob',
  'cannot edit someone else''s profile');
select pg_temp.check(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000c') = 'Carol the Kind',
  'can edit own profile');

-- Signed-out users see nothing.
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.worlds) = 0, 'anon cannot read worlds');
select pg_temp.check((select count(*) from public.profiles) = 0, 'anon cannot read profiles');
reset role;

-- The host can remove Bob; Bob can no longer read the world.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
delete from public.world_members where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.worlds) = 0, 'removed player loses access');

-- The host can rename the world.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update public.worlds set name = 'Aerth Reborn' where id = current_setting('test.world_id')::uuid;
reset role;
select pg_temp.check(
  (select name from public.worlds where id = current_setting('test.world_id')::uuid) = 'Aerth Reborn',
  'host can rename the world');

\echo 'All RLS checks passed.'
