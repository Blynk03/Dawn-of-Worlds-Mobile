-- Tests for 20261112000000_chronicle_social.sql: comments, reactions and unread counts (DOW-37).
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
  ('00000000-0000-0000-0000-0000000a0021', 'feed-host@example.com'),
  ('00000000-0000-0000-0000-0000000b0022', 'feed-bob@example.com');

-- A world with two gods.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0021');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Feedworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Solara', '{Light}', '#E3B05B', '☀');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0022');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Umbra', '{Darkness}', '#7C3AED', '☾');


reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c0023', 'feed-outsider@example.com');

-- A 10×8 grassland map with one ocean hex at (9,7), and a started game.
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0021');
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


-- One action to talk about: the active god shapes a hex.
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.set_power(10);
select public.take_action(current_setting('test.w')::uuid, 'shapeLand', '[[1,1]]', 'hills', 'Hills rise');
reset role;
select set_config('test.seq', (select max(seq)::text from public.world_events
  where world_id = current_setting('test.w')::uuid and type = 'action_taken'), false);
create function pg_temp.comment(body text, reply_to uuid default null) returns uuid language sql as $$
  select public.add_comment(current_setting('test.w')::uuid, current_setting('test.seq')::int, body, reply_to)
$$;
create function pg_temp.unread() returns int language sql as $$
  select unread from public.unread_counts() where world_id = current_setting('test.w')::uuid
$$;

-- Who can comment, and on what.
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0023');
select pg_temp.expect_error($q$select pg_temp.comment('hi')$q$, 'not in this world', 'outsiders can''t comment');
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.expect_error(format($q$select public.add_comment(%L, 1, 'hi')$q$, current_setting('test.w')),
  'doesn''t exist', 'comments go on actions, not other events');
select pg_temp.expect_error($q$select pg_temp.comment('   ')$q$, 'Write something', 'empty comments are refused');
select pg_temp.expect_error(format($q$select pg_temp.comment(%L)$q$, repeat('x', 1001)), 'under 1000',
  'long comments are refused');

-- Unread: the waiter hasn't read the actor's action yet.
select pg_temp.check(pg_temp.unread() = 1, 'another god''s action is unread');
select set_config('test.c1', pg_temp.comment('  Lovely hills  ')::text, false);
select pg_temp.check((select body = 'Lovely hills' and parent_id is null and user_id = current_setting('test.waiter_user')::uuid
  from public.action_comments where id = current_setting('test.c1')::uuid), 'a member can comment on an action');
select pg_temp.check(pg_temp.unread() = 1, 'your own comments are never unread');

select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select pg_temp.check(pg_temp.unread() = 1, 'your own actions are never unread; others'' comments are');
select set_config('test.c2', pg_temp.comment('Thanks!', current_setting('test.c1')::uuid)::text, false);
select set_config('test.c3', pg_temp.comment('Reply to a reply', current_setting('test.c2')::uuid)::text, false);
select pg_temp.check((select bool_and(parent_id = current_setting('test.c1')::uuid) from public.action_comments
  where id in (current_setting('test.c2')::uuid, current_setting('test.c3')::uuid)),
  'replies, even to replies, join the top-level comment''s thread');
select public.mark_world_read(current_setting('test.w')::uuid);
select pg_temp.check(pg_temp.unread() = 0, 'reading the feed clears it');

-- Replies must be on the same action.
reset role;
select pg_temp.set_power(10);
select pg_temp.act_as(current_setting('test.actor_user')::uuid);
select public.take_action(current_setting('test.w')::uuid, 'shapeLand', '[[2,1]]', 'hills', 'More hills');
select pg_temp.expect_error(format($q$select public.add_comment(%L, %s, 'x', %L)$q$, current_setting('test.w'),
  current_setting('test.seq')::int + 1, current_setting('test.c1')), 'isn''t on this action',
  'a reply must be on the same action');

-- Deleting.
select pg_temp.expect_error(format($q$select public.delete_comment(%L)$q$, current_setting('test.c1')),
  'only delete your own', 'you can''t delete someone else''s comment');
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select public.delete_comment(current_setting('test.c1')::uuid);
select pg_temp.check((select count(*) = 0 from public.action_comments), 'deleting a comment removes its replies');

-- Reactions.
select pg_temp.check(public.toggle_reaction(current_setting('test.w')::uuid, current_setting('test.seq')::int, '🔥'),
  'reacting turns it on');
select public.toggle_reaction(current_setting('test.w')::uuid, current_setting('test.seq')::int, '👏');
select pg_temp.check((select count(*) = 2 from public.action_reactions), 'a player can use several emoji');
select pg_temp.check(not public.toggle_reaction(current_setting('test.w')::uuid, current_setting('test.seq')::int, '🔥'),
  'reacting again takes it back');
select pg_temp.check((select count(*) = 1 from public.action_reactions where emoji = '👏'), 'only that reaction goes');
select pg_temp.expect_error(format($q$select public.toggle_reaction(%L, %s, '💩')$q$, current_setting('test.w'),
  current_setting('test.seq')), 'check constraint', 'only the offered emoji are allowed');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0023');
select pg_temp.expect_error(format($q$select public.toggle_reaction(%L, %s, '🔥')$q$, current_setting('test.w'),
  current_setting('test.seq')), 'not in this world', 'outsiders can''t react');

-- Who can see and write directly.
select pg_temp.check((select count(*) from public.action_reactions) = 0, 'outsiders see no reactions');
select pg_temp.check((select count(*) from public.unread_counts()) = 0, 'outsiders have no unread counts');
select pg_temp.act_as(current_setting('test.waiter_user')::uuid);
select pg_temp.check((select count(*) from public.action_reactions) = 1, 'members see reactions');
select pg_temp.expect_error(format(
  $q$insert into public.action_comments (world_id, event_seq, user_id, body) values (%L, %s, %L, 'x')$q$,
  current_setting('test.w'), current_setting('test.seq'), current_setting('test.waiter_user')),
  'permission denied', 'comments only go through add_comment');
select pg_temp.expect_error(format(
  $q$insert into public.world_reads (world_id, user_id) values (%L, %L)$q$,
  current_setting('test.w'), current_setting('test.waiter_user')),
  'permission denied', 'read marks only go through mark_world_read');
select pg_temp.act_as(null);
select pg_temp.expect_error('select public.unread_counts()', 'permission denied', 'signed-out visitors get nothing');
reset role;

\echo 'All chronicle checks passed.'
