import { projectWorld, type GameEvent } from '@/game/project';
import fixture from '@/game/__tests__/fixtures/server-game.json';

import { mapMarkers } from '../markers';

describe('mapMarkers', () => {
  const view = projectWorld(fixture.events as GameEvent[]);
  const race = view.races[0];
  const gods = [{ id: race.godId!, color: '#E3B05B' }];

  it("marks each race's homeland and each city in the race creator's color", () => {
    const width = fixture.map.width;
    expect(mapMarkers(view, gods)).toEqual([
      { index: 4 * width + 4, kind: 'race', color: '#E3B05B', label: 'Dwarves' },
      { index: 4 * width + 6, kind: 'race', color: '#E3B05B', label: 'Deep Dwarves' },
      { index: 4 * width + 5, kind: 'city', color: '#E3B05B', label: 'Karak' },
    ]);
  });

  it('uses a neutral color when the god is unknown, and nothing without a map', () => {
    expect(mapMarkers(view, []).every((m) => m.color === '#6B7280')).toBe(true);
    expect(mapMarkers({ ...view, map: null }, gods)).toEqual([]);
  });
});
