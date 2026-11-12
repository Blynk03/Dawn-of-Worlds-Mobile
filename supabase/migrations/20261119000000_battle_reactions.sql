-- DOW-56 (a reaction window before a battle is rolled) and the rest of DOW-54 (battle bonuses the
-- table can dispute and vote on).
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- How it works:
-- * declare_attack() pays for the attack (and sets aside the most utter destruction could cost)
--   and opens a reaction window: 12 hours by default; the host can change it, or set 0 to roll
--   battles at once as before. Nothing is rolled yet.
-- * During the window the other gods play their turns as usual, so they can answer it: march an
--   army in to defend, shape the land, raise walls. Any god can propose a +1 for either side, and
--   dispute a bonus someone else proposed; a disputed bonus is voted on (keep or drop; more than
--   half decides, otherwise the larger side when the battle is rolled, a tie a coin flip).
-- * The battle is rolled when the window closes or as soon as every other god has waived, with the
--   armies as they stand then and the bonuses that stood. If the attacking army or its target is
--   gone by then, the attack is called off and refunded.

alter table public.worlds add column reaction_hours int not null default 12
  check (reaction_hours in (0, 1, 6, 12, 24, 48));
grant update (reaction_hours) on public.worlds to authenticated;

create table public.world_battles (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  god_id uuid references public.gods (id) on delete set null,
  army_id uuid not null,
  target_kind text not null check (target_kind in ('army', 'city')),
  target_id uuid not null,
  utterly_destroy boolean not null default false,
  description text not null,
  -- Power set aside for utter destruction (given back, less what is destroyed, when rolled).
  reserved int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'cancelled')),
  closes_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- One pending attack per army.
create unique index world_battles_one_per_army on public.world_battles (army_id) where status = 'pending';

create table public.world_battle_bonuses (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references public.world_battles (id) on delete cascade,
  side text not null check (side in ('attacker', 'defender')),
  label text not null check (char_length(label) between 1 and 60),
  god_id uuid references public.gods (id) on delete set null,
  status text not null default 'agreed' check (status in ('agreed', 'disputed', 'kept', 'dropped')),
  created_at timestamptz not null default now(),
  unique (battle_id, side, label)
);

create table public.world_battle_waivers (
  battle_id uuid not null references public.world_battles (id) on delete cascade,
  god_id uuid not null references public.gods (id) on delete cascade,
  primary key (battle_id, god_id)
);

alter table public.world_battles enable row level security;
alter table public.world_battle_bonuses enable row level security;
alter table public.world_battle_waivers enable row level security;
revoke insert, update, delete on public.world_battles, public.world_battle_bonuses,
  public.world_battle_waivers from anon, authenticated;
create policy "world_battles: members read"
  on public.world_battles for select to authenticated using (public.is_world_member(world_id));
create policy "world_battle_bonuses: members read"
  on public.world_battle_bonuses for select to authenticated using (
    exists (select 1 from public.world_battles b where b.id = battle_id and public.is_world_member(b.world_id))
  );
create policy "world_battle_waivers: members read"
  on public.world_battle_waivers for select to authenticated using (
    exists (select 1 from public.world_battles b where b.id = battle_id and public.is_world_member(b.world_id))
  );

-- Disputed bonuses are voted on like objections.
alter table public.world_proposals add column battle_bonus_id uuid
  references public.world_battle_bonuses (id) on delete cascade;
alter table public.world_proposals drop constraint if exists world_proposals_kind_check;
alter table public.world_proposals add constraint world_proposals_kind_check
  check (kind in ('advance_age', 'objection', 'bonus'));
alter table public.world_proposals drop constraint if exists world_proposals_status_check;
alter table public.world_proposals add constraint world_proposals_status_check
  check (status in ('open', 'passed', 'failed', 'expired', 'kept', 'undone', 'dropped'));
alter table public.world_votes drop constraint if exists world_votes_choice_check;
alter table public.world_votes add constraint world_votes_choice_check
  check (choice in ('yes', 'no', 'keep', 'undo', 'coin', 'drop'));

