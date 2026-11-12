// DOW-48/54/55: rules helpers for cities, armies and battles. Pure functions over the projected
// game, mirroring the server so the app only offers what it will accept.
import type { ArmyView, GameView, StructureView } from './project';

/** Every active army that would defend a city: raised there, or standing on it. */
export function defendersOf(view: GameView, cityId: string, attackerId?: string): ArmyView[] {
  const city = view.cities.find((c) => c.id === cityId);
  if (!city) return [];
  return view.armies.filter(
    (a) =>
      a.status === 'active' &&
      a.id !== attackerId &&
      (a.cityId === cityId || (a.hex.x === city.hex.x && a.hex.y === city.hex.y)),
  );
}

/** How many armies a god has raised from a city this turn (one allowed, two with an avatar). */
export function armiesRaisedThisTurn(view: GameView, godId: string, cityId: string): number {
  return view.actions.filter(
    (a) =>
      a.godId === godId &&
      a.age === view.age &&
      a.round === view.round &&
      a.intent === 'raiseArmy' &&
      a.target?.id === cityId,
  ).length;
}

export function structuresOf(view: GameView, cityId: string): StructureView[] {
  return view.structures.filter((s) => s.cityId === cityId);
}

/** Generic +1s any side might claim (rules, section IV). */
export const FIELD_MODIFIERS = ['Higher ground', 'Favorable terrain', 'Favorable weather'] as const;

/**
 * DOW-54: the +1s to suggest for each side. The rules: "For each such technology that might be
 * used in battle ... assign a +1 bonus to that army. The same applies for an army that enjoys
 * higher ground, a defensive wall, or specialized terrain or weather." Players choose which
 * apply ("be reasonable here").
 */
export function battleSuggestions(
  view: GameView,
  army: ArmyView,
  target: { kind: 'army' | 'city'; id: string },
): { attacker: string[]; defender: string[] } {
  const fieldsOf = (raceId: string | null, cityId: string | null) =>
    view.advancements
      .filter((a) => a.entityId === raceId || a.entityId === cityId)
      .map((a) => a.field);
  const ledBy = (hex: { x: number; y: number }) =>
    view.avatars
      .filter((a) => a.status === 'active' && a.hex.x === hex.x && a.hex.y === hex.y)
      .map((a) => `Led by ${a.name}`);

  const attacker = [...fieldsOf(army.raceId, army.cityId), ...ledBy(army.hex)];
  let defender: string[] = [];
  if (target.kind === 'army') {
    const other = view.armies.find((a) => a.id === target.id);
    if (other) defender = [...fieldsOf(other.raceId, other.cityId), ...ledBy(other.hex)];
  } else {
    const city = view.cities.find((c) => c.id === target.id);
    if (city) {
      const walls = structuresOf(view, city.id)
        .filter((s) => s.structureType === 'wall')
        .map((s) => s.name);
      defender = [...fieldsOf(city.raceId, city.id), ...walls, ...ledBy(city.hex)];
    }
  }
  const unique = (xs: string[]) => [...new Set([...xs, ...FIELD_MODIFIERS])];
  return { attacker: unique(attacker), defender: unique(defender) };
}
