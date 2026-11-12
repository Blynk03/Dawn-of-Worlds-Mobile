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

export type NewRace = {
  name: string;
  description: string;
  appearance: string;
  /** +1 good, 0 neutral, -1 evil. */
  alignment: -1 | 0 | 1;
  hex: { x: number; y: number };
};

/** DOW-34: Create Race on its homeland hex. Returns the new race's id. */
export async function createRace(worldId: string, race: NewRace): Promise<string> {
  const { data, error } = await client().rpc('create_race', {
    target_world: worldId,
    race_name: race.name,
    race_description: race.description,
    race_appearance: race.appearance,
    race_alignment: race.alignment,
    hex_x: race.hex.x,
    hex_y: race.hex.y,
  });
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** DOW-35: Command Race to found a city. Returns the new city's id. */
export async function foundCity(
  worldId: string,
  raceId: string,
  name: string,
  hex: { x: number; y: number },
  description: string,
): Promise<string> {
  const { data, error } = await client().rpc('found_city', {
    target_world: worldId,
    race: raceId,
    city_name: name,
    hex_x: hex.x,
    hex_y: hex.y,
    description,
  });
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** DOW-43: Create Subrace, next to its parent race's land. Returns the new race's id. */
export async function createSubrace(
  worldId: string,
  parentRaceId: string,
  race: NewRace,
): Promise<string> {
  const { data, error } = await client().rpc('create_subrace', {
    target_world: worldId,
    parent_race: parentRaceId,
    race_name: race.name,
    race_description: race.description,
    race_appearance: race.appearance,
    race_alignment: race.alignment,
    hex_x: race.hex.x,
    hex_y: race.hex.y,
  });
  if (error) throw new Error(friendlyError(error));
  return data;
}

/** DOW-47: Advance Civilization or Advance City (by the target's kind). */
export async function advance(
  worldId: string,
  targetId: string,
  field: string,
  description: string,
): Promise<void> {
  const { error } = await client().rpc('advance', {
    target_world: worldId,
    target: targetId,
    field,
    description,
  });
  if (error) throw new Error(friendlyError(error));
}

export type AlignmentTarget =
  { kind: 'race' | 'city'; id: string } | { kind: 'region'; hex: { x: number; y: number } };

/** DOW-46: Purify (+1) or Corrupt (-1). Returns the target's new alignment. */
export async function changeAlignment(
  worldId: string,
  target: AlignmentTarget,
  direction: 1 | -1,
  description: string,
): Promise<number> {
  const { data, error } = await client().rpc('change_alignment', {
    target_world: worldId,
    target_kind: target.kind,
    target: target.kind === 'region' ? null : target.id,
    hex_x: target.kind === 'region' ? target.hex.x : null,
    hex_y: target.kind === 'region' ? target.hex.y : null,
    direction,
    description,
  });
  if (error) throw new Error(friendlyError(error));
  return data;
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
