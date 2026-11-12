import { neighbors } from '@/map/hex';
import { terrainInfo } from '@/map/terrain';

import {
  ageName,
  applyEvent,
  cityCandidates,
  describeDeadline,
  EMPTY_GAME,
  type GameEvent,
  hexChanges,
  projectWorld,
  settlementsAt,
} from '../project';
import fixture from './fixtures/server-game.json';

// A short game played by the real database functions (scripts/game-fixture.sql): a 10×8 starting
// landmass; round 1 with Shape Land (3 hexes) and Shape Climate, then an end, a pass and a low-pool
// end; round 2 with Shape Land over an earlier hex, the Dwarves created on (4,4), the city of Karak
// founded on (5,4), an end and a timeout.
const events = fixture.events as GameEvent[];
const server = fixture.state;

describe('projectWorld against a game played by the server', () => {
  const view = projectWorld(events);

  it('matches the server: round, age, year and turn order', () => {
    expect(view.started).toBe(true);
    expect(view.round).toBe(server.round);
    expect(view.age).toBe(server.age);
    expect(view.year).toBe(server.year);
    expect(view.turnOrder).toEqual(server.turn_order);
  });

  it('matches the server: whose turn it is and the deadline', () => {
    expect(view.activeGodId).toBe(server.turn_order[server.active_position - 1]);
    expect(view.turnDeadline).toBe(server.turn_deadline);
  });

  it("matches the server: every god's power and low-pool bonus", () => {
    expect(view.powers).toEqual(fixture.powers);
  });

  it("matches the server's map exactly, terrain and climate", () => {
    expect(view.map).toEqual(fixture.map);
  });

  it('records every action, with its cost', () => {
    expect(view.actions.map((a) => [a.power, a.choice, a.cost])).toEqual([
      ['shapeLand', 'mountains', 9],
      ['shapeClimate', 'snow', 2],
      ['shapeLand', 'forest', 6],
      ['createRace', 'Dwarves', 22],
      ['commandRace', 'Karak', 8],
      ['createSubrace', 'Deep Dwarves', 12],
      ['advanceCivilization', 'Steel', 10],
      ['purifyCity', 'Karak', 4],
      ['corruptRegion', 'the region at 2, 2', 3],
      ['createOrder', 'Hammers of the Deep', 8],
      ['commandOrder', 'Hammers of the Deep', 4],
      ['createAvatar', 'Durin', 10],
      ['commandAvatar', 'Durin', 2],
    ]);
  });

  it("matches the server's orders, with their kind, purpose and creator (DOW-44)", () => {
    expect(
      view.orders.map((o) => ({
        id: o.id,
        name: o.name,
        race_id: o.raceId,
        god_id: o.godId,
        order_type: o.orderType,
        purpose: o.purpose,
        status: o.status,
      })),
    ).toEqual(
      fixture.entities
        .filter((e) => e.kind === 'order')
        .map((e) => ({
          id: e.id,
          name: e.name,
          race_id: e.race_id,
          god_id: e.god_id,
          order_type: e.order_type,
          purpose: e.purpose,
          status: e.status,
        })),
    );
  });

  it("matches the server's avatars and knows which avatar acted (DOW-45)", () => {
    expect(
      view.avatars.map((a) => [a.id, a.name, a.avatarType, a.raceId, a.hex.x, a.hex.y, a.status]),
    ).toEqual(
      fixture.entities
        .filter((e) => e.kind === 'avatar')
        .map((e) => [e.id, e.name, e.avatar_type, e.race_id, e.hex_x, e.hex_y, e.status]),
    );
    const deed = byPower('commandAvatar');
    expect(deed).toMatchObject({
      intent: 'deed',
      avatar: { id: view.avatars[0].id, name: 'Durin' },
      description: 'Durin slays the wyrm of the north',
    });
    expect(byPower('createAvatar').avatar).toEqual({ id: view.avatars[0].id, name: 'Durin' });
  });

  it('brings a slain avatar back when it is resurrected', () => {
    const durin = view.avatars[0];
    const slain = { ...view, avatars: [{ ...durin, status: 'destroyed' as const }] };
    const last = events[events.length - 1];
    const back = applyEvent(slain, {
      ...last,
      seq: last.seq + 1,
      type: 'action_taken',
      god_id: durin.godId,
      payload: {
        power: 'resurrectAvatar',
        cost: 5,
        hexes: [[4, 4]],
        choice: 'Durin',
        description: 'He returns',
        power_after: 1,
        target: { kind: 'avatar', id: durin.id, key: durin.id, name: 'Durin' },
        avatar: { id: durin.id, name: 'Durin', status: 'active' },
      },
    });
    expect(back.avatars[0].status).toBe('active');
  });

  const byPower = (power: string) => view.actions.find((a) => a.power === power)!;

  it('knows subraces and their lineage (DOW-43)', () => {
    const [dwarves, deep] = view.races;
    expect(deep).toMatchObject({
      name: 'Deep Dwarves',
      parentId: dwarves.id,
      alignment: -1,
      hex: { x: 6, y: 4 },
      appearance: 'Pale and silent',
    });
    expect(dwarves.parentId).toBeNull();
    expect(
      fixture.entities.filter((e) => e.parent_race_id).map((e) => [e.name, e.parent_race_id]),
    ).toEqual([['Deep Dwarves', dwarves.id]]);
    // The subrace's creator gets a sect, like a race's.
    expect(view.orders.filter((o) => o.raceId === deep.id)).toHaveLength(1);
  });

  it('knows who is the greatest in the world at what (DOW-47)', () => {
    expect(
      view.advancements.map((a) => ({ entity_id: a.entityId, field: a.field, god_id: a.godId })),
    ).toEqual(fixture.advancements);
    expect(byPower('advanceCivilization').target).toMatchObject({ kind: 'race', name: 'Dwarves' });
  });

  it('follows alignment changes to cities and regions (DOW-46)', () => {
    const fromServer = (name: string) => fixture.entities.find((e) => e.name === name)!.alignment;
    expect(view.cities[0].alignment).toBe(fromServer('Karak'));
    expect(view.races.map((r) => r.alignment)).toEqual(view.races.map((r) => fromServer(r.name)));
    expect(view.map!.alignment).toEqual(fixture.map.alignment);
    expect(view.map!.alignment![2 * fixture.map.width + 2]).toBe(-1);
    expect(byPower('corruptRegion').target).toEqual({
      kind: 'region',
      id: null,
      key: '2,2',
      name: 'the region at 2, 2',
    });
  });

  it("matches the server's races, sects and cities (DOW-34/35)", () => {
    const byKind = (kind: string) => fixture.entities.filter((e) => e.kind === kind);
    expect(
      view.races.map((r) => ({
        id: r.id,
        name: r.name,
        god_id: r.godId,
        alignment: r.alignment,
        hex: [r.hex.x, r.hex.y],
      })),
    ).toEqual(
      byKind('race').map((e) => ({
        id: e.id,
        name: e.name,
        god_id: e.god_id,
        alignment: e.alignment,
        hex: [e.hex_x, e.hex_y],
      })),
    );
    expect(view.orders.map((o) => [o.id, o.name, o.raceId, o.godId])).toEqual(
      byKind('order').map((e) => [e.id, e.name, e.race_id, e.god_id]),
    );
    expect(view.cities.map((c) => [c.id, c.name, c.raceId, c.alignment, c.hex.x, c.hex.y])).toEqual(
      byKind('city').map((e) => [e.id, e.name, e.race_id, e.alignment, e.hex_x, e.hex_y]),
    );
    expect(view.races[0]).toMatchObject({
      description: 'Stout folk of the deep halls',
      appearance: 'Short and bearded',
    });
    expect(view.cities[0].description).toBe('A hall is carved into the hill');
  });

  it('finds what is settled on a hex', () => {
    expect(settlementsAt(view, { x: 4, y: 4 }).race?.name).toBe('Dwarves');
    expect(settlementsAt(view, { x: 5, y: 4 }).city?.name).toBe('Karak');
    expect(settlementsAt(view, { x: 1, y: 1 })).toEqual({ race: null, city: null });
  });

  it("offers city sites the server accepts: on or next to the race's land, on dry land", () => {
    const width = fixture.map.width;
    const sites = cityCandidates(
      view,
      view.races[0].id,
      (t) => terrainInfo(t).water,
      (h) => neighbors(h, width, fixture.map.height),
    ).map((i) => [i % width, Math.floor(i / width)]);
    // Homeland (4,4) is offered; Karak's hex (5,4) is not; nor is (6,4), the Deep Dwarves' home.
    expect(sites).toContainEqual([4, 4]);
    expect(sites).not.toContainEqual([5, 4]);
    expect(sites).not.toContainEqual([6, 4]); // the Deep Dwarves' homeland
    expect(sites).toContainEqual([5, 5]); // next to Karak
    expect(sites).toContainEqual([3, 5]); // even-row neighbor of the homeland
    expect(sites).not.toContainEqual([5, 6]); // two hexes away
    expect(
      cityCandidates(
        view,
        'nope',
        () => false,
        () => [],
      ),
    ).toEqual([]);
  });

  it("keeps each hex's history (DOW-33)", () => {
    const width = fixture.map.width;
    const reshaped = hexChanges(view, 2 * width + 2); // [2,2]: mountains, then forest
    expect(reshaped.map((a) => a.choice)).toEqual(['mountains', 'forest', 'the region at 2, 2']);
    expect(reshaped[0].description).toBe('The Spine of the World rises');
    const snowy = hexChanges(view, 2 * width + 3); // [3,2]: mountains, then snow
    expect(snowy.map((a) => a.choice)).toEqual(['mountains', 'snow']);
    expect(hexChanges(view, 0)).toEqual([]); // untouched ocean corner
  });

  it('lists the turns taken this round', () => {
    expect(view.turnsThisRound.map((t) => t.how)).toEqual(['end', 'timeout']);
    expect(view.turnsThisRound.map((t) => t.godId)).toEqual(server.turn_order.slice(0, 2));
  });

  it("shows this round's income in turn order", () => {
    expect(view.roundIncomes.map((i) => i.godId)).toEqual(server.turn_order);
    for (const income of view.roundIncomes) {
      expect(income.gained).toBe(income.roll + income.bonus);
      expect(income.roll).toBeGreaterThanOrEqual(2);
      expect(income.roll).toBeLessThanOrEqual(12);
    }
  });
});

