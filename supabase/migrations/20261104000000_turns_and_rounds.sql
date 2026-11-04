-- DOW-14 (event log), DOW-15 (server dice), DOW-21 (turn order), DOW-25 (turns), DOW-27 (rounds).
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- The game is server-authoritative: dice are rolled here, power and turn order are kept here,
-- and players can only ask to end or pass their own turn. Everything that happens is appended
-- to world_events, which the app reads to show the game (and later the chronicle and timelapse).

create extension if not exists pgcrypto with schema extensions;

------------------------------------------------------------------------------------------------
-- Rulesets: the parts of src/rules/rulesets/*.json the server needs. Kept in sync by
-- src/rules/__tests__/ruleset-sql-parity.test.ts.
------------------------------------------------------------------------------------------------
create table public.rulesets (
  id text primary key,
  config jsonb not null
);

alter table public.rulesets enable row level security;
create policy "rulesets: anyone signed in reads"
  on public.rulesets for select to authenticated using (true);

insert into public.rulesets (id, config) values ('classic',
-- ruleset:classic:begin
'{
  "income": {
    "dice": { "count": 2, "sides": 6 },
    "lowPool": { "threshold": 5, "bonusPerTurn": 1, "maxBonus": 3 }
  },
  "ages": [
    { "age": 1, "name": "First Age", "focus": "Land", "yearsPerRound": 500 },
    { "age": 2, "name": "Second Age", "focus": "Races", "yearsPerRound": 100 },
    { "age": 3, "name": "Third Age", "focus": "Relations", "yearsPerRound": 5 }
  ],
  "ageTransition": { "minRounds": 5, "anyPlayerAfterRounds": 10 }
}'
-- ruleset:classic:end
);

alter table public.worlds
  add constraint worlds_ruleset_id_fkey foreign key (ruleset_id) references public.rulesets (id);

------------------------------------------------------------------------------------------------
-- World settings and tightened world permissions.
------------------------------------------------------------------------------------------------
-- Optional: a turn not taken within this many hours can be skipped by any player.
alter table public.worlds
  add column turn_time_limit_hours int check (turn_time_limit_hours between 1 and 168);

-- Worlds must be created in the lobby, and only the name and turn limit can be edited directly.
-- Status changes go through start_world() so the game is set up properly.
drop policy "worlds: create as self" on public.worlds;
create policy "worlds: create as self, in the lobby"
  on public.worlds for insert to authenticated
  with check (created_by = (select auth.uid()) and status = 'lobby');

revoke update on public.worlds from anon, authenticated;
grant update (name, turn_time_limit_hours) on public.worlds to authenticated;

------------------------------------------------------------------------------------------------
-- Game state (server-owned; players can read but never write).
------------------------------------------------------------------------------------------------
create table public.world_state (
  world_id uuid primary key references public.worlds (id) on delete cascade,
  age smallint not null default 1 check (age between 1 and 3),
  round int not null default 0,
  year int not null default 0,
  turn_order uuid[] not null default '{}',
  -- 1-based position in turn_order of the god whose turn it is.
  active_position int not null default 1,
  turn_started_at timestamptz,
  turn_deadline timestamptz
);

create table public.god_power (
  god_id uuid primary key references public.gods (id) on delete cascade,
  world_id uuid not null references public.worlds (id) on delete cascade,
  power int not null default 0 check (power >= 0),
  -- Bonus added at the next round for ending turns with a low pool (PDF section III).
  low_pool_bonus int not null default 0 check (low_pool_bonus >= 0)
);

create index god_power_world_id_idx on public.god_power (world_id);

-- DOW-14: the append-only game log.
create table public.world_events (
  id bigint generated always as identity primary key,
  world_id uuid not null references public.worlds (id) on delete cascade,
  seq int not null,
  age smallint not null,
  round int not null,
  god_id uuid references public.gods (id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (world_id, seq)
);

alter table public.world_state enable row level security;
alter table public.god_power enable row level security;
alter table public.world_events enable row level security;

create policy "world_state: members read"
  on public.world_state for select to authenticated using (public.is_world_member(world_id));
create policy "god_power: members read"
  on public.god_power for select to authenticated using (public.is_world_member(world_id));
create policy "world_events: members read"
  on public.world_events for select to authenticated using (public.is_world_member(world_id));

------------------------------------------------------------------------------------------------
-- DOW-15: dice. Rolled on the server with a cryptographically secure source, and every roll is
-- logged as a 'dice_rolled' event.
------------------------------------------------------------------------------------------------
create or replace function public._roll_die(sides int)
returns int
language plpgsql
volatile
set search_path = ''
as $$
declare
  byte int;
  usable int := 256 - (256 % sides); -- rejection sampling keeps every face equally likely
begin
  if sides < 2 or sides > 256 then
    raise exception 'A die needs between 2 and 256 sides';
  end if;
  loop
    byte := get_byte(extensions.gen_random_bytes(1), 0);
    if byte < usable then
      return 1 + (byte % sides);
    end if;
  end loop;
end;
$$;

create or replace function public._roll_dice(dice_count int, sides int)
returns int[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  results int[] := '{}';
begin
  for i in 1..dice_count loop
    results := results || public._roll_die(sides);
  end loop;
  return results;
end;
$$;

-- Appends an event. Callers must hold the world_state row lock, which keeps seq gap-free.
create or replace function public._append_event(
  target_world uuid,
  event_type text,
  event_payload jsonb,
  event_god uuid default null
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  next_seq int;
  st public.world_state%rowtype;
begin
  select * into st from public.world_state s where s.world_id = target_world;
  select coalesce(max(e.seq), 0) + 1 into next_seq
  from public.world_events e where e.world_id = target_world;
  insert into public.world_events (world_id, seq, age, round, god_id, type, payload)
  values (target_world, next_seq, st.age, st.round, event_god, event_type, event_payload);
  return next_seq;
end;
$$;

create or replace function public._log_roll(
  target_world uuid,
  roller uuid,
  purpose text,
  dice int[]
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  total int := (select sum(d) from unnest(dice) d);
begin
  perform public._append_event(
    target_world,
    'dice_rolled',
    jsonb_build_object('god_id', roller, 'purpose', purpose, 'dice', to_jsonb(dice), 'total', total),
    roller
  );
  return total;
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-27 + DOW-21: starting a round. Every god gains income (2d6 + low-pool bonus); the same
-- roll decides turn order (highest first, ties re-rolled); a GM's god always goes first.
------------------------------------------------------------------------------------------------
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
  delete from pg_temp._dow_order;

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

------------------------------------------------------------------------------------------------
-- Starting the game (replaces the lobby-only version): also sets up state and round 1.
------------------------------------------------------------------------------------------------
create or replace function public.start_world(target_world uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  god_count int;
  missing int;
begin
  if not public.is_world_host(target_world) then
    raise exception 'Only the host can start the game' using errcode = 'insufficient_privilege';
  end if;

  if (select w.status from public.worlds w where w.id = target_world for update) <> 'lobby' then
    raise exception 'This world has already started' using errcode = 'check_violation';
  end if;

  select count(*) into god_count from public.gods g where g.world_id = target_world;
  if god_count < 2 then
    raise exception 'At least 2 gods are needed to start' using errcode = 'check_violation';
  end if;

  select count(*) into missing
  from public.world_members m
  where m.world_id = target_world
    and not m.is_gm
    and not exists (
      select 1 from public.gods g where g.world_id = m.world_id and g.user_id = m.user_id
    );
  if missing > 0 then
    raise exception 'Every player needs a god before the game starts'
      using errcode = 'check_violation';
  end if;

  update public.worlds set status = 'active' where id = target_world;
  insert into public.world_state (world_id) values (target_world);
  insert into public.god_power (god_id, world_id)
  select g.id, g.world_id from public.gods g where g.world_id = target_world;

  perform public._append_event(
    target_world,
    'game_started',
    jsonb_build_object(
      'gods', (select jsonb_agg(g.id order by g.created_at) from public.gods g where g.world_id = target_world),
      'turn_time_limit_hours', (select w.turn_time_limit_hours from public.worlds w where w.id = target_world)
    )
  );
  perform public._begin_round(target_world);
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-25: ending, passing and skipping turns.
------------------------------------------------------------------------------------------------
create or replace function public._finish_turn(target_world uuid, how text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
  cfg jsonb;
  ending_god uuid;
  next_god uuid;
  gp public.god_power%rowtype;
  new_bonus int;
  limit_hours int;
  new_deadline timestamptz;
begin
  select * into st from public.world_state s where s.world_id = target_world for update;
  ending_god := st.turn_order[st.active_position];

  select r.config, w.turn_time_limit_hours into cfg, limit_hours
  from public.worlds w join public.rulesets r on r.id = w.ruleset_id
  where w.id = target_world;

  -- "Players who end any turn with five or fewer points gain a cumulative +1 point for the next
  -- round, up to a maximum of +3." Ending above the threshold resets it (same as src/rules/power.ts).
  select * into gp from public.god_power p where p.god_id = ending_god for update;
  new_bonus := case
    when gp.power <= (cfg #>> '{income,lowPool,threshold}')::int
      then least(
        gp.low_pool_bonus + (cfg #>> '{income,lowPool,bonusPerTurn}')::int,
        (cfg #>> '{income,lowPool,maxBonus}')::int
      )
    else 0
  end;
  update public.god_power set low_pool_bonus = new_bonus where god_id = ending_god;

  if st.active_position < cardinality(st.turn_order) then
    next_god := st.turn_order[st.active_position + 1];
    new_deadline := case when limit_hours is null then null else now() + make_interval(hours => limit_hours) end;
    update public.world_state
    set active_position = st.active_position + 1,
        turn_started_at = now(),
        turn_deadline = new_deadline
    where world_id = target_world;
  end if;

  perform public._append_event(
    target_world,
    'turn_ended',
    jsonb_build_object(
      'god_id', ending_god,
      'how', how,
      'power', gp.power,
      'low_pool_bonus', new_bonus,
      'next_god_id', next_god,
      'deadline', new_deadline
    ),
    ending_god
  );

  if next_god is null then
    perform public._begin_round(target_world);
  end if;
end;
$$;

-- Ends your turn ('end'), or passes without acting ('pass').
create or replace function public.end_turn(target_world uuid, pass boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
begin
  if (select w.status from public.worlds w where w.id = target_world) is distinct from 'active' then
    raise exception 'This game is not in play' using errcode = 'check_violation';
  end if;
  select * into st from public.world_state s where s.world_id = target_world for update;
  if not exists (
    select 1 from public.gods g
    where g.id = st.turn_order[st.active_position] and g.user_id = (select auth.uid())
  ) then
    raise exception 'It isn''t your turn' using errcode = 'insufficient_privilege';
  end if;
  perform public._finish_turn(target_world, case when pass then 'pass' else 'end' end);
end;
$$;

-- When a turn has run past the world's time limit, any player in the world can skip it.
create or replace function public.skip_timed_out_turn(target_world uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
begin
  if not public.is_world_member(target_world) then
    raise exception 'You are not in this world' using errcode = 'insufficient_privilege';
  end if;
  if (select w.status from public.worlds w where w.id = target_world) is distinct from 'active' then
    raise exception 'This game is not in play' using errcode = 'check_violation';
  end if;
  select * into st from public.world_state s where s.world_id = target_world for update;
  if st.turn_deadline is null or st.turn_deadline > now() then
    raise exception 'This turn hasn''t run out of time yet' using errcode = 'check_violation';
  end if;
  perform public._finish_turn(target_world, 'timeout');
end;
$$;

------------------------------------------------------------------------------------------------
-- Worlds started before this migration have no game state yet: set them up and begin round 1.
------------------------------------------------------------------------------------------------
create or replace function public._set_up_started_worlds()
returns int
language plpgsql
set search_path = ''
as $$
declare
  w record;
  fixed int := 0;
begin
  for w in
    select wo.id from public.worlds wo
    where wo.status = 'active'
      and not exists (select 1 from public.world_state s where s.world_id = wo.id)
  loop
    insert into public.world_state (world_id) values (w.id);
    insert into public.god_power (god_id, world_id)
    select g.id, g.world_id from public.gods g where g.world_id = w.id
    on conflict do nothing;
    perform public._append_event(
      w.id,
      'game_started',
      jsonb_build_object(
        'gods', (select jsonb_agg(g.id order by g.created_at) from public.gods g where g.world_id = w.id),
        'turn_time_limit_hours', null
      )
    );
    perform public._begin_round(w.id);
    fixed := fixed + 1;
  end loop;
  return fixed;
end;
$$;

select public._set_up_started_worlds();

------------------------------------------------------------------------------------------------
-- Permissions: players may call only the public game functions.
------------------------------------------------------------------------------------------------
revoke execute on function public._roll_die(int) from public, anon, authenticated;
revoke execute on function public._roll_dice(int, int) from public, anon, authenticated;
revoke execute on function public._append_event(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public._log_roll(uuid, uuid, text, int[]) from public, anon, authenticated;
revoke execute on function public._begin_round(uuid) from public, anon, authenticated;
revoke execute on function public._finish_turn(uuid, text) from public, anon, authenticated;
revoke execute on function public._set_up_started_worlds() from public, anon, authenticated;

revoke execute on function public.start_world(uuid) from public, anon;
revoke execute on function public.end_turn(uuid, boolean) from public, anon;
revoke execute on function public.skip_timed_out_turn(uuid) from public, anon;
grant execute on function public.start_world(uuid) to authenticated;
grant execute on function public.end_turn(uuid, boolean) to authenticated;
grant execute on function public.skip_timed_out_turn(uuid) to authenticated;

-- Live updates for the game screen.
alter publication supabase_realtime add table public.world_state, public.god_power, public.world_events;
