/** Pure helpers for showing worlds on the home screen and in the lobby (DOW-22/24). */
import type { God, World, WorldMember } from '@/lib/database.types';

type MemberLike = Pick<WorldMember, 'user_id' | 'role' | 'is_gm'>;
type GodLike = Pick<God, 'user_id'> & Partial<Pick<God, 'id'>>;
type StateLike = { round: number; turn_order: string[]; active_position: number };
type WorldLike = Pick<World, 'status' | 'updated_at'> & {
  world_members: MemberLike[];
  gods: GodLike[];
  world_state?: StateLike | null;
};

export type WorldAction =
  | 'yourTurn' // a game in play is waiting on you
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
  if (world.status === 'active') return isMyTurn(world, myUserId) ? 'yourTurn' : 'playing';
  const me = world.world_members.find((m) => m.user_id === myUserId);
  const hasGod = world.gods.some((g) => g.user_id === myUserId);
  if (me && !me.is_gm && !hasGod) return 'createGod';
  if (me?.role === 'host' && canStart(world.world_members, world.gods)) return 'startGame';
  return 'waitingForPlayers';
}

/** Whether the god whose turn it is belongs to this player. */
export function isMyTurn(world: WorldLike, myUserId: string): boolean {
  const state = world.world_state;
  if (!state) return false;
  const activeGod = state.turn_order[state.active_position - 1];
  return world.gods.some((g) => g.id === activeGod && g.user_id === myUserId);
}

const ACTION_ORDER: Record<WorldAction, number> = {
  yourTurn: 0,
  createGod: 1,
  startGame: 2,
  playing: 3,
  waitingForPlayers: 4,
  finished: 5,
};

/**
 * Worlds that need you come first (your turn, then setup tasks), then
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
  const round = world.world_state?.round;
  switch (worldAction(world, myUserId)) {
    case 'yourTurn':
      return round ? `Your turn · Round ${round}` : 'Your turn';
    case 'createGod':
      return `Lobby · ${playerText} · Create your god`;
    case 'startGame':
      return `Lobby · ${playerText} · Ready to start`;
    case 'waitingForPlayers':
      return `Lobby · ${playerText} · Waiting for players`;
    case 'playing':
      return round ? `In play · Round ${round} · ${playerText}` : `In play · ${playerText}`;
    case 'finished':
      return `Finished · ${playerText}`;
  }
}
