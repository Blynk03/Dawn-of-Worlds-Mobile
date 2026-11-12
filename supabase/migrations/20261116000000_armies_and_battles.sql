-- DOW-48 (Command City: structures and armies), DOW-54/55 (battles: modifiers, 2d6, fatigue,
-- several armies) and DOW-41 (total destruction costs the creation cost).
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- From the rules:
-- * Command City: "the god directs one single city to create something. This can be a wonder,
--   wall, school, tower, or the like. Armies too are created with this power, though any given
--   city may only produce one army in a given turn." Through an avatar, "players may raise two
--   armies in a turn from the same city".
-- * Command Race: "it can be used to direct the race to make war on others". Marching and
--   attacking are Command Race, so they need an order or avatar among the army's race (**).
-- * Conflict (section IV): each side adds +1 for each technology that might be used in battle,
--   higher ground, a defensive wall, or specialized terrain or weather; rolls 2d6; the loser "is
--   either destroyed or scattered". Several armies: a separate roll for each, and "for each
--   battle after the first, a cumulative -1 penalty". If a city "lies defenseless, the city will
--   be demolished".
-- * "It is very difficult to completely wipe out anything ... should a player wish to completely
--   wipe out any fixture an army, order, race, subrace, or city, he or she must pay the equivalent
--   creation cost." Otherwise survivors remain: a beaten army is scattered, a taken city ruined.
--
-- Choices the rules leave open (see the PR): a tied roll is rolled again; the attacking god
-- picks both sides' +1s in the battle wizard (disputes and votes come with the objection window);
-- total destruction is chosen before the roll and only charged for what is actually destroyed.

------------------------------------------------------------------------------------------------
-- Armies and structures are world_entities too.
------------------------------------------------------------------------------------------------
alter table public.world_entities drop constraint world_entities_kind_check;
alter table public.world_entities add constraint world_entities_kind_check
  check (kind in ('race', 'city', 'order', 'avatar', 'army', 'structure'));

-- scattered: a beaten army (survivors remain). ruined: a taken city (survivors remain).
-- destroyed: wiped out completely (or an avatar slain, an order gone).
alter table public.world_entities drop constraint world_entities_status_check;
alter table public.world_entities add constraint world_entities_status_check
  check (status in ('active', 'scattered', 'ruined', 'destroyed'));

alter table public.world_entities
  -- An army's home city; a structure's city.
  add column city_id uuid references public.world_entities (id) on delete set null,
  add column structure_type text
    check (structure_type in ('wonder', 'wall', 'school', 'tower', 'temple', 'other'));

------------------------------------------------------------------------------------------------
-- Helpers.
------------------------------------------------------------------------------------------------

