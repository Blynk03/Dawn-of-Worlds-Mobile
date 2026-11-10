-- DOW-29/30/31/32/33 + DOW-26 (core): the world map, the starting landmass, and the first
-- powers that spend power: Shape Land and Shape Climate.
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- The map is a rectangle of hexes stored row by row: index = y * width + x ("odd-r" offset
-- layout; see src/map/hex.ts). Every change is logged in world_events, so each hex's history
-- can be traced.

------------------------------------------------------------------------------------------------
-- Ruleset: power costs and map options the server enforces. Kept in sync with
-- src/rules/rulesets/classic.json by src/rules/__tests__/ruleset-sql-parity.test.ts.
------------------------------------------------------------------------------------------------
update public.rulesets set config = config ||
-- ruleset:classic-powers-map:begin
'{
  "map": {
    "defaultSize": { "width": 32, "height": 24 },
    "terrains": ["ocean", "lake", "grassland", "forest", "jungle", "hills", "mountains", "desert", "tundra", "swamp"],
    "climates": ["none", "fog", "rain", "snow", "sun", "heat", "cold", "sleet"]
  },
  "powers": [
    { "id": "shapeLand", "costs": [3, 5, 8], "perArea": true },
    { "id": "shapeClimate", "costs": [2, 4, 6], "perArea": true },
    { "id": "createRace", "costs": [22, 6, 15] },
    { "id": "createSubrace", "costs": [12, 4, 10] },
    { "id": "commandRace", "costs": [8, 4, 3] },
    { "id": "commandCity", "costs": [6, 4, 2] },
    { "id": "advanceCivilization", "costs": [10, 5, 6] },
    { "id": "advanceCity", "costs": [8, 4, 5] },
    { "id": "purifyCivilization", "costs": [5, 3, 4] },
    { "id": "corruptCivilization", "costs": [4, 3, 3] },
    { "id": "purifyCity", "costs": [4, 3, 3] },
    { "id": "corruptCity", "costs": [3, 2, 2] },
    { "id": "event", "costs": [10, 7, 9] },
    { "id": "createOrder", "costs": [8, 6, 4] },
    { "id": "commandOrder", "costs": [4, 3, 2] },
    { "id": "createAvatar", "costs": [10, 7, 8] },
    { "id": "commandAvatar", "costs": [2, 1, 1] },
    { "id": "catastrophe", "costs": [10, 10, 10], "perArea": true }
  ]
}'::jsonb
-- ruleset:classic-powers-map:end
where id = 'classic';

------------------------------------------------------------------------------------------------
-- The map.
------------------------------------------------------------------------------------------------
create table public.world_map (
  world_id uuid primary key references public.worlds (id) on delete cascade,
  width int not null check (width between 8 and 64),
  height int not null check (height between 8 and 64),
  terrain text[] not null,
  climate text[] not null,
  updated_at timestamptz not null default now(),
  check (cardinality(terrain) = width * height),
  check (cardinality(climate) = width * height)
);

alter table public.world_map enable row level security;
create policy "world_map: members read"
  on public.world_map for select to authenticated using (public.is_world_member(world_id));

