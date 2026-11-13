-- Tests for 20261120000000_gm_role.sql: the GM's rulings and rules (DOW-62).
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

-- Gwen (a0101) hosts and is the GM, without a god of her own; Bryce (b0102) and Cora (c0103) play.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0101', 'gwen@example.com'),
  ('00000000-0000-0000-0000-0000000b0102', 'bryce@example.com'),
  ('00000000-0000-0000-0000-0000000c0103', 'cora@example.com');

select pg_temp.act_as('00000000-0000-0000-0000-0000000a0101');
do $$
declare w uuid; c text;
begin
  insert into public.worlds (name) values ('GM world') returning id, invite_code into w, c;
  perform set_config('t.w', w::text, false);
  perform set_config('t.code', c, false);
end $$;
select public.set_my_gm_role(current_setting('t.w')::uuid, true);
select pg_temp.act_as('00000000-0000-0000-0000-0000000b0102');
select public.join_world(current_setting('t.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('t.w')::uuid, 'Bryce', '{Fire}', '#EF4444', '♨');
select pg_temp.act_as('00000000-0000-0000-0000-0000000c0103');
select public.join_world(current_setting('t.code'));
insert into public.gods (world_id, name, spheres, color, sigil)
values (current_setting('t.w')::uuid, 'Cora', '{Sea}', '#3B82F6', '≈');
select pg_temp.act_as('00000000-0000-0000-0000-0000000a0101');
select public.set_initial_map(current_setting('t.w')::uuid, 10, 8,
  array(select 'grassland' from generate_series(1, 80) i));
select public.start_world(current_setting('t.w')::uuid);
reset role;

create function pg_temp.w() returns uuid language sql as $$ select current_setting('t.w')::uuid $$;
create function pg_temp.god(n text) returns uuid language sql as $$
  select id from public.gods where world_id = pg_temp.w() and name = n
$$;
create function pg_temp.as_user(n text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform pg_temp.act_as(case n
    when 'Gwen' then '00000000-0000-0000-0000-0000000a0101'::uuid
    when 'Bryce' then '00000000-0000-0000-0000-0000000b0102'::uuid
    else '00000000-0000-0000-0000-0000000c0103'::uuid end);
end $$;
create function pg_temp.turn(n text, power int) returns void language plpgsql as $$
begin
  execute 'reset role';
  update public.world_state set active_position = array_position(turn_order, pg_temp.god(n))
  where world_id = pg_temp.w();
  update public.god_power set power = turn.power where god_id = pg_temp.god(n);
  perform pg_temp.as_user(n);
end $$;
create function pg_temp.power_of(n text) returns int language sql as $$
  select power from public.god_power where god_id = pg_temp.god(n)
$$;
create function pg_temp.last(t text) returns jsonb language sql as $$
  select payload from public.world_events where world_id = pg_temp.w() and type = t order by seq desc limit 1
$$;
create function pg_temp.last_action() returns int language sql as $$
  select max(seq) from public.world_events where world_id = pg_temp.w() and type = 'action_taken'
$$;
create function pg_temp.race_cost() returns int language sql as $$
  select public._power_cost(pg_temp.w(), 'createRace')
$$;

select pg_temp.check((select is_gm from public.world_members where world_id = pg_temp.w()
  and user_id = '00000000-0000-0000-0000-0000000a0101'), 'Gwen is the GM');
select pg_temp.expect_error(format($q$update public.world_members set is_gm = true
  where world_id = %L and user_id = '00000000-0000-0000-0000-0000000b0102'$q$, pg_temp.w()),
  'world_members_one_gm', 'a world has at most one GM');

------------------------------------------------------------------------------------------------
-- The GM's rules.
------------------------------------------------------------------------------------------------
select pg_temp.as_user('Bryce');
select pg_temp.expect_error(format('select public.gm_set_rules(%L, true, 2, null)', pg_temp.w()),
  'only the gm', 'only the GM sets the rules');
select pg_temp.as_user('Gwen');
select pg_temp.expect_error(format('select public.gm_set_rules(%L, true, 50, null)', pg_temp.w()),
  'between ±1 and ±20', 'a sensible cap');
select pg_temp.expect_error(format($q$select public.gm_set_rules(%L, true, 2, '{300,50}')$q$, pg_temp.w()),
  'each age', 'years for each age');
select public.gm_set_rules(pg_temp.w(), true, 2, '{300,50,2}');
reset role;
select pg_temp.check((select gm_final_say and alignment_cap = 2 and years_per_round = '{300,50,2}'
  from public.worlds where id = pg_temp.w()), 'the GM''s rules are set');
select pg_temp.check(pg_temp.last('gm_ruling') = '{"kind": "rules", "final_say": true, "alignment_cap": 2, "years_per_round": [300, 50, 2]}',
  'and logged in the chronicle');
select pg_temp.as_user('Gwen');
select public.gm_set_rules(pg_temp.w(), true, 2, '{300,50,2}');
reset role;
select pg_temp.check((select count(*) = 1 from public.world_events where world_id = pg_temp.w() and type = 'gm_ruling'),
  'no change, nothing logged');

-- Years per round.
select set_config('t.year', (select year::text from public.world_state where world_id = pg_temp.w()), false);
create function pg_temp.finish_round() returns void language plpgsql as $$
declare who uuid; r int := (select round from public.world_state where world_id = pg_temp.w());
begin
  loop
    execute 'reset role';
    exit when (select round from public.world_state where world_id = pg_temp.w()) > r;
    select g.user_id into who from public.world_state s join public.gods g on g.id = s.turn_order[s.active_position]
    where s.world_id = pg_temp.w();
    perform pg_temp.act_as(who);
    perform public.end_turn(pg_temp.w(), true);
  end loop;
end $$;
select pg_temp.finish_round();
select pg_temp.check((select year from public.world_state where world_id = pg_temp.w())
  = current_setting('t.year')::int + 300, 'a round now lasts the GM''s 300 years');

-- The alignment cap.
select pg_temp.turn('Bryce', 200);
select public.create_race(pg_temp.w(), 'Ashkin', 'Born of embers', '', 0, 2, 2);
select set_config('t.ashkin', pg_temp.last_action()::text, false);
reset role;
update public.world_entities set alignment = 2 where world_id = pg_temp.w() and name = 'Ashkin';
select pg_temp.as_user('Bryce');
select pg_temp.expect_error(format($q$select public.change_alignment(%L, 'race', %L, null, null, 1, 'Holier')$q$,
  pg_temp.w(), (select id from public.world_entities where world_id = pg_temp.w() and name = 'Ashkin')),
  'capped alignment at ±2', 'alignment can''t pass the GM''s cap');
select pg_temp.check(public.change_alignment(pg_temp.w(), 'race',
  (select id from public.world_entities where world_id = pg_temp.w() and name = 'Ashkin'), null, null, -1, 'Humbled') = 1,
  'but can move back within it');
reset role;
select pg_temp.expect_error(format($q$update public.world_map set alignment = array_fill(3, array[80]) where world_id = %L$q$, pg_temp.w()),
  'capped alignment', 'regions too');

------------------------------------------------------------------------------------------------
-- Non-traditional races cost double.
------------------------------------------------------------------------------------------------
select set_config('t.bryce_power', pg_temp.power_of('Bryce')::text, false);
select pg_temp.as_user('Bryce');
select pg_temp.expect_error(format('select public.gm_rule_nontraditional(%L, %s, '''')', pg_temp.w(), current_setting('t.ashkin')),
  'only the gm', 'only the GM rules on races');
select pg_temp.as_user('Gwen');
select pg_temp.expect_error(format('select public.gm_rule_nontraditional(%L, 1, '''')', pg_temp.w()),
  'race that was created', 'only on created races');
select pg_temp.check(public.gm_rule_nontraditional(pg_temp.w(), current_setting('t.ashkin')::int, 'Living embers') = 'charged',
  'the GM rules the Ashkin non-traditional');
reset role;
select pg_temp.check(pg_temp.power_of('Bryce') = current_setting('t.bryce_power')::int - pg_temp.race_cost(),
  'Bryce pays the cost again');
select pg_temp.check(pg_temp.last('gm_ruling') ->> 'kind' = 'nontraditional'
  and (pg_temp.last('gm_ruling') ->> 'charged')::int = pg_temp.race_cost()
  and pg_temp.last('gm_ruling') ->> 'note' = 'Living embers', 'the ruling is logged');
select pg_temp.as_user('Gwen');
select pg_temp.expect_error(format('select public.gm_rule_nontraditional(%L, %s, '''')', pg_temp.w(), current_setting('t.ashkin')),
  'already ruled', 'once per race');

-- Cora can't pay double: her race is undone.
select pg_temp.turn('Cora', 0);
reset role;
update public.god_power set power = pg_temp.race_cost() where god_id = pg_temp.god('Cora');
select pg_temp.as_user('Cora');
select public.create_race(pg_temp.w(), 'Cloudkin', 'Living clouds', '', 0, 6, 5);
select set_config('t.cloud', pg_temp.last_action()::text, false);
select pg_temp.as_user('Gwen');
select pg_temp.check(public.gm_rule_nontraditional(pg_temp.w(), current_setting('t.cloud')::int, '') = 'undone',
  'a race whose creator can''t pay double is undone');
reset role;
select pg_temp.check(not exists (select 1 from public.world_entities where world_id = pg_temp.w() and name = 'Cloudkin')
  and pg_temp.power_of('Cora') = pg_temp.race_cost(), 'and refunded');

------------------------------------------------------------------------------------------------
-- The GM's final say on objections.
------------------------------------------------------------------------------------------------
select pg_temp.as_user('Cora');
select set_config('t.p', public.object_to_action(pg_temp.w(), current_setting('t.ashkin')::int, 'Too odd')::text, false);
select pg_temp.expect_error(format('select public.gm_rule(%L, %L, ''undo'', '''')', pg_temp.w(), current_setting('t.p')),
  'only the gm', 'only the GM rules');
reset role;
update public.worlds set gm_final_say = false where id = pg_temp.w();
select pg_temp.as_user('Gwen');
select pg_temp.expect_error(format('select public.gm_rule(%L, %L, ''undo'', '''')', pg_temp.w(), current_setting('t.p')),
  'final say', 'only if the GM has the final say');
reset role;
update public.worlds set gm_final_say = true where id = pg_temp.w();
select set_config('t.bryce_power', pg_temp.power_of('Bryce')::text, false);
select pg_temp.as_user('Gwen');
select pg_temp.expect_error(format('select public.gm_rule(%L, %L, ''drop'', '''')', pg_temp.w(), current_setting('t.p')),
  'isn''t a choice', 'keep or undo');
select pg_temp.check(public.gm_rule(pg_temp.w(), current_setting('t.p')::uuid, 'undo', 'Cora is right') = 'undone',
  'the GM''s ruling settles it at once');
reset role;
select pg_temp.check((select status = 'undone' from public.world_proposals where id = current_setting('t.p')::uuid), 'undone');
select pg_temp.check(not exists (select 1 from public.world_entities where world_id = pg_temp.w() and name = 'Ashkin'),
  'the Ashkin are gone');
select pg_temp.check(pg_temp.power_of('Bryce') = current_setting('t.bryce_power')::int
  + (select sum((payload ->> 'cost')::int) from public.world_events where world_id = pg_temp.w() and type = 'action_taken'
     and seq in (select (payload ->> 'seq')::int from public.world_events where world_id = pg_temp.w() and type = 'action_retconned'
                 and payload ->> 'proposal_id' = current_setting('t.p')))
  + pg_temp.race_cost(), 'refunding everything, the GM''s double charge too');
select pg_temp.check(pg_temp.last('gm_ruling') @> jsonb_build_object('kind', 'objection', 'outcome', 'undone',
  'note', 'Cora is right', 'proposal_id', current_setting('t.p')), 'the ruling is logged');
select pg_temp.as_user('Gwen');
select pg_temp.expect_error(format('select public.gm_rule(%L, %L, ''keep'', '''')', pg_temp.w(), current_setting('t.p')),
  'vote is over', 'nothing left to rule on');
reset role;

\o
\echo All GM checks passed.