-- DOW-38 as an error: commanding a race (or one of its cities or armies) needs presence there.
create or replace function public._require_presence(target_world uuid, god uuid, race uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  race_name text;
begin
  if not public._present_in_race(target_world, god, race) then
    select e.name into race_name from public.world_entities e where e.id = race;
    raise exception 'To command the %, you need an order or avatar among them', race_name
      using errcode = 'check_violation';
  end if;
end;
$$;

-- Validates a list of battle modifiers (each is a +1 with a short reason).
create or replace function public._clean_modifiers(mods jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  m jsonb;
  out jsonb := '[]'::jsonb;
begin
  if mods is null or jsonb_typeof(mods) = 'null' then
    return out;
  end if;
  if jsonb_typeof(mods) <> 'array' or jsonb_array_length(mods) > 10 then
    raise exception 'Up to 10 modifiers a side' using errcode = 'check_violation';
  end if;
  for m in select * from jsonb_array_elements(mods) loop
    if jsonb_typeof(m) <> 'string' or char_length(trim(m #>> '{}')) not between 1 and 60 then
      raise exception 'Each modifier needs a short reason' using errcode = 'check_violation';
    end if;
    out := out || to_jsonb(trim(m #>> '{}'));
  end loop;
  return out;
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-48: Command City. `army_limit` is 1 normally, 2 through an avatar.
------------------------------------------------------------------------------------------------
create or replace function public._do_command_city(
  target_world uuid,
  acting_god uuid,
  city uuid,
  action text,
  args jsonb,
  power_id text,
  cost int,
  extra jsonb,
  army_limit int
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  c public.world_entities%rowtype;
  st public.world_state%rowtype;
  clean_name text;
  clean_description text;
  kind_of text;
  power_after int;
  new_id uuid := gen_random_uuid();
  raised int;
  seq int;
begin
  select * into c from public.world_entities e
  where e.id = city and e.world_id = target_world and e.kind = 'city';
  if c.id is null then
    raise exception 'Choose one of this world''s cities' using errcode = 'check_violation';
  end if;
  if c.status <> 'active' then
    raise exception '% lies in ruins', c.name using errcode = 'check_violation';
  end if;

  if action = 'build' then
    clean_name := public._require_name(args->>'name', 'structure');
    kind_of := coalesce(args->>'structure_type', '');
    if kind_of not in ('wonder', 'wall', 'school', 'tower', 'temple', 'other') then
      raise exception 'Choose what to build' using errcode = 'check_violation';
    end if;
    clean_description := public._require_description(args->>'description');
    power_after := public._spend_power(acting_god, cost);
    seq := public._log_action(
      target_world, acting_god, power_id, cost, power_after,
      jsonb_build_array(jsonb_build_array(c.hex_x, c.hex_y)), clean_name, clean_description,
      jsonb_build_object(
        'intent', 'build',
        'target', jsonb_build_object('kind', 'city', 'id', c.id, 'key', c.id, 'name', c.name),
        'structure', jsonb_build_object(
          'id', new_id, 'name', clean_name, 'structure_type', kind_of, 'city_id', c.id
        )
      ) || coalesce(extra, '{}'::jsonb)
    );
    insert into public.world_entities
      (id, world_id, kind, name, description, structure_type, city_id, race_id, hex_x, hex_y,
       god_id, created_seq)
    values
      (new_id, target_world, 'structure', clean_name, clean_description, kind_of, c.id, c.race_id,
       c.hex_x, c.hex_y, acting_god, seq);
    return new_id;
  elsif action = 'raiseArmy' then
    clean_name := public._require_name(args->>'name', 'army');
    clean_description := public._require_description(args->>'description');
    -- "any given city may only produce one army in a given turn" (two through an avatar).
    select * into st from public.world_state where world_id = target_world;
    select count(*) into raised from public.world_events ev
    where ev.world_id = target_world and ev.type = 'action_taken' and ev.god_id = acting_god
      and ev.round = st.round and ev.age = st.age
      and ev.payload->'army'->>'city_id' = c.id::text and ev.payload->>'intent' = 'raiseArmy';
    if raised >= army_limit then
      raise exception '% has already raised % this turn', c.name,
        case when raised = 1 then 'an army' else raised || ' armies' end
        using errcode = 'check_violation';
    end if;
    power_after := public._spend_power(acting_god, cost);
    seq := public._log_action(
      target_world, acting_god, power_id, cost, power_after,
      jsonb_build_array(jsonb_build_array(c.hex_x, c.hex_y)), clean_name, clean_description,
      jsonb_build_object(
        'intent', 'raiseArmy',
        'target', jsonb_build_object('kind', 'city', 'id', c.id, 'key', c.id, 'name', c.name),
        'army', jsonb_build_object(
          'id', new_id, 'name', clean_name, 'race_id', c.race_id, 'city_id', c.id,
          'hex', jsonb_build_array(c.hex_x, c.hex_y)
        )
      ) || coalesce(extra, '{}'::jsonb)
    );
    insert into public.world_entities
      (id, world_id, kind, name, description, alignment, city_id, race_id, hex_x, hex_y, god_id,
       created_seq)
    values
      (new_id, target_world, 'army', clean_name, clean_description, c.alignment, c.id, c.race_id,
       c.hex_x, c.hex_y, acting_god, seq);
    return new_id;
  else
    raise exception 'A city can build something or raise an army' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.command_city(target_world uuid, city uuid, action text, args jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_god uuid := public._require_my_turn(target_world);
  race uuid;
begin
  select e.race_id into race from public.world_entities e
  where e.id = city and e.world_id = target_world and e.kind = 'city';
  if race is not null then
    perform public._require_presence(target_world, acting_god, race);
  end if;
  return public._do_command_city(
    target_world, acting_god, city, action, args, 'commandCity',
    public._power_cost(target_world, 'commandCity'), null, 1
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- Command Race: march an army somewhere (on land).
------------------------------------------------------------------------------------------------
create or replace function public.march_army(
  target_world uuid,
  army uuid,
  hex_x int,
  hex_y int,
  description text
)
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
  where e.id = army and e.world_id = target_world and e.kind = 'army';
  if a.id is null then
    raise exception 'Choose one of this world''s armies' using errcode = 'check_violation';
  end if;
  if a.status <> 'active' then
    raise exception '% is scattered', a.name using errcode = 'check_violation';
  end if;
  perform public._require_presence(target_world, acting_god, a.race_id);
  perform public._require_land(target_world, hex_x, hex_y);
  clean_description := public._require_description(description);
  cost := public._power_cost(target_world, 'commandRace');
  power_after := public._spend_power(acting_god, cost);
  update public.world_entities set hex_x = march_army.hex_x, hex_y = march_army.hex_y
  where id = a.id;
  perform public._log_action(
    target_world, acting_god, 'commandRace', cost, power_after,
    jsonb_build_array(jsonb_build_array(hex_x, hex_y)), a.name, clean_description,
    jsonb_build_object(
      'intent', 'march',
      'target', jsonb_build_object('kind', 'army', 'id', a.id, 'key', a.id, 'name', a.name),
      'march', jsonb_build_object(
        'army_id', a.id, 'from', jsonb_build_array(a.hex_x, a.hex_y),
        'to', jsonb_build_array(hex_x, hex_y)
      )
    )
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- DOW-54/55 + DOW-41: Command Race to attack an army or a city.
--
-- Against a city, every active army raised there or standing on it defends, one battle each;
-- the attacker tires by -1 for each battle after the first. Losing armies are scattered (or
-- destroyed, if the winner pays). A city with no defenders left falls: ruined, or destroyed if
-- the attacker pays. `utterly_destroy` is chosen beforehand and only charged for what is
-- actually destroyed (an army: Command City's cost; a city: Command Race's, as for founding it).
------------------------------------------------------------------------------------------------
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
declare
  acting_god uuid := public._require_my_turn(target_world);
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
  perform public._require_presence(target_world, acting_god, a.race_id);

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
  if coalesce(utterly_destroy, false) then
    -- Make sure total destruction can be paid for however the battles go.
    worst_case := army_price * cardinality(defenders)
      + case when target_kind = 'city' then city_price else 0 end;
    select p.power into have from public.god_power p where p.god_id = acting_god;
    if have < cost + worst_case then
      raise exception 'Attacking and utterly destroying everything could cost % power; you have %',
        cost + worst_case, have using errcode = 'check_violation';
    end if;
  end if;
  power_after := public._spend_power(acting_god, cost);

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
      )
    )
  );
  return case when won then 'won' else 'lost' end;
end;
$$;

------------------------------------------------------------------------------------------------
-- Command Avatar gains Command City (build, or raise an army: a second one from the same city
-- this turn is allowed through an avatar). Same as the batch B function otherwise.
------------------------------------------------------------------------------------------------
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
    'avatar_intent', intent,
    'avatar', jsonb_build_object('id', a.id, 'name', a.name)
  );

  if intent = 'deed' then
    power_after := public._spend_power(acting_god, cost);
    perform public._log_action(
      target_world, acting_god, 'commandAvatar', cost, power_after,
      jsonb_build_array(jsonb_build_array(a.hex_x, a.hex_y)), a.name,
      public._require_description(args->>'description'),
      extra || jsonb_build_object('intent', 'deed')
    );
  elsif intent = 'foundCity' then
    made := public._do_found_city(
      target_world, acting_god, (args->>'race')::uuid, args->>'name',
      (args->>'x')::int, (args->>'y')::int, args->>'description', 'commandAvatar', cost, extra
    );
  elsif intent = 'createOrder' then
    made := public._do_create_order(
      target_world, acting_god, (args->>'race')::uuid, args->>'name', args->>'order_type',
      args->>'purpose', 'commandAvatar', cost, extra || jsonb_build_object('intent', 'createOrder')
    );
  elsif intent = 'commandOrder' then
    perform public._do_command_order(
      target_world, acting_god, (args->>'order')::uuid, args->>'directive', 'commandAvatar', cost,
      extra || jsonb_build_object('intent', 'commandOrder')
    );
  elsif intent in ('purifyCity', 'corruptCity') then
    perform public._do_change_alignment(
      target_world, acting_god, 'city', (args->>'city')::uuid, null, null,
      case intent when 'purifyCity' then 1 else -1 end, args->>'description',
      'commandAvatar', cost, extra || jsonb_build_object('intent', intent)
    );
  elsif intent = 'createRace' then
    made := public._do_create_race(
      target_world, acting_god, null, args->>'name', args->>'description', args->>'appearance',
      (args->>'alignment')::int, (args->>'x')::int, (args->>'y')::int, 'commandAvatar', cost,
      extra || jsonb_build_object('intent', 'createRace')
    );
  elsif intent = 'commandCity' then
    made := public._do_command_city(
      target_world, acting_god, (args->>'city')::uuid, args->>'action', args, 'commandAvatar',
      cost, extra, 2
    );
  else
    raise exception 'An avatar can''t do that (yet)' using errcode = 'check_violation';
  end if;
  return made;
end;
$$;

------------------------------------------------------------------------------------------------
-- A city utterly destroyed no longer counts as land or blocks its hex; a ruined one still does
-- (its survivors remain). Destroyed things lose their place on the map (hex set to null), which
-- every placement check already ignores.
------------------------------------------------------------------------------------------------

------------------------------------------------------------------------------------------------
-- Permissions.
------------------------------------------------------------------------------------------------
revoke execute on function public._require_presence(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._clean_modifiers(jsonb) from public, anon, authenticated;
revoke execute on function public._do_command_city(uuid, uuid, uuid, text, jsonb, text, int, jsonb, int) from public, anon, authenticated;

revoke execute on function public.command_city(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.march_army(uuid, uuid, int, int, text) from public, anon;
revoke execute on function public.attack(uuid, uuid, text, uuid, jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.command_city(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.march_army(uuid, uuid, int, int, text) to authenticated;
grant execute on function public.attack(uuid, uuid, text, uuid, jsonb, jsonb, boolean, text) to authenticated;
