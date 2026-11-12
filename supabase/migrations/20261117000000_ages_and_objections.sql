-- DOW-52 (age transitions with voting) and DOW-53 (objections: vote or coin flip, retcons).
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- From the rules (section II): "Each age lasts a minimum of five rounds. After the fifth round,
-- a majority vote of the players can end the age. After the tenth round, any player can end it."
-- And on disputes: when the players can't agree, flip a coin.
--
-- How the app does it:
-- * Ages: from the age's 5th round any god can propose the next age; it passes when more than
--   half of the gods vote yes, and fails when that can no longer happen or the round ends. From
--   the 10th round a single god can call it. Either way the new age begins with the next round,
--   so everyone plays a whole round at one age's prices.
-- * Objections: within the world's objection window (12 hours by default; the host can change it
--   or turn objections off), any other god can object to an action. Every god votes keep, undo,
--   or "flip a coin". More than half decides; if everyone has voted (or the window closes) with
--   no majority, the larger of keep and undo wins, and a tie is settled by a server coin flip.
-- * Undoing an action refunds its cost and puts the world back as it was: every change an
--   action makes to the map, races, cities, armies, advancements and the like is recorded in an
--   undo log, and anything later that built on it (an army raised in an undone city, a second
--   coat of terrain on the same hex) is undone too. Undone actions stay in the log, marked.

------------------------------------------------------------------------------------------------
-- Settings and state.
------------------------------------------------------------------------------------------------
alter table public.worlds add column objection_hours int not null default 12
  check (objection_hours in (0, 1, 6, 12, 24, 48));
grant update (objection_hours) on public.worlds to authenticated;

-- The round the current age began in, and whether the next age begins at the next round.
alter table public.world_state add column age_started_round int not null default 1;
alter table public.world_state add column age_pending boolean not null default false;

