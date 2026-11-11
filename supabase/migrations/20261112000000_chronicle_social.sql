-- DOW-37: comments, reactions and unread tracking for the chronicle's activity feed.
--
-- Run once in the Supabase dashboard (SQL Editor → paste the whole file → Run), after the
-- earlier migrations.
--
-- Players react to and discuss actions (action_taken events). Writes go through the functions
-- below, which check membership and shape; players can read everything in their worlds.

------------------------------------------------------------------------------------------------
-- Comments: on an action, with one level of replies.
------------------------------------------------------------------------------------------------
create table public.action_comments (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null,
  event_seq int not null,
  -- A reply's top-level comment (replies don't nest further).
  parent_id uuid references public.action_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (world_id, event_seq) references public.world_events (world_id, seq) on delete cascade
);
create index action_comments_event_idx on public.action_comments (world_id, event_seq, created_at);

------------------------------------------------------------------------------------------------
-- Reactions: one of a fixed set of emoji, at most once each per player per action.
------------------------------------------------------------------------------------------------
create table public.action_reactions (
  world_id uuid not null,
  event_seq int not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Kept in sync with REACTIONS in src/chronicle/social.ts.
  emoji text not null check (emoji in ('🔥', '😮', '😂', '❤️', '👏', '😈')),
  created_at timestamptz not null default now(),
  primary key (world_id, event_seq, user_id, emoji),
  foreign key (world_id, event_seq) references public.world_events (world_id, seq) on delete cascade
);

------------------------------------------------------------------------------------------------
-- When each player last caught up on each world's feed.
------------------------------------------------------------------------------------------------
create table public.world_reads (
  world_id uuid not null references public.worlds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (world_id, user_id)
);

alter table public.action_comments enable row level security;
alter table public.action_reactions enable row level security;
alter table public.world_reads enable row level security;

create policy "action_comments: members read"
  on public.action_comments for select to authenticated using (public.is_world_member(world_id));
create policy "action_reactions: members read"
  on public.action_reactions for select to authenticated using (public.is_world_member(world_id));
create policy "world_reads: read your own"
  on public.world_reads for select to authenticated using (user_id = (select auth.uid()));

-- Only the functions below write.
revoke insert, update, delete on public.action_comments from anon, authenticated;
revoke insert, update, delete on public.action_reactions from anon, authenticated;
revoke insert, update, delete on public.world_reads from anon, authenticated;

------------------------------------------------------------------------------------------------
-- Functions.
------------------------------------------------------------------------------------------------

-- Checks the caller is in the world and the event is an action there.
create or replace function public._require_action(target_world uuid, action_seq int)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_world_member(target_world) then
    raise exception 'You''re not in this world' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.world_events e
    where e.world_id = target_world and e.seq = action_seq and e.type = 'action_taken'
  ) then
    raise exception 'That action doesn''t exist' using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.add_comment(
  target_world uuid,
  action_seq int,
  body text,
  reply_to uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_body text := trim(coalesce(body, ''));
  parent public.action_comments%rowtype;
  new_id uuid;
begin
  perform public._require_action(target_world, action_seq);
  if char_length(clean_body) = 0 then
    raise exception 'Write something first' using errcode = 'check_violation';
  end if;
  if char_length(clean_body) > 1000 then
    raise exception 'Keep comments under 1000 characters' using errcode = 'check_violation';
  end if;
  if reply_to is not null then
    select * into parent from public.action_comments c where c.id = reply_to;
    if parent.id is null or parent.world_id <> target_world or parent.event_seq <> action_seq then
      raise exception 'That comment isn''t on this action' using errcode = 'check_violation';
    end if;
    -- Replies to a reply join the same thread.
    reply_to := coalesce(parent.parent_id, parent.id);
  end if;
  insert into public.action_comments (world_id, event_seq, parent_id, user_id, body)
  values (target_world, action_seq, reply_to, (select auth.uid()), clean_body)
  returning id into new_id;
  return new_id;
end;
$$;

-- Deletes one of your own comments (and its replies).
create or replace function public.delete_comment(comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.action_comments c
  where c.id = comment and c.user_id = (select auth.uid());
  if not found then
    raise exception 'You can only delete your own comments' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Adds your reaction, or takes it back if it's already there. Returns whether it's now on.
create or replace function public.toggle_reaction(target_world uuid, action_seq int, emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_action(target_world, action_seq);
  delete from public.action_reactions r
  where r.world_id = target_world and r.event_seq = action_seq
    and r.user_id = (select auth.uid()) and r.emoji = toggle_reaction.emoji;
  if found then
    return false;
  end if;
  insert into public.action_reactions (world_id, event_seq, user_id, emoji)
  values (target_world, action_seq, (select auth.uid()), toggle_reaction.emoji);
  return true;
end;
$$;

-- Marks a world's feed as read up to now.
create or replace function public.mark_world_read(target_world uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_world_member(target_world) then
    raise exception 'You''re not in this world' using errcode = 'insufficient_privilege';
  end if;
  insert into public.world_reads (world_id, user_id, last_read_at)
  values (target_world, (select auth.uid()), now())
  on conflict (world_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- For each of your worlds: other players' actions and comments since you last read its feed.
create or replace function public.unread_counts()
returns table (world_id uuid, unread int)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select m.world_id, coalesce(r.last_read_at, '-infinity'::timestamptz) as since
    from public.world_members m
    left join public.world_reads r on r.world_id = m.world_id and r.user_id = m.user_id
    where m.user_id = (select auth.uid())
  )
  select mine.world_id,
    (
      (select count(*) from public.world_events e
       where e.world_id = mine.world_id and e.type = 'action_taken' and e.created_at > mine.since
         and not exists (
           select 1 from public.gods g where g.id = e.god_id and g.user_id = (select auth.uid())
         ))
      +
      (select count(*) from public.action_comments c
       where c.world_id = mine.world_id and c.created_at > mine.since
         and c.user_id <> (select auth.uid()))
    )::int
  from mine
$$;

------------------------------------------------------------------------------------------------
-- Permissions and live updates.
------------------------------------------------------------------------------------------------
revoke execute on function public._require_action(uuid, int) from public, anon, authenticated;

revoke execute on function public.add_comment(uuid, int, text, uuid) from public, anon;
revoke execute on function public.delete_comment(uuid) from public, anon;
revoke execute on function public.toggle_reaction(uuid, int, text) from public, anon;
revoke execute on function public.mark_world_read(uuid) from public, anon;
revoke execute on function public.unread_counts() from public, anon;
grant execute on function public.add_comment(uuid, int, text, uuid) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
grant execute on function public.toggle_reaction(uuid, int, text) to authenticated;
grant execute on function public.mark_world_read(uuid) to authenticated;
grant execute on function public.unread_counts() to authenticated;

alter publication supabase_realtime add table public.action_comments, public.action_reactions;
