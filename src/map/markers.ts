import type { GameView } from '@/game/project';

/** Something settled on a hex: a race's homeland or a city. */
export type MapMarker = {
  index: number;
  kind: 'race' | 'city' | 'avatar' | 'army';
  /** The color of the god who created the race (cities share their race's color). */
  color: string;
  label: string;
  /** DOW-41: a city taken in battle, shown grey. */
  ruined?: boolean;
};

const RUINS_COLOR = '#9CA3AF';

const FALLBACK_COLOR = '#6B7280';

/**
 * DOW-34/35/45/48: the map markers for every race homeland, avatar, army and city, in their
 * creators' colors. Ruined cities are grey; destroyed cities and armies, scattered armies vanish.
 */
export function mapMarkers(
  view: GameView,
  gods: readonly { id: string; color: string }[],
): MapMarker[] {
  const map = view.map;
  if (!map) return [];
  const colorOf = (godId: string | null) =>
    gods.find((g) => g.id === godId)?.color ?? FALLBACK_COLOR;
  const raceColor = new Map(view.races.map((r) => [r.id, colorOf(r.godId)]));
  const index = (h: { x: number; y: number }) => h.y * map.width + h.x;
  return [
    ...view.races.map((r): MapMarker => ({
      index: index(r.hex),
      kind: 'race',
      color: colorOf(r.godId),
      label: r.name,
    })),
    // DOW-45: avatars still walking the world.
    ...view.avatars
      .filter((a) => a.status === 'active')
      .map((a): MapMarker => ({
        index: index(a.hex),
        kind: 'avatar',
        color: colorOf(a.godId),
        label: a.name,
      })),
    ...view.armies
      .filter((a) => a.status === 'active')
      .map((a): MapMarker => ({
        index: index(a.hex),
        kind: 'army',
        color: raceColor.get(a.raceId) ?? FALLBACK_COLOR,
        label: a.name,
      })),
    ...view.cities
      .filter((c) => c.status !== 'destroyed')
      .map((c): MapMarker => {
        const ruined = c.status === 'ruined';
        return {
          index: index(c.hex),
          kind: 'city',
          color: ruined ? RUINS_COLOR : (raceColor.get(c.raceId) ?? FALLBACK_COLOR),
          label: ruined ? `${c.name} (ruins)` : c.name,
          ...(ruined ? { ruined } : {}),
        };
      }),
  ];
}
