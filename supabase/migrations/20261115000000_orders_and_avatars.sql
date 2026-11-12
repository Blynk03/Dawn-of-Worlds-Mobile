-- DOW-44 (Orders), DOW-45 (Avatars), DOW-38 (presence needed to command) and DOW-39 (commanding
-- someone else's order costs extra).
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- From the rules (section III):
-- * Command Race / Command City, footnote **: "Player must have either an Avatar, or order (sect)
--   present where directions are given." A race's creator gets a sect in it automatically.
-- * Command Order: "For religious orders or sects, add +10 points if a non-creating player
--   commands them. For other orders, add +5 points."
-- * Create Avatar: "If slain or wiped out, they may be resurrected or reestablished by the
--   creating player for 5 points."
-- * Command Avatar: "An avatar can perform ONE of the following immortal or Many Mortal actions
--   (such as leading an army) in a turn when commanded. Immortal actions which an avatar can
--   perform include: Command City, Create Order, Command Order, Create City, Corrupt/Purify City,
--   Create Race (ONCE), gather an army." The avatar's action costs Command Avatar instead of the
--   power it stands in for. (Command City and armies come with the battle stories.)
--
-- Create Race, Found City, Purify/Corrupt, Create/Command Order are split into "_do_*" cores
-- that take who pays and how much, so the avatar can reuse them.

------------------------------------------------------------------------------------------------
-- Ruleset: adds Resurrect Avatar (5, from the Create Avatar text). Kept in sync with
-- src/rules/rulesets/classic.json by src/rules/__tests__/ruleset-sql-parity.test.ts.
------------------------------------------------------------------------------------------------
update public.rulesets set config = config ||
-- ruleset:classic-avatars:begin
'{
  "powers": [
    {"id": "shapeLand", "costs": [3, 5, 8], "perArea": true},
    {"id": "shapeClimate", "costs": [2, 4, 6], "perArea": true},
    {"id": "createRace", "costs": [22, 6, 15]},
    {"id": "createSubrace", "costs": [12, 4, 10]},
    {"id": "commandRace", "costs": [8, 4, 3]},
    {"id": "commandCity", "costs": [6, 4, 2]},
    {"id": "advanceCivilization", "costs": [10, 5, 6]},
    {"id": "advanceCity", "costs": [8, 4, 5]},
    {"id": "purifyCivilization", "costs": [5, 3, 4]},
    {"id": "corruptCivilization", "costs": [4, 3, 3]},
    {"id": "purifyCity", "costs": [4, 3, 3]},
    {"id": "corruptCity", "costs": [3, 2, 2]},
    {"id": "resurrectAvatar", "costs": [5, 5, 5]},
    {"id": "purifyRegion", "costs": [4, 3, 3]},
    {"id": "corruptRegion", "costs": [3, 2, 2]},
    {"id": "event", "costs": [10, 7, 9]},
    {"id": "createOrder", "costs": [8, 6, 4]},
    {"id": "commandOrder", "costs": [4, 3, 2]},
    {"id": "createAvatar", "costs": [10, 7, 8]},
    {"id": "commandAvatar", "costs": [2, 1, 1]},
    {"id": "catastrophe", "costs": [10, 10, 10], "perArea": true}
  ]
}'::jsonb
-- ruleset:classic-avatars:end
where id = 'classic';

------------------------------------------------------------------------------------------------
-- Orders and avatars are world_entities too.
------------------------------------------------------------------------------------------------
do $$
declare
  c record;
