/**
 * Supabase calls for worlds, membership and gods. Row-level security (supabase/migrations) decides
 * what each player can see and change; these functions just shape the requests and results.
 */
import type { God, World, WorldMember, WorldState } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { friendlyError } from './errors';
import { normalizeInviteCode } from './invite';

function client() {
  if (!supabase) throw new Error('The app is not connected to Supabase.');
  return supabase;
}

/** Throws a player-friendly Error for a failed Supabase call. */
function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error(friendlyError(result.error));
  return result.data;
}

/** Like check(), for calls that must return a value (single row, RPC result). */
function checkRow<T>(result: { data: T; error: unknown }): NonNullable<T> {
  const data = check(result);
  if (data === null || data === undefined) {
    throw new Error('Something went wrong. Please try again.');
  }
  return data;
}

export type GodSummary = Pick<God, 'id' | 'user_id' | 'name' | 'color' | 'sigil'>;

export type WorldSummary = World & {
  world_members: Pick<WorldMember, 'user_id' | 'role' | 'is_gm'>[];
  gods: GodSummary[];
  world_state: Pick<WorldState, 'round' | 'turn_order' | 'active_position'> | null;
};

/** Every world the signed-in player belongs to. */
export async function listMyWorlds(): Promise<WorldSummary[]> {
  const data = check(
    await client()
      .from('worlds')
      .select(
        '*, world_members(user_id, role, is_gm), gods(id, user_id, name, color, sigil), world_state(round, turn_order, active_position)',
      )
      .order('updated_at', { ascending: false }),
  );
  return (data ?? []) as unknown as WorldSummary[];
}

export type LobbyMember = WorldMember & { profiles: { display_name: string } | null };

export type Lobby = {
  world: World;
  members: LobbyMember[];
  gods: God[];
};

export async function getLobby(worldId: string): Promise<Lobby | null> {
  const db = client();
  const [world, members, gods] = await Promise.all([
    db.from('worlds').select('*').eq('id', worldId).maybeSingle(),
    db
      .from('world_members')
      .select('*, profiles(display_name)')
      .eq('world_id', worldId)
      .order('joined_at'),
    db.from('gods').select('*').eq('world_id', worldId).order('created_at'),
  ]);
  const worldRow = check(world);
  if (!worldRow) return null;
  return {
    world: worldRow,
    members: (check(members) ?? []) as unknown as LobbyMember[],
    gods: check(gods) ?? [],
  };
}

export async function createWorld(
  name: string,
  hostIsGm: boolean,
  turnTimeLimitHours: number | null = null,
): Promise<World> {
  const db = client();
  const world = checkRow(
    await db
      .from('worlds')
      .insert({ name: name.trim(), turn_time_limit_hours: turnTimeLimitHours })
      .select('*')
      .single(),
  );
  if (hostIsGm) {
    check(await db.rpc('set_my_gm_role', { target_world: world.id, gm: true }));
  }
  return world;
}

/** Joins by invite code and returns the world id. */
export async function joinWorld(code: string): Promise<string> {
  return checkRow(await client().rpc('join_world', { code: normalizeInviteCode(code) }));
}

export async function startWorld(worldId: string): Promise<void> {
  check(await client().rpc('start_world', { target_world: worldId }));
}

export async function removeMember(worldId: string, userId: string): Promise<void> {
  check(
    await client().from('world_members').delete().eq('world_id', worldId).eq('user_id', userId),
  );
}

export type GodFields = Pick<God, 'name' | 'spheres' | 'personality' | 'color' | 'sigil'>;

export async function createGod(worldId: string, fields: GodFields): Promise<God> {
  return checkRow(
    await client()
      .from('gods')
      .insert({ world_id: worldId, ...fields, name: fields.name.trim() })
      .select('*')
      .single(),
  );
}

export async function updateGod(godId: string, fields: Partial<GodFields>): Promise<God> {
  const update = fields.name === undefined ? fields : { ...fields, name: fields.name.trim() };
  return checkRow(await client().from('gods').update(update).eq('id', godId).select('*').single());
}

let channelCounter = 0;

/**
 * Calls `onChange` when anything about the world, its members or its gods changes, so lobbies
 * update live when friends join or pick their gods. Returns an unsubscribe function.
 *
 * Each subscription gets its own channel name: Supabase returns the *existing* channel for a
 * name that's already in use, and adding listeners to a channel that's already subscribed throws
 * (this crashed the app when the god editor opened on top of the lobby). Live updates are a
 * nice-to-have, so any failure here is logged rather than thrown.
 */
export function subscribeToWorld(worldId: string, onChange: () => void): () => void {
  if (!supabase) return () => {};
  const db = supabase;
  try {
    const channel = db
      .channel(`world:${worldId}:${++channelCounter}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'worlds', filter: `id=eq.${worldId}` },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'world_members', filter: `world_id=eq.${worldId}` },
        onChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gods', filter: `world_id=eq.${worldId}` },
        onChange,
      )
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  } catch (error) {
    console.warn('Live updates unavailable for this world:', error);
    return () => {};
  }
}