-- Rough continent in the middle of an ocean, for worlds whose host didn't draw one.
create or replace function public._default_terrain(map_width int, map_height int)
returns text[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  cells text[] := '{}';
  dx float;
  dy float;
begin
  for y in 0..map_height - 1 loop
    for x in 0..map_width - 1 loop
      dx := (x - (map_width - 1) / 2.0) / (map_width * 0.36);
      dy := (y - (map_height - 1) / 2.0) / (map_height * 0.36);
      cells := cells || case
        when dx * dx + dy * dy + (random() - 0.5) * 0.45 < 1 then 'grassland'
        else 'ocean'
      end;
    end loop;
  end loop;
  return cells;
end;
$$;

-- Creates a world's map if it doesn't have one yet. Returns true if it created one.
create or replace function public._ensure_map(target_world uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  cfg jsonb;
  w int;
  h int;
begin
  if exists (select 1 from public.world_map m where m.world_id = target_world) then
    return false;
  end if;
  select r.config into cfg
  from public.worlds wo join public.rulesets r on r.id = wo.ruleset_id where wo.id = target_world;
  w := (cfg #>> '{map,defaultSize,width}')::int;
  h := (cfg #>> '{map,defaultSize,height}')::int;
  insert into public.world_map (world_id, width, height, terrain, climate)
  values (target_world, w, h, public._default_terrain(w, h), array_fill('none'::text, array[w * h]));
  return true;
end;
$$;

create or replace function public._log_map_initialized(target_world uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m public.world_map%rowtype;
begin
  select * into m from public.world_map where world_id = target_world;
  perform public._append_event(
    target_world,
    'map_initialized',
    jsonb_build_object(
      'width', m.width,
      'height', m.height,
      'terrain', to_jsonb(m.terrain),
      'climate', to_jsonb(m.climate)
    )
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-30: the host draws the starting landmass in the lobby (free; locked once play starts).
------------------------------------------------------------------------------------------------
create or replace function public.set_initial_map(
  target_world uuid,
  map_width int,
  map_height int,
  terrain text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed text[];
begin
  if not public.is_world_host(target_world) then
    raise exception 'Only the host can shape the starting landmass' using errcode = 'insufficient_privilege';
  end if;
  if (select w.status from public.worlds w where w.id = target_world) <> 'lobby' then
    raise exception 'The starting landmass is fixed once the game starts' using errcode = 'check_violation';
  end if;
  if map_width not between 8 and 64 or map_height not between 8 and 64 then
    raise exception 'Maps can be 8 to 64 hexes wide and tall' using errcode = 'check_violation';
  end if;
  if cardinality(terrain) is distinct from map_width * map_height then
    raise exception 'The map needs exactly one terrain per hex' using errcode = 'check_violation';
  end if;
  select array(select jsonb_array_elements_text(r.config #> '{map,terrains}')) into allowed
  from public.worlds w join public.rulesets r on r.id = w.ruleset_id where w.id = target_world;
  if exists (select 1 from unnest(terrain) t where t is null or not t = any (allowed)) then
    raise exception 'The map contains an unknown terrain' using errcode = 'check_violation';
  end if;

  insert into public.world_map (world_id, width, height, terrain, climate)
  values (target_world, map_width, map_height, terrain, array_fill('none'::text, array[map_width * map_height]))
  on conflict (world_id) do update
    set width = excluded.width,
        height = excluded.height,
        terrain = excluded.terrain,
        climate = excluded.climate,
        updated_at = now();
end;
$$;

------------------------------------------------------------------------------------------------
-- Starting the game (replaces the previous version): also fixes the map and logs it.
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
  perform public._ensure_map(target_world);
  perform public._log_map_initialized(target_world);
  perform public._begin_round(target_world);
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-26 / DOW-31 / DOW-32: spending power. The active god may take any number of actions in
-- their turn, limited only by their power.
------------------------------------------------------------------------------------------------
create or replace function public.take_action(
  target_world uuid,
  power_id text,
  hexes jsonb,
  choice text,
  description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
  m public.world_map%rowtype;
  cfg jsonb;
  power_cfg jsonb;
  acting_god uuid;
  gp public.god_power%rowtype;
  allowed text[];
  cells int[] := '{}';
  hex jsonb;
  hx int;
  hy int;
  idx int;
  area_count int;
  cost int;
  clean_description text := trim(coalesce(description, ''));
begin
  if (select w.status from public.worlds w where w.id = target_world) is distinct from 'active' then
    raise exception 'This game is not in play' using errcode = 'check_violation';
  end if;

  select * into st from public.world_state s where s.world_id = target_world for update;
  acting_god := st.turn_order[st.active_position];
  if not exists (
    select 1 from public.gods g where g.id = acting_god and g.user_id = (select auth.uid())
  ) then
    raise exception 'It isn''t your turn' using errcode = 'insufficient_privilege';
  end if;

  if power_id not in ('shapeLand', 'shapeClimate') then
    raise exception 'That power isn''t available yet' using errcode = 'check_violation';
  end if;

  if char_length(clean_description) = 0 then
    raise exception 'Describe what your god does' using errcode = 'check_violation';
  end if;
  if char_length(clean_description) > 280 then
    raise exception 'Keep the description under 280 characters' using errcode = 'check_violation';
  end if;

  select r.config into cfg
  from public.worlds w join public.rulesets r on r.id = w.ruleset_id where w.id = target_world;
  select p into power_cfg from jsonb_array_elements(cfg -> 'powers') p where p ->> 'id' = power_id;

  select * into m from public.world_map where world_id = target_world for update;

  -- Hexes: a list of [x, y] pairs, each on the map, no repeats.
  if jsonb_typeof(hexes) is distinct from 'array' or jsonb_array_length(hexes) = 0 then
    raise exception 'Choose at least one hex' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(hexes) > 64 then
    raise exception 'Choose at most 64 hexes in one action' using errcode = 'check_violation';
  end if;
  for hex in select * from jsonb_array_elements(hexes) loop
    if jsonb_typeof(hex) <> 'array' or jsonb_array_length(hex) <> 2 then
      raise exception 'Each hex needs an x and y' using errcode = 'check_violation';
    end if;
    hx := (hex ->> 0)::int;
    hy := (hex ->> 1)::int;
    if hx < 0 or hy < 0 or hx >= m.width or hy >= m.height then
      raise exception 'That hex is off the map' using errcode = 'check_violation';
    end if;
    idx := hy * m.width + hx + 1; -- Postgres arrays are 1-based
    if idx = any (cells) then
      raise exception 'Each hex can only be chosen once per action' using errcode = 'check_violation';
    end if;
    cells := cells || idx;
  end loop;
  area_count := cardinality(cells);

  if power_id = 'shapeLand' then
    select array(select jsonb_array_elements_text(cfg #> '{map,terrains}')) into allowed;
  else
    select array(select jsonb_array_elements_text(cfg #> '{map,climates}')) into allowed;
  end if;
  if choice is null or not choice = any (allowed) then
    raise exception 'Choose a valid % for this action',
      case when power_id = 'shapeLand' then 'terrain' else 'climate' end
      using errcode = 'check_violation';
  end if;

  cost := (power_cfg -> 'costs' ->> (st.age - 1))::int
    * case when (power_cfg ->> 'perArea')::boolean then area_count else 1 end;

  select * into gp from public.god_power p where p.god_id = acting_god for update;
  if gp.power < cost then
    raise exception 'That costs % power; you have %', cost, gp.power using errcode = 'check_violation';
  end if;

  update public.god_power set power = power - cost where god_id = acting_god;

  for i in 1..area_count loop
    if power_id = 'shapeLand' then
      m.terrain[cells[i]] := choice;
    else
      m.climate[cells[i]] := choice;
    end if;
  end loop;
  update public.world_map
  set terrain = m.terrain, climate = m.climate, updated_at = now()
  where world_id = target_world;

  perform public._append_event(
    target_world,
    'action_taken',
    jsonb_build_object(
      'power', power_id,
      'cost', cost,
      'hexes', hexes,
      'choice', choice,
      'description', clean_description,
      'power_after', gp.power - cost
    ),
    acting_god
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- Worlds already in play get a map.
------------------------------------------------------------------------------------------------
create or replace function public._add_maps_to_started_worlds()
returns int
language plpgsql
set search_path = ''
as $$
declare
  w record;
  added int := 0;
begin
  for w in
    select wo.id from public.worlds wo
    where wo.status = 'active'
      and exists (select 1 from public.world_state s where s.world_id = wo.id)
      and not exists (select 1 from public.world_map m where m.world_id = wo.id)
  loop
    perform public._ensure_map(w.id);
    perform public._log_map_initialized(w.id);
    added := added + 1;
  end loop;
  return added;
end;
$$;

select public._add_maps_to_started_worlds();

------------------------------------------------------------------------------------------------
-- Permissions and live updates.
------------------------------------------------------------------------------------------------
revoke execute on function public._default_terrain(int, int) from public, anon, authenticated;
revoke execute on function public._ensure_map(uuid) from public, anon, authenticated;
revoke execute on function public._log_map_initialized(uuid) from public, anon, authenticated;
revoke execute on function public._add_maps_to_started_worlds() from public, anon, authenticated;

revoke execute on function public.set_initial_map(uuid, int, int, text[]) from public, anon;
revoke execute on function public.take_action(uuid, text, jsonb, text, text) from public, anon;
revoke execute on function public.start_world(uuid) from public, anon;
grant execute on function public.set_initial_map(uuid, int, int, text[]) to authenticated;
grant execute on function public.take_action(uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.start_world(uuid) to authenticated;

alter publication supabase_realtime add table public.world_map;
