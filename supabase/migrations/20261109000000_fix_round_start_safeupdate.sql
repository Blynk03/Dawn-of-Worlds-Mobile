-- Fix: starting a game or a new round failed with "DELETE requires a WHERE clause".
--
-- Supabase loads the pg-safeupdate extension for requests made through its API, which rejects
-- DELETE and UPDATE statements without a WHERE clause. _begin_round cleared its scratch table
-- with a bare DELETE, so start_world and the last end_turn of every round failed from the app.
-- (It worked in the SQL Editor, which doesn't load pg-safeupdate.)
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run).

create or replace function public._begin_round(target_world uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
  cfg jsonb;
  dice_count int;
  sides int;
  new_year int;
  god record;
  roll int[];
  roll_total int;
  incomes jsonb := '[]'::jsonb;
  order_ids uuid[];
  gm_god uuid;
  limit_hours int;
begin
  select * into st from public.world_state s where s.world_id = target_world for update;

  select r.config, w.turn_time_limit_hours into cfg, limit_hours
  from public.worlds w join public.rulesets r on r.id = w.ruleset_id
  where w.id = target_world;
  dice_count := (cfg #>> '{income,dice,count}')::int;
  sides := (cfg #>> '{income,dice,sides}')::int;

  -- The first round starts at year 0; each later round moves time on by the current age's scale.
  new_year := case
    when st.round = 0 then 0
    else st.year + (cfg -> 'ages' -> (st.age - 1) ->> 'yearsPerRound')::int
  end;
  update public.world_state
  set round = st.round + 1, year = new_year
  where world_id = target_world;

  -- Scratch table for working out turn order (per connection, emptied each round).
  if to_regclass('pg_temp._dow_order') is null then
    create temp table _dow_order (god_id uuid primary key, keys int[] not null);
  end if;
  delete from pg_temp._dow_order where true; -- explicit WHERE: Supabase's pg-safeupdate rejects DELETE without one

  for god in
    select g.id, p.power, p.low_pool_bonus
    from public.gods g join public.god_power p on p.god_id = g.id
    where g.world_id = target_world
    order by g.created_at
  loop
    roll := public._roll_dice(dice_count, sides);
    roll_total := public._log_roll(target_world, god.id, 'income', roll);
    update public.god_power
    set power = power + roll_total + god.low_pool_bonus
    where god_id = god.id;
    incomes := incomes || jsonb_build_object(
      'god_id', god.id,
      'roll', roll_total,
      'bonus', god.low_pool_bonus,
      'gained', roll_total + god.low_pool_bonus,
      'power', god.power + roll_total + god.low_pool_bonus
    );
    insert into pg_temp._dow_order values (god.id, array[roll_total]);
  end loop;

  -- Ties: tied gods roll again (and again) until every position is decided.
  loop
    exit when not exists (
      select 1 from pg_temp._dow_order group by keys having count(*) > 1
    );
    for god in
      select o.god_id from pg_temp._dow_order o
      where (select count(*) from pg_temp._dow_order o2 where o2.keys = o.keys) > 1
      order by o.god_id
    loop
      roll := public._roll_dice(dice_count, sides);
      roll_total := public._log_roll(target_world, god.god_id, 'turn_order_tiebreak', roll);
      update pg_temp._dow_order set keys = keys || roll_total where god_id = god.god_id;
    end loop;
  end loop;

  select g.id into gm_god
  from public.gods g
  join public.world_members m on m.world_id = g.world_id and m.user_id = g.user_id
  where g.world_id = target_world and m.is_gm
  limit 1;

  select array_agg(o.god_id order by (o.god_id = gm_god) desc nulls last, o.keys desc)
  into order_ids
  from pg_temp._dow_order o;

  update public.world_state
  set turn_order = order_ids,
      active_position = 1,
      turn_started_at = now(),
      turn_deadline = case when limit_hours is null then null else now() + make_interval(hours => limit_hours) end
  where world_id = target_world;

  perform public._append_event(
    target_world,
    'round_started',
    jsonb_build_object(
      'round', st.round + 1,
      'age', st.age,
      'year', new_year,
      'incomes', incomes,
      'turn_order', to_jsonb(order_ids),
      'deadline', (select s.turn_deadline from public.world_state s where s.world_id = target_world)
    )
  );
end;
$$;

revoke execute on function public._begin_round(uuid) from public, anon, authenticated;