describe('applying events incrementally', () => {
  it('gives the same result as projecting everything at once', () => {
    const stepByStep = events.reduce(applyEvent, EMPTY_GAME);
    expect(stepByStep).toEqual(projectWorld(events));
  });

  it('ignores events it has already applied (realtime re-delivery)', () => {
    const once = projectWorld(events);
    expect(projectWorld(events, once)).toEqual(once);
    expect(applyEvent(once, events[3])).toBe(once);
  });

  it('sorts events by sequence number first', () => {
    expect(projectWorld([...events].reverse())).toEqual(projectWorld(events));
  });

  it('skips unknown event types instead of failing', () => {
    const extra: GameEvent = {
      seq: 999,
      type: 'from_the_future',
      age: 1,
      round: 2,
      god_id: null,
      payload: { anything: true },
      created_at: '',
    };
    const view = projectWorld([...events, extra]);
    expect(view.lastSeq).toBe(999);
    expect(view.round).toBe(server.round);
  });

  it('is empty before the game starts', () => {
    expect(projectWorld([])).toEqual(EMPTY_GAME);
  });
});

describe('helpers', () => {
  it('names ages', () => {
    expect(ageName(1)).toBe('First Age');
    expect(ageName(3)).toBe('Third Age');
  });

  it('describes deadlines', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    expect(describeDeadline(null, now)).toBeNull();
    expect(describeDeadline('2026-11-04T11:00:00Z', now)).toBe("Time's up");
    expect(describeDeadline('2026-11-04T12:20:00Z', now)).toBe('Ends in 20m');
    expect(describeDeadline('2026-11-05T11:00:00Z', now)).toBe('Ends in 23h');
    expect(describeDeadline('2026-11-08T12:00:00Z', now)).toBe('Ends in 4d');
  });
});
