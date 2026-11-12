-- DOW-43 (Create Subrace), DOW-46 (Purify / Corrupt), DOW-47 (Advance City / Civilization),
-- and DOW-40 (Purify / Corrupt only once per target per turn, the Table of Powers footnote *).
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.

------------------------------------------------------------------------------------------------
-- Ruleset: adds Purify / Corrupt Region. The rules let gods change the alignment of "a one inch
-- region of landscape" but only price civilizations and cities, so regions are priced like a
-- city (a house rule, noted in src/rules/rulesets/classic.json). Kept in sync with that file by
-- src/rules/__tests__/ruleset-sql-parity.test.ts.
------------------------------------------------------------------------------------------------
update public.rulesets set config = config ||
-- ruleset:classic-civ:begin
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
-- ruleset:classic-civ:end
where id = 'classic';

------------------------------------------------------------------------------------------------
-- Lineage, alignment without a cap, and advancements.
------------------------------------------------------------------------------------------------

-- A subrace's parent race.
alter table public.world_entities
  add column parent_race_id uuid references public.world_entities (id) on delete set null;

-- "Unless the game master or author directs otherwise, there is no limit to how far this can go."
alter table public.world_entities drop constraint if exists world_entities_alignment_check;

-- Each hex's alignment (null means 0 everywhere), changed by Purify / Corrupt Region.
alter table public.world_map add column alignment int[];

-- DOW-47: "So long as that city or civilization persists, it will always be the greatest in
-- this field." One holder per field per world.
create table public.world_advancements (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  entity_id uuid not null references public.world_entities (id) on delete cascade,
  field text not null check (char_length(trim(field)) between 1 and 40),
  god_id uuid references public.gods (id) on delete set null,
  created_seq int not null
);
create unique index world_advancements_field_idx
  on public.world_advancements (world_id, lower(trim(field)));

alter table public.world_advancements enable row level security;
create policy "world_advancements: members read"
  on public.world_advancements for select to authenticated using (public.is_world_member(world_id));
revoke insert, update, delete on public.world_advancements from anon, authenticated;

------------------------------------------------------------------------------------------------
-- Helpers.
------------------------------------------------------------------------------------------------

-- Whether a hex already holds a race's homeland or a city.
create or replace function public._hex_settled(target_world uuid, hx int, hy int)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.world_entities e
    where e.world_id = target_world and e.kind in ('race', 'city') and e.hex_x = hx and e.hex_y = hy
  )
$$;

-- Logs an action and returns its seq.
create or replace function public._log_action(
  target_world uuid,
  acting_god uuid,
  power_id text,
  cost int,
  power_after int,
  hexes jsonb,
  choice text,
  description text,
  extra jsonb
)
returns int
language sql
set search_path = ''
as $$
  select public._append_event(
    target_world,
    'action_taken',
    jsonb_build_object(
      'power', power_id,
      'cost', cost,
      'hexes', hexes,
      'choice', choice,
      'description', description,
      'power_after', power_after
    ) || coalesce(extra, '{}'::jsonb),
    acting_god
  )
$$;

create or replace function public._require_description(description text, max_length int default 280)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := trim(coalesce(description, ''));
begin
  if char_length(clean) = 0 then
    raise exception 'Describe what your god does' using errcode = 'check_violation';
  end if;
  if char_length(clean) > max_length then
    raise exception 'Keep the description under % characters', max_length using errcode = 'check_violation';
  end if;
  return clean;
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-43: Create Subrace. A splinter group of an existing race, in territory next to its
-- ancestors' land (homeland or cities). It's a race in its own right, and its creator gets a sect.
------------------------------------------------------------------------------------------------
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
  acting_god uuid;
  parent public.world_entities%rowtype;
  god_name text;
  clean_name text := trim(coalesce(race_name, ''));
  clean_description text := trim(coalesce(race_description, ''));
  clean_appearance text := trim(coalesce(race_appearance, ''));
  cost int;
  power_after int;
  race_id uuid := gen_random_uuid();
  order_id uuid := gen_random_uuid();
  order_name text;
  seq int;
