-- DOW-22 / DOW-23: invite codes, joining, starting a game, and gods.
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after
-- 20261102000000_profiles_worlds.sql.

------------------------------------------------------------------------------------------------
-- Invite codes: 6 characters, no look-alikes (no 0/O, 1/I/L).
------------------------------------------------------------------------------------------------
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
security definer -- must see every world's code, not just the caller's, to avoid duplicates
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.worlds w where w.invite_code = candidate);
  end loop;
  return candidate;
end;
$$;

alter table public.worlds
  add column invite_code text unique check (invite_code ~ '^[A-Z0-9]{6}$');
update public.worlds set invite_code = public.generate_invite_code() where invite_code is null;
alter table public.worlds
  alter column invite_code set default public.generate_invite_code(),
  alter column invite_code set not null;

------------------------------------------------------------------------------------------------
-- Gods: one per player per world.
------------------------------------------------------------------------------------------------
create table public.gods (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  name text not null check (char_length(trim(name)) between 1 and 30),
  spheres text[] not null check (
    cardinality(spheres) between 1 and 3
    and array_position(spheres, null) is null
  ),
  personality text not null default '' check (char_length(personality) <= 500),
  color text not null check (color ~ '^#[0-9A-F]{6}$'),
  sigil text not null check (char_length(sigil) between 1 and 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (world_id, user_id) references public.world_members (world_id, user_id) on delete cascade,
  unique (world_id, user_id),
  unique (world_id, color)
);

create unique index gods_world_name_idx on public.gods (world_id, lower(trim(name)));

alter table public.gods enable row level security;

create trigger gods_touch_updated_at
  before update on public.gods
  for each row execute procedure public.touch_updated_at();

-- Once the game starts, a god's spheres, color and sigil are fixed (name and personality stay
-- editable). Gods can't move between worlds or players.
create or replace function public.lock_god_after_start()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  world_status text;
begin
  if new.world_id <> old.world_id or new.user_id <> old.user_id then
    raise exception 'A god cannot change world or owner' using errcode = 'check_violation';
  end if;
  select w.status into world_status from public.worlds w where w.id = new.world_id;
  if world_status <> 'lobby' and (
    new.spheres is distinct from old.spheres
    or new.color is distinct from old.color
    or new.sigil is distinct from old.sigil
  ) then
    raise exception 'Spheres, color and sigil are locked once the game has started'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger gods_lock_after_start
  before update on public.gods
  for each row execute procedure public.lock_god_after_start();

-- Members see every god in their worlds.
create policy "gods: members read"
  on public.gods for select to authenticated
  using (public.is_world_member(world_id));

-- You create your own god, only while the world is in its lobby.
create policy "gods: create own in lobby"
  on public.gods for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_world_member(world_id)
    and exists (select 1 from public.worlds w where w.id = world_id and w.status = 'lobby')
  );

-- You edit your own god (the trigger above limits what can change after the start).
create policy "gods: update own"
  on public.gods for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- You can delete your own god while in the lobby.
create policy "gods: delete own in lobby"
  on public.gods for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.worlds w where w.id = world_id and w.status = 'lobby')
  );

------------------------------------------------------------------------------------------------
-- Membership changes: the host can remove players only before the game starts.
------------------------------------------------------------------------------------------------
drop policy "world_members: leave or host removes" on public.world_members;

create policy "world_members: leave, or host removes in lobby"
  on public.world_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (
      public.is_world_host(world_id)
      and exists (select 1 from public.worlds w where w.id = world_id and w.status = 'lobby')
    )
  );

------------------------------------------------------------------------------------------------
-- Joining by invite code. Only through this function: there is still no insert policy on
-- world_members.
------------------------------------------------------------------------------------------------
create or replace function public.join_world(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  target public.worlds%rowtype;
  member_count int;
begin
  if me is null then
    raise exception 'Sign in to join a world' using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.worlds w
  where w.invite_code = upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then
    raise exception 'No world has that invite code' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.world_members m where m.world_id = target.id and m.user_id = me) then
    return target.id; -- already a member: joining again is harmless
  end if;

  if target.status <> 'lobby' then
    raise exception 'That world has already started' using errcode = 'check_violation';
  end if;

  select count(*) into member_count from public.world_members m where m.world_id = target.id;
  if member_count >= 8 then
    raise exception 'That world is full (8 players)' using errcode = 'check_violation';
  end if;

  insert into public.world_members (world_id, user_id, role) values (target.id, me, 'player');
  return target.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- Starting the game: host only, from the lobby, with at least 2 gods and a god for every
-- player (a GM may run the world without one).
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

  if (select w.status from public.worlds w where w.id = target_world) <> 'lobby' then
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
end;
$$;

-- The creator can choose to be the GM when creating the world.
create or replace function public.set_my_gm_role(target_world uuid, gm boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_world_host(target_world) then
    raise exception 'Only the host can change the GM role' using errcode = 'insufficient_privilege';
  end if;
  if (select w.status from public.worlds w where w.id = target_world) <> 'lobby' then
    raise exception 'The GM role is fixed once the game starts' using errcode = 'check_violation';
  end if;
  update public.world_members set is_gm = gm
  where world_id = target_world and user_id = (select auth.uid());
end;
$$;

revoke execute on function public.join_world(text) from public, anon;
revoke execute on function public.start_world(uuid) from public, anon;
revoke execute on function public.set_my_gm_role(uuid, boolean) from public, anon;
revoke execute on function public.generate_invite_code() from public, anon;
grant execute on function public.join_world(text) to authenticated;
grant execute on function public.start_world(uuid) to authenticated;
grant execute on function public.set_my_gm_role(uuid, boolean) to authenticated;
-- Used as the invite_code column default, so inserting a world needs it.
grant execute on function public.generate_invite_code() to authenticated;

------------------------------------------------------------------------------------------------
-- Live updates: lobbies refresh when someone joins, picks a god, or the game starts.
-- Realtime respects the row-level security above.
------------------------------------------------------------------------------------------------
alter publication supabase_realtime add table public.worlds, public.world_members, public.gods;
