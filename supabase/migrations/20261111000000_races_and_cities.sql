-- DOW-34/35 + DOW-26: races, their founding sects, and cities.
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- Races, cities and orders live in world_entities so the server can check names, placement and
-- territory. Each action is still logged as an action_taken event (with the new race or city in
-- the payload), which is what the app projects and what each hex's history is built from.

------------------------------------------------------------------------------------------------
-- Ruleset: the map now says which terrains are water (races and cities need land). Kept in sync
-- with src/rules/rulesets/classic.json by src/rules/__tests__/ruleset-sql-parity.test.ts.
------------------------------------------------------------------------------------------------
update public.rulesets set config = config ||
-- ruleset:classic-races:begin
'{
  "map": {
    "defaultSize": { "width": 32, "height": 24 },
    "terrains": ["ocean", "lake", "grassland", "forest", "jungle", "hills", "mountains", "desert", "tundra", "swamp"],
    "water": ["ocean", "lake"],
    "climates": ["none", "fog", "rain", "snow", "sun", "heat", "cold", "sleet"]
  }
}'::jsonb
-- ruleset:classic-races:end
where id = 'classic';

------------------------------------------------------------------------------------------------
-- Races, cities and orders (sects).
------------------------------------------------------------------------------------------------
create table public.world_entities (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  kind text not null check (kind in ('race', 'city', 'order')),
  name text not null check (char_length(trim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  appearance text not null default '' check (char_length(appearance) <= 280),
  -- +1 good, 0 neutral, -1 evil to start; purify/corrupt move it later.
  alignment int not null default 0 check (alignment between -10 and 10),
  -- Where it is on the map: a race's homeland, a city's site. Orders have no hex.
  hex_x int,
  hex_y int,
  -- A city's or sect's race.
  race_id uuid references public.world_entities (id) on delete cascade,
  -- The god who created it.
  god_id uuid references public.gods (id) on delete set null,
  -- The world_events seq that created it.
  created_seq int not null,
  created_at timestamptz not null default now(),
  check ((hex_x is null) = (hex_y is null)),
  check (kind = 'race' or race_id is not null)
);

create unique index world_entities_name_idx
  on public.world_entities (world_id, lower(trim(name)))
  where kind in ('race', 'city');
create index world_entities_world_idx on public.world_entities (world_id, kind);

alter table public.world_entities enable row level security;
create policy "world_entities: members read"
  on public.world_entities for select to authenticated using (public.is_world_member(world_id));
-- Only the server functions below write here.
revoke insert, update, delete on public.world_entities from anon, authenticated;

------------------------------------------------------------------------------------------------
-- Helpers shared by the actions.
------------------------------------------------------------------------------------------------

-- Locks the world's turn state and returns the god whose turn it is, if it belongs to the caller.
create or replace function public._require_my_turn(target_world uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  st public.world_state%rowtype;
  acting_god uuid;
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
  return acting_god;
end;
$$;

-- The cost of one use of a power in the world's current age.
create or replace function public._power_cost(target_world uuid, power_id text)
returns int
language sql
stable
set search_path = ''
as $$
  select (p -> 'costs' ->> (s.age - 1))::int
  from public.worlds w
  join public.rulesets r on r.id = w.ruleset_id
  join public.world_state s on s.world_id = w.id
  cross join lateral jsonb_array_elements(r.config -> 'powers') p
  where w.id = target_world and p ->> 'id' = power_id
$$;

-- Takes `cost` from a god's power and returns what's left, or explains that it's too much.
create or replace function public._spend_power(god uuid, cost int)
returns int
language plpgsql
set search_path = ''
as $$
declare
  have int;
begin
  select p.power into have from public.god_power p where p.god_id = god for update;
  if have < cost then
    raise exception 'That costs % power; you have %', cost, have using errcode = 'check_violation';
  end if;
  update public.god_power set power = power - cost where god_id = god;
  return have - cost;
end;
$$;

-- Whether two hexes touch, in the map's "odd-r" layout (see neighbors() in src/map/hex.ts).
create or replace function public._hex_adjacent(x1 int, y1 int, x2 int, y2 int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when abs(y2 - y1) > 1 then false
    when y2 = y1 then abs(x2 - x1) = 1
    when y1 % 2 = 1 then x2 - x1 in (0, 1)
    else x2 - x1 in (-1, 0)
  end
$$;

-- Checks that a hex is on the map and is land; returns its terrain.
create or replace function public._require_land(target_world uuid, hx int, hy int)
returns text
language plpgsql
set search_path = ''
as $$
declare
  m public.world_map%rowtype;
  terrain text;
  water text[];
begin
  select * into m from public.world_map where world_id = target_world;
  if hx is null or hy is null or hx < 0 or hy < 0 or hx >= m.width or hy >= m.height then
    raise exception 'That hex is off the map' using errcode = 'check_violation';
  end if;
  terrain := m.terrain[hy * m.width + hx + 1];
  select array(select jsonb_array_elements_text(r.config #> '{map,water}')) into water
  from public.worlds w join public.rulesets r on r.id = w.ruleset_id where w.id = target_world;
  if terrain = any (water) then
    raise exception 'That hex is water; choose land' using errcode = 'check_violation';
  end if;
  return terrain;
end;
$$;

create or replace function public._require_unique_name(target_world uuid, new_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.world_entities e
    where e.world_id = target_world and e.kind in ('race', 'city')
      and lower(trim(e.name)) = lower(trim(new_name))
  ) then
    raise exception 'Something in this world is already called %', trim(new_name)
      using errcode = 'unique_violation';
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-34: Create Race. The race appears on its homeland hex, and its creator gets a sect in it.
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
  acting_god uuid;
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

  if char_length(clean_name) = 0 then
    raise exception 'Give the race a name' using errcode = 'check_violation';
  end if;
  if char_length(clean_name) > 40 then
    raise exception 'Keep the name under 40 characters' using errcode = 'check_violation';
  end if;
  if char_length(clean_description) = 0 then
    raise exception 'Describe the race' using errcode = 'check_violation';
  end if;
  if char_length(clean_description) > 500 then
    raise exception 'Keep the description under 500 characters' using errcode = 'check_violation';
  end if;
  if char_length(clean_appearance) > 280 then
    raise exception 'Keep the appearance under 280 characters' using errcode = 'check_violation';
  end if;
  if race_alignment is null or race_alignment not in (-1, 0, 1) then
    raise exception 'A race starts good, neutral or evil' using errcode = 'check_violation';
  end if;
  perform public._require_unique_name(target_world, clean_name);
  perform public._require_land(target_world, hex_x, hex_y);
  if exists (
    select 1 from public.world_entities e
    where e.world_id = target_world and e.kind in ('race', 'city')
      and e.hex_x = create_race.hex_x and e.hex_y = create_race.hex_y
  ) then
    raise exception 'Someone already lives on that hex' using errcode = 'check_violation';
  end if;

  cost := public._power_cost(target_world, 'createRace');
  power_after := public._spend_power(acting_god, cost);

  select g.name into god_name from public.gods g where g.id = acting_god;
  order_name := 'Faithful of ' || god_name;

  seq := public._append_event(
    target_world,
    'action_taken',
    jsonb_build_object(
      'power', 'createRace',
      'cost', cost,
      'hexes', jsonb_build_array(jsonb_build_array(hex_x, hex_y)),
      'choice', clean_name,
      'description', clean_description,
      'power_after', power_after,
      'race', jsonb_build_object(
        'id', race_id,
        'name', clean_name,
        'description', clean_description,
        'appearance', clean_appearance,
        'alignment', race_alignment,
        'hex', jsonb_build_array(hex_x, hex_y)
      ),
      'order', jsonb_build_object('id', order_id, 'name', order_name)
    ),
    acting_god
  );

  insert into public.world_entities
    (id, world_id, kind, name, description, appearance, alignment, hex_x, hex_y, god_id, created_seq)
  values
    (race_id, target_world, 'race', clean_name, clean_description, clean_appearance,
     race_alignment, hex_x, hex_y, acting_god, seq);
  insert into public.world_entities (id, world_id, kind, name, alignment, race_id, god_id, created_seq)
  values (order_id, target_world, 'order', order_name, race_alignment, race_id, acting_god, seq);

  return race_id;
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-35: Command Race to found a city, on or next to the race's land (its homeland and cities).
-- Any god may command any race. (The presence rule for commanding comes in v2.)
------------------------------------------------------------------------------------------------
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
  acting_god uuid;
  r public.world_entities%rowtype;
  clean_name text := trim(coalesce(city_name, ''));
  clean_description text := trim(coalesce(description, ''));
  cost int;
  power_after int;
  city_id uuid := gen_random_uuid();
  seq int;
begin
  acting_god := public._require_my_turn(target_world);

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
  perform public._require_land(target_world, hex_x, hex_y);

  if exists (
    select 1 from public.world_entities e
    where e.world_id = target_world and e.kind = 'city'
      and e.hex_x = found_city.hex_x and e.hex_y = found_city.hex_y
  ) then
    raise exception 'There is already a city on that hex' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.world_entities e
    where e.world_id = target_world and e.kind = 'race' and e.id <> r.id
      and e.hex_x = found_city.hex_x and e.hex_y = found_city.hex_y
  ) then
    raise exception 'That hex is another race''s homeland' using errcode = 'check_violation';
  end if;
  -- On or next to the race's homeland or one of its cities.
  if not exists (
    select 1 from public.world_entities e
    where e.world_id = target_world
      and (e.id = r.id or (e.kind = 'city' and e.race_id = r.id))
      and ((e.hex_x = found_city.hex_x and e.hex_y = found_city.hex_y)
           or public._hex_adjacent(e.hex_x, e.hex_y, found_city.hex_x, found_city.hex_y))
  ) then
    raise exception 'A city must be on or next to % land', r.name || '''s'
      using errcode = 'check_violation';
  end if;

  cost := public._power_cost(target_world, 'commandRace');
  power_after := public._spend_power(acting_god, cost);

  seq := public._append_event(
    target_world,
    'action_taken',
    jsonb_build_object(
      'power', 'commandRace',
      'intent', 'foundCity',
      'cost', cost,
      'hexes', jsonb_build_array(jsonb_build_array(hex_x, hex_y)),
      'choice', clean_name,
      'description', clean_description,
      'power_after', power_after,
      'city', jsonb_build_object(
        'id', city_id,
        'name', clean_name,
        'race_id', r.id,
        'alignment', r.alignment,
        'hex', jsonb_build_array(hex_x, hex_y)
      )
    ),
    acting_god
  );

  insert into public.world_entities
    (id, world_id, kind, name, alignment, hex_x, hex_y, race_id, god_id, created_seq)
  values
    (city_id, target_world, 'city', clean_name, r.alignment, hex_x, hex_y, r.id, acting_god, seq);

  return city_id;
end;
$$;

------------------------------------------------------------------------------------------------
-- Permissions.
------------------------------------------------------------------------------------------------
revoke execute on function public._require_my_turn(uuid) from public, anon, authenticated;
revoke execute on function public._power_cost(uuid, text) from public, anon, authenticated;
revoke execute on function public._spend_power(uuid, int) from public, anon, authenticated;
revoke execute on function public._hex_adjacent(int, int, int, int) from public, anon, authenticated;
revoke execute on function public._require_land(uuid, int, int) from public, anon, authenticated;
revoke execute on function public._require_unique_name(uuid, text) from public, anon, authenticated;

revoke execute on function public.create_race(uuid, text, text, text, int, int, int) from public, anon;
revoke execute on function public.found_city(uuid, uuid, text, int, int, text) from public, anon;
grant execute on function public.create_race(uuid, text, text, text, int, int, int) to authenticated;
grant execute on function public.found_city(uuid, uuid, text, int, int, text) to authenticated;