begin
  acting_god := public._require_my_turn(target_world);

  select * into parent from public.world_entities e
  where e.id = parent_race and e.world_id = target_world and e.kind = 'race';
  if parent.id is null then
    raise exception 'Choose one of this world''s races' using errcode = 'check_violation';
  end if;
  if char_length(clean_name) = 0 then
    raise exception 'Give the subrace a name' using errcode = 'check_violation';
  end if;
  if char_length(clean_name) > 40 then
    raise exception 'Keep the name under 40 characters' using errcode = 'check_violation';
  end if;
  if char_length(clean_description) = 0 then
    raise exception 'Describe the subrace' using errcode = 'check_violation';
  end if;
  if char_length(clean_description) > 500 then
    raise exception 'Keep the description under 500 characters' using errcode = 'check_violation';
  end if;
  if char_length(clean_appearance) > 280 then
    raise exception 'Keep the appearance under 280 characters' using errcode = 'check_violation';
  end if;
  if race_alignment is null or race_alignment not in (-1, 0, 1) then
    raise exception 'A subrace starts good, neutral or evil' using errcode = 'check_violation';
  end if;
  perform public._require_unique_name(target_world, clean_name);
  perform public._require_land(target_world, hex_x, hex_y);
  if public._hex_settled(target_world, hex_x, hex_y) then
    raise exception 'Someone already lives on that hex' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.world_entities e
    where e.world_id = target_world
      and (e.id = parent.id or (e.kind = 'city' and e.race_id = parent.id))
      and public._hex_adjacent(e.hex_x, e.hex_y, create_subrace.hex_x, create_subrace.hex_y)
  ) then
    raise exception 'A subrace must start next to % land', parent.name || '''s'
      using errcode = 'check_violation';
  end if;

  cost := public._power_cost(target_world, 'createSubrace');
  power_after := public._spend_power(acting_god, cost);
  select g.name into god_name from public.gods g where g.id = acting_god;
  order_name := 'Faithful of ' || god_name;

  seq := public._log_action(
    target_world, acting_god, 'createSubrace', cost, power_after,
    jsonb_build_array(jsonb_build_array(hex_x, hex_y)), clean_name, clean_description,
    jsonb_build_object(
      'race', jsonb_build_object(
        'id', race_id,
        'name', clean_name,
        'description', clean_description,
        'appearance', clean_appearance,
        'alignment', race_alignment,
        'hex', jsonb_build_array(hex_x, hex_y),
        'parent_id', parent.id
      ),
      'order', jsonb_build_object('id', order_id, 'name', order_name)
    )
  );

  insert into public.world_entities
    (id, world_id, kind, name, description, appearance, alignment, hex_x, hex_y, god_id,
     created_seq, parent_race_id)
  values
    (race_id, target_world, 'race', clean_name, clean_description, clean_appearance,
     race_alignment, hex_x, hex_y, acting_god, seq, parent.id);
  insert into public.world_entities (id, world_id, kind, name, alignment, race_id, god_id, created_seq)
  values (order_id, target_world, 'order', order_name, race_alignment, race_id, acting_god, seq);

  return race_id;
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-47: Advance Civilization / Advance City. The race or city becomes the greatest in the
-- world at a field of knowledge, for as long as it persists.
------------------------------------------------------------------------------------------------
create or replace function public.advance(
  target_world uuid,
  target uuid,
  field text,
  description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid;
  e public.world_entities%rowtype;
  clean_field text := trim(coalesce(field, ''));
  clean_description text;
  holder text;
  power_id text;
  cost int;
  power_after int;
  advancement_id uuid := gen_random_uuid();
  seq int;
begin
  acting_god := public._require_my_turn(target_world);

  select * into e from public.world_entities x
  where x.id = target and x.world_id = target_world and x.kind in ('race', 'city');
  if e.id is null then
    raise exception 'Choose one of this world''s races or cities' using errcode = 'check_violation';
  end if;
  if char_length(clean_field) = 0 then
    raise exception 'Choose what they become the greatest at' using errcode = 'check_violation';
  end if;
  if char_length(clean_field) > 40 then
    raise exception 'Keep the field under 40 characters' using errcode = 'check_violation';
  end if;
  select x.name into holder
  from public.world_advancements a join public.world_entities x on x.id = a.entity_id
  where a.world_id = target_world and lower(trim(a.field)) = lower(clean_field);
  if holder is not null then
    raise exception '% is already the greatest in the world at %', holder, clean_field
      using errcode = 'unique_violation';
  end if;
  clean_description := public._require_description(description);

  power_id := case e.kind when 'race' then 'advanceCivilization' else 'advanceCity' end;
  cost := public._power_cost(target_world, power_id);
  power_after := public._spend_power(acting_god, cost);

  seq := public._log_action(
    target_world, acting_god, power_id, cost, power_after,
    jsonb_build_array(jsonb_build_array(e.hex_x, e.hex_y)), clean_field, clean_description,
    jsonb_build_object(
      'target', jsonb_build_object('kind', e.kind, 'id', e.id, 'name', e.name),
      'advancement', jsonb_build_object('id', advancement_id, 'field', clean_field)
    )
  );
  insert into public.world_advancements (id, world_id, entity_id, field, god_id, created_seq)
  values (advancement_id, target_world, e.id, clean_field, acting_god, seq);
  return advancement_id;
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-46 + DOW-40: Purify (+1) or Corrupt (-1) a civilization, a city or a 1-hex region, once
-- per target per turn for each god. Returns the new alignment.
------------------------------------------------------------------------------------------------
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
  acting_god uuid;
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
  acting_god := public._require_my_turn(target_world);
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
    if change_alignment.hex_x is null or change_alignment.hex_y is null
       or change_alignment.hex_x < 0 or change_alignment.hex_y < 0
       or change_alignment.hex_x >= m.width or change_alignment.hex_y >= m.height then
      raise exception 'That hex is off the map' using errcode = 'check_violation';
    end if;
    hx := change_alignment.hex_x;
    hy := change_alignment.hex_y;
    target_key := hx || ',' || hy;
    target_name := 'the region at ' || hx || ', ' || hy;
    power_id := case when direction = 1 then 'purifyRegion' else 'corruptRegion' end;
  else
    raise exception 'Choose a civilization, a city or a region' using errcode = 'check_violation';
  end if;

  -- Footnote *: only once per target per turn. A god has one turn a round.
  select * into st from public.world_state where world_id = target_world;
  if exists (
    select 1 from public.world_events ev
    where ev.world_id = target_world and ev.type = 'action_taken' and ev.god_id = acting_god
      and ev.round = st.round and ev.age = st.age
      and ev.payload->>'power' ~ '^(purify|corrupt)'
      and ev.payload->'target'->>'key' = target_key
  ) then
    raise exception 'You''ve already changed the alignment of % this turn', target_name
      using errcode = 'check_violation';
  end if;
  clean_description := public._require_description(description);

  cost := public._power_cost(target_world, power_id);
  power_after := public._spend_power(acting_god, cost);

  if target_kind = 'region' then
    cell := hy * m.width + hx + 1;
    update public.world_map
      set alignment = array_fill(0, array[m.width * m.height])
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
    target_world, acting_god, power_id, cost, power_after,
    jsonb_build_array(jsonb_build_array(hx, hy)), target_name, clean_description,
    jsonb_build_object(
      'target', jsonb_build_object(
        'kind', target_kind,
        'id', case when target_kind = 'region' then null else e.id end,
        'key', target_key,
        'name', target_name
      ),
      'alignment', jsonb_build_object('delta', direction, 'after', after)
    )
  );
  return after;
end;
$$;

------------------------------------------------------------------------------------------------
-- Permissions.
------------------------------------------------------------------------------------------------
revoke execute on function public._hex_settled(uuid, int, int) from public, anon, authenticated;
revoke execute on function public._log_action(uuid, uuid, text, int, int, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._require_description(text, int) from public, anon, authenticated;

revoke execute on function public.create_subrace(uuid, uuid, text, text, text, int, int, int) from public, anon;
revoke execute on function public.advance(uuid, uuid, text, text) from public, anon;
revoke execute on function public.change_alignment(uuid, text, uuid, int, int, int, text) from public, anon;
grant execute on function public.create_subrace(uuid, uuid, text, text, text, int, int, int) to authenticated;
grant execute on function public.advance(uuid, uuid, text, text) to authenticated;
grant execute on function public.change_alignment(uuid, text, uuid, int, int, int, text) to authenticated;
