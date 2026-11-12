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