------------------------------------------------------------------------------------------------
-- The battle itself, shared by attacking at once and rolling a declared battle (as attack() in
-- 20261116000000, taking the god, and optionally prepaid).
------------------------------------------------------------------------------------------------
create or replace function public._do_attack(
  target_world uuid,
  acting_god uuid,
  army uuid,
  target_kind text,
  target uuid,
  attacker_modifiers jsonb,
  defender_modifiers jsonb,
  utterly_destroy boolean,
  description text,
  -- For a battle declared earlier (DOW-56): the reserve already set aside for utter destruction.
  -- Null for an attack rolled at once.
  prepaid int default null,
  battle_id uuid default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  a public.world_entities%rowtype;
  t public.world_entities%rowtype;
  d record;
  att_mods jsonb := public._clean_modifiers(attacker_modifiers);
  def_mods jsonb := public._clean_modifiers(defender_modifiers);
  clean_description text;
  cost int;
  power_after int;
  army_price int := public._power_cost(target_world, 'commandCity');
  city_price int := public._power_cost(target_world, 'commandRace');
  defenders uuid[];
  battles jsonb := '[]'::jsonb;
  battle_no int := 0;
  ar int[];
  dr int[];
  a_total int;
  d_total int;
  won boolean := true;
  scattered jsonb := '[]'::jsonb;
  destroyed jsonb := '[]'::jsonb;
  city_outcome text;
  destruction_cost int := 0;
  worst_case int;
  have int;
begin
  select * into a from public.world_entities e
  where e.id = army and e.world_id = target_world and e.kind = 'army';
  if a.id is null then
    raise exception 'Choose one of this world''s armies' using errcode = 'check_violation';
  end if;
  if a.status <> 'active' then
    raise exception '% is scattered', a.name using errcode = 'check_violation';
  end if;
  if prepaid is null then
    perform public._require_presence(target_world, acting_god, a.race_id);
  end if;

  if target_kind = 'army' then
    select * into t from public.world_entities e
    where e.id = target and e.world_id = target_world and e.kind = 'army';
    if t.id is null or t.id = a.id then
      raise exception 'Choose another army to attack' using errcode = 'check_violation';
    end if;
    if t.status <> 'active' then
      raise exception '% is already scattered', t.name using errcode = 'check_violation';
    end if;
    defenders := array[t.id];
  elsif target_kind = 'city' then
    select * into t from public.world_entities e
    where e.id = target and e.world_id = target_world and e.kind = 'city';
    if t.id is null then
      raise exception 'Choose one of this world''s cities' using errcode = 'check_violation';
    end if;
    if t.status <> 'active' then
      raise exception '% already lies in ruins', t.name using errcode = 'check_violation';
    end if;
    select coalesce(array_agg(e.id order by e.created_seq), '{}') into defenders
    from public.world_entities e
    where e.world_id = target_world and e.kind = 'army' and e.status = 'active' and e.id <> a.id
      and (e.city_id = t.id or (e.hex_x = t.hex_x and e.hex_y = t.hex_y));
  else
    raise exception 'Attack an army or a city' using errcode = 'check_violation';
  end if;
  clean_description := public._require_description(description);

  cost := public._power_cost(target_world, 'commandRace');
  if prepaid is not null then
    -- Declared earlier: the attack and the reserve are paid. If more defenders have arrived than
    -- the reserve (and the god's power now) can pay to destroy, they are scattered instead.
    worst_case := army_price * cardinality(defenders)
      + case when target_kind = 'city' then city_price else 0 end;
    select p.power into have from public.god_power p where p.god_id = acting_god;
    if coalesce(utterly_destroy, false) and worst_case > prepaid + have then
      utterly_destroy := false;
    end if;
    -- Give the reserve back now; destruction is paid below, like an immediate attack.
    update public.god_power set power = power + prepaid where god_id = acting_god
    returning power into power_after;
  elsif coalesce(utterly_destroy, false) then
    -- Make sure total destruction can be paid for however the battles go.
    worst_case := army_price * cardinality(defenders)
      + case when target_kind = 'city' then city_price else 0 end;
    select p.power into have from public.god_power p where p.god_id = acting_god;
    if have < cost + worst_case then
      raise exception 'Attacking and utterly destroying everything could cost % power; you have %',
        cost + worst_case, have using errcode = 'check_violation';
    end if;
  end if;
  if prepaid is null then
    power_after := public._spend_power(acting_god, cost);
  end if;

  -- One battle per defending army, in order; the attacker tires after the first.
  foreach target in array defenders loop
    select e.id, e.name into d from public.world_entities e where e.id = target;
    loop
      ar := array[public._roll_die(6), public._roll_die(6)];
      dr := array[public._roll_die(6), public._roll_die(6)];
      a_total := ar[1] + ar[2] + jsonb_array_length(att_mods) - battle_no;
      d_total := dr[1] + dr[2] + jsonb_array_length(def_mods);
      exit when a_total <> d_total; -- a tie is fought again
    end loop;
    battles := battles || jsonb_build_object(
      'defender', jsonb_build_object('id', d.id, 'name', d.name),
      'attacker_dice', to_jsonb(ar), 'defender_dice', to_jsonb(dr),
      'attacker_bonus', jsonb_array_length(att_mods), 'defender_bonus', jsonb_array_length(def_mods),
      'fatigue', battle_no, 'attacker_total', a_total, 'defender_total', d_total,
      'winner', case when a_total > d_total then 'attacker' else 'defender' end
    );
    battle_no := battle_no + 1;
    if a_total > d_total then
      if coalesce(utterly_destroy, false) then
        destroyed := destroyed || to_jsonb(d.id);
        destruction_cost := destruction_cost + army_price;
        update public.world_entities set status = 'destroyed', hex_x = null, hex_y = null where id = d.id;
      else
        scattered := scattered || to_jsonb(d.id);
        update public.world_entities set status = 'scattered' where id = d.id;
      end if;
    else
      won := false;
      scattered := scattered || to_jsonb(a.id);
      update public.world_entities set status = 'scattered' where id = a.id;
      exit;
    end if;
  end loop;

  if won then
    -- The victors hold the field.
    update public.world_entities set hex_x = t.hex_x, hex_y = t.hex_y where id = a.id;
    if target_kind = 'city' then
      if coalesce(utterly_destroy, false) then
        city_outcome := 'destroyed';
        destruction_cost := destruction_cost + city_price;
        update public.world_entities set status = 'destroyed', hex_x = null, hex_y = null where id = t.id;
        destroyed := destroyed || to_jsonb(t.id);
      else
        city_outcome := 'ruined';
        update public.world_entities set status = 'ruined' where id = t.id;
      end if;
    end if;
  end if;
  if destruction_cost > 0 then
    power_after := public._spend_power(acting_god, destruction_cost);
  end if;

  perform public._log_action(
    target_world, acting_god, 'commandRace', cost + destruction_cost, power_after,
    jsonb_build_array(jsonb_build_array(t.hex_x, t.hex_y)), t.name, clean_description,
    jsonb_build_object(
      'intent', 'attack',
      'target', jsonb_build_object('kind', target_kind, 'id', t.id, 'key', t.id, 'name', t.name),
      'battle', jsonb_build_object(
        'army', jsonb_build_object('id', a.id, 'name', a.name),
        'attacker_modifiers', att_mods,
        'defender_modifiers', def_mods,
        'battles', battles,
        'outcome', case when won then 'won' else 'lost' end,
        'scattered', scattered,
        'destroyed', destroyed,
        'city_outcome', city_outcome,
        'destruction_cost', destruction_cost,
        'utterly_destroy', coalesce(utterly_destroy, false)
      ),
      'battle_id', battle_id
    )
  );
  return case when won then 'won' else 'lost' end;
end;
$$;

create or replace function public.attack(
  target_world uuid,
  army uuid,
  target_kind text,
  target uuid,
  attacker_modifiers jsonb,
  defender_modifiers jsonb,
  utterly_destroy boolean,
  description text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public._do_attack(
    target_world, public._require_my_turn(target_world), army, target_kind, target,
    attacker_modifiers, defender_modifiers, utterly_destroy, description
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- Declaring a battle.
------------------------------------------------------------------------------------------------
create or replace function public._add_bonus(b public.world_battles, bonus_side text, bonus_label text, god uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  clean text := trim(coalesce(bonus_label, ''));
  bonus uuid;
begin
  if char_length(clean) = 0 or char_length(clean) > 60 then
    raise exception 'A bonus needs a short name (up to 60 characters)' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.world_battle_bonuses x where x.battle_id = b.id and x.side = bonus_side) >= 10 then
    raise exception 'Each side can have up to 10 bonuses' using errcode = 'check_violation';
  end if;
  insert into public.world_battle_bonuses (battle_id, side, label, god_id)
  values (b.id, bonus_side, clean, god)
  on conflict do nothing
  returning id into bonus;
  if bonus is null then
    raise exception 'That bonus is already there' using errcode = 'check_violation';
  end if;
  perform public._append_event(
    b.world_id, 'bonus_proposed',
    jsonb_build_object('battle_id', b.id, 'bonus_id', bonus, 'side', bonus_side, 'label', clean), god
  );
  return bonus;
end;
$$;

create or replace function public.declare_attack(
  target_world uuid,
  army uuid,
  target_kind text,
  target uuid,
  attacker_modifiers jsonb,
  defender_modifiers jsonb,
  utterly_destroy boolean,
  description text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  hours int;
  a public.world_entities%rowtype;
  t public.world_entities%rowtype;
  defenders int;
  cost int := public._power_cost(target_world, 'commandRace');
  reserve int := 0;
  power_after int;
  b public.world_battles;
  m jsonb;
  att_mods jsonb := public._clean_modifiers(attacker_modifiers);
  def_mods jsonb := public._clean_modifiers(defender_modifiers);
begin
  select w.reaction_hours into hours from public.worlds w where w.id = target_world;
  if hours = 0 then
    -- No reaction window in this world: roll at once.
    return public._do_attack(
      target_world, acting_god, army, target_kind, target,
      attacker_modifiers, defender_modifiers, utterly_destroy, description
    );
  end if;

  select * into a from public.world_entities e
  where e.id = army and e.world_id = target_world and e.kind = 'army';
  if a.id is null then
    raise exception 'Choose one of this world''s armies' using errcode = 'check_violation';
  end if;
  if a.status <> 'active' then
    raise exception '% is scattered', a.name using errcode = 'check_violation';
  end if;
  perform public._require_presence(target_world, acting_god, a.race_id);
  if exists (select 1 from public.world_battles x where x.army_id = a.id and x.status = 'pending') then
    raise exception '% is already marching to battle', a.name using errcode = 'check_violation';
  end if;
  select * into t from public.world_entities e
  where e.id = target and e.world_id = target_world and e.kind = target_kind and e.id <> a.id;
  if t.id is null or target_kind not in ('army', 'city') then
    raise exception 'Attack another army or a city' using errcode = 'check_violation';
  end if;
  if t.status <> 'active' then
    raise exception '% is already %', t.name, case when t.kind = 'city' then 'in ruins' else 'scattered' end
      using errcode = 'check_violation';
  end if;
  perform public._require_description(description);

  if coalesce(utterly_destroy, false) then
    if target_kind = 'army' then
      defenders := 1;
    else
      select count(*) into defenders from public.world_entities e
      where e.world_id = target_world and e.kind = 'army' and e.status = 'active' and e.id <> a.id
        and (e.city_id = t.id or (e.hex_x = t.hex_x and e.hex_y = t.hex_y));
    end if;
    reserve := public._power_cost(target_world, 'commandCity') * defenders
      + case when target_kind = 'city' then public._power_cost(target_world, 'commandRace') else 0 end;
  end if;
  power_after := public._spend_power(acting_god, cost + reserve);

  insert into public.world_battles (
    world_id, god_id, army_id, target_kind, target_id, utterly_destroy, description, reserved, closes_at
  )
  values (
    target_world, acting_god, a.id, target_kind, t.id, coalesce(utterly_destroy, false),
    trim(description), reserve, now() + make_interval(hours => hours)
  )
  returning * into b;

  perform public._append_event(
    target_world,
    'battle_declared',
    jsonb_build_object(
      'battle_id', b.id,
      'army', jsonb_build_object('id', a.id, 'name', a.name),
      'target', jsonb_build_object('kind', target_kind, 'id', t.id, 'name', t.name),
      'utterly_destroy', b.utterly_destroy,
      'description', b.description,
      'cost', cost,
      'reserved', reserve,
      'power_after', power_after,
      'closes_at', b.closes_at
    ),
    acting_god
  );
  for m in select * from jsonb_array_elements(att_mods) loop
    perform public._add_bonus(b, 'attacker', m #>> '{}', acting_god);
  end loop;
  for m in select * from jsonb_array_elements(def_mods) loop
    perform public._add_bonus(b, 'defender', m #>> '{}', acting_god);
  end loop;
  perform public._notify(g.user_id, target_world, 'battle',
      a.name || ' marches on ' || t.name,
      'The battle is rolled in ' || hours || ' hours. Respond on your turn, propose or dispute bonuses, or waive.',
      '/world/' || target_world)
  from public.gods g
  where g.world_id = target_world and g.id <> acting_god and g.departed_at is null;
  return 'pending';
end;
$$;

------------------------------------------------------------------------------------------------
-- During the window.
------------------------------------------------------------------------------------------------
create or replace function public._pending_battle(target_world uuid, battle uuid)
returns public.world_battles
language plpgsql
set search_path = ''
as $$
declare
  b public.world_battles;
begin
  select * into b from public.world_battles x where x.id = battle and x.world_id = target_world for update;
  if b.id is null then
    raise exception 'That battle doesn''t exist' using errcode = 'check_violation';
  end if;
  if b.status <> 'pending' then
    raise exception 'That battle has already been %', case when b.status = 'resolved' then 'fought' else 'called off' end
      using errcode = 'check_violation';
  end if;
  return b;
end;
$$;

-- Any god can propose a +1 for either side while the window is open.
create or replace function public.propose_bonus(target_world uuid, battle uuid, side text, label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  god uuid := public._my_god(target_world);
  b public.world_battles := public._pending_battle(target_world, battle);
begin
  if side not in ('attacker', 'defender') then
    raise exception 'A bonus is for the attackers or the defenders' using errcode = 'check_violation';
  end if;
  return public._add_bonus(b, side, label, god);
end;
$$;

-- Any god other than the one who proposed it can dispute a bonus; the gods then vote.
create or replace function public.dispute_bonus(target_world uuid, bonus uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  god uuid := public._my_god(target_world);
  x public.world_battle_bonuses;
  b public.world_battles;
  p public.world_proposals;
begin
  select * into x from public.world_battle_bonuses y where y.id = bonus for update;
  if x.id is null then
    raise exception 'That bonus doesn''t exist' using errcode = 'check_violation';
  end if;
  b := public._pending_battle(target_world, x.battle_id);
  if x.god_id = god then
    raise exception 'You proposed that bonus; you can''t dispute it' using errcode = 'check_violation';
  end if;
  if x.status <> 'agreed' then
    raise exception 'That bonus has already been disputed' using errcode = 'check_violation';
  end if;
  update public.world_battle_bonuses set status = 'disputed' where id = x.id;
  insert into public.world_proposals (world_id, kind, god_id, battle_bonus_id, reason, closes_at)
  values (target_world, 'bonus', god, x.id, x.label, b.closes_at)
  returning * into p;
  perform public._append_event(
    target_world,
    'proposal_opened',
    jsonb_build_object(
      'proposal_id', p.id, 'kind', 'bonus', 'battle_id', b.id, 'bonus_id', x.id,
      'reason', x.label, 'closes_at', p.closes_at
    ),
    god
  );
  perform public._cast_vote(p, god, 'drop');
  perform public._tally(p, false);
  return p.id;
end;
$$;

-- Every other god waiving rolls the battle at once.
create or replace function public.waive_reaction(target_world uuid, battle uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  god uuid := public._my_god(target_world);
  b public.world_battles := public._pending_battle(target_world, battle);
begin
  if god = b.god_id then
    raise exception 'It''s your attack: the others can waive' using errcode = 'check_violation';
  end if;
  insert into public.world_battle_waivers (battle_id, god_id) values (b.id, god) on conflict do nothing;
  perform public._append_event(target_world, 'reaction_waived', jsonb_build_object('battle_id', b.id), god);
  if not exists (
    select 1 from public.gods g
    where g.world_id = target_world and g.id <> b.god_id and g.departed_at is null
      and not exists (select 1 from public.world_battle_waivers w where w.battle_id = b.id and w.god_id = g.id)
  ) then
    return public._resolve_battle(b);
  end if;
  return 'pending';
end;
$$;

-- Anyone in the world can roll a battle whose window has closed (the app does when it notices).
create or replace function public.close_battle(target_world uuid, battle uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.world_battles;
begin
  if not public.is_world_member(target_world) then
    raise exception 'You''re not in this world' using errcode = 'insufficient_privilege';
  end if;
  b := public._pending_battle(target_world, battle);
  if b.closes_at > now() then
    raise exception 'The battle is rolled when the window closes' using errcode = 'check_violation';
  end if;
  return public._resolve_battle(b);
end;
$$;

------------------------------------------------------------------------------------------------
-- Rolling it.
------------------------------------------------------------------------------------------------
create or replace function public._resolve_battle(b public.world_battles)
returns text
language plpgsql
set search_path = ''
as $$
declare
  p public.world_proposals;
  att jsonb;
  def jsonb;
  outcome text;
  refund int;
  power_now int;
begin
  -- Disputed bonuses still being voted on are settled now.
  for p in
    select x.* from public.world_proposals x
    join public.world_battle_bonuses y on y.id = x.battle_bonus_id
    where y.battle_id = b.id and x.status = 'open'
  loop
    perform public._tally(p, true);
  end loop;
  select coalesce(jsonb_agg(label order by created_at) filter (where side = 'attacker'), '[]'),
         coalesce(jsonb_agg(label order by created_at) filter (where side = 'defender'), '[]')
  into att, def
  from public.world_battle_bonuses
  where battle_id = b.id and status in ('agreed', 'kept');

  update public.world_battles set status = 'resolved' where id = b.id;
  -- Changes from here belong to the attack's action (for undoing it after an objection).
  perform set_config('dow.action_seq', 'pending', true);
  begin
    outcome := public._do_attack(
      b.world_id, b.god_id, b.army_id, b.target_kind, b.target_id, att, def,
      b.utterly_destroy, b.description, b.reserved, b.id
    );
  exception when check_violation then
    -- The army or its target is gone: call it off and give everything back.
    update public.world_battles set status = 'cancelled' where id = b.id;
    refund := public._power_cost(b.world_id, 'commandRace') + b.reserved;
    update public.god_power set power = power + refund where god_id = b.god_id
    returning power into power_now;
    perform public._append_event(
      b.world_id, 'battle_cancelled',
      jsonb_build_object('battle_id', b.id, 'reason', sqlerrm, 'refund', refund, 'power_after', power_now),
      b.god_id
    );
    return 'cancelled';
  end;
  perform public._append_event(
    b.world_id, 'battle_resolved', jsonb_build_object('battle_id', b.id, 'outcome', outcome), b.god_id
  );
  return outcome;
end;
$$;

------------------------------------------------------------------------------------------------
-- Votes on bonuses (as in 20261118000000 / 20261117000000, with the 'bonus' kind added).
------------------------------------------------------------------------------------------------
create or replace function public._tally(p public.world_proposals, closing boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  gods int;
  cast_votes int;
  yes int; keep int; undo int; coin int; dropping int;
  decided text;
  flip int;
begin
  select count(*) into gods from public.gods g
  where g.world_id = p.world_id and g.departed_at is null;
  select count(*),
         count(*) filter (where choice = 'yes'),
         count(*) filter (where choice = 'keep'),
         count(*) filter (where choice = 'undo'),
         count(*) filter (where choice = 'coin'),
         count(*) filter (where choice = 'drop')
  into cast_votes, yes, keep, undo, coin, dropping
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

  -- DOW-54: a disputed battle bonus. More than half decides; otherwise, when the battle is rolled,
  -- the larger side wins and a tie is a coin flip.
  if p.kind = 'bonus' then
    if keep * 2 > gods then
      decided := 'kept';
    elsif dropping * 2 > gods then
      decided := 'dropped';
    elsif closing or cast_votes >= gods then
      decided := case when keep > dropping then 'kept' when dropping > keep then 'dropped' else 'coin' end;
    else
      return 'open';
    end if;
    if decided = 'coin' then
      flip := public._coin_flip(p.world_id, p.god_id);
      decided := case when flip = 1 then 'kept' else 'dropped' end;
    end if;
    update public.world_battle_bonuses set status = decided where id = p.battle_bonus_id;
    return public._finish_proposal(p, decided, flip, null);
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
    or (p.kind = 'bonus' and choice in ('keep', 'drop'))
  ) then
    raise exception 'That isn''t a choice in this vote' using errcode = 'check_violation';
  end if;
  perform public._cast_vote(p, god, choice);
  return public._tally(p, false);
end;
$$;

create or replace function public.close_expired_proposals()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.world_proposals;
  b public.world_battles;
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
  -- DOW-56: battles whose reaction window has closed are rolled.
  for b in
    select * from public.world_battles x
    where x.status = 'pending' and x.closes_at < now()
    order by x.closes_at
    for update skip locked
  loop
    perform public._resolve_battle(b);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public._do_attack(uuid, uuid, uuid, text, uuid, jsonb, jsonb, boolean, text, int, uuid) from public, anon, authenticated;
revoke execute on function public._add_bonus(public.world_battles, text, text, uuid) from public, anon, authenticated;
revoke execute on function public._pending_battle(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._resolve_battle(public.world_battles) from public, anon, authenticated;
revoke execute on function public._tally(public.world_proposals, boolean) from public, anon, authenticated;
revoke execute on function public.close_expired_proposals() from public, anon, authenticated;

revoke execute on function public.attack(uuid, uuid, text, uuid, jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.attack(uuid, uuid, text, uuid, jsonb, jsonb, boolean, text) to authenticated;
revoke execute on function public.declare_attack(uuid, uuid, text, uuid, jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.declare_attack(uuid, uuid, text, uuid, jsonb, jsonb, boolean, text) to authenticated;
revoke execute on function public.propose_bonus(uuid, uuid, text, text) from public, anon;
grant execute on function public.propose_bonus(uuid, uuid, text, text) to authenticated;
revoke execute on function public.dispute_bonus(uuid, uuid) from public, anon;
grant execute on function public.dispute_bonus(uuid, uuid) to authenticated;
revoke execute on function public.waive_reaction(uuid, uuid) from public, anon;
grant execute on function public.waive_reaction(uuid, uuid) to authenticated;
revoke execute on function public.close_battle(uuid, uuid) from public, anon;
grant execute on function public.close_battle(uuid, uuid) to authenticated;
revoke execute on function public.vote(uuid, uuid, text) from public, anon;
grant execute on function public.vote(uuid, uuid, text) to authenticated;
