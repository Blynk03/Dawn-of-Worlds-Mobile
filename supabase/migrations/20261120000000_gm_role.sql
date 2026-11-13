-- DOW-62: the GM (author) role.
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- A world has at most one GM: the host can take the role before the game starts, and may also
-- play a god. Already: the GM's god goes first each round, and a GM needn't make a god. Now the GM
-- can also, from the GM card in World settings and on the world screen:
-- * have the final say on objections and disputed battle bonuses (if the GM turns that on):
--   a ruling settles the vote at once;
-- * rule that a newly created race is non-traditional, so it costs double (an unusual race, such
--   as living clouds, at the GM's discretion). If its creator can't pay, the race is undone and
--   refunded;
-- * cap alignment ("unless the game master or author directs otherwise, there is no limit");
-- * change how many years pass each round in each age.
-- Every ruling and change is logged in the chronicle.

alter table public.worlds add column gm_final_say boolean not null default false;
alter table public.worlds add column alignment_cap int check (alignment_cap between 1 and 20);
alter table public.worlds add column years_per_round int[]
  check (years_per_round is null or (cardinality(years_per_round) = 3
    and 1 <= all (years_per_round) and 10000 >= all (years_per_round)));

-- At most one GM per world.
create unique index world_members_one_gm on public.world_members (world_id) where is_gm;

create or replace function public._require_gm(target_world uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.world_members m
    where m.world_id = target_world and m.user_id = (select auth.uid()) and m.is_gm
  ) then
    raise exception 'Only the GM can do that' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public._gm_god(target_world uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select g.id from public.gods g where g.world_id = target_world and g.user_id = (select auth.uid())
$$;

create or replace function public._clean_note(note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(trim(coalesce(note, ''))) > 280 then
    raise exception 'Keep it under 280 characters' using errcode = 'check_violation';
  end if;
  return trim(coalesce(note, ''));
end;
$$;

------------------------------------------------------------------------------------------------
-- The GM's final say on a vote.
------------------------------------------------------------------------------------------------
create or replace function public.gm_rule(target_world uuid, proposal uuid, choice text, note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.world_proposals;
  outcome text;
  clean text := public._clean_note(note);
begin
  perform public._require_gm(target_world);
  if not (select w.gm_final_say from public.worlds w where w.id = target_world) then
    raise exception 'Turn on the GM''s final say in World settings first' using errcode = 'check_violation';
  end if;
  select * into p from public.world_proposals x
  where x.id = proposal and x.world_id = target_world for update;
  if p.id is null or p.kind not in ('objection', 'bonus') then
    raise exception 'The GM rules on objections and disputed bonuses' using errcode = 'check_violation';
  end if;
  if p.status <> 'open' then
    raise exception 'That vote is over' using errcode = 'check_violation';
  end if;
  outcome := case
    when p.kind = 'objection' and choice = 'keep' then 'kept'
    when p.kind = 'objection' and choice = 'undo' then 'undone'
    when p.kind = 'bonus' and choice = 'keep' then 'kept'
    when p.kind = 'bonus' and choice = 'drop' then 'dropped'
  end;
  if outcome is null then
    raise exception 'That isn''t a choice in this vote' using errcode = 'check_violation';
  end if;

  if p.kind = 'bonus' then
    update public.world_battle_bonuses set status = outcome where id = p.battle_bonus_id;
    perform public._finish_proposal(p, outcome, null, null);
  else
    perform public._finish_proposal(
      p, outcome, null,
      case when outcome = 'undone' then public._retcon(target_world, p.target_seq, p.id) end
    );
  end if;
  perform public._append_event(
    target_world,
    'gm_ruling',
    jsonb_build_object(
      'kind', p.kind, 'proposal_id', p.id, 'seq', p.target_seq, 'outcome', outcome, 'note', clean
    ),
    public._gm_god(target_world)
  );
  return outcome;
end;
$$;

------------------------------------------------------------------------------------------------
-- Non-traditional races cost double.
------------------------------------------------------------------------------------------------
create or replace function public.gm_rule_nontraditional(target_world uuid, action_seq int, note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.world_events%rowtype;
  hours int;
  charge int;
  have int;
  power_now int;
  undone int[];
  clean text := public._clean_note(note);
begin
  perform public._require_gm(target_world);
  select * into ev from public.world_events e
  where e.world_id = target_world and e.seq = action_seq and e.type = 'action_taken'
    and e.payload ->> 'power' = 'createRace';
  if ev.id is null then
    raise exception 'Choose a race that was created' using errcode = 'check_violation';
  end if;
  if public._is_retconned(target_world, action_seq) then
    raise exception 'That race has been undone' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.world_events r
    where r.world_id = target_world and r.type = 'gm_ruling'
      and r.payload ->> 'kind' = 'nontraditional' and (r.payload ->> 'seq')::int = action_seq
  ) then
    raise exception 'You''ve already ruled on that race' using errcode = 'check_violation';
  end if;
  -- Within the objection window (or a day, if objections are off).
  select nullif(w.objection_hours, 0) into hours from public.worlds w where w.id = target_world;
  if ev.created_at + make_interval(hours => coalesce(hours, 24)) < now() then
    raise exception 'It''s too late to rule on that race' using errcode = 'check_violation';
  end if;

  charge := coalesce((ev.payload ->> 'cost')::int, 0);
  select p.power into have from public.god_power p where p.god_id = ev.god_id for update;
  if have >= charge then
    update public.god_power set power = power - charge where god_id = ev.god_id
    returning power into power_now;
    perform public._append_event(
      target_world,
      'gm_ruling',
      jsonb_build_object(
        'kind', 'nontraditional', 'seq', action_seq, 'charged', charge,
        'god_id', ev.god_id, 'power_after', power_now, 'note', clean
      ),
      public._gm_god(target_world)
    );
    return 'charged';
  end if;
  -- Its creator can't pay double: the race is undone (and refunded), with anything built on it.
  undone := public._retcon(target_world, action_seq, null);
  perform public._append_event(
    target_world,
    'gm_ruling',
    jsonb_build_object(
      'kind', 'nontraditional', 'seq', action_seq, 'charged', 0, 'god_id', ev.god_id,
      'undone', to_jsonb(undone), 'note', clean
    ),
    public._gm_god(target_world)
  );
  return 'undone';
end;
$$;

------------------------------------------------------------------------------------------------
-- The GM's rules for the world: final say, alignment cap, years per round.
------------------------------------------------------------------------------------------------
create or replace function public.gm_set_rules(
  target_world uuid,
  final_say boolean,
  cap int,
  years int[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.worlds%rowtype;
  changes jsonb := '{}'::jsonb;
begin
  perform public._require_gm(target_world);
  select * into w from public.worlds x where x.id = target_world for update;
  if cap is not null and (cap < 1 or cap > 20) then
    raise exception 'Cap alignment between ±1 and ±20' using errcode = 'check_violation';
  end if;
  if years is not null and (cardinality(years) <> 3 or 1 > any (years) or 10000 < any (years)) then
    raise exception 'Years per round are between 1 and 10,000 for each age' using errcode = 'check_violation';
  end if;
  if final_say is distinct from w.gm_final_say then
    changes := changes || jsonb_build_object('final_say', final_say);
  end if;
  if cap is distinct from w.alignment_cap then
    changes := changes || jsonb_build_object('alignment_cap', cap);
  end if;
  if years is distinct from w.years_per_round then
    changes := changes || jsonb_build_object('years_per_round', to_jsonb(years));
  end if;
  if changes = '{}'::jsonb then
    return;
  end if;
  update public.worlds
  set gm_final_say = final_say, alignment_cap = cap, years_per_round = years
  where id = target_world;
  if w.status <> 'lobby' then
    perform public._append_event(
      target_world, 'gm_ruling', jsonb_build_object('kind', 'rules') || changes,
      public._gm_god(target_world)
    );
  end if;
end;
$$;

-- Alignment can't pass the GM's cap (undoing an action puts things back as they were).
create or replace function public._enforce_alignment_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cap int;
  i int;
begin
  if current_setting('dow.undoing', true) = 'on' then
    return new;
  end if;
  select w.alignment_cap into cap from public.worlds w where w.id = new.world_id;
  if cap is null then
    return new;
  end if;
  if tg_table_name = 'world_entities' then
    if abs(coalesce(new.alignment, 0)) > cap
       and (tg_op = 'INSERT' or new.alignment is distinct from old.alignment) then
      raise exception 'The GM has capped alignment at ±%', cap using errcode = 'check_violation';
    end if;
  elsif new.alignment is not null then
    for i in 1..cardinality(new.alignment) loop
      if abs(coalesce(new.alignment[i], 0)) > cap
         and (old.alignment is null or new.alignment[i] is distinct from old.alignment[i]) then
        raise exception 'The GM has capped alignment at ±%', cap using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger world_entities_alignment_cap
  before insert or update of alignment on public.world_entities
  for each row execute function public._enforce_alignment_cap();
create trigger world_map_alignment_cap
  before update of alignment on public.world_map
  for each row execute function public._enforce_alignment_cap();

------------------------------------------------------------------------------------------------
-- Years per round: the GM's, or the ruleset's.
------------------------------------------------------------------------------------------------
create or replace function public._years_per_round(target_world uuid, cfg jsonb, age int)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select w.years_per_round[age] from public.worlds w where w.id = target_world),
    (cfg -> 'ages' -> (age - 1) ->> 'yearsPerRound')::int
  )
$$;

-- As in 20261118000000, using _years_per_round().
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
  lapsed public.world_proposals;
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
    else st.year + public._years_per_round(target_world, cfg, st.age)
  end;
  update public.world_state
  set round = st.round + 1, year = new_year
  where world_id = target_world;

  -- DOW-52: a vote on the next age that hasn't passed lapses with the round.
  for lapsed in
    select * from public.world_proposals x
    where x.world_id = target_world and x.kind = 'advance_age' and x.status = 'open'
  loop
    perform public._finish_proposal(lapsed, 'expired', null, null);
  end loop;
  -- ...and one that has passed begins now.
  if st.age_pending then
    update public.world_state
    set age = st.age + 1, age_started_round = st.round + 1, age_pending = false
    where world_id = target_world;
    st.age := st.age + 1;
    perform public._append_event(
      target_world,
      'age_advanced',
      jsonb_build_object(
        'age', st.age,
        'name', cfg -> 'ages' -> (st.age - 1) ->> 'name',
        'years_per_round', public._years_per_round(target_world, cfg, st.age),
        'round', st.round + 1
      )
    );
  end if;

  -- Scratch table for working out turn order (per connection, emptied each round).
  if to_regclass('pg_temp._dow_order') is null then
    create temp table _dow_order (god_id uuid primary key, keys int[] not null);
  end if;
  delete from pg_temp._dow_order where true; -- explicit WHERE: Supabase's pg-safeupdate rejects DELETE without one

  for god in
    select g.id, p.power, p.low_pool_bonus
    from public.gods g join public.god_power p on p.god_id = g.id
    where g.world_id = target_world and g.departed_at is null
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
  where g.world_id = target_world and m.is_gm and g.departed_at is null
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

-- As in 20261117000000, also refunding what the GM charged for a non-traditional race.
create or replace function public._retcon(target_world uuid, root_seq int, proposal uuid)
returns int[]
language plpgsql
set search_path = ''
as $$
declare
  undone int[] := array[root_seq];
  later record;
  u public.world_undo_log;
  s int;
  ev public.world_events%rowtype;
  refund int;
  power_now int;
  other public.world_proposals;
  map_width int;
begin
  select m.width into map_width from public.world_map m where m.world_id = target_world;
  if public._is_retconned(target_world, root_seq) then
    return '{}'::int[]; -- already undone along with something else
  end if;
  -- Later actions that touched the same rows or hexes, or mention anything the undone ones made.
  for later in
    select e.seq, e.payload from public.world_events e
    where e.world_id = target_world and e.type = 'action_taken' and e.seq > root_seq
      and not public._is_retconned(target_world, e.seq)
    order by e.seq
  loop
    if exists (
      select 1
      from public.world_undo_log mine
      where mine.world_id = target_world and mine.action_seq = any (undone)
        and (
          exists (
            select 1 from public.world_undo_log theirs
            where theirs.world_id = target_world and theirs.action_seq = later.seq
              and theirs.tbl = mine.tbl and theirs.key = mine.key
          )
          -- Something placed on a hex whose terrain is being undone.
          or (
            mine.tbl = 'world_map' and mine.key like 'terrain:%'
            and exists (
              select 1 from public.world_undo_log theirs
              where theirs.world_id = target_world and theirs.action_seq = later.seq
                and theirs.tbl = 'world_entities' and theirs.new_row ->> 'hex_x' is not null
                and (theirs.new_row ->> 'hex_y')::int * map_width + (theirs.new_row ->> 'hex_x')::int + 1
                  = split_part(mine.key, ':', 2)::int
            )
          )
          or (
            mine.op = 'insert' and mine.tbl <> 'world_map'
            and (
              later.payload::text like '%' || mine.key || '%'
              or exists (
                select 1 from public.world_undo_log theirs
                where theirs.world_id = target_world and theirs.action_seq = later.seq
                  and (coalesce(theirs.new_row, theirs.old_row))::text like '%' || mine.key || '%'
              )
            )
          )
        )
    ) then
      undone := undone || later.seq;
    end if;
  end loop;

  perform set_config('dow.undoing', 'on', true);
  foreach s in array (select array_agg(x order by x desc) from unnest(undone) x) loop
    for u in
      select * from public.world_undo_log l
      where l.world_id = target_world and l.action_seq = s
      order by l.id desc
    loop
      perform public._undo_apply(u);
    end loop;

    select * into ev from public.world_events e where e.world_id = target_world and e.seq = s;
    refund := coalesce((ev.payload ->> 'cost')::int, 0)
      -- DOW-62: and what the GM charged on top for a non-traditional race.
      + coalesce((
          select sum((r.payload ->> 'charged')::int) from public.world_events r
          where r.world_id = target_world and r.type = 'gm_ruling'
            and r.payload ->> 'kind' = 'nontraditional' and (r.payload ->> 'seq')::int = s
        ), 0);
    update public.god_power set power = power + refund where god_id = ev.god_id
    returning power into power_now;
    perform public._append_event(
      target_world,
      'action_retconned',
      jsonb_build_object(
        'seq', s,
        'proposal_id', proposal,
        'because_of', case when s = root_seq then null else root_seq end,
        'refund', refund,
        'power_after', power_now
      ),
      ev.god_id
    );
  end loop;
  perform set_config('dow.undoing', 'off', true);

  -- Objections to anything undone along with it are settled.
  for other in
    select * from public.world_proposals x
    where x.world_id = target_world and x.kind = 'objection' and x.status = 'open'
      and x.target_seq = any (undone) and x.id is distinct from proposal
  loop
    perform public._finish_proposal(other, 'undone', null, null);
  end loop;
  return undone;
end;
$$;

revoke execute on function public._require_gm(uuid) from public, anon, authenticated;
revoke execute on function public._gm_god(uuid) from public, anon, authenticated;
revoke execute on function public._clean_note(text) from public, anon, authenticated;
revoke execute on function public._enforce_alignment_cap() from public, anon, authenticated;
revoke execute on function public._years_per_round(uuid, jsonb, int) from public, anon, authenticated;
revoke execute on function public._begin_round(uuid) from public, anon, authenticated;
revoke execute on function public._retcon(uuid, int, uuid) from public, anon, authenticated;

revoke execute on function public.gm_rule(uuid, uuid, text, text) from public, anon;
grant execute on function public.gm_rule(uuid, uuid, text, text) to authenticated;
revoke execute on function public.gm_rule_nontraditional(uuid, int, text) from public, anon;
grant execute on function public.gm_rule_nontraditional(uuid, int, text) to authenticated;
revoke execute on function public.gm_set_rules(uuid, boolean, int, int[]) from public, anon;
grant execute on function public.gm_set_rules(uuid, boolean, int, int[]) to authenticated;
