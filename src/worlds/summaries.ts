/** Pure helpers for showing worlds on the home screen and in the lobby (DOW-22/24). */
import type { God, World, WorldMember } from '@/lib/database.types';

type MemberLike = Pick<WorldMember, 'user_id' | 'role' | 'is_gm'>;
type GodLike = Pick<God, 'user_id'>;
type WorldLike = Pick<World, 'status' | 'updated_at'> & {
  world_members: MemberLike[];
  gods: GodLike[];
};

export type WorldAction =
  | 'createGod' // you still need a god
  | 'startGame' // you're the host and everyone is ready
  | 'waitingForPlayers' // lobby, nothing for you to do
  | 'playing'
  | 'finished';

export const MIN_GODS_TO_START = 2;

/** Who still needs a god before the game can start (GMs may play without one). */
export function playersWithoutGods<M extends MemberLike>(members: M[], gods: GodLike[]): M[] {
  return members.filter((m) => !m.is_gm && !gods.some((g) => g.user_id === m.user_id));
}

export function canStart(members: MemberLike[], gods: GodLike[]): boolean {
  return gods.length >= MIN_GODS_TO_START && playersWithoutGods(members, gods).length === 0;
}

/** What this world needs from the signed-in player right now. */
export function worldAction(world: WorldLike, myUserId: string): WorldAction {
  if (world.status === 'finished') return 'finished';
  if (world.status === 'active') return 'playing';
  const me = world.world_members.find((m) => m.user_id === myUserId);
  const hasGod = world.gods.some((g) => g.user_id === myUserId);
  if (me && !me.is_gm && !hasGod) return 'createGod';
  if (me?.role === 'host' && canStart(world.world_members, world.gods)) return 'startGame';
  return 'waitingForPlayers';
}

const ACTION_ORDER: Record<WorldAction, number> = {
  createGod: 0,
  startGame: 1,
  playing: 2,
  waitingForPlayers: 3,
  finished: 4,
};

/**
 * Worlds that need you come first ("Your turn" joins this once turns exist, DOW-25), then
 * active games, then lobbies you're waiting on, then finished worlds. Most recent first within each.
 */
export function sortWorldsForHome<W extends WorldLike>(worlds: W[], myUserId: string): W[] {
  return [...worlds].sort((a, b) => {
    const byAction =
      ACTION_ORDER[worldAction(a, myUserId)] - ACTION_ORDER[worldAction(b, myUserId)];
    return byAction !== 0 ? byAction : b.updated_at.localeCompare(a.updated_at);
  });
}

export function worldStatusLabel(world: WorldLike, myUserId: string): string {
  const players = world.world_members.length;
  const playerText = `${players} ${players === 1 ? 'player' : 'players'}`;
  switch (worldAction(world, myUserId)) {
    case 'createGod':
      return `Lobby · ${playerText} · Create your god`;
    case 'startGame':
      return `Lobby · ${playerText} · Ready to start`;
    case 'waitingForPlayers':
      return `Lobby · ${playerText} · Waiting for players`;
    case 'playing':
      return `In play · ${playerText}`;
    case 'finished':
      return `Finished · ${playerText}`;
  }
}
