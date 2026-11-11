// DOW-36: the History Chart. Every action becomes a row; rows can be filtered by age, god or a
// race/city. Pure functions over the projected game (no React).
import type { ActionRecord, GameView } from '@/game/project';
import { climateInfo, terrainInfo } from '@/map/terrain';

export const POWER_NAMES: Record<string, string> = {
  shapeLand: 'Shape Land',
  shapeClimate: 'Shape Climate',
  createRace: 'Create Race',
  commandRace: 'Command Race',
};

/** e.g. { power: 'Shape Land', what: 'Hills' }, { power: 'Command Race', what: 'founded Karak' }. */
export function describeAction(action: ActionRecord): { power: string; what: string } {
  const power = POWER_NAMES[action.power] ?? action.power;
  const what =
    action.power === 'shapeLand'
      ? terrainInfo(action.choice).name
      : action.power === 'shapeClimate'
        ? climateInfo(action.choice).name
        : action.intent === 'foundCity'
          ? `founded ${action.choice}`
          : action.choice;
  return { power, what };
}

export type EntityRef = { id: string; kind: 'race' | 'city'; name: string };

/** The races and cities an action created or involved (a city's race counts too). */
export function actionEntities(view: GameView, action: ActionRecord): EntityRef[] {
  const out: EntityRef[] = [];
  for (const race of view.races) {
    if (race.createdSeq === action.seq) out.push({ id: race.id, kind: 'race', name: race.name });
  }
  for (const city of view.cities) {
    if (city.createdSeq !== action.seq) continue;
    const race = view.races.find((r) => r.id === city.raceId);
    if (race) out.push({ id: race.id, kind: 'race', name: race.name });
    out.push({ id: city.id, kind: 'city', name: city.name });
  }
  return out;
}

export type HistoryFilter = {
  age?: number | null;
  godId?: string | null;
  entityId?: string | null;
};

/** The History Chart's rows, oldest first, after filtering. */
export function historyRows(view: GameView, filter: HistoryFilter = {}): ActionRecord[] {
  return view.actions.filter(
    (a) =>
      (filter.age == null || a.age === filter.age) &&
      (filter.godId == null || a.godId === filter.godId) &&
      (filter.entityId == null || actionEntities(view, a).some((e) => e.id === filter.entityId)),
  );
}

/** Every race and city, for the entity filter: races, each followed by its cities. */
export function filterableEntities(view: GameView): EntityRef[] {
  return view.races.flatMap((race): EntityRef[] => [
    { id: race.id, kind: 'race', name: race.name },
    ...view.cities
      .filter((c) => c.raceId === race.id)
      .map((c): EntityRef => ({ id: c.id, kind: 'city', name: c.name })),
  ]);
}

/** e.g. "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
