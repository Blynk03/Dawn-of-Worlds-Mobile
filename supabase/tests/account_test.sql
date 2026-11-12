-- Tests for 20261118000000_account_deletion.sql: deleting your account (DOW-17, Google Play).
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

-- Erin (e0081) deletes her account. Fen (f0082) and Gus (a0083) play on.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e0081', 'erin@example.com'),
  ('00000000-0000-0000-0000-0000000f0082', 'fen@example.com'),
  ('00000000-0000-0000-0000-0000000a0083', 'gus@example.com');

create function pg_temp.new_world(name text, host uuid, joiners uuid[]) returns uuid
language plpgsql as $$
declare w uuid; c text; u uuid; i int := 0;
begin
  perform pg_temp.act_as(host);
  insert into public.worlds (name) values (name) returning id, invite_code into w, c;
  insert into public.gods (world_id, name, spheres, color, sigil)
  values (w, name || ' host god', '{Stars}', '#E3B05B', '✶');
  foreach u in array joiners loop
    i := i + 1;
    perform pg_temp.act_as(u);
    perform public.join_world(c);
    insert into public.gods (world_id, name, spheres, color, sigil)
    values (w, name || ' god ' || i, '{Sea}', (array['#3B82F6','#10B981','#EF4444'])[i], '≈');
  end loop;
  execute 'reset role';
  return w;
end $$;

select set_config('t.solo', pg_temp.new_world('Erin alone', '00000000-0000-0000-0000-0000000e0081', '{}')::text, false);
select set_config('t.lobby', pg_temp.new_world('Erin lobby', '00000000-0000-0000-0000-0000000e0081',
  '{00000000-0000-0000-0000-0000000f0082}')::text, false);
select set_config('t.play', pg_temp.new_world('Erin play', '00000000-0000-0000-0000-0000000e0081',
  '{00000000-0000-0000-0000-0000000f0082,00000000-0000-0000-0000-0000000a0083}')::text, false);
select set_config('t.duel', pg_temp.new_world('Erin duel', '00000000-0000-0000-0000-0000000f0082',
  '{00000000-0000-0000-0000-0000000e0081}')::text, false);

create function pg_temp.start(w uuid) returns void language plpgsql as $$
begin
  perform pg_temp.act_as((select created_by from public.worlds where id = w));
  perform public.set_initial_map(w, 8, 8, array(select 'grassland' from generate_series(1, 64) i));
  perform public.start_world(w);
  execute 'reset role';
end $$;
select pg_temp.start(current_setting('t.play')::uuid);
select pg_temp.start(current_setting('t.duel')::uuid);

create function pg_temp.play() returns uuid language sql as $$ select current_setting('t.play')::uuid $$;
create function pg_temp.erin_god(w uuid) returns uuid language sql as $$
  select id from public.gods where world_id = w and user_id = '00000000-0000-0000-0000-0000000e0081'
$$;
select set_config('t.erin_play_god', pg_temp.erin_god(pg_temp.play())::text, false);

-- Make it Erin's turn in the game of three, with someone still to play after her.
update public.world_state
set turn_order = array[
      (select id from public.gods where world_id = pg_temp.play() and user_id = '00000000-0000-0000-0000-0000000f0082'),
      current_setting('t.erin_play_god')::uuid,
      (select id from public.gods where world_id = pg_temp.play() and user_id = '00000000-0000-0000-0000-0000000a0083')],
    active_position = 2
where world_id = pg_temp.play();

-- Erin's personal data.
select pg_temp.act_as('00000000-0000-0000-0000-0000000e0081');
select public.register_push_token('ExponentPushToken[erin-phone]', 'android');
reset role;
insert into public.world_events (world_id, seq, type, age, round, god_id, payload)
values (pg_temp.play(), 900, 'action_taken', 1, 1, current_setting('t.erin_play_god')::uuid, '{"power":"shapeLand","cost":3}');
insert into public.action_comments (world_id, event_seq, user_id, body)
values (pg_temp.play(), 900, '00000000-0000-0000-0000-0000000e0081', 'Behold!');
insert into public.action_reactions (world_id, event_seq, user_id, emoji)
values (pg_temp.play(), 900, '00000000-0000-0000-0000-0000000e0081', '🔥');
insert into public.world_reads (world_id, user_id) values (pg_temp.play(), '00000000-0000-0000-0000-0000000e0081');

select pg_temp.act_as(null);
select pg_temp.expect_error('select public.delete_my_account()', 'permission denied', 'signed-out visitors can''t call it');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000e0081');
select public.delete_my_account();
reset role;

select pg_temp.check(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000e0081'),
  'the sign-in (and email) is gone');
select pg_temp.check((select display_name = 'Departed player' and avatar_url is null from public.profiles
  where id = '00000000-0000-0000-0000-0000000e0081'), 'the profile is anonymised');
