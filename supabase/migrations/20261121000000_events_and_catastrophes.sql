-- DOW-49 (Events) and DOW-50 (Catastrophes): the last two powers in the Table of Powers.
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- Events (10 / 7 / 9) strike one avatar, order, city or civilization: gold found, a storm, famine,
-- plague, drought, a technology lost… Most are told in words, but an event can also:
-- * take away one of the target's advancements;
-- * slay an avatar (its creator can bring it back for 5);
-- * break up an order, or leave a city in ruins. Wiping either out utterly costs extra: what it
--   cost to create (Create Order; a city, Command Race, which founds one), as the total-destruction rule says.
--
-- Catastrophes (10 a hex, in every age) strike up to 7 hexes: earthquake, eruption, flood,
-- wildfire, a falling star… They can change the terrain, and the god chooses what becomes of each
-- city, army and avatar there (spared by default; ruined or scattered; destroyed utterly for the
-- same extra cost as in battle; avatars slain) and which of their advancements are lost.

create or replace function public._advancement_owner(target_world uuid, advancement uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select a.entity_id from public.world_advancements a where a.id = advancement and a.world_id = target_world
$$;

-- Deletes advancements, returning them for the log.
create or replace function public._lose_advancements(target_world uuid, ids uuid[])
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  lost jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'entity_id', a.entity_id, 'field', a.field)
    order by a.created_seq), '[]')
  into lost
  from public.world_advancements a
  where a.world_id = target_world and a.id = any (ids);
  delete from public.world_advancements a where a.world_id = target_world and a.id = any (ids);
  return lost;
end;
$$;

