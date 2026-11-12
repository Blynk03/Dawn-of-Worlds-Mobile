// DOW-36: the History Chart. Every action becomes a row; rows can be filtered by age, god or a
// race/city. Pure functions over the projected game (no React).
import type { ActionRecord, GameView } from '@/game/project';
import { alignmentLabel, regionAlignmentName } from '@/game/civilization';
import { climateInfo, terrainInfo } from '@/map/terrain';

export const POWER_NAMES: Record<string, string> = {
  shapeLand: 'Shape Land',
  shapeClimate: 'Shape Climate',
  createRace: 'Create Race',
  createSubrace: 'Create Subrace',
  commandRace: 'Command Race',
  advanceCivilization: 'Advance Civilization',
  advanceCity: 'Advance City',
  purifyCivilization: 'Purify Civilization',
  corruptCivilization: 'Corrupt Civilization',
  purifyCity: 'Purify City',
  corruptCity: 'Corrupt City',
  purifyRegion: 'Purify Region',
  corruptRegion: 'Corrupt Region',
  createOrder: 'Create Order',
  commandOrder: 'Command Order',
  commandCity: 'Command City',
  createAvatar: 'Create Avatar',
  commandAvatar: 'Command Avatar',
  resurrectAvatar: 'Resurrect Avatar',
};

/** DOW-48: "Karak builds The Iron Wall", "Karak raises the Host of Karak". */
function cityDeed(action: ActionRecord, verbs: [string, string] = ['raises', 'builds']): string {
  const city = action.target?.name ?? 'a city';
  return `${city} ${action.intent === 'raiseArmy' ? verbs[0] : verbs[1]} ${action.choice}`;
}

/** DOW-55: "Host of Karak took Underhold", "Host of Karak fell attacking Karak". */
function attackDeed(action: ActionRecord): string {
  const battle = action.battle;
  if (!battle) return `attacked ${action.choice}`;
  if (battle.outcome === 'lost') return `${battle.armyName} fell attacking ${action.choice}`;
  if (action.target?.kind === 'city') {
    const fate = battle.cityOutcome === 'destroyed' ? 'razed' : 'took';
    return `${battle.armyName} ${fate} ${action.choice}`;
  }
  const destroyed = battle.destructionCost > 0 ? 'destroyed' : 'scattered';
  return `${battle.armyName} ${destroyed} ${action.choice}`;
}

/** What an avatar did when commanded (DOW-45). */
function avatarDeed(action: ActionRecord, name: string): string {
  const now =
    action.alignmentAfter !== null ? `, now ${alignmentLabel(action.alignmentAfter)}` : '';
  switch (action.intent) {
    case 'foundCity':
      return `${name} founds ${action.choice}`;
    case 'createOrder':
      return `${name} creates the order ${action.choice}`;
    case 'commandOrder':
      return `${name} commands ${action.choice}`;
    case 'purifyCity':
      return `${name} purifies ${action.choice}${now}`;
    case 'corruptCity':
      return `${name} corrupts ${action.choice}${now}`;
    case 'createRace':
      return `${name} creates the ${action.choice}`;
    case 'build':
    case 'raiseArmy':
      return `${name} bids ${cityDeed(action, ['raise', 'build'])}`;
    default:
      return `${name}, a mortal deed`;
  }
}

/**
 * e.g. { power: 'Shape Land', what: 'Hills' }, { power: 'Command Race', what: 'founded Karak' },
 * { power: 'Advance City', what: 'Karak, the greatest at Writing' },
 * { power: 'Purify City', what: 'Karak, now Noble (+2)' }.
 */
export function describeAction(action: ActionRecord): { power: string; what: string } {
  const power = POWER_NAMES[action.power] ?? action.power;
  let what = action.choice;
  if (action.power === 'shapeLand') what = terrainInfo(action.choice).name;
  else if (action.power === 'shapeClimate') what = climateInfo(action.choice).name;
  else if (action.power === 'commandAvatar' && action.avatar) {
    what = avatarDeed(action, action.avatar.name);
  } else if (action.intent === 'foundCity') what = `founded ${action.choice}`;
  else if (action.power === 'commandCity') what = cityDeed(action);
  else if (action.intent === 'march') {
    const [x, y] = action.hexes[0] ?? [0, 0];
    what = `${action.choice} marched to (${x}, ${y})`;
  } else if (action.intent === 'attack') what = attackDeed(action);
  else if (action.power === 'resurrectAvatar') what = `${action.choice} returns`;
  else if (action.power.startsWith('advance') && action.target) {
    what = `${action.target.name}, the greatest at ${action.choice}`;
  } else if (/^(purify|corrupt)/.test(action.power) && action.alignmentAfter !== null) {
    const after = action.alignmentAfter;
    const now =
      action.target?.kind === 'region'
        ? (regionAlignmentName(after) ?? 'restored to neutral')
        : alignmentLabel(after);
    what = `${action.choice}, now ${now}`;
  }
  return { power, what };
}

export type EntityRef = { id: string; kind: 'race' | 'city'; name: string };

/** The races and cities an action created or involved (a city's race counts too). */
export function actionEntities(view: GameView, action: ActionRecord): EntityRef[] {
  const out: EntityRef[] = [];
  const add = (ref: EntityRef) => {
    if (!out.some((e) => e.id === ref.id)) out.push(ref);
  };
  const raceRef = (id: string | null) => {
    const race = view.races.find((r) => r.id === id);
    if (race) add({ id: race.id, kind: 'race', name: race.name });
  };
  for (const race of view.races) {
    if (race.createdSeq === action.seq) {
      raceRef(race.parentId); // a subrace's ancestors
      add({ id: race.id, kind: 'race', name: race.name });
    }
  }
  // Advance, Purify, Corrupt: the race or city they were aimed at.
  if (action.target?.kind === 'race') raceRef(action.target.id);
  if (action.target?.kind === 'order') {
    raceRef(view.orders.find((o) => o.id === action.target!.id)?.raceId ?? null);
  }
  // Orders and avatars: the race they belong to.
  for (const order of view.orders) {
    if (order.createdSeq === action.seq) raceRef(order.raceId);
  }
  const avatar = view.avatars.find((a) => a.id === action.avatar?.id);
  if (avatar) raceRef(avatar.raceId);
  // Armies count as their city: the one marching or attacking, the one attacked, a new one.
  const armyCity = (armyId: string | null | undefined) => {
    const army = view.armies.find((a) => a.id === armyId);
    const city = view.cities.find((c) => c.id === army?.cityId);
    if (city) {
      raceRef(city.raceId);
      add({ id: city.id, kind: 'city', name: city.name });
    }
  };
  armyCity(action.battle?.armyId);
  if (action.target?.kind === 'army') armyCity(action.target.id);
  for (const army of view.armies) if (army.createdSeq === action.seq) armyCity(army.id);
  if (action.target?.kind === 'city') {
    const city = view.cities.find((c) => c.id === action.target!.id);
    if (city) {
      raceRef(city.raceId);
      add({ id: city.id, kind: 'city', name: city.name });
    }
  }
  for (const city of view.cities) {
    if (city.createdSeq !== action.seq) continue;
    raceRef(city.raceId);
    add({ id: city.id, kind: 'city', name: city.name });
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