-- Votes: on the next age, and on objections.
create table public.world_proposals (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  kind text not null check (kind in ('advance_age', 'objection')),
  god_id uuid references public.gods (id) on delete set null,
  -- An objection's action.
  target_seq int,
  reason text not null default '' check (char_length(reason) <= 280),
  status text not null default 'open'
    check (status in ('open', 'passed', 'failed', 'expired', 'kept', 'undone')),
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index world_proposals_one_age_vote
  on public.world_proposals (world_id) where kind = 'advance_age' and status = 'open';
-- One objection per action.
create unique index world_proposals_one_objection
  on public.world_proposals (world_id, target_seq) where kind = 'objection';

create table public.world_votes (
  proposal_id uuid not null references public.world_proposals (id) on delete cascade,
  god_id uuid not null references public.gods (id) on delete cascade,
  choice text not null check (choice in ('yes', 'no', 'keep', 'undo', 'coin')),
  created_at timestamptz not null default now(),
  primary key (proposal_id, god_id)
);

alter table public.world_proposals enable row level security;
alter table public.world_votes enable row level security;
revoke insert, update, delete on public.world_proposals, public.world_votes from anon, authenticated;
create policy "world_proposals: members read"
  on public.world_proposals for select to authenticated using (public.is_world_member(world_id));
create policy "world_votes: members read"
  on public.world_votes for select to authenticated using (
    exists (
      select 1 from public.world_proposals p
      where p.id = proposal_id and public.is_world_member(p.world_id)
    )
  );


------------------------------------------------------------------------------------------------
-- The undo log. Every change an action makes to a game table is recorded with the action's
-- world_events seq, so the action can be reversed.
------------------------------------------------------------------------------------------------
create table public.world_undo_log (
  id bigint generated always as identity primary key,
  world_id uuid not null references public.worlds (id) on delete cascade,
  txid bigint not null default txid_current(),
  action_seq int,
  tbl text not null,
  -- A row id, or for the map "terrain:12" (column and 1-based hex index).
  key text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb
);
create index world_undo_log_action_idx on public.world_undo_log (world_id, action_seq);
create index world_undo_log_pending_idx on public.world_undo_log (txid) where action_seq is null;
alter table public.world_undo_log enable row level security; -- server only: no policies
revoke all on public.world_undo_log from anon, authenticated;

-- Which action a change belongs to. An action spends power first, so a drop in a god's power
-- marks "a new action is starting" (changes made before its event is logged are stamped when it
-- is); once the action's event is logged, later changes in the same call carry its seq.
create or replace function public._undo_action_seq()
returns int
language sql
stable
set search_path = ''
as $$
  select case
    when current_setting('dow.action_seq', true) ~ '^[0-9]+$'
      then current_setting('dow.action_seq', true)::int
  end
$$;

create or replace function public._undo_mark_spend()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.power <= old.power then
    perform set_config('dow.action_seq', 'pending', true);
  end if;
  return null;
end;
$$;

create trigger god_power_undo_mark
  after update of power on public.god_power
  for each row execute function public._undo_mark_spend();

create or replace function public._undo_stamp_action()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.world_undo_log
  set action_seq = new.seq
  where world_id = new.world_id and txid = txid_current() and action_seq is null;
  perform set_config('dow.action_seq', new.seq::text, true);
  return null;
end;
$$;

create trigger world_events_undo_stamp
  after insert on public.world_events
  for each row when (new.type = 'action_taken')
  execute function public._undo_stamp_action();

-- Rows: world_entities, world_advancements.
create or replace function public._undo_capture_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('dow.undoing', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.world_undo_log (world_id, action_seq, tbl, key, op, new_row)
    values (new.world_id, public._undo_action_seq(), tg_table_name, new.id::text, 'insert', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    if to_jsonb(old) is distinct from to_jsonb(new) then
      insert into public.world_undo_log (world_id, action_seq, tbl, key, op, old_row, new_row)
      values (new.world_id, public._undo_action_seq(), tg_table_name, new.id::text, 'update',
              to_jsonb(old), to_jsonb(new));
    end if;
  else
    insert into public.world_undo_log (world_id, action_seq, tbl, key, op, old_row)
    values (old.world_id, public._undo_action_seq(), tg_table_name, old.id::text, 'delete', to_jsonb(old));
  end if;
  return null;
end;
$$;

create trigger world_entities_undo
  after insert or update or delete on public.world_entities
  for each row execute function public._undo_capture_row();
create trigger world_advancements_undo
  after insert or update or delete on public.world_advancements
  for each row execute function public._undo_capture_row();

-- The map is one row of arrays: record each hex that changed.
create or replace function public._undo_capture_map()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  i int;
  seq int := public._undo_action_seq();
begin
  if current_setting('dow.undoing', true) = 'on' then
    return null;
  end if;
  for i in 1..cardinality(new.terrain) loop
    if old.terrain[i] is distinct from new.terrain[i] then
      insert into public.world_undo_log (world_id, action_seq, tbl, key, op, old_row, new_row)
      values (new.world_id, seq, 'world_map', 'terrain:' || i, 'update',
              to_jsonb(old.terrain[i]), to_jsonb(new.terrain[i]));
    end if;
    if old.climate[i] is distinct from new.climate[i] then
      insert into public.world_undo_log (world_id, action_seq, tbl, key, op, old_row, new_row)
      values (new.world_id, seq, 'world_map', 'climate:' || i, 'update',
              to_jsonb(old.climate[i]), to_jsonb(new.climate[i]));
    end if;
    if old.alignment[i] is distinct from new.alignment[i] then
      insert into public.world_undo_log (world_id, action_seq, tbl, key, op, old_row, new_row)
      values (new.world_id, seq, 'world_map', 'alignment:' || i, 'update',
              to_jsonb(old.alignment[i]), to_jsonb(new.alignment[i]));
    end if;
  end loop;
  return null;
end;
$$;

create trigger world_map_undo
  after update on public.world_map
  for each row execute function public._undo_capture_map();

create or replace function public._is_retconned(target_world uuid, action_seq int)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.world_events r
    where r.world_id = target_world and r.type = 'action_retconned'
      and (r.payload ->> 'seq')::int = action_seq
  )
$$;

-- Reverses one undo-log entry.
create or replace function public._undo_apply(u public.world_undo_log)
returns void
language plpgsql
set search_path = ''
as $$
declare
  col text;
  idx int;
  cols text;
  rcols text;
begin
  if u.tbl = 'world_map' then
    col := split_part(u.key, ':', 1);
    idx := split_part(u.key, ':', 2)::int;
    execute format(
      'update public.world_map set %I[%s] = ($1 #>> ''{}'')%s where world_id = $2',
      col, idx, case when col = 'alignment' then '::int' else '' end
    ) using u.old_row, u.world_id;
  elsif u.op = 'insert' then
    execute format('delete from public.%I where id = $1', u.tbl) using u.key::uuid;
  elsif u.op = 'delete' then
    execute format(
      'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', u.tbl, u.tbl
    ) using u.old_row;
  else
    select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position),
           string_agg(format('r.%I', c.column_name), ', ' order by c.ordinal_position)
    into cols, rcols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = u.tbl and c.column_name <> 'id';
    execute format(
      'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r) where t.id = $2',
      u.tbl, cols, rcols, u.tbl
    ) using u.old_row, u.key::uuid;
  end if;
end;
$$;

-- Undoes an action and everything later that built on it (changed the same rows or hexes,
-- mentions something it made, or stands on a hex whose terrain it shaped); refunds each.
-- Returns the undone seqs.
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
    refund := coalesce((ev.payload ->> 'cost')::int, 0);
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

------------------------------------------------------------------------------------------------
-- Proposals and votes.
------------------------------------------------------------------------------------------------
-- The caller's god in a world.
create or replace function public._my_god(target_world uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  god uuid;
begin
  select g.id into god from public.gods g
  where g.world_id = target_world and g.user_id = (select auth.uid());
  if god is null then
    raise exception 'Only gods in this world can do that' using errcode = 'insufficient_privilege';
  end if;
  return god;
end;
$$;

create or replace function public._require_active(target_world uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (select w.status from public.worlds w where w.id = target_world) is distinct from 'active' then
    raise exception 'This game is not in play' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public._age_name(age int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case age when 1 then 'First' when 2 then 'Second' else 'Third' end || ' Age'
$$;

-- Tells every other god about a new vote.
create or replace function public._announce_proposal(p public.world_proposals, title text, body text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  g record;
begin
  for g in
    select gd.user_id from public.gods gd
    where gd.world_id = p.world_id and gd.id is distinct from p.god_id
  loop
    perform public._notify(g.user_id, p.world_id, 'vote', title, body, '/world/' || p.world_id);
  end loop;
end;
$$;

-- A fair coin, rolled and logged like any other die: 1 keeps the action, 2 undoes it.
create or replace function public._coin_flip(target_world uuid, flipper uuid)
returns int
language sql
set search_path = ''
as $$
  select public._log_roll(target_world, flipper, 'coin_flip', public._roll_dice(1, 2))
$$;

create or replace function public._finish_proposal(
  p public.world_proposals,
  outcome text,
  coin int,
  undone int[]
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  tally jsonb;
begin
  select coalesce(jsonb_object_agg(v.choice, v.n), '{}'::jsonb) into tally
  from (select choice, count(*) as n from public.world_votes where proposal_id = p.id group by choice) v;

  update public.world_proposals set status = outcome, resolved_at = now() where id = p.id;
  if p.kind = 'advance_age' and outcome = 'passed' then
    update public.world_state set age_pending = true where world_id = p.world_id;
  end if;
  perform public._append_event(
    p.world_id,
    'proposal_resolved',
    jsonb_build_object(
      'proposal_id', p.id,
      'kind', p.kind,
      'outcome', outcome,
      'tally', tally,
      'coin', coin,
      'undone', to_jsonb(coalesce(undone, '{}'::int[]))
    ),
    null
  );
  return outcome;
end;
$$;

-- Counts the votes; resolves the proposal when the outcome is decided (or `closing`).
create or replace function public._tally(p public.world_proposals, closing boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  gods int;
  cast_votes int;
  yes int; keep int; undo int; coin int;
  decided text;
  flip int;
begin
  select count(*) into gods from public.gods g where g.world_id = p.world_id;
  select count(*),
         count(*) filter (where choice = 'yes'),
         count(*) filter (where choice = 'keep'),
         count(*) filter (where choice = 'undo'),
         count(*) filter (where choice = 'coin')
  into cast_votes, yes, keep, undo, coin
  from public.world_votes where proposal_id = p.id;

  if p.kind = 'advance_age' then
    if yes * 2 > gods then
      return public._finish_proposal(p, 'passed', null, null);
    elsif (yes + gods - cast_votes) * 2 <= gods then
      return public._finish_proposal(p, 'failed', null, null);
    elsif closing then
      return public._finish_proposal(p, 'expired', null, null);
    end if;
    return 'open';
  end if;

  -- Objections.
  if keep * 2 > gods then
    decided := 'kept';
  elsif undo * 2 > gods then
    decided := 'undone';
  elsif coin * 2 > gods then
    decided := 'coin';
  elsif closing or cast_votes >= gods then
    decided := case
      when coin > keep and coin > undo then 'coin'
      when keep > undo then 'kept'
      when undo > keep then 'undone'
      else 'coin'
    end;
  else
    return 'open';
  end if;

  if decided = 'coin' then
    flip := public._coin_flip(p.world_id, p.god_id);
    decided := case when flip = 1 then 'kept' else 'undone' end;
  end if;
  return public._finish_proposal(
    p, decided, flip,
    case when decided = 'undone' then public._retcon(p.world_id, p.target_seq, p.id) end
  );
end;
$$;

create or replace function public._cast_vote(p public.world_proposals, god uuid, choice text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.world_votes (proposal_id, god_id, choice) values (p.id, god, choice)
  on conflict (proposal_id, god_id) do update set choice = excluded.choice, created_at = now();
  perform public._append_event(
    p.world_id, 'vote_cast', jsonb_build_object('proposal_id', p.id, 'choice', choice), god
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-52: the next age.
------------------------------------------------------------------------------------------------
create or replace function public.propose_next_age(target_world uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  god uuid := public._my_god(target_world);
  st public.world_state%rowtype;
  cfg jsonb;
  rounds_in_age int;
  p public.world_proposals;
  solo boolean;
begin
  perform public._require_active(target_world);
  select * into st from public.world_state s where s.world_id = target_world for update;
  select r.config into cfg
  from public.worlds w join public.rulesets r on r.id = w.ruleset_id where w.id = target_world;

  if st.age >= jsonb_array_length(cfg -> 'ages') then
    raise exception 'This is the last age' using errcode = 'check_violation';
  end if;
  if st.age_pending then
    raise exception 'The % begins when this round ends', public._age_name(st.age + 1)
      using errcode = 'check_violation';
  end if;
  rounds_in_age := st.round - st.age_started_round + 1;
  if rounds_in_age < (cfg #>> '{ageTransition,minRounds}')::int then
    raise exception 'An age lasts at least % rounds; this is round % of the %',
      cfg #>> '{ageTransition,minRounds}', rounds_in_age, public._age_name(st.age)
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.world_proposals x
    where x.world_id = target_world and x.kind = 'advance_age' and x.status = 'open'
  ) then
    raise exception 'There is already a vote on the next age' using errcode = 'check_violation';
  end if;
  solo := rounds_in_age >= (cfg #>> '{ageTransition,anyPlayerAfterRounds}')::int;

  insert into public.world_proposals (world_id, kind, god_id)
  values (target_world, 'advance_age', god)
  returning * into p;
  perform public._append_event(
    target_world,
    'proposal_opened',
    jsonb_build_object(
      'proposal_id', p.id, 'kind', 'advance_age', 'age', st.age + 1, 'solo', solo,
      'closes_at', null, 'reason', ''
    ),
    god
  );

  if solo then
    return public._finish_proposal(p, 'passed', null, null);
  end if;
  perform public._cast_vote(p, god, 'yes');
  perform public._announce_proposal(
    p,
    'Vote: the ' || public._age_name(st.age + 1) || '?',
    (select g.name from public.gods g where g.id = god) || ' proposes moving on to the '
      || public._age_name(st.age + 1) || '. Vote in the app.'
  );
  return public._tally(p, false);
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-53: objections.
------------------------------------------------------------------------------------------------
create or replace function public.object_to_action(target_world uuid, action_seq int, reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  god uuid := public._my_god(target_world);
  hours int;
  ev public.world_events%rowtype;
  p public.world_proposals;
  clean text := trim(coalesce(reason, ''));
begin
  perform public._require_active(target_world);
  select w.objection_hours into hours from public.worlds w where w.id = target_world;
  if hours = 0 then
    raise exception 'Objections are turned off in this world' using errcode = 'check_violation';
  end if;
  select * into ev from public.world_events e
  where e.world_id = target_world and e.seq = action_seq and e.type = 'action_taken';
  if ev.id is null then
    raise exception 'That action doesn''t exist' using errcode = 'check_violation';
  end if;
  if ev.god_id = god then
    raise exception 'You can''t object to your own action' using errcode = 'check_violation';
  end if;
  if ev.created_at + make_interval(hours => hours) < now() then
    raise exception 'It''s too late to object to that (the window is % hours)', hours
      using errcode = 'check_violation';
  end if;
  if public._is_retconned(target_world, action_seq) then
    raise exception 'That action has already been undone' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.world_proposals x
    where x.world_id = target_world and x.kind = 'objection' and x.target_seq = action_seq
  ) then
    raise exception 'Someone has already objected to that' using errcode = 'check_violation';
  end if;
  if char_length(clean) = 0 then
    raise exception 'Say why you object' using errcode = 'check_violation';
  end if;
  if char_length(clean) > 280 then
    raise exception 'Keep it under 280 characters' using errcode = 'check_violation';
  end if;

  insert into public.world_proposals (world_id, kind, god_id, target_seq, reason, closes_at)
  values (target_world, 'objection', god, action_seq, clean, now() + make_interval(hours => hours))
  returning * into p;
  perform public._append_event(
    target_world,
    'proposal_opened',
    jsonb_build_object(
      'proposal_id', p.id, 'kind', 'objection', 'target_seq', action_seq,
      'reason', clean, 'closes_at', p.closes_at
    ),
    god
  );
  perform public._cast_vote(p, god, 'undo');
  perform public._announce_proposal(
    p,
    'Objection!',
    (select g.name from public.gods g where g.id = god) || ' objects to '
      || coalesce((select g.name from public.gods g where g.id = ev.god_id), 'an action')
      || '''s ' || coalesce(ev.payload ->> 'choice', 'action') || ': ' || clean
      || ' Vote to keep or undo it.'
  );
  perform public._tally(p, false);
  return p.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- Voting and closing.
------------------------------------------------------------------------------------------------
create or replace function public.vote(target_world uuid, proposal uuid, choice text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  god uuid := public._my_god(target_world);
  p public.world_proposals;
begin
  select * into p from public.world_proposals x
  where x.id = proposal and x.world_id = target_world for update;
  if p.id is null then
    raise exception 'That vote doesn''t exist' using errcode = 'check_violation';
  end if;
  if p.status <> 'open' then
    raise exception 'That vote is over' using errcode = 'check_violation';
  end if;
  if p.closes_at is not null and p.closes_at < now() then
    return public._tally(p, true);
  end if;
  if not (
    (p.kind = 'advance_age' and choice in ('yes', 'no'))
    or (p.kind = 'objection' and choice in ('keep', 'undo', 'coin'))
  ) then
    raise exception 'That isn''t a choice in this vote' using errcode = 'check_violation';
  end if;
  perform public._cast_vote(p, god, choice);
  return public._tally(p, false);
end;
$$;

-- Anyone in the world can close a vote whose time is up (the app does it when it notices).
create or replace function public.close_proposal(target_world uuid, proposal uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.world_proposals;
begin
  if not public.is_world_member(target_world) then
    raise exception 'You''re not in this world' using errcode = 'insufficient_privilege';
  end if;
  select * into p from public.world_proposals x
  where x.id = proposal and x.world_id = target_world for update;
  if p.id is null or p.status <> 'open' then
    return coalesce(p.status, 'missing');
  end if;
  if p.closes_at is null or p.closes_at > now() then
    raise exception 'That vote is still open' using errcode = 'check_violation';
  end if;
  return public._tally(p, true);
end;
$$;

-- Every few minutes (pg_cron), close votes whose time is up.
create or replace function public.close_expired_proposals()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.world_proposals;
  n int := 0;
begin
  for p in
    select * from public.world_proposals x
    where x.status = 'open' and x.closes_at < now()
    order by x.closes_at
    for update skip locked
  loop
    perform public._tally(p, true);
    n := n + 1;
  end loop;
  return n;
end;
$$;

------------------------------------------------------------------------------------------------
-- Rounds: a new age begins with a round; open age votes lapse when the round ends.
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
    else st.year + (cfg -> 'ages' -> (st.age - 1) ->> 'yearsPerRound')::int
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
        'years_per_round', (cfg -> 'ages' -> (st.age - 1) ->> 'yearsPerRound')::int,
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
-- Grants.
------------------------------------------------------------------------------------------------
revoke execute on function public._undo_action_seq() from public, anon, authenticated;
revoke execute on function public._undo_mark_spend() from public, anon, authenticated;
revoke execute on function public._undo_stamp_action() from public, anon, authenticated;
revoke execute on function public._undo_capture_row() from public, anon, authenticated;
revoke execute on function public._undo_capture_map() from public, anon, authenticated;
revoke execute on function public._is_retconned(uuid, int) from public, anon, authenticated;
revoke execute on function public._undo_apply(public.world_undo_log) from public, anon, authenticated;
revoke execute on function public._retcon(uuid, int, uuid) from public, anon, authenticated;
revoke execute on function public._my_god(uuid) from public, anon, authenticated;
revoke execute on function public._require_active(uuid) from public, anon, authenticated;
revoke execute on function public._age_name(int) from public, anon, authenticated;
revoke execute on function public._announce_proposal(public.world_proposals, text, text) from public, anon, authenticated;
revoke execute on function public._coin_flip(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._finish_proposal(public.world_proposals, text, int, int[]) from public, anon, authenticated;
revoke execute on function public._tally(public.world_proposals, boolean) from public, anon, authenticated;
revoke execute on function public._cast_vote(public.world_proposals, uuid, text) from public, anon, authenticated;
revoke execute on function public._begin_round(uuid) from public, anon, authenticated;
revoke execute on function public.close_expired_proposals() from public, anon, authenticated;

revoke execute on function public.propose_next_age(uuid) from public, anon;
revoke execute on function public.object_to_action(uuid, int, text) from public, anon;
revoke execute on function public.vote(uuid, uuid, text) from public, anon;
revoke execute on function public.close_proposal(uuid, uuid) from public, anon;
grant execute on function public.propose_next_age(uuid) to authenticated;
grant execute on function public.object_to_action(uuid, int, text) to authenticated;
grant execute on function public.vote(uuid, uuid, text) to authenticated;
grant execute on function public.close_proposal(uuid, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'dow-close-votes'$q$;
    execute $q$select cron.schedule('dow-close-votes', '*/5 * * * *',
      'select public.close_expired_proposals()')$q$;
  end if;
end
$$;
