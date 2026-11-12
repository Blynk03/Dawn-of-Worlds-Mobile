import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, projectWorld } from '@/game/project';

import {
  actionEntities,
  describeAction,
  filterableEntities,
  historyRows,
  timeAgo,
} from '../history';

// A real server-played game: Shape Land and Shape Climate in rounds 1–2, then the Dwarves are
// created and found the city of Karak.
const events = fixture.events as GameEvent[];
const view = projectWorld(events);
const byPower = (power: string) => view.actions.find((a) => a.power === power)!;
const dwarves = view.races[0];
const karak = view.cities[0];

describe('History Chart (DOW-36)', () => {
  it('has a row for every action, oldest first, with age, round, year, god and time', () => {
    const rows = historyRows(view);
    const logged = events.filter((e) => e.type === 'action_taken');
    expect(rows.map((r) => r.seq)).toEqual(logged.map((e) => e.seq));
    for (const [i, row] of rows.entries()) {
      expect(row).toMatchObject({
        age: logged[i].age,
        round: logged[i].round,
        godId: logged[i].god_id,
        at: logged[i].created_at,
      });
    }
    // The year is the year its round started in.
    const yearOfRound = (round: number) =>
      (
        events.find((e) => e.type === 'round_started' && e.round === round)!.payload as {
          year: number;
        }
      ).year;
    expect(rows.map((r) => r.year)).toEqual(rows.map((r) => yearOfRound(r.round)));
  });

  it('describes each kind of action', () => {
    expect(describeAction(byPower('shapeLand'))).toEqual({
      power: 'Shape Land',
      what: expect.any(String),
    });
    expect(describeAction(byPower('createRace'))).toEqual({
      power: 'Create Race',
      what: 'Dwarves',
    });
    expect(describeAction(byPower('commandRace'))).toEqual({
      power: 'Command Race',
      what: 'founded Karak',
    });
    expect(describeAction({ ...byPower('shapeLand'), power: 'mystery', choice: 'x' })).toEqual({
      power: 'mystery',
      what: 'x',
    });
  });

  it('describes the civilization powers (DOW-43/46/47)', () => {
    expect(describeAction(byPower('createSubrace'))).toEqual({
      power: 'Create Subrace',
      what: 'Deep Dwarves',
    });
    expect(describeAction(byPower('advanceCivilization'))).toEqual({
      power: 'Advance Civilization',
      what: 'Dwarves, the greatest at Steel',
    });
    expect(describeAction(byPower('purifyCity'))).toEqual({
      power: 'Purify City',
      what: 'Karak, now Noble (+2)',
    });
    expect(describeAction(byPower('corruptRegion'))).toEqual({
      power: 'Corrupt Region',
      what: 'the region at 2, 2, now Blighted',
    });
    expect(describeAction({ ...byPower('corruptRegion'), alignmentAfter: 0 }).what).toBe(
      'the region at 2, 2, now restored to neutral',
    );
  });

  it('knows which races and cities an action involves', () => {
    expect(actionEntities(view, byPower('shapeLand'))).toEqual([]);
    expect(actionEntities(view, byPower('createRace'))).toEqual([
      { id: dwarves.id, kind: 'race', name: 'Dwarves' },
    ]);
    expect(actionEntities(view, byPower('commandRace'))).toEqual([
      { id: dwarves.id, kind: 'race', name: 'Dwarves' },
      { id: karak.id, kind: 'city', name: 'Karak' },
    ]);
    const deep = view.races[1];
    expect(actionEntities(view, byPower('createSubrace'))).toEqual([
      { id: dwarves.id, kind: 'race', name: 'Dwarves' },
      { id: deep.id, kind: 'race', name: 'Deep Dwarves' },
    ]);
    expect(actionEntities(view, byPower('advanceCivilization'))).toEqual([
      { id: dwarves.id, kind: 'race', name: 'Dwarves' },
    ]);
    expect(actionEntities(view, byPower('purifyCity'))).toEqual([
      { id: dwarves.id, kind: 'race', name: 'Dwarves' },
      { id: karak.id, kind: 'city', name: 'Karak' },
    ]);
    expect(actionEntities(view, byPower('corruptRegion'))).toEqual([]);
  });

  it('filters by age, god and race or city', () => {
    const all = historyRows(view);
    expect(historyRows(view, { age: 1 })).toEqual(all);
    expect(historyRows(view, { age: 2 })).toEqual([]);
    const godId = dwarves.godId!;
    expect(historyRows(view, { godId }).every((r) => r.godId === godId)).toBe(true);
    expect(historyRows(view, { godId }).length).toBeGreaterThan(0);
    // A race's history includes its cities and subraces.
    expect(historyRows(view, { entityId: dwarves.id }).map((r) => r.power)).toEqual([
      'createRace',
      'commandRace',
      'createSubrace',
      'advanceCivilization',
      'purifyCity',
    ]);
    expect(historyRows(view, { entityId: karak.id }).map((r) => r.power)).toEqual([
      'commandRace',
      'purifyCity',
    ]);
    expect(historyRows(view, { entityId: dwarves.id, godId: 'nobody' })).toEqual([]);
  });

  it('lists races, each followed by its cities, for the filter', () => {
    expect(filterableEntities(view)).toEqual([
      { id: dwarves.id, kind: 'race', name: 'Dwarves' },
      { id: karak.id, kind: 'city', name: 'Karak' },
      { id: view.races[1].id, kind: 'race', name: 'Deep Dwarves' },
    ]);
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it.each([
    ['2026-11-10T11:59:40Z', 'just now'],
    ['2026-11-10T11:55:00Z', '5m ago'],
    ['2026-11-10T09:00:00Z', '3h ago'],
    ['2026-11-08T12:00:00Z', '2d ago'],
    ['nonsense', ''],
  ])('%s → %s', (iso, text) => {
    expect(timeAgo(iso, now)).toBe(text);
  });

  it('shows a date after a week', () => {
    expect(timeAgo('2026-10-01T12:00:00Z', now)).toMatch(/Oct|10/);
  });
});
