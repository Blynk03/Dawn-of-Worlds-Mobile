import { projectWorld, type GameEvent } from '@/game/project';
import fixture from '@/game/__tests__/fixtures/server-game.json';

import { catastropheScars, mapMarkers } from '../markers';

describe('mapMarkers', () => {
  const view = projectWorld(fixture.events as GameEvent[]);
  const race = view.races[0];
  const gods = [{ id: race.godId!, color: '#E3B05B' }];

  it("marks each race's homeland and each city in the race creator's color", () => {
    const width = fixture.map.width;
    expect(mapMarkers(view, gods)).toEqual([
      { index: 4 * width + 4, kind: 'race', color: '#E3B05B', label: 'Dwarves' },
      { index: 4 * width + 6, kind: 'race', color: '#E3B05B', label: 'Deep Dwarves' },
      { index: 4 * width + 4, kind: 'avatar', color: '#E3B05B', label: 'Durin' },
      { index: 4 * width + 7, kind: 'army', color: '#E3B05B', label: 'Host of Karak' },
      { index: 4 * width + 5, kind: 'city', color: '#E3B05B', label: 'Karak' },
      // DOW-41: the Host of Karak took Underhold.
      {
        index: 4 * width + 7,
        kind: 'city',
        color: '#9CA3AF',
        label: 'Underhold (ruins)',
        ruined: true,
      },
    ]);
  });

  it('leaves scattered armies and destroyed cities off the map', () => {
    const after = {
      ...view,
      armies: view.armies.map((a) => ({ ...a, status: 'scattered' as const })),
      cities: view.cities.map((c) => ({ ...c, status: 'destroyed' as const })),
    };
    expect(mapMarkers(after, gods).map((m) => m.kind)).toEqual(['race', 'race', 'avatar']);
  });

  it('leaves slain avatars off the map', () => {
    const slain = {
      ...view,
      avatars: view.avatars.map((a) => ({ ...a, status: 'destroyed' as const })),
    };
    expect(mapMarkers(slain, gods).some((m) => m.kind === 'avatar')).toBe(false);
  });

  it('uses a neutral color when the god is unknown, and nothing without a map', () => {
    const live = mapMarkers(view, []).filter((m) => !m.ruined);
    expect(live.every((m) => m.color === '#6B7280')).toBe(true);
    expect(mapMarkers({ ...view, map: null }, gods)).toEqual([]);
  });
});

describe('catastropheScars (DOW-50)', () => {
  const view = projectWorld(fixture.events as GameEvent[]);
  const quake = {
    ...view.actions[0],
    power: 'catastrophe',
    age: view.age,
    round: view.round,
    hexes: [
      [1, 2],
      [3, 0],
    ] as [number, number][],
    retconned: false,
  };
  const width = view.map!.width;

  it('marks the hexes a catastrophe struck this round', () => {
    expect([...catastropheScars({ ...view, actions: [...view.actions, quake] })]).toEqual([
      2 * width + 1,
      3,
    ]);
  });

  it('fades with the round, and ignores undone catastrophes', () => {
    expect(catastropheScars({ ...view, actions: [quake], round: view.round + 1 }).size).toBe(0);
    expect(catastropheScars({ ...view, actions: [{ ...quake, retconned: true }] }).size).toBe(0);
    expect(catastropheScars(view).size).toBe(0);
  });
});
