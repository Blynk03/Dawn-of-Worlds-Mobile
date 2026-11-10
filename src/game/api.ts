/** Supabase calls for the turn system (DOW-14/15/21/25/27). The server enforces every rule. */
import type { WorldEventRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/worlds/errors';

import type { GameEvent } from './project';

function client() {
  if (!supabase) throw new Error('The app is not connected to Supabase.');
  return supabase;
}

function toGameEvent(
  row: Pick<WorldEventRow, 'seq' | 'type' | 'age' | 'round' | 'god_id' | 'payload' | 'created_at'>,
): GameEvent {
  return {
    seq: row.seq,
    type: row.type,
    age: row.age,
    round: row.round,
    god_id: row.god_id,
    payload: row.payload,
    created_at: row.created_at,
  };
}

/** The whole game log for a world, oldest first. */
export async function loadGameEvents(worldId: string, afterSeq = 0): Promise<GameEvent[]> {
  const { data, error } = await client()
    .from('world_events')
    .select('seq, type, age, round, god_id, payload, created_at')
    .eq('world_id', worldId)
    .gt('seq', afterSeq)
    .order('seq');
  if (error) throw new Error(friendlyError(error));
  return (data ?? []).map(toGameEvent);
}

/** Ends your turn, or passes if `pass` is true. */
export async function endTurn(worldId: string, pass = false): Promise<void> {
  const { error } = await client().rpc('end_turn', { target_world: worldId, pass });
  if (error) throw new Error(friendlyError(error));
}

/** Skips a turn that has run past the world's time limit. */
export async function skipTimedOutTurn(worldId: string): Promise<void> {
  const { error } = await client().rpc('skip_timed_out_turn', { target_world: worldId });
  if (error) throw new Error(friendlyError(error));
}

/** DOW-26: spends power on an action (Shape Land / Shape Climate so far). */
export async function takeAction(
  worldId: string,
  powerId: string,
  hexes: [number, number][],
  choice: string,
  description: string,
): Promise<void> {
  const { error } = await client().rpc('take_action', {
    target_world: worldId,
    power_id: powerId,
    hexes,
    choice,
    description,
  });
  if (error) throw new Error(friendlyError(error));
}

let channelCounter = 0;

/**
 * Calls `onEvent` for each new event in this world's log. Each subscription has its own channel
 * name (see DOW-75), and failures are logged, never thrown. Returns an unsubscribe function.
 */
export function subscribeToGameEvents(
  worldId: string,
  onEvent: (event: GameEvent) => void,
): () => void {
  if (!supabase) return () => {};
  const db = supabase;
  try {
    const channel = db
      .channel(`game:${worldId}:${++channelCounter}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'world_events',
          filter: `world_id=eq.${worldId}`,
        },
        (change) => onEvent(toGameEvent(change.new as WorldEventRow)),
      )
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  } catch (error) {
    console.warn('Live game updates unavailable:', error);
    return () => {};
  }
}