begin
  -- Replace the "kind" and "only races may lack a race" checks so avatars fit.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.world_entities'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%kind = ANY%' or pg_get_constraintdef(oid) like '%race_id IS NOT NULL%')
  loop
    execute format('alter table public.world_entities drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.world_entities
  add constraint world_entities_kind_check check (kind in ('race', 'city', 'order', 'avatar')),
  -- Cities and orders belong to a race; an avatar may walk among one, or none (a dragon).
  add constraint world_entities_race_check check (kind in ('race', 'avatar') or race_id is not null),
  -- Destroyed (an order wiped out, an avatar slain): kept for the history.
  add column status text not null default 'active' check (status in ('active', 'destroyed')),
  -- Orders: religious sect, knights, thieves' guild, brigands, pirates, or other.
  add column order_type text check (order_type in ('religious', 'knights', 'thieves', 'brigands', 'pirates', 'other')),
  add column purpose text not null default '' check (char_length(purpose) <= 280),
  -- Avatars: high priest, dragon, warrior, dynasty… (free text, kept short).
  add column avatar_type text check (char_length(avatar_type) between 1 and 40);

-- Every existing order is a race creator's automatic sect.
update public.world_entities set order_type = 'religious', purpose = 'Worship of the race''s creator'
where kind = 'order' and order_type is null;

------------------------------------------------------------------------------------------------
-- Helpers.
------------------------------------------------------------------------------------------------

-- DOW-38: whether a god has an order or an avatar (still standing) among a race.
create or replace function public._present_in_race(target_world uuid, god uuid, race uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.world_entities e
    where e.world_id = target_world and e.kind in ('order', 'avatar') and e.status = 'active'
      and e.god_id = god and e.race_id = race
  )
$$;

create or replace function public._require_name(name text, what text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := trim(coalesce(name, ''));
begin
  if char_length(clean) = 0 then
    raise exception 'Give the % a name', what using errcode = 'check_violation';
  end if;
  if char_length(clean) > 40 then
    raise exception 'Keep the name under 40 characters' using errcode = 'check_violation';
  end if;
  return clean;
end;
$$;

------------------------------------------------------------------------------------------------
-- Cores. Each checks what it needs, spends `cost` from `acting_god`, logs `power_id` (with
-- `extra` merged into the payload) and returns what it made.
------------------------------------------------------------------------------------------------

-- Create Race / Create Subrace (parent_race not null).
create or replace function public._do_create_race(
  target_world uuid,
  acting_god uuid,
  parent_race uuid,
  race_name text,
  race_description text,
  race_appearance text,
  race_alignment int,
  hx int,
  hy int,
  power_id text,
  cost int,
  extra jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  word text := case when parent_race is null then 'race' else 'subrace' end;
  parent public.world_entities%rowtype;
  god_name text;
  clean_name text := trim(coalesce(race_name, ''));
  clean_description text := trim(coalesce(race_description, ''));
  clean_appearance text := trim(coalesce(race_appearance, ''));
  power_after int;
  race_id uuid := gen_random_uuid();
  order_id uuid := gen_random_uuid();
  order_name text;
  seq int;
begin
  if parent_race is not null then
    select * into parent from public.world_entities e
    where e.id = parent_race and e.world_id = target_world and e.kind = 'race';
    if parent.id is null then
      raise exception 'Choose one of this world''s races' using errcode = 'check_violation';
    end if;
  end if;
  if char_length(clean_name) = 0 then
    raise exception 'Give the % a name', word using errcode = 'check_violation';
  end if;
  if char_length(clean_name) > 40 then
    raise exception 'Keep the name under 40 characters' using errcode = 'check_violation';
  end if;
  if char_length(clean_description) = 0 then
    raise exception 'Describe the %', word using errcode = 'check_violation';
  end if;
  if char_length(clean_description) > 500 then
    raise exception 'Keep the description under 500 characters' using errcode = 'check_violation';
  end if;
  if char_length(clean_appearance) > 280 then
    raise exception 'Keep the appearance under 280 characters' using errcode = 'check_violation';
  end if;
  if race_alignment is null or race_alignment not in (-1, 0, 1) then
    raise exception 'A % starts good, neutral or evil', word using errcode = 'check_violation';
  end if;
  perform public._require_unique_name(target_world, clean_name);
  perform public._require_land(target_world, hx, hy);
  if public._hex_settled(target_world, hx, hy) then
    raise exception 'Someone already lives on that hex' using errcode = 'check_violation';
  end if;
  if parent.id is not null and not exists (
    select 1 from public.world_entities e
    where e.world_id = target_world
      and (e.id = parent.id or (e.kind = 'city' and e.race_id = parent.id))
      and public._hex_adjacent(e.hex_x, e.hex_y, hx, hy)
  ) then
    raise exception 'A subrace must start next to % land', parent.name || '''s'
      using errcode = 'check_violation';
  end if;

  power_after := public._spend_power(acting_god, cost);
  select g.name into god_name from public.gods g where g.id = acting_god;
  order_name := 'Faithful of ' || god_name;

  seq := public._log_action(
    target_world, acting_god, power_id, cost, power_after,
    jsonb_build_array(jsonb_build_array(hx, hy)), clean_name, clean_description,
    jsonb_build_object(
      'race', jsonb_build_object(
        'id', race_id,
        'name', clean_name,
        'description', clean_description,
        'appearance', clean_appearance,
        'alignment', race_alignment,
        'hex', jsonb_build_array(hx, hy),
        'parent_id', parent.id
      ),
      'order', jsonb_build_object(
        'id', order_id, 'name', order_name, 'race_id', race_id,
        'order_type', 'religious', 'purpose', 'Worship of ' || god_name
      )
    ) || coalesce(extra, '{}'::jsonb)
  );

  insert into public.world_entities
    (id, world_id, kind, name, description, appearance, alignment, hex_x, hex_y, god_id,
     created_seq, parent_race_id)
  values
    (race_id, target_world, 'race', clean_name, clean_description, clean_appearance,
     race_alignment, hx, hy, acting_god, seq, parent.id);
  insert into public.world_entities
    (id, world_id, kind, name, alignment, race_id, god_id, created_seq, order_type, purpose)
  values
    (order_id, target_world, 'order', order_name, race_alignment, race_id, acting_god, seq,
     'religious', 'Worship of ' || god_name);
  return race_id;
end;
$$;

-- Found a city (Command Race's "Create City").
create or replace function public._do_found_city(
  target_world uuid,
  acting_god uuid,
  race uuid,
  city_name text,
  hx int,
  hy int,
  description text,
  power_id text,
  cost int,
  extra jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  r public.world_entities%rowtype;
  clean_name text := trim(coalesce(city_name, ''));
  clean_description text := trim(coalesce(description, ''));
  power_after int;
  city_id uuid := gen_random_uuid();
  seq int;
begin
  select * into r from public.world_entities e
  where e.id = race and e.world_id = target_world and e.kind = 'race';
  if r.id is null then
    raise exception 'Choose one of this world''s races' using errcode = 'check_violation';
  end if;
  if char_length(clean_name) = 0 then
    raise exception 'Give the city a name' using errcode = 'check_violation';
  end if;
  if char_length(clean_name) > 40 then
    raise exception 'Keep the name under 40 characters' using errcode = 'check_violation';
  end if;
  if char_length(clean_description) = 0 then
    raise exception 'Describe what your god does' using errcode = 'check_violation';
  end if;
  if char_length(clean_description) > 280 then
    raise exception 'Keep the description under 280 characters' using errcode = 'check_violation';
  end if;
  perform public._require_unique_name(target_world, clean_name);
  perform public._require_land(target_world, hx, hy);
  if exists (
    select 1 from public.world_entities e
    where e.world_id = target_world and e.kind = 'city' and e.hex_x = hx and e.hex_y = hy
  ) then
    raise exception 'There is already a city on that hex' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.world_entities e
    where e.world_id = target_world and e.kind = 'race' and e.id <> r.id and e.hex_x = hx and e.hex_y = hy
  ) then
    raise exception 'That hex is another race''s homeland' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.world_entities e
    where e.world_id = target_world
      and (e.id = r.id or (e.kind = 'city' and e.race_id = r.id))
      and ((e.hex_x = hx and e.hex_y = hy) or public._hex_adjacent(e.hex_x, e.hex_y, hx, hy))
  ) then
    raise exception 'A city must be on or next to % land', r.name || '''s'
      using errcode = 'check_violation';
  end if;

  power_after := public._spend_power(acting_god, cost);
  seq := public._log_action(
    target_world, acting_god, power_id, cost, power_after,
    jsonb_build_array(jsonb_build_array(hx, hy)), clean_name, clean_description,
    jsonb_build_object(
      'intent', 'foundCity',
      'city', jsonb_build_object(
        'id', city_id, 'name', clean_name, 'race_id', r.id, 'alignment', r.alignment,
        'hex', jsonb_build_array(hx, hy)
      )
    ) || coalesce(extra, '{}'::jsonb)
  );
  insert into public.world_entities
    (id, world_id, kind, name, alignment, hex_x, hex_y, race_id, god_id, created_seq)
  values
    (city_id, target_world, 'city', clean_name, r.alignment, hx, hy, r.id, acting_god, seq);
  return city_id;
end;
$$;

-- Purify / Corrupt. `via_power` / `via_cost` replace the usual power and price (an avatar).
create or replace function public._do_change_alignment(
  target_world uuid,
  acting_god uuid,
  target_kind text,
  target uuid,
  hex_x int,
  hex_y int,
  direction int,
  description text,
  via_power text,
  via_cost int,
  extra jsonb
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
  e public.world_entities%rowtype;
  m public.world_map%rowtype;
  clean_description text;
  power_id text;
  target_key text;
  target_name text;
  hx int;
  hy int;
  cell int;
  after int;
  cost int;
  power_after int;
begin
  if direction is null or direction not in (1, -1) then
    raise exception 'Choose to purify (+1) or corrupt (-1)' using errcode = 'check_violation';
  end if;
  if target_kind in ('race', 'city') then
    select * into e from public.world_entities x
    where x.id = target and x.world_id = target_world and x.kind = target_kind;
    if e.id is null then
      raise exception 'Choose one of this world''s %',
        case target_kind when 'race' then 'races' else 'cities' end
        using errcode = 'check_violation';
    end if;
    target_key := e.id::text;
    target_name := e.name;
    hx := e.hex_x;
    hy := e.hex_y;
    power_id := case when direction = 1 then 'purify' else 'corrupt' end
      || case target_kind when 'race' then 'Civilization' else 'City' end;
  elsif target_kind = 'region' then
    select * into m from public.world_map where world_id = target_world;
    if _do_change_alignment.hex_x is null or _do_change_alignment.hex_y is null
       or _do_change_alignment.hex_x < 0 or _do_change_alignment.hex_y < 0
       or _do_change_alignment.hex_x >= m.width or _do_change_alignment.hex_y >= m.height then
      raise exception 'That hex is off the map' using errcode = 'check_violation';
    end if;
    hx := _do_change_alignment.hex_x;
    hy := _do_change_alignment.hex_y;
    target_key := hx || ',' || hy;
    target_name := 'the region at ' || hx || ', ' || hy;
    power_id := case when direction = 1 then 'purifyRegion' else 'corruptRegion' end;
  else
    raise exception 'Choose a civilization, a city or a region' using errcode = 'check_violation';
  end if;

  -- Footnote *: only once per target per turn (however the change was made).
  select * into st from public.world_state where world_id = target_world;
  if exists (
    select 1 from public.world_events ev
    where ev.world_id = target_world and ev.type = 'action_taken' and ev.god_id = acting_god
      and ev.round = st.round and ev.age = st.age
      and ev.payload ? 'alignment'
      and ev.payload->'target'->>'key' = target_key
  ) then
    raise exception 'You''ve already changed the alignment of % this turn', target_name
      using errcode = 'check_violation';
  end if;
  clean_description := public._require_description(description);

  cost := coalesce(via_cost, public._power_cost(target_world, power_id));
  power_after := public._spend_power(acting_god, cost);

  if target_kind = 'region' then
    cell := hy * m.width + hx + 1;
    update public.world_map set alignment = array_fill(0, array[m.width * m.height])
    where world_id = target_world and alignment is null;
    update public.world_map set alignment[cell] = alignment[cell] + direction
    where world_id = target_world
    returning alignment[cell] into after;
  else
    update public.world_entities set alignment = alignment + direction
    where id = e.id
    returning alignment into after;
  end if;

  perform public._log_action(
    target_world, acting_god, coalesce(via_power, power_id), cost, power_after,
    jsonb_build_array(jsonb_build_array(hx, hy)), target_name, clean_description,
    jsonb_build_object(
      'target', jsonb_build_object(
        'kind', target_kind,
        'id', case when target_kind = 'region' then null else e.id end,
        'key', target_key,
        'name', target_name
      ),
      'alignment', jsonb_build_object('delta', direction, 'after', after, 'power', power_id)
    ) || coalesce(extra, '{}'::jsonb)
  );
  return after;
end;
$$;

-- DOW-44: Create Order within a race.
create or replace function public._do_create_order(
  target_world uuid,
  acting_god uuid,
  race uuid,
  order_name text,
  order_type text,
  purpose text,
  power_id text,
  cost int,
  extra jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  r public.world_entities%rowtype;
  clean_name text := public._require_name(order_name, 'order');
  clean_purpose text := trim(coalesce(purpose, ''));
  power_after int;
  order_id uuid := gen_random_uuid();
  seq int;
begin
  select * into r from public.world_entities e
  where e.id = race and e.world_id = target_world and e.kind = 'race';
  if r.id is null then
    raise exception 'Choose one of this world''s races' using errcode = 'check_violation';
  end if;
  if order_type is null
     or order_type not in ('religious', 'knights', 'thieves', 'brigands', 'pirates', 'other') then
    raise exception 'Choose what kind of order it is' using errcode = 'check_violation';
  end if;
  if char_length(clean_purpose) = 0 then
    raise exception 'Say what the order is for' using errcode = 'check_violation';
  end if;
  if char_length(clean_purpose) > 280 then
    raise exception 'Keep the purpose under 280 characters' using errcode = 'check_violation';
  end if;

  power_after := public._spend_power(acting_god, cost);
  seq := public._log_action(
    target_world, acting_god, power_id, cost, power_after,
    jsonb_build_array(jsonb_build_array(r.hex_x, r.hex_y)), clean_name, clean_purpose,
    jsonb_build_object(
      'order', jsonb_build_object(
        'id', order_id, 'name', clean_name, 'race_id', r.id,
        'order_type', order_type, 'purpose', clean_purpose
      ),
      'target', jsonb_build_object('kind', 'race', 'id', r.id, 'key', r.id, 'name', r.name)
    ) || coalesce(extra, '{}'::jsonb)
  );
  insert into public.world_entities
    (id, world_id, kind, name, alignment, race_id, god_id, created_seq, order_type, purpose)
  values
    (order_id, target_world, 'order', clean_name, r.alignment, r.id, acting_god, seq,
     order_type, clean_purpose);
  return order_id;
end;
$$;

-- DOW-44: Command Order. `cost` already includes any surcharge.
create or replace function public._do_command_order(
  target_world uuid,
  acting_god uuid,
  target_order uuid,
  directive text,
  power_id text,
  cost int,
  extra jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  o public.world_entities%rowtype;
  r public.world_entities%rowtype;
  clean_directive text := public._require_description(directive);
  power_after int;
begin
  select * into o from public.world_entities e
  where e.id = target_order and e.world_id = target_world and e.kind = 'order';
  if o.id is null then
    raise exception 'Choose one of this world''s orders' using errcode = 'check_violation';
  end if;
  if o.status <> 'active' then
    raise exception '% is no more', o.name using errcode = 'check_violation';
  end if;
  select * into r from public.world_entities e where e.id = o.race_id;
  power_after := public._spend_power(acting_god, cost);
  perform public._log_action(
    target_world, acting_god, power_id, cost, power_after,
    jsonb_build_array(jsonb_build_array(r.hex_x, r.hex_y)), o.name, clean_directive,
    jsonb_build_object(
      'target', jsonb_build_object('kind', 'order', 'id', o.id, 'key', o.id, 'name', o.name)
    ) || coalesce(extra, '{}'::jsonb)
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- The powers players call. Existing ones keep their signatures.
------------------------------------------------------------------------------------------------

create or replace function public.create_race(
  target_world uuid,
  race_name text,
  race_description text,
  race_appearance text,
  race_alignment int,
  hex_x int,
  hex_y int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
begin
  return public._do_create_race(
    target_world, acting_god, null, race_name, race_description, race_appearance,
    race_alignment, hex_x, hex_y, 'createRace', public._power_cost(target_world, 'createRace'), null
  );
end;
$$;

create or replace function public.create_subrace(
  target_world uuid,
  parent_race uuid,
  race_name text,
  race_description text,
  race_appearance text,
  race_alignment int,
  hex_x int,
  hex_y int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
begin
  if parent_race is null then
    raise exception 'Choose one of this world''s races' using errcode = 'check_violation';
  end if;
  return public._do_create_race(
    target_world, acting_god, parent_race, race_name, race_description, race_appearance,
    race_alignment, hex_x, hex_y, 'createSubrace', public._power_cost(target_world, 'createSubrace'), null
  );
end;
$$;

-- Command Race to found a city. DOW-38: needs an order or avatar among the race.
create or replace function public.found_city(
  target_world uuid,
  race uuid,
  city_name text,
  hex_x int,
  hex_y int,
  description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  race_name text;
begin
  select e.name into race_name from public.world_entities e
  where e.id = race and e.world_id = target_world and e.kind = 'race';
  if race_name is not null and not public._present_in_race(target_world, acting_god, race) then
    raise exception 'To command the %, you need an order or avatar among them', race_name
      using errcode = 'check_violation';
  end if;
  return public._do_found_city(
    target_world, acting_god, race, city_name, hex_x, hex_y, description,
    'commandRace', public._power_cost(target_world, 'commandRace'), null
  );
end;
$$;

create or replace function public.change_alignment(
  target_world uuid,
  target_kind text,
  target uuid,
  hex_x int,
  hex_y int,
  direction int,
  description text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
begin
  return public._do_change_alignment(
    target_world, acting_god, target_kind, target, hex_x, hex_y, direction, description,
    null, null, null
  );
end;
$$;

create or replace function public.create_order(
  target_world uuid,
  race uuid,
  order_name text,
  order_type text,
  purpose text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
begin
  return public._do_create_order(
    target_world, acting_god, race, order_name, order_type, purpose,
    'createOrder', public._power_cost(target_world, 'createOrder'), null
  );
end;
$$;

-- DOW-39: commanding someone else's order costs +10 (religious) or +5 (any other).
create or replace function public.command_order(target_world uuid, target_order uuid, directive text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  o public.world_entities%rowtype;
  surcharge int := 0;
  cost int;
begin
  select * into o from public.world_entities e
  where e.id = target_order and e.world_id = target_world and e.kind = 'order';
  if o.id is not null and o.god_id is distinct from acting_god then
    surcharge := case when o.order_type = 'religious' then 10 else 5 end;
  end if;
  cost := public._power_cost(target_world, 'commandOrder') + surcharge;
  perform public._do_command_order(
    target_world, acting_god, target_order, directive, 'commandOrder', cost,
    jsonb_build_object('surcharge', surcharge)
  );
end;
$$;

-- DOW-45: Create Avatar, anywhere on the map, optionally among a race.
create or replace function public.create_avatar(
  target_world uuid,
  avatar_name text,
  avatar_type text,
  description text,
  race uuid,
  hex_x int,
  hex_y int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  clean_name text := public._require_name(avatar_name, 'avatar');
  clean_type text := trim(coalesce(avatar_type, ''));
  clean_description text := public._require_description(description, 500);
  r public.world_entities%rowtype;
  m public.world_map%rowtype;
  cost int;
  power_after int;
  avatar_id uuid := gen_random_uuid();
  seq int;
begin
  if char_length(clean_type) = 0 then
    raise exception 'Say what the avatar is (a high priest, a dragon…)' using errcode = 'check_violation';
  end if;
  if char_length(clean_type) > 40 then
    raise exception 'Keep what it is under 40 characters' using errcode = 'check_violation';
  end if;
  if race is not null then
    select * into r from public.world_entities e
    where e.id = race and e.world_id = target_world and e.kind = 'race';
    if r.id is null then
      raise exception 'Choose one of this world''s races' using errcode = 'check_violation';
    end if;
  end if;
  select * into m from public.world_map where world_id = target_world;
  if hex_x is null or hex_y is null or hex_x < 0 or hex_y < 0 or hex_x >= m.width or hex_y >= m.height then
    raise exception 'That hex is off the map' using errcode = 'check_violation';
  end if;

  cost := public._power_cost(target_world, 'createAvatar');
  power_after := public._spend_power(acting_god, cost);
  seq := public._log_action(
    target_world, acting_god, 'createAvatar', cost, power_after,
    jsonb_build_array(jsonb_build_array(hex_x, hex_y)), clean_name, clean_description,
    jsonb_build_object('avatar', jsonb_build_object(
      'id', avatar_id, 'name', clean_name, 'avatar_type', clean_type,
      'description', clean_description, 'race_id', r.id, 'hex', jsonb_build_array(hex_x, hex_y)
    ))
  );
  insert into public.world_entities
    (id, world_id, kind, name, description, avatar_type, race_id, hex_x, hex_y, god_id, created_seq)
  values
    (avatar_id, target_world, 'avatar', clean_name, clean_description, clean_type, r.id,
     hex_x, hex_y, acting_god, seq);
  return avatar_id;
end;
$$;

-- DOW-45: Command Avatar. One action per avatar per turn, by its creator, for the price of
-- Command Avatar. `args` holds the action's details:
--   deed:        { description }                        mortal deeds (lead an army, slay a beast…)
--   foundCity:   { race, name, x, y, description }      Create City
--   createOrder: { race, name, order_type, purpose }
--   commandOrder:{ order, directive }
--   purifyCity / corruptCity: { city, description }
--   createRace:  { name, description, appearance, alignment, x, y }   once per avatar
-- Returns the id of anything created.
create or replace function public.command_avatar(
  target_world uuid,
  avatar uuid,
  intent text,
  args jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  a public.world_entities%rowtype;
  st public.world_state%rowtype;
  cost int;
  power_after int;
  extra jsonb;
  made uuid;
begin
  select * into a from public.world_entities e
  where e.id = avatar and e.world_id = target_world and e.kind = 'avatar';
  if a.id is null then
    raise exception 'Choose one of this world''s avatars' using errcode = 'check_violation';
  end if;
  if a.god_id is distinct from acting_god then
    raise exception 'Only the god who created % can command them', a.name
      using errcode = 'insufficient_privilege';
  end if;
  if a.status <> 'active' then
    raise exception '% is slain; resurrect them first', a.name using errcode = 'check_violation';
  end if;
  select * into st from public.world_state where world_id = target_world;
  if exists (
    select 1 from public.world_events ev
    where ev.world_id = target_world and ev.type = 'action_taken' and ev.god_id = acting_god
      and ev.round = st.round and ev.age = st.age and ev.payload->'avatar'->>'id' = a.id::text
      and ev.payload->>'power' = 'commandAvatar'
  ) then
    raise exception '% has already acted this turn', a.name using errcode = 'check_violation';
  end if;
  if intent = 'createRace' and exists (
    select 1 from public.world_events ev
    where ev.world_id = target_world and ev.type = 'action_taken'
      and ev.payload->'avatar'->>'id' = a.id::text and ev.payload->>'intent' = 'createRace'
  ) then
    raise exception '% has already created a race; an avatar may only do that once', a.name
      using errcode = 'check_violation';
  end if;

  cost := public._power_cost(target_world, 'commandAvatar');
  extra := jsonb_build_object(
    'intent', intent,
    'avatar', jsonb_build_object('id', a.id, 'name', a.name)
  );

  if intent = 'deed' then
    power_after := public._spend_power(acting_god, cost);
    perform public._log_action(
      target_world, acting_god, 'commandAvatar', cost, power_after,
      jsonb_build_array(jsonb_build_array(a.hex_x, a.hex_y)), a.name,
      public._require_description(args->>'description'), extra
    );
  elsif intent = 'foundCity' then
    made := public._do_found_city(
      target_world, acting_god, (args->>'race')::uuid, args->>'name',
      (args->>'x')::int, (args->>'y')::int, args->>'description', 'commandAvatar', cost, extra
    );
  elsif intent = 'createOrder' then
    made := public._do_create_order(
      target_world, acting_god, (args->>'race')::uuid, args->>'name', args->>'order_type',
      args->>'purpose', 'commandAvatar', cost, extra
    );
  elsif intent = 'commandOrder' then
    perform public._do_command_order(
      target_world, acting_god, (args->>'order')::uuid, args->>'directive', 'commandAvatar', cost, extra
    );
  elsif intent in ('purifyCity', 'corruptCity') then
    perform public._do_change_alignment(
      target_world, acting_god, 'city', (args->>'city')::uuid, null, null,
      case intent when 'purifyCity' then 1 else -1 end, args->>'description',
      'commandAvatar', cost, extra
    );
  elsif intent = 'createRace' then
    made := public._do_create_race(
      target_world, acting_god, null, args->>'name', args->>'description', args->>'appearance',
      (args->>'alignment')::int, (args->>'x')::int, (args->>'y')::int, 'commandAvatar', cost, extra
    );
  else
    raise exception 'An avatar can''t do that (yet)' using errcode = 'check_violation';
  end if;
  return made;
end;
$$;

-- DOW-45: resurrect (or re-establish) a slain avatar, by its creator, for 5.
create or replace function public.resurrect_avatar(target_world uuid, avatar uuid, description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  a public.world_entities%rowtype;
  clean_description text;
  cost int;
  power_after int;
begin
  select * into a from public.world_entities e
  where e.id = avatar and e.world_id = target_world and e.kind = 'avatar';
  if a.id is null then
    raise exception 'Choose one of this world''s avatars' using errcode = 'check_violation';
  end if;
  if a.god_id is distinct from acting_god then
    raise exception 'Only an avatar''s creator can bring it back' using errcode = 'insufficient_privilege';
  end if;
  if a.status = 'active' then
    raise exception '% isn''t slain', a.name using errcode = 'check_violation';
  end if;
  clean_description := public._require_description(description);
  cost := public._power_cost(target_world, 'resurrectAvatar');
  power_after := public._spend_power(acting_god, cost);
  update public.world_entities set status = 'active' where id = a.id;
  perform public._log_action(
    target_world, acting_god, 'resurrectAvatar', cost, power_after,
    jsonb_build_array(jsonb_build_array(a.hex_x, a.hex_y)), a.name, clean_description,
    jsonb_build_object(
      'target', jsonb_build_object('kind', 'avatar', 'id', a.id, 'key', a.id, 'name', a.name),
      'avatar', jsonb_build_object('id', a.id, 'name', a.name, 'status', 'active')
    )
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- Permissions.
------------------------------------------------------------------------------------------------
revoke execute on function public._present_in_race(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._require_name(text, text) from public, anon, authenticated;
revoke execute on function public._do_create_race(uuid, uuid, uuid, text, text, text, int, int, int, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public._do_found_city(uuid, uuid, uuid, text, int, int, text, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public._do_change_alignment(uuid, uuid, text, uuid, int, int, int, text, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public._do_create_order(uuid, uuid, uuid, text, text, text, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public._do_command_order(uuid, uuid, uuid, text, text, int, jsonb) from public, anon, authenticated;

revoke execute on function public.create_order(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.command_order(uuid, uuid, text) from public, anon;
revoke execute on function public.create_avatar(uuid, text, text, text, uuid, int, int) from public, anon;
revoke execute on function public.command_avatar(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.resurrect_avatar(uuid, uuid, text) from public, anon;
grant execute on function public.create_order(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.command_order(uuid, uuid, text) to authenticated;
grant execute on function public.create_avatar(uuid, text, text, text, uuid, int, int) to authenticated;
grant execute on function public.command_avatar(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.resurrect_avatar(uuid, uuid, text) to authenticated;
