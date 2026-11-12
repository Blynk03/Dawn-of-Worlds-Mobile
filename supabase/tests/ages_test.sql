-- Tests for 20261117000000_ages_and_objections.sql: age transitions (DOW-52) and objections with
-- votes, coin flips and undoing actions (DOW-53).
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0071', 'age-a@example.com'),
  ('00000000-0000-0000-0000-0000000b0072', 'age-b@example.com'),
  ('00000000-0000-0000-0000-0000000c0073', 'age-c@example.com'),
  ('00000000-0000-0000-0000-0000000d0074', 'age-outsider@example.com');

-- A world with three gods: Aster (a0071, the host), Brann (b0072), Cael (c0073).
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0071');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('Ageworld') returning id, invite_code into w, c;
  perform set_config('test.w', w::text, false);
  perform set_config('test.code', c, false);
end $$;
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Aster', '{Stars}', '#E3B05B', '✶');
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0072');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Brann', '{Fire}', '#EF4444', '♨');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0073');
select public.join_world(current_setting('test.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('test.w')::uuid, 'Cael', '{Sea}', '#3B82F6', '≈');

select pg_temp.act_as('00000000-0000-0000-0000-0000000a0071');
select public.set_initial_map(current_setting('test.w')::uuid, 10, 8,
  array(select 'grassland' from generate_series(1, 80) i));
select public.start_world(current_setting('test.w')::uuid);
reset role;

create function pg_temp.w() returns uuid language sql as $$ select current_setting('test.w')::uuid $$;
create function pg_temp.god(n text) returns uuid language sql as $$
  select id from public.gods where world_id = pg_temp.w() and name = n
$$;
create function pg_temp.user_of(n text) returns uuid language sql as $$
  select user_id from public.gods where world_id = pg_temp.w() and name = n
$$;
create function pg_temp.state() returns public.world_state language sql as $$
  select * from public.world_state where world_id = pg_temp.w()
$$;
create function pg_temp.events(t text) returns bigint language sql as $$
  select count(*) from public.world_events where world_id = pg_temp.w() and type = t
$$;
create function pg_temp.last(t text) returns jsonb language sql as $$
  select payload from public.world_events where world_id = pg_temp.w() and type = t
  order by seq desc limit 1
$$;
-- Every god passes, so the round ends and the next begins.
create function pg_temp.finish_round() returns void language plpgsql as $$
declare was text := current_user; i int; who uuid;
begin
  for i in 1..3 loop
    execute 'reset role';
    select g.user_id into who from public.world_state s join public.gods g on g.id = s.turn_order[s.active_position]
    where s.world_id = pg_temp.w();
    perform pg_temp.act_as(who);
    perform public.end_turn(pg_temp.w(), true);
  end loop;
  execute 'reset role';
  if was <> 'postgres' then execute format('set role %I', was); end if;
end $$;
create function pg_temp.give(god uuid, n int) returns void language plpgsql as $$
declare was text := current_user;
begin
  execute 'reset role';
  update public.god_power set power = n where god_id = god;
  if was <> 'postgres' then execute format('set role %I', was); end if;
end $$;
create function pg_temp.power_of(god uuid) returns int language sql as $$
  select power from public.god_power where god_id = god
$$;

------------------------------------------------------------------------------------------------
-- DOW-52: ages.
------------------------------------------------------------------------------------------------
select pg_temp.check((pg_temp.state()).age = 1 and (pg_temp.state()).age_started_round = 1,
  'the game starts in the First Age, round 1');
select pg_temp.act_as(pg_temp.user_of('Aster'));
select pg_temp.expect_error(format('select public.propose_next_age(%L)', pg_temp.w()),
  'at least 5 rounds', 'an age lasts at least five rounds');
reset role;

select pg_temp.finish_round(); select pg_temp.finish_round();
select pg_temp.finish_round(); select pg_temp.finish_round();
select pg_temp.check((pg_temp.state()).round = 5, 'four rounds later it is round 5');

select pg_temp.act_as('00000000-0000-0000-0000-0000000d0074');
select pg_temp.expect_error(format('select public.propose_next_age(%L)', pg_temp.w()),
  'only gods', 'outsiders can''t propose');
reset role;
select pg_temp.act_as(pg_temp.user_of('Aster'));
select pg_temp.check(public.propose_next_age(pg_temp.w()) = 'open',
  'from round 5 a god can propose the next age');
select pg_temp.check((select count(*) = 1 from public.world_votes v
  join public.world_proposals p on p.id = v.proposal_id
  where p.world_id = pg_temp.w() and v.choice = 'yes'), 'the proposer votes yes');
select pg_temp.expect_error(format('select public.propose_next_age(%L)', pg_temp.w()),
  'already a vote', 'one age vote at a time');
select set_config('test.p', (select id::text from public.world_proposals
  where world_id = pg_temp.w() and status = 'open'), false);
select pg_temp.expect_error(format('select public.vote(%L, %L, ''keep'')', pg_temp.w(), current_setting('test.p')),
  'isn''t a choice', 'an age vote is yes or no');

select pg_temp.act_as(pg_temp.user_of('Brann'));
select pg_temp.check(public.vote(pg_temp.w(), current_setting('test.p')::uuid, 'no') = 'open',
  'one yes and one no of three: still open');
select pg_temp.act_as(pg_temp.user_of('Cael'));
select pg_temp.check(public.vote(pg_temp.w(), current_setting('test.p')::uuid, 'yes') = 'passed',
  'two yes of three is a majority');
reset role;
select pg_temp.check((pg_temp.state()).age = 1 and (pg_temp.state()).age_pending,
  'the new age waits for the round to end');
select pg_temp.check(pg_temp.last('proposal_resolved') ->> 'outcome' = 'passed'
  and (pg_temp.last('proposal_resolved') -> 'tally' ->> 'yes')::int = 2, 'the result is logged');
select pg_temp.act_as(pg_temp.user_of('Brann'));
select pg_temp.expect_error(format('select public.propose_next_age(%L)', pg_temp.w()),
  'begins when this round ends', 'no second proposal once one has passed');
select pg_temp.expect_error(format('select public.vote(%L, %L, ''no'')', pg_temp.w(), current_setting('test.p')),
  'vote is over', 'a finished vote takes no more votes');
reset role;

select pg_temp.finish_round();
select pg_temp.check((pg_temp.state()).age = 2 and (pg_temp.state()).age_started_round = 6
  and not (pg_temp.state()).age_pending, 'round 6 begins the Second Age');
select pg_temp.check(pg_temp.last('age_advanced') = jsonb_build_object(
  'age', 2, 'name', 'Second Age', 'years_per_round', 100, 'round', 6), 'the new age is logged');
select pg_temp.check((pg_temp.last('round_started') ->> 'age')::int = 2, 'round 6 is in age 2');
select pg_temp.check((select seq from public.world_events where world_id = pg_temp.w() and type = 'age_advanced')
  < (select max(seq) from public.world_events where world_id = pg_temp.w() and type = 'round_started'),
  'the age begins before the round');
-- Round 5 lasted 500 years (First Age); round 6 is 2500 years in.
select pg_temp.check((pg_temp.state()).year = 2500, 'the last First Age round still counted 500 years');

-- A vote that doesn't pass lapses with the round.
select pg_temp.finish_round(); select pg_temp.finish_round();
select pg_temp.finish_round(); select pg_temp.finish_round();
select pg_temp.check((pg_temp.state()).round = 10, 'round 10: the Second Age''s 5th round');
select pg_temp.act_as(pg_temp.user_of('Brann'));
select pg_temp.check(public.propose_next_age(pg_temp.w()) = 'open', 'a new vote in the Second Age');
reset role;
select pg_temp.finish_round();
select pg_temp.check((pg_temp.state()).age = 2, 'nobody else voted: still the Second Age');
select pg_temp.check(pg_temp.last('proposal_resolved') ->> 'outcome' = 'expired', 'the vote lapsed');

-- After ten rounds any one god can call it.
select pg_temp.finish_round(); select pg_temp.finish_round();
select pg_temp.finish_round(); select pg_temp.finish_round();
select pg_temp.check((pg_temp.state()).round - (pg_temp.state()).age_started_round + 1 = 10,
  'the Second Age''s 10th round');
select pg_temp.act_as(pg_temp.user_of('Cael'));
select pg_temp.check(public.propose_next_age(pg_temp.w()) = 'passed', 'one god can end the age now');
select pg_temp.check((pg_temp.last('proposal_opened') ->> 'solo')::boolean, 'logged as a single god''s call');
reset role;
select pg_temp.finish_round();
select pg_temp.check((pg_temp.state()).age = 3, 'the Third Age');
-- (The last age can't be ended; it lasts until the game does.)
update public.world_state set age_started_round = round - 20 where world_id = pg_temp.w();
select pg_temp.act_as(pg_temp.user_of('Cael'));
select pg_temp.expect_error(format('select public.propose_next_age(%L)', pg_temp.w()),
  'last age', 'there is no Fourth Age');
reset role;

------------------------------------------------------------------------------------------------
-- DOW-53: objections.
------------------------------------------------------------------------------------------------
-- Scripted dice for the coin flips (anything else rolls for real). Restored at the end.
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

-- Whoever's turn it is (the actor) shapes a hex, creates a race and founds a city on it; then
-- adds terrain elsewhere.
select set_config('test.actor', (select s.turn_order[s.active_position]::text from public.world_state s
  where s.world_id = pg_temp.w()), false);
create function pg_temp.actor() returns uuid language sql as $$ select current_setting('test.actor')::uuid $$;
create function pg_temp.others() returns setof uuid language sql as $$
  select id from public.gods where world_id = pg_temp.w() and id <> pg_temp.actor() order by name
$$;
select set_config('test.o1', (select x::text from pg_temp.others() x limit 1), false);
select set_config('test.o2', (select x::text from pg_temp.others() x offset 1 limit 1), false);
create function pg_temp.as_god(g uuid) returns void language sql as $$
  select pg_temp.act_as((select user_id from public.gods where id = g))
$$;

select pg_temp.give(pg_temp.actor(), 100);
select pg_temp.as_god(pg_temp.actor());
select public.take_action(pg_temp.w(), 'shapeLand', '[[3,3]]', 'hills', 'Rolling hills');
select set_config('test.hills', (select max(seq)::text from public.world_events
  where world_id = pg_temp.w() and type = 'action_taken'), false);
select public.create_race(pg_temp.w(), 'Hillfolk', 'They dwell in the hills', '', 0, 3, 3);
select set_config('test.race', (select max(seq)::text from public.world_events
  where world_id = pg_temp.w() and type = 'action_taken'), false);
select public.found_city(pg_temp.w(),
  (select id from public.world_entities where world_id = pg_temp.w() and name = 'Hillfolk'),
  'Barrowdown', 4, 3, 'A town of turf');
select public.take_action(pg_temp.w(), 'shapeLand', '[[7,1]]', 'forest', 'Woods far away');
select set_config('test.woods', (select max(seq)::text from public.world_events
  where world_id = pg_temp.w() and type = 'action_taken'), false);
reset role;

select pg_temp.check((select count(*) = 0 from public.world_undo_log
  where world_id = pg_temp.w() and action_seq is null), 'every recorded change belongs to an action');
select pg_temp.check((select count(*) = 1 from public.world_undo_log
  where world_id = pg_temp.w() and action_seq = current_setting('test.hills')::int
  and key = 'terrain:34' and old_row = '"grassland"' and new_row = '"hills"'),
  'the undo log records the hex that changed, and what it was');

select pg_temp.as_god(pg_temp.actor());
select pg_temp.expect_error(format('select public.object_to_action(%L, %s, ''No'')', pg_temp.w(), current_setting('test.race')),
  'own action', 'you can''t object to your own action');
select pg_temp.as_god(current_setting('test.o1')::uuid);
select pg_temp.expect_error(format('select public.object_to_action(%L, %s, ''  '')', pg_temp.w(), current_setting('test.race')),
  'say why', 'an objection needs a reason');
select pg_temp.expect_error(format('select public.object_to_action(%L, 1, ''No'')', pg_temp.w()),
  'doesn''t exist', 'only actions can be objected to');
reset role;
update public.worlds set objection_hours = 0 where id = pg_temp.w();
select pg_temp.as_god(current_setting('test.o1')::uuid);
select pg_temp.expect_error(format('select public.object_to_action(%L, %s, ''No'')', pg_temp.w(), current_setting('test.race')),
  'turned off', 'the host can turn objections off');
reset role;
update public.worlds set objection_hours = 12 where id = pg_temp.w();
update public.world_events set created_at = now() - interval '13 hours'
where world_id = pg_temp.w() and seq = current_setting('test.woods')::int;
select pg_temp.as_god(current_setting('test.o1')::uuid);
select pg_temp.expect_error(format('select public.object_to_action(%L, %s, ''No'')', pg_temp.w(), current_setting('test.woods')),
  'too late', 'objections close after the window');

-- Objecting to the hills: the race and its city stand on them, so undoing the hills undoes those.
select pg_temp.check(public.object_to_action(pg_temp.w(), current_setting('test.hills')::int,
  'Hills here block my river') is not null, 'another god objects');
reset role;
select set_config('test.p', (select id::text from public.world_proposals
  where world_id = pg_temp.w() and kind = 'objection'), false);
select pg_temp.check((select status = 'open' and closes_at > now() + interval '11 hours'
  from public.world_proposals where id = current_setting('test.p')::uuid), 'the vote is open for 12 hours');
select pg_temp.check((pg_temp.last('proposal_opened') ->> 'target_seq')::int = current_setting('test.hills')::int
  and pg_temp.last('proposal_opened') ->> 'reason' = 'Hills here block my river', 'the objection is logged');
select pg_temp.check((select count(*) = 2 from public.push_outbox
  where world_id = pg_temp.w() and kind = 'vote' and title = 'Objection!'), 'the other gods are told');
select pg_temp.as_god(current_setting('test.o2')::uuid);
select pg_temp.expect_error(format('select public.object_to_action(%L, %s, ''Me too'')', pg_temp.w(), current_setting('test.hills')),
  'already objected', 'one objection per action');
select pg_temp.expect_error(format('select public.vote(%L, %L, ''yes'')', pg_temp.w(), current_setting('test.p')),
  'isn''t a choice', 'an objection vote is keep, undo or coin');

-- Undo 1, keep 1, coin 1: no majority and keep/undo tied, so the server flips a coin: 2 = undo.
select pg_temp.check(public.vote(pg_temp.w(), current_setting('test.p')::uuid, 'coin') = 'open', 'still open');
reset role;
select set_config('test.power_before', pg_temp.power_of(pg_temp.actor())::text, false);
insert into pg_temp.dice (value) values (2);
select pg_temp.as_god(pg_temp.actor());
select pg_temp.check(public.vote(pg_temp.w(), current_setting('test.p')::uuid, 'keep') = 'undone',
  'a tie is settled by a coin flip');
reset role;
select pg_temp.check(pg_temp.last('proposal_resolved') ->> 'outcome' = 'undone'
  and (pg_temp.last('proposal_resolved') ->> 'coin')::int = 2, 'the coin is logged');
select pg_temp.check((select payload ->> 'purpose' = 'coin_flip' from public.world_events
  where world_id = pg_temp.w() and type = 'dice_rolled' order by seq desc limit 1), 'and rolled like any die');
select pg_temp.check(
  (select array_agg((payload ->> 'seq')::int order by (payload ->> 'seq')::int) from public.world_events
   where world_id = pg_temp.w() and type = 'action_retconned')
  = array[current_setting('test.hills')::int, current_setting('test.race')::int, current_setting('test.race')::int + 1],
  'the hills are undone, with the race and city on them; the far woods stand');
select pg_temp.check((select terrain[34] = 'grassland' and terrain[18] = 'forest'
  from public.world_map where world_id = pg_temp.w()), 'the hex is grassland again');
select pg_temp.check((select count(*) = 0 from public.world_entities where world_id = pg_temp.w()),
  'the race and city are gone');
select pg_temp.check(pg_temp.power_of(pg_temp.actor()) = current_setting('test.power_before')::int
  + (select sum((payload ->> 'cost')::int) from public.world_events where world_id = pg_temp.w()
     and type = 'action_taken' and seq between current_setting('test.hills')::int and current_setting('test.race')::int + 1),
  'every undone action is refunded');
select pg_temp.check((select (payload ->> 'because_of')::int = current_setting('test.hills')::int
  from public.world_events where world_id = pg_temp.w() and type = 'action_retconned'
  and (payload ->> 'seq')::int = current_setting('test.race')::int), 'the race was undone because of the hills');
select pg_temp.as_god(current_setting('test.o2')::uuid);
select pg_temp.expect_error(format('select public.object_to_action(%L, %s, ''No'')', pg_temp.w(), current_setting('test.race')),
  'already been undone', 'an undone action can''t be objected to');
reset role;

-- A majority to keep: the action stands.
select pg_temp.give(pg_temp.actor(), 100);
select pg_temp.as_god(pg_temp.actor());
select public.take_action(pg_temp.w(), 'shapeLand', '[[5,5]]', 'mountains', 'Peaks');
select set_config('test.peaks', (select max(seq)::text from public.world_events
  where world_id = pg_temp.w() and type = 'action_taken'), false);
select pg_temp.as_god(current_setting('test.o1')::uuid);
select set_config('test.p2', public.object_to_action(pg_temp.w(), current_setting('test.peaks')::int, 'Too tall')::text, false);
select pg_temp.as_god(current_setting('test.o2')::uuid);
select pg_temp.check(public.vote(pg_temp.w(), current_setting('test.p2')::uuid, 'keep') = 'open', 'one each');
select pg_temp.as_god(current_setting('test.o1')::uuid);
select pg_temp.check(public.vote(pg_temp.w(), current_setting('test.p2')::uuid, 'keep') = 'kept',
  'the objector can change their mind: two of three keep it');
reset role;
select pg_temp.check((select terrain[56] = 'mountains' from public.world_map where world_id = pg_temp.w()),
  'the peaks stand');

-- A vote that runs out of time: the votes cast decide.
select pg_temp.as_god(pg_temp.actor());
select public.take_action(pg_temp.w(), 'shapeLand', '[[6,6]]', 'desert', 'Dunes');
select set_config('test.dunes', (select max(seq)::text from public.world_events
  where world_id = pg_temp.w() and type = 'action_taken'), false);
select pg_temp.as_god(current_setting('test.o1')::uuid);
select set_config('test.p3', public.object_to_action(pg_temp.w(), current_setting('test.dunes')::int, 'Too dry')::text, false);
select pg_temp.expect_error(format('select public.close_proposal(%L, %L)', pg_temp.w(), current_setting('test.p3')),
  'still open', 'a vote can''t be closed early');
reset role;
update public.world_proposals set closes_at = now() - interval '1 minute' where id = current_setting('test.p3')::uuid;
select pg_temp.check(public.close_expired_proposals() = 1, 'the scheduled job closes it');
select pg_temp.check((select status = 'undone' from public.world_proposals where id = current_setting('test.p3')::uuid),
  'one vote to undo and none to keep: undone');
select pg_temp.check((select terrain[67] = 'grassland' from public.world_map where world_id = pg_temp.w()),
  'the dunes are gone');

-- Undoing a change to something that stays: it goes back to how it was.
select pg_temp.give(pg_temp.actor(), 100);
select pg_temp.as_god(pg_temp.actor());
select public.create_race(pg_temp.w(), 'Plainsfolk', 'Riders', '', 0, 2, 2);
select public.change_alignment(pg_temp.w(), 'race',
  (select id from public.world_entities where world_id = pg_temp.w() and name = 'Plainsfolk'),
  null, null, -1, 'They turn cruel');
select set_config('test.cruel', (select max(seq)::text from public.world_events
  where world_id = pg_temp.w() and type = 'action_taken'), false);
reset role;
select pg_temp.check((select alignment = -1 from public.world_entities where world_id = pg_temp.w()
  and name = 'Plainsfolk'), 'the Plainsfolk turn evil');
select pg_temp.as_god(current_setting('test.o1')::uuid);
select set_config('test.p4', public.object_to_action(pg_temp.w(), current_setting('test.cruel')::int, 'Out of character')::text, false);
select pg_temp.as_god(current_setting('test.o2')::uuid);
select pg_temp.check(public.vote(pg_temp.w(), current_setting('test.p4')::uuid, 'undo') = 'undone', 'two of three undo it');
reset role;
select pg_temp.check((select alignment = 0 and description = 'Riders' from public.world_entities
  where world_id = pg_temp.w() and name = 'Plainsfolk'), 'the Plainsfolk are as they were, and still here');

select pg_temp.check((select count(*) = 0 from pg_temp.dice), 'all the scripted dice were used');
drop function public._roll_die(int);
alter function public._roll_die_real(int) rename to _roll_die;

-- Players can read votes, never write them.
select pg_temp.as_god(current_setting('test.o1')::uuid);
select pg_temp.check((select count(*) = 4 from public.world_proposals where kind = 'objection'), 'members read proposals');
select pg_temp.expect_error('insert into public.world_votes (proposal_id, god_id, choice) values (gen_random_uuid(), gen_random_uuid(), ''yes'')',
  'permission denied', 'no writing votes directly');
select pg_temp.expect_error('select count(*) from public.world_undo_log', 'permission denied', 'the undo log is private');
select pg_temp.act_as('00000000-0000-0000-0000-0000000d0074');
select pg_temp.check((select count(*) = 0 from public.world_proposals), 'outsiders see no votes');
reset role;

\o
\echo All age and objection checks passed.
