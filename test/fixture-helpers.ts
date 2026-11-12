// Helpers for tests that use the server-played game in src/game/__tests__/fixtures/server-game.json.
import type { GameEvent } from '@/game/project';

/** Powers that don't need a race to exist. */
const LANDSCAPE_POWERS = new Set(['shapeLand', 'shapeClimate', 'purifyRegion', 'corruptRegion']);

/** The game as if nobody had created a race yet (only land, climate and region actions). */
export function withoutRaces(events: readonly GameEvent[]): GameEvent[] {
  return events.filter(
    (e) =>
      e.type !== 'action_taken' ||
      LANDSCAPE_POWERS.has((e.payload as { power?: string }).power ?? ''),
  );
}

/** The game plus one more action: `godId` creates an order among `raceId` (presence, DOW-38). */
export function withOrder(
  events: readonly GameEvent[],
  godId: string,
  raceId: string,
  name = 'Test Order',
): GameEvent[] {
  const last = events[events.length - 1];
  return [
    ...events,
    {
      ...last,
      seq: last.seq + 1,
      type: 'action_taken',
      god_id: godId,
      payload: {
        power: 'createOrder',
        cost: 0,
        hexes: [],
        choice: name,
        description: 'For the tests',
        power_after: (last.payload as { power_after?: number }).power_after ?? 30,
        order: {
          id: `order-${godId}-${raceId}`,
          name,
          race_id: raceId,
          order_type: 'knights',
          purpose: 'For the tests',
        },
      },
    },
  ];
}

/** The game plus one more action: `godId` creates an avatar (among `raceId`, if given). */
export function withAvatar(
  events: readonly GameEvent[],
  godId: string,
  raceId: string | null,
  name = 'Aelin',
): GameEvent[] {
  const last = events[events.length - 1];
  return [
    ...events,
    {
      ...last,
      seq: last.seq + 1,
      type: 'action_taken',
      god_id: godId,
      payload: {
        power: 'createAvatar',
        cost: 0,
        hexes: [[1, 1]],
        choice: name,
        description: 'A test hero',
        power_after: (last.payload as { power_after?: number }).power_after ?? 30,
        avatar: {
          id: `avatar-${name}`,
          name,
          avatar_type: 'Hero',
          description: 'A test hero',
          race_id: raceId,
          hex: [1, 1],
        },
      },
    },
  ];
}
