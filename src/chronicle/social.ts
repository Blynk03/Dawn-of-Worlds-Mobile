/** Supabase calls for the activity feed (DOW-37): comments, reactions and unread counts. */
import type { CommentRow, ReactionRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/worlds/errors';

/** The reactions players can use. Kept in sync with the check in the chronicle migration. */
export const REACTIONS = ['🔥', '😮', '😂', '❤️', '👏', '😈'] as const;

export type Social = { comments: CommentRow[]; reactions: ReactionRow[] };

function client() {
  if (!supabase) throw new Error('The app is not connected to Supabase.');
  return supabase;
}

export async function loadSocial(worldId: string): Promise<Social> {
  const db = client();
  const [comments, reactions] = await Promise.all([
    db
      .from('action_comments')
      .select('*')
      .eq('world_id', worldId)
      .order('created_at', { ascending: true }),
    db.from('action_reactions').select('*').eq('world_id', worldId),
  ]);
  if (comments.error) throw new Error(friendlyError(comments.error));
  if (reactions.error) throw new Error(friendlyError(reactions.error));
  return { comments: comments.data ?? [], reactions: reactions.data ?? [] };
}

export async function addComment(
  worldId: string,
  actionSeq: number,
  body: string,
  replyTo: string | null = null,
): Promise<void> {
  const { error } = await client().rpc('add_comment', {
    target_world: worldId,
    action_seq: actionSeq,
    body,
    reply_to: replyTo,
  });
  if (error) throw new Error(friendlyError(error));
}

export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await client().rpc('delete_comment', { comment: commentId });
  if (error) throw new Error(friendlyError(error));
}

export async function toggleReaction(
  worldId: string,
  actionSeq: number,
  emoji: string,
): Promise<void> {
  const { error } = await client().rpc('toggle_reaction', {
    target_world: worldId,
    action_seq: actionSeq,
    emoji,
  });
  if (error) throw new Error(friendlyError(error));
}

export async function markWorldRead(worldId: string): Promise<void> {
  const { error } = await client().rpc('mark_world_read', { target_world: worldId });
  if (error) throw new Error(friendlyError(error));
}

/** Unread actions and comments by other players, per world (worlds with none are left out). */
export async function loadUnreadCounts(): Promise<Record<string, number>> {
  const { data, error } = await client().rpc('unread_counts');
  if (error) throw new Error(friendlyError(error));
  return Object.fromEntries(
    (data ?? []).filter((r) => r.unread > 0).map((r) => [r.world_id, r.unread]),
  );
}

let channelCounter = 0;

/** Calls `onChange` whenever a comment or reaction in the world is added or removed. */
export function subscribeToSocial(worldId: string, onChange: () => void): () => void {
  if (!supabase) return () => {};
  const db = supabase;
  try {
    const filter = `world_id=eq.${worldId}`;
    const channel = db
      .channel(`social:${worldId}:${++channelCounter}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'action_comments', filter },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'action_reactions', filter },
        onChange,
      )
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  } catch (error) {
    console.warn('Live feed updates unavailable:', error);
    return () => {};
  }
}

export type Thread = { comment: CommentRow; replies: CommentRow[] };

/** An action's comments as threads: top-level comments (oldest first), each with its replies. */
export function threadsFor(comments: CommentRow[], actionSeq: number): Thread[] {
  const here = comments.filter((c) => c.event_seq === actionSeq);
  return here
    .filter((c) => !c.parent_id)
    .map((comment) => ({ comment, replies: here.filter((r) => r.parent_id === comment.id) }));
}

export type ReactionCount = { emoji: string; count: number; mine: boolean };

/** Counts for each reaction on an action, in REACTIONS order (unused ones included). */
export function reactionCounts(
  reactions: ReactionRow[],
  actionSeq: number,
  myId: string | undefined,
): ReactionCount[] {
  const here = reactions.filter((r) => r.event_seq === actionSeq);
  return REACTIONS.map((emoji) => {
    const these = here.filter((r) => r.emoji === emoji);
    return { emoji, count: these.length, mine: these.some((r) => r.user_id === myId) };
  });
}
