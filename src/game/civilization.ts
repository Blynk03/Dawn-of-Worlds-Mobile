// DOW-43/46/47: rules helpers for subraces, alignment and advancements. Pure functions over the
// projected game; they mirror the server's checks so the app only offers moves it will accept.
import type { AdvancementView, GameView } from './project';

type Hex = { x: number; y: number };

/**
 * DOW-43: hexes where a subrace of `parentId` can start: next to the parent race's land (its
 * homeland and cities), on land, and not already someone's homeland or a city.
 */
export function subraceCandidates(
  view: GameView,
  parentId: string,
  isWater: (terrain: string) => boolean,
  neighborsOf: (hex: Hex) => Hex[],
): number[] {
  const map = view.map;
  const parent = view.races.find((r) => r.id === parentId);
  if (!map || !parent) return [];
  const key = (h: Hex) => h.y * map.width + h.x;
  const land = [parent.hex, ...view.cities.filter((c) => c.raceId === parentId).map((c) => c.hex)];
  const settled = new Set([
    ...view.races.map((r) => key(r.hex)),
    ...view.cities.map((c) => key(c.hex)),
  ]);
  const out = new Set<number>();
  for (const h of land.flatMap(neighborsOf)) {
    const k = key(h);
    if (!settled.has(k) && !isWater(map.terrain[k] ?? '')) out.add(k);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * DOW-40 (Table of Powers footnote *): what a god has already purified or corrupted this turn,
 * as target keys (an entity id, or "x,y" for a region).
 */
export function alignmentChangedThisTurn(view: GameView, godId: string): Set<string> {
  return new Set(
    view.actions
      .filter(
        (a) =>
          a.godId === godId &&
          a.age === view.age &&
          a.round === view.round &&
          /^(purify|corrupt)/.test(a.power) &&
          a.target,
      )
      .map((a) => a.target!.key),
  );
}

const ALIGNMENT_NAMES: [number, string][] = [
  [4, 'Saintly'],
  [3, 'Virtuous'],
  [2, 'Noble'],
  [1, 'Good'],
  [0, 'Neutral'],
  [-1, 'Evil'],
  [-2, 'Wicked'],
  [-3, 'Corrupt'],
  [-4, 'Vile'],
];

/** DOW-46: a civilization's or city's alignment on the Saintly … Neutral … Vile scale. */
export function alignmentName(n: number): string {
  if (n >= 4) return 'Saintly';
  if (n <= -4) return 'Vile';
  return ALIGNMENT_NAMES.find(([v]) => v === n)?.[1] ?? 'Neutral';
}

/** e.g. "Noble (+2)", "Neutral (0)", "Vile (-5)". */
export function alignmentLabel(n: number): string {
  return `${alignmentName(n)} (${n > 0 ? `+${n}` : n})`;
}

/** A region's alignment: "Hallowed", "Blessed", "Blighted", "Cursed", or null when untouched. */
export function regionAlignmentName(n: number): string | null {
  if (n >= 2) return 'Hallowed';
  if (n === 1) return 'Blessed';
  if (n === -1) return 'Blighted';
  if (n <= -2) return 'Cursed';
  return null;
}

/** DOW-47: the fields the rules suggest. Anything else can be typed in. */
export const ADVANCEMENT_SUGGESTIONS = [
  'War magic',
  'Healing',
  'Warfare',
  'Steel',
  'Weaponsmithing',
  'Sailing',
  'Writing',
  'Engineering',
  'Architecture',
  'Farming',
] as const;

/** Who is the greatest in the world at a field (case-insensitive), if anyone. */
export function greatestAt(view: GameView, field: string): AdvancementView | null {
  const wanted = field.trim().toLowerCase();
  return view.advancements.find((a) => a.field.trim().toLowerCase() === wanted) ?? null;
}

/** The fields a race or city is the greatest in the world at. */
export function advancementsOf(view: GameView, entityId: string): AdvancementView[] {
  return view.advancements.filter((a) => a.entityId === entityId);
}

/** The name of a race or city by id. */
export function entityName(view: GameView, id: string | null | undefined): string | null {
  if (!id) return null;
  return (
    view.races.find((r) => r.id === id)?.name ?? view.cities.find((c) => c.id === id)?.name ?? null
  );
}
