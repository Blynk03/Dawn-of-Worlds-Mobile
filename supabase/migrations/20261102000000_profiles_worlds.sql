-- DOW-13: profiles, worlds and world membership, with row-level security.
--
-- Run once in the Supabase dashboard (SQL Editor → paste → Run), or with `supabase db push`.
-- Safe to read top to bottom: every table has RLS enabled before any policy is added.

------------------------------------------------------------------------------------------------
-- Profiles: one per signed-in user, created automatically on sign-up.
------------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'New god'
      ),
      40
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

------------------------------------------------------------------------------------------------
-- Worlds and their members.
------------------------------------------------------------------------------------------------
create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  ruleset_id text not null default 'classic',
  status text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.world_members (
  world_id uuid not null references public.worlds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'player' check (role in ('host', 'player')),
  is_gm boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (world_id, user_id)
);

create index world_members_user_id_idx on public.world_members (user_id);

alter table public.worlds enable row level security;
alter table public.world_members enable row level security;

create trigger worlds_touch_updated_at
  before update on public.worlds
  for each row execute procedure public.touch_updated_at();

-- The creator becomes the world's host automatically.
create or replace function public.add_world_creator_as_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.world_members (world_id, user_id, role)
  values (new.id, new.created_by, 'host');
  return new;
end;
$$;

create trigger worlds_add_creator_as_host
  after insert on public.worlds
  for each row execute procedure public.add_world_creator_as_host();

-- Membership checks used by policies. SECURITY DEFINER avoids policies on world_members
-- recursively checking world_members.
create or replace function public.is_world_member(target_world uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.world_members m
    where m.world_id = target_world and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_world_host(target_world uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.world_members m
    where m.world_id = target_world and m.user_id = (select auth.uid()) and m.role = 'host'
  );
$$;

create or replace function public.shares_world_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.world_members mine
    join public.world_members theirs on theirs.world_id = mine.world_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other_user
  );
$$;

revoke execute on function public.is_world_member(uuid) from public, anon;
revoke execute on function public.is_world_host(uuid) from public, anon;
revoke execute on function public.shares_world_with(uuid) from public, anon;
grant execute on function public.is_world_member(uuid) to authenticated;
grant execute on function public.is_world_host(uuid) to authenticated;
grant execute on function public.shares_world_with(uuid) to authenticated;

------------------------------------------------------------------------------------------------
-- Policies. Signed-out users (anon) get nothing.
------------------------------------------------------------------------------------------------

-- Profiles: you can see yourself and anyone you share a world with; you can edit only yourself.
create policy "profiles: read self and world-mates"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_world_with(id));

create policy "profiles: update self"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Worlds: members (and the creator) can read; anyone signed in can create one as themselves;
-- hosts can edit/delete. The creator check lets `insert ... returning` see the new row before the
-- host membership trigger has run.
create policy "worlds: members read"
  on public.worlds for select to authenticated
  using (created_by = (select auth.uid()) or public.is_world_member(id));

create policy "worlds: create as self"
  on public.worlds for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "worlds: host updates"
  on public.worlds for update to authenticated
  using (public.is_world_host(id))
  with check (public.is_world_host(id));

create policy "worlds: host deletes"
  on public.worlds for delete to authenticated
  using (public.is_world_host(id));

-- Members: members can see who else is in their worlds. You can leave a world; the host can
-- remove players. Joining happens through the invite flow (DOW-22), not direct inserts.
create policy "world_members: members read"
  on public.world_members for select to authenticated
  using (public.is_world_member(world_id));

create policy "world_members: leave or host removes"
  on public.world_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_world_host(world_id));
