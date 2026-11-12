import { neighbors } from '@/map/hex';
import { terrainInfo } from '@/map/terrain';

import {
  advancementsOf,
  alignmentChangedThisTurn,
  alignmentLabel,
  alignmentName,
  entityName,
  greatestAt,
  regionAlignmentName,
  subraceCandidates,
} from '../civilization';
import { type GameEvent, projectWorld } from '../project';
import fixture from './fixtures/server-game.json';

// A real server-played game: the Dwarves on (4,4), Karak on (5,4), the Deep Dwarves on (6,4),
// the Dwarves greatest at Steel, Karak purified and the region at (2,2) corrupted.
const events = fixture.events as GameEvent[];
const view = projectWorld(events);
const [dwarves, deep] = view.races;
const karak = view.cities[0];
const width = fixture.map.width;
const at = (i: number) => [i % width, Math.floor(i / width)];

describe('subraceCandidates (DOW-43)', () => {
  const sites = (parent: string) =>
    subraceCandidates(
      view,
      parent,
      (t) => terrainInfo(t).water,
      (h) => neighbors(h, width, fixture.map.height),
    ).map(at);

  it("offers land next to the parent race's homeland and cities, never a settled hex", () => {
    const s = sites(dwarves.id);
    expect(s).toContainEqual([3, 4]); // next to the homeland
    expect(s).toContainEqual([5, 5]); // next to Karak
    expect(s).not.toContainEqual([4, 4]); // the homeland itself
    expect(s).not.toContainEqual([5, 4]); // Karak
    expect(s).not.toContainEqual([6, 4]); // the Deep Dwarves
    expect(s).not.toContainEqual([8, 4]); // too far
  });

  it('works for subraces of subraces, and nothing for unknown races', () => {
    expect(sites(deep.id)).toContainEqual([7, 4]);
    expect(sites('nope')).toEqual([]);
  });
});

describe('alignmentChangedThisTurn (DOW-40)', () => {
  const purify = view.actions.find((a) => a.power === 'purifyCity')!;

  it('lists what a god purified or corrupted in the current round', () => {
    expect(view.round).toBe(purify.round); // the fixture's changes happened this round
    expect([...alignmentChangedThisTurn(view, purify.godId!)].sort()).toEqual(
      [karak.id, '2,2'].sort(),
    );
  });

  it('is per god, and starts afresh next round', () => {
    expect(alignmentChangedThisTurn(view, 'someone-else').size).toBe(0);
    expect(alignmentChangedThisTurn({ ...view, round: view.round + 1 }, purify.godId!).size).toBe(
      0,
    );
  });
});

describe('alignment names (DOW-46)', () => {
  it.each([
    [7, 'Saintly'],
    [4, 'Saintly'],
    [3, 'Virtuous'],
    [2, 'Noble'],
    [1, 'Good'],
    [0, 'Neutral'],
    [-1, 'Evil'],
    [-2, 'Wicked'],
    [-3, 'Corrupt'],
    [-4, 'Vile'],
    [-9, 'Vile'],
  ])('%i is %s', (n, name) => {
    expect(alignmentName(n)).toBe(name);
  });

  it('labels with the number', () => {
    expect(alignmentLabel(2)).toBe('Noble (+2)');
    expect(alignmentLabel(0)).toBe('Neutral (0)');
    expect(alignmentLabel(-5)).toBe('Vile (-5)');
  });

  it('names regions only once they have changed', () => {
    expect([2, 1, 0, -1, -3].map(regionAlignmentName)).toEqual([
      'Hallowed',
      'Blessed',
      null,
      'Blighted',
      'Cursed',
    ]);
  });
});

describe('advancements (DOW-47)', () => {
  it('knows who is the greatest at what, ignoring case and spaces', () => {
    expect(greatestAt(view, '  steel ')?.entityId).toBe(dwarves.id);
    expect(greatestAt(view, 'Writing')).toBeNull();
    expect(advancementsOf(view, dwarves.id).map((a) => a.field)).toEqual(['Steel']);
    expect(advancementsOf(view, karak.id)).toEqual([]);
  });

  it('names races and cities', () => {
    expect(entityName(view, dwarves.id)).toBe('Dwarves');
    expect(entityName(view, karak.id)).toBe('Karak');
    expect(entityName(view, 'nope')).toBeNull();
    expect(entityName(view, null)).toBeNull();
  });
});