select pg_temp.check(not exists (select 1 from public.push_tokens where user_id = '00000000-0000-0000-0000-0000000e0081')
  and not exists (select 1 from public.action_comments where user_id = '00000000-0000-0000-0000-0000000e0081')
  and not exists (select 1 from public.action_reactions where user_id = '00000000-0000-0000-0000-0000000e0081')
  and not exists (select 1 from public.world_reads where user_id = '00000000-0000-0000-0000-0000000e0081'),
  'devices, comments, reactions and read markers are deleted');

select pg_temp.check(not exists (select 1 from public.worlds where id = current_setting('t.solo')::uuid),
  'an unstarted world with nobody else in it is deleted');
select pg_temp.check((select created_by = '00000000-0000-0000-0000-0000000f0082' from public.worlds
  where id = current_setting('t.lobby')::uuid), 'an unstarted world passes to the next player');
select pg_temp.check((select role = 'host' from public.world_members where world_id = current_setting('t.lobby')::uuid
  and user_id = '00000000-0000-0000-0000-0000000f0082'), '...who becomes host');
select pg_temp.check(not exists (select 1 from public.world_members where world_id = current_setting('t.lobby')::uuid
  and user_id = '00000000-0000-0000-0000-0000000e0081'), 'Erin leaves the unstarted world, god and all');

select pg_temp.check((select created_by = '00000000-0000-0000-0000-0000000f0082' from public.worlds
  where id = pg_temp.play()), 'a world in play passes to the next player too');
select pg_temp.check((select departed_at is not null from public.gods where id = current_setting('t.erin_play_god')::uuid),
  'Erin''s god stays in the world''s history, departed');
select pg_temp.check(exists (select 1 from public.world_events where world_id = pg_temp.play() and seq = 900),
  'her actions stay');
select pg_temp.check((select payload ->> 'god_id' = current_setting('t.erin_play_god') from public.world_events
  where world_id = pg_temp.play() and type = 'god_departed'), 'the departure is logged');
select pg_temp.check((select payload ->> 'how' = 'pass' from public.world_events
  where world_id = pg_temp.play() and type = 'turn_ended' order by seq desc limit 1), 'it was her turn: it is passed');
select pg_temp.check((select cardinality(turn_order) = 2 and active_position = 2
  and not (current_setting('t.erin_play_god')::uuid = any (turn_order)) from public.world_state
  where world_id = pg_temp.play()), 'she''s out of the turn order; the next god is playing');

-- The next round leaves her out.
create function pg_temp.finish_round(w uuid) returns void language plpgsql as $$
declare who uuid; r int := (select round from public.world_state where world_id = w);
begin
  loop
    execute 'reset role';
    exit when (select round from public.world_state where world_id = w) > r;
    select g.user_id into who from public.world_state s join public.gods g on g.id = s.turn_order[s.active_position]
    where s.world_id = w;
    perform pg_temp.act_as(who);
    perform public.end_turn(w, true);
  end loop;
end $$;
select pg_temp.finish_round(pg_temp.play());
select pg_temp.check((select cardinality(turn_order) = 2 from public.world_state where world_id = pg_temp.play()),
  'a new round has two gods');
select pg_temp.check((select jsonb_array_length(payload -> 'incomes') = 2 from public.world_events
  where world_id = pg_temp.play() and type = 'round_started' order by seq desc limit 1), 'and no income for a departed god');

-- Votes count the gods still playing: one keep, one undo of two is a tie, settled at once.
select pg_temp.act_as((select g.user_id from public.world_state s join public.gods g on g.id = s.turn_order[s.active_position]
  where s.world_id = pg_temp.play()));
select public.take_action(pg_temp.play(), 'shapeLand', '[[2,2]]', 'hills', 'A hill');
reset role;
select set_config('t.hill', (select max(seq)::text from public.world_events where world_id = pg_temp.play() and type = 'action_taken'), false);
select set_config('t.actor', (select god_id::text from public.world_events where world_id = pg_temp.play()
  and seq = current_setting('t.hill')::int), false);
select pg_temp.act_as((select user_id from public.gods where world_id = pg_temp.play()
  and departed_at is null and id <> current_setting('t.actor')::uuid));
select set_config('t.p', public.object_to_action(pg_temp.play(), current_setting('t.hill')::int, 'No')::text, false);
select pg_temp.act_as((select user_id from public.gods where id = current_setting('t.actor')::uuid));
select pg_temp.check(public.vote(pg_temp.play(), current_setting('t.p')::uuid, 'keep') in ('kept', 'undone'),
  'two gods vote, one each way: decided by a coin flip, not waiting for the departed');
reset role;

-- A game of two: with only one player left it ends.
select pg_temp.check((select status = 'active' from public.worlds where id = current_setting('t.duel')::uuid), 'the duel was on');
select pg_temp.act_as('00000000-0000-0000-0000-0000000f0082');
select public.delete_my_account();
reset role;
select pg_temp.check((select status = 'finished' from public.worlds where id = current_setting('t.duel')::uuid),
  'when the last player leaves a game, it ends');

\o
\echo All account deletion checks passed.