------------------------------------------------------------------------------------------------
-- Events.
------------------------------------------------------------------------------------------------
create or replace function public.trigger_event(
  target_world uuid,
  target_kind text,
  target uuid,
  event_kind text,
  -- {"lose_advancement": uuid?, "fate": "slain" | "disbanded" | "ruined" | "destroyed" | null}
  effect jsonb,
  description text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  t public.world_entities%rowtype;
  cost int := public._power_cost(target_world, 'event');
  extra int := 0;
  fate text := nullif(effect ->> 'fate', '');
  lose uuid := nullif(effect ->> 'lose_advancement', '')::uuid;
  new_status text;
  fates jsonb := '[]'::jsonb;
  lost jsonb := '[]'::jsonb;
  power_after int;
  clean_kind text := trim(coalesce(event_kind, ''));
begin
  if target_kind not in ('avatar', 'order', 'city', 'race') then
    raise exception 'An event strikes an avatar, an order, a city or a civilization' using errcode = 'check_violation';
  end if;
  select * into t from public.world_entities e
  where e.id = target and e.world_id = target_world and e.kind = target_kind;
  if t.id is null then
    raise exception 'Choose one of this world''s %s', case target_kind when 'race' then 'civilization' else target_kind end
      using errcode = 'check_violation';
  end if;
  if t.status <> 'active' then
    raise exception '% is already gone', t.name using errcode = 'check_violation';
  end if;
  if char_length(clean_kind) = 0 or char_length(clean_kind) > 40 then
    raise exception 'Name the event (up to 40 characters)' using errcode = 'check_violation';
  end if;
  perform public._require_description(description);

  if lose is not null and public._advancement_owner(target_world, lose) is distinct from t.id then
    raise exception 'That advancement isn''t %''s', t.name using errcode = 'check_violation';
  end if;
  new_status := case
    when fate is null then null
    when fate = 'slain' and target_kind = 'avatar' then 'destroyed'
    when fate = 'disbanded' and target_kind = 'order' then 'destroyed'
    when fate = 'ruined' and target_kind = 'city' then 'ruined'
    when fate = 'destroyed' and target_kind = 'city' then 'destroyed'
  end;
  if fate is not null and new_status is null then
    raise exception 'That can''t happen to a %', case target_kind when 'race' then 'civilization' else target_kind end
      using errcode = 'check_violation';
  end if;
  -- Total destruction costs what it cost to create.
  if fate = 'disbanded' then
    extra := public._power_cost(target_world, 'createOrder');
  elsif fate = 'destroyed' then
    extra := public._power_cost(target_world, 'commandRace');
  end if;

  power_after := public._spend_power(acting_god, cost + extra);
  if new_status is not null then
    update public.world_entities set status = new_status where id = t.id;
    fates := jsonb_build_array(jsonb_build_object(
      'id', t.id, 'kind', target_kind, 'name', t.name, 'status', new_status, 'fate', fate
    ));
  end if;
  if lose is not null then
    lost := public._lose_advancements(target_world, array[lose]);
  end if;

  return public._log_action(
    target_world, acting_god, 'event', cost + extra, power_after,
    case when t.hex_x is null then '[]'::jsonb else jsonb_build_array(jsonb_build_array(t.hex_x, t.hex_y)) end,
    clean_kind, trim(description),
    jsonb_build_object(
      'target', jsonb_build_object('kind', target_kind, 'id', t.id, 'name', t.name),
      'event_kind', clean_kind,
      'fates', fates,
      'advancements_lost', lost,
      'destruction_cost', extra
    )
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- Catastrophes.
------------------------------------------------------------------------------------------------
create or replace function public.catastrophe(
  target_world uuid,
  hexes jsonb,
  catastrophe_kind text,
  -- The hexes' new terrain, or null to leave it.
  new_terrain text,
  -- [{"id": uuid, "fate": "ruined" | "scattered" | "slain" | "destroyed"}]; anything not listed is spared.
  fates jsonb,
  lost_advancements jsonb,
  description text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  cfg jsonb;
  m public.world_map%rowtype;
  hex jsonb;
  hx int;
  hy int;
  idx int;
  seen int[] := '{}';
  per_hex int := public._power_cost(target_world, 'catastrophe');
  cost int;
  extra int := 0;
  f jsonb;
  e public.world_entities%rowtype;
  fate text;
  new_status text;
  logged jsonb := '[]'::jsonb;
  lose uuid[] := '{}';
  lost jsonb := '[]'::jsonb;
  owner uuid;
  power_after int;
  clean_kind text := trim(coalesce(catastrophe_kind, ''));
begin
  select r.config into cfg
  from public.worlds w join public.rulesets r on r.id = w.ruleset_id where w.id = target_world;
  select * into m from public.world_map x where x.world_id = target_world for update;
  if char_length(clean_kind) = 0 or char_length(clean_kind) > 40 then
    raise exception 'Name the catastrophe (up to 40 characters)' using errcode = 'check_violation';
  end if;
  perform public._require_description(description);
  if jsonb_typeof(hexes) is distinct from 'array' or jsonb_array_length(hexes) = 0 then
    raise exception 'Choose at least one hex' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(hexes) > 7 then
    raise exception 'A catastrophe strikes at most 7 hexes' using errcode = 'check_violation';
  end if;
  for hex in select * from jsonb_array_elements(hexes) loop
    hx := (hex ->> 0)::int;
    hy := (hex ->> 1)::int;
    if hx is null or hy is null or hx < 0 or hy < 0 or hx >= m.width or hy >= m.height then
      raise exception 'That hex is off the map' using errcode = 'check_violation';
    end if;
    idx := hy * m.width + hx;
    if idx = any (seen) then
      raise exception 'Each hex can only be chosen once' using errcode = 'check_violation';
    end if;
    seen := seen || idx;
  end loop;
  if new_terrain is not null and not (cfg #> '{map,terrains}') ? new_terrain then
    raise exception 'Choose a valid terrain' using errcode = 'check_violation';
  end if;
  cost := per_hex * jsonb_array_length(hexes);

  -- What becomes of those caught in it.
  for f in select * from jsonb_array_elements(coalesce(fates, '[]'::jsonb)) loop
    select * into e from public.world_entities x
    where x.id = (f ->> 'id')::uuid and x.world_id = target_world;
    if e.id is null or e.hex_x is null or not ((e.hex_y * m.width + e.hex_x) = any (seen)) then
      raise exception 'Only what stands on the stricken hexes can be struck' using errcode = 'check_violation';
    end if;
    if e.status <> 'active' then
      raise exception '% is already gone', e.name using errcode = 'check_violation';
    end if;
    fate := f ->> 'fate';
    new_status := case
      when e.kind = 'city' and fate in ('ruined', 'destroyed') then fate
      when e.kind = 'army' and fate in ('scattered', 'destroyed') then fate
      when e.kind = 'avatar' and fate = 'slain' then 'destroyed'
    end;
    if new_status is null then
      raise exception 'That can''t happen to %', e.name using errcode = 'check_violation';
    end if;
    -- Utter destruction costs extra, as in battle.
    if e.kind = 'city' and fate = 'destroyed' then
      extra := extra + public._power_cost(target_world, 'commandRace');
    elsif e.kind = 'army' and fate = 'destroyed' then
      extra := extra + public._power_cost(target_world, 'commandCity');
    end if;
    logged := logged || jsonb_build_object('id', e.id, 'kind', e.kind, 'name', e.name, 'status', new_status, 'fate', fate);
  end loop;

  -- Advancements lost: those of cities on the hexes, or of civilizations whose homeland is there.
  for f in select * from jsonb_array_elements(coalesce(lost_advancements, '[]'::jsonb)) loop
    owner := public._advancement_owner(target_world, (f #>> '{}')::uuid);
    select * into e from public.world_entities x where x.id = owner;
    if e.id is null or e.hex_x is null or not ((e.hex_y * m.width + e.hex_x) = any (seen)) then
      raise exception 'Only advancements of cities and civilizations on the stricken hexes can be lost'
        using errcode = 'check_violation';
    end if;
    lose := lose || (f #>> '{}')::uuid;
  end loop;

  power_after := public._spend_power(acting_god, cost + extra);
  if new_terrain is not null then
    foreach idx in array seen loop
      m.terrain[idx + 1] := new_terrain;
    end loop;
    update public.world_map set terrain = m.terrain where world_id = target_world;
  end if;
  for f in select * from jsonb_array_elements(logged) loop
    update public.world_entities
    set status = f ->> 'status',
        -- Destroyed armies leave the map, as in battle.
        hex_x = case when f ->> 'kind' = 'army' and f ->> 'status' = 'destroyed' then null else hex_x end,
        hex_y = case when f ->> 'kind' = 'army' and f ->> 'status' = 'destroyed' then null else hex_y end
    where id = (f ->> 'id')::uuid;
  end loop;
  if cardinality(lose) > 0 then
    lost := public._lose_advancements(target_world, lose);
  end if;

  return public._log_action(
    target_world, acting_god, 'catastrophe', cost + extra, power_after, hexes,
    clean_kind, trim(description),
    jsonb_build_object(
      'catastrophe_kind', clean_kind,
      'terrain', new_terrain,
      'fates', logged,
      'advancements_lost', lost,
      'destruction_cost', extra
    )
  );
end;
$$;

revoke execute on function public._advancement_owner(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._lose_advancements(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.trigger_event(uuid, text, uuid, text, jsonb, text) from public, anon;
grant execute on function public.trigger_event(uuid, text, uuid, text, jsonb, text) to authenticated;
revoke execute on function public.catastrophe(uuid, jsonb, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.catastrophe(uuid, jsonb, text, text, jsonb, jsonb, text) to authenticated;
