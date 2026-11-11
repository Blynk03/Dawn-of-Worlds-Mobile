import type { CommentRow, ReactionRow } from '@/lib/database.types';

import { REACTIONS, reactionCounts, threadsFor } from '../social';

const comment = (id: string, seq: number, parent: string | null = null): CommentRow => ({
  id,
  world_id: 'w',
  event_seq: seq,
  parent_id: parent,
  user_id: 'u1',
  body: id,
  created_at: '',
});
const reaction = (seq: number, user: string, emoji: string): ReactionRow => ({
  world_id: 'w',
  event_seq: seq,
  user_id: user,
  emoji,
  created_at: '',
});

describe('threadsFor', () => {
  it("groups an action's comments into threads, keeping order", () => {
    const comments = [
      comment('a', 5),
      comment('b', 6),
      comment('a1', 5, 'a'),
      comment('c', 5),
      comment('a2', 5, 'a'),
    ];
    expect(threadsFor(comments, 5).map((t) => [t.comment.id, t.replies.map((r) => r.id)])).toEqual([
      ['a', ['a1', 'a2']],
      ['c', []],
    ]);
    expect(threadsFor(comments, 7)).toEqual([]);
  });
});

describe('reactionCounts', () => {
  it('counts each reaction on an action and marks yours', () => {
    const reactions = [
      reaction(5, 'u1', '🔥'),
      reaction(5, 'u2', '🔥'),
      reaction(5, 'u2', '😂'),
      reaction(6, 'u1', '😂'),
    ];
    const counts = reactionCounts(reactions, 5, 'u1');
    expect(counts.map((c) => c.emoji)).toEqual([...REACTIONS]);
    expect(counts.find((c) => c.emoji === '🔥')).toEqual({ emoji: '🔥', count: 2, mine: true });
    expect(counts.find((c) => c.emoji === '😂')).toEqual({ emoji: '😂', count: 1, mine: false });
    expect(counts.find((c) => c.emoji === '👏')).toEqual({ emoji: '👏', count: 0, mine: false });
  });
});
