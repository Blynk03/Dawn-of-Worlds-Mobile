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
      ['commandCity', 'The Iron Wall', 6],
      ['commandCity', 'Host of Karak', 6],
      ['commandRace', 'Underhold', 8],
      ['commandCity', 'Pale Guard', 6],
      ['commandRace', 'Host of Karak', 8],
      ['commandRace', 'Underhold', 8],
      ['shapeLand', 'hills', 3], // objected to and undone
    ]);
  });

  it('lists an undone action, marked, without its effects (DOW-53)', () => {
    const hill = view.actions[view.actions.length - 1];
    expect(hill.retconned).toBe(true);
    expect(hill.undoneBecauseOf).toBeNull();
    expect(view.actions.filter((a) => a.retconned)).toEqual([hill]);
    expect(view.retconned).toEqual([hill.seq]);
    // The map matches the server (above): the hex is as it was, and its history leaves it out.
    expect(view.map!.terrain[7 * view.map!.width]).not.toBe('hills');
    expect(view.hexHistory[7 * view.map!.width] ?? []).not.toContain(hill.seq);
  });

  it('follows a declared battle, its bonuses and the dispute (DOW-56/54)', () => {
    expect(view.battles).toHaveLength(1);
    const [battle] = view.battles;
    const host = view.armies.find((a) => a.name === 'Host of Karak')!;
    const karak = view.cities.find((c) => c.name === 'Karak')!;
    expect(battle).toMatchObject({
      army: { id: host.id, name: 'Host of Karak' },
      target: { kind: 'city', id: karak.id, name: 'Karak' },
      utterlyDestroy: false,
      description: 'The Host turns on its own city',
      cost: 8,
      reserved: 0,
      status: 'pending',
      waived: [],
    });
    expect(battle.closesAt).toEqual(expect.any(String));
    expect(battle.bonuses.map((b) => [b.side, b.label, b.status])).toEqual([
      ['attacker', 'Steel', 'disputed'],
      ['defender', 'The Iron Wall', 'agreed'],
      ['defender', 'Higher ground', 'agreed'],
    ]);
    expect(battle.bonuses[2].godId).not.toBe(battle.godId);
    const dispute = view.proposals.find((p) => p.kind === 'bonus')!;
    expect(dispute).toMatchObject({
      battleId: battle.id,
      bonusId: battle.bonuses[0].id,
      reason: 'Steel',
      status: 'open',
      votes: { [dispute.godId!]: 'drop' },
    });
    // Nothing is rolled yet: the Host and Karak stand.
    expect(host.status).toBe('active');
    expect(karak.status).toBe('active');
  });

  it('records a battle rolled or called off, and a kept or dropped bonus', () => {
    const [battle] = view.battles;
    const dispute = view.proposals.find((p) => p.kind === 'bonus')!;
    let seq = view.lastSeq;
    const ev = (type: string, payload: Record<string, unknown>): GameEvent => ({
      seq: ++seq,
      type,
      age: 1,
      round: view.round,
      god_id: battle.godId,
      payload,
      created_at: '2026-11-04T06:00:00Z',
    });
    const after = projectWorld(
      [
        ev('reaction_waived', { battle_id: battle.id }),
        ev('proposal_resolved', { proposal_id: dispute.id, kind: 'bonus', outcome: 'dropped' }),
        ev('battle_cancelled', {
          battle_id: battle.id,
          reason: 'Karak is gone',
          refund: 8,
          power_after: 40,
        }),
      ],
      view,
    );
    expect(after.battles[0]).toMatchObject({
      status: 'cancelled',
      reason: 'Karak is gone',
      waived: [battle.godId],
    });
    expect(after.battles[0].bonuses[0].status).toBe('dropped');
    expect(after.powers[battle.godId!].power).toBe(40);
  });

  it('records the objection and its vote (DOW-53)', () => {
    const hill = view.actions[view.actions.length - 1];
    const objections = view.proposals.filter((p) => p.kind === 'objection');
    expect(objections).toHaveLength(1);
    const [objection] = objections;
    expect(objection).toMatchObject({
      kind: 'objection',
      targetSeq: hill.seq,
      reason: 'That hill is in my sea',
      status: 'undone',
      coin: null,
      solo: false,
    });
    expect(objection.godId).not.toBe(hill.godId);
    expect(objection.votes).toEqual({ [objection.godId!]: 'undo', [hill.godId!]: 'undo' });
    expect(objection.closesAt).toEqual(expect.any(String));
  });

  const entity = (name: string) => fixture.entities.find((e) => e.name === name)!;

  it("matches the server's armies and structures after marching and battle (DOW-48/55)", () => {
    expect(
      view.armies.map((a) => [a.id, a.name, a.raceId, a.cityId, a.hex.x, a.hex.y, a.status]),
    ).toEqual(
      fixture.entities
        .filter((e) => e.kind === 'army')
        .map((e) => [e.id, e.name, e.race_id, e.city_id, e.hex_x, e.hex_y, e.status]),
    );
    expect(view.structures.map((s) => [s.id, s.name, s.structureType, s.cityId])).toEqual(
      fixture.entities
        .filter((e) => e.kind === 'structure')
        .map((e) => [e.id, e.name, e.structure_type, e.city_id]),
    );
    expect(view.cities.map((c) => [c.name, c.status])).toEqual(
      fixture.entities.filter((e) => e.kind === 'city').map((e) => [e.name, e.status]),
    );
  });

  it('records the battle: dice, bonuses, fatigue and outcome (DOW-54/55)', () => {
    const attack = view.actions.find((a) => a.intent === 'attack')!;
    expect(attack.battle).toEqual({
      armyId: entity('Host of Karak').id,
      armyName: 'Host of Karak',
      attackerModifiers: ['Steel'],
      defenderModifiers: ['High ground'],
      battles: [
        {
          defenderId: entity('Pale Guard').id,
          defenderName: 'Pale Guard',
          attackerDice: [5, 4],
          defenderDice: [2, 2],
          attackerBonus: 1,
          defenderBonus: 1,
          fatigue: 0,
          attackerTotal: 10,
          defenderTotal: 5,
          winner: 'attacker',
        },
      ],
      outcome: 'won',
      cityOutcome: 'ruined',
      destructionCost: 0,
    });
    expect(attack.target).toMatchObject({ kind: 'city', name: 'Underhold' });
  });

  it('follows utter destruction and lost battles', () => {
    const attack = view.actions.find((a) => a.intent === 'attack')!;
    const last = events[events.length - 1];
    const payload = (events.find((e) => e.seq === attack.seq)!.payload ?? {}) as Record<
      string,
      unknown
    >;
    const battle = payload.battle as Record<string, unknown>;
    // The same attack, but lost.
    const before = projectWorld(events.filter((e) => e.seq < attack.seq));
    const lost = applyEvent(before, {
      ...last,
      type: 'action_taken',
      seq: attack.seq,
      god_id: attack.godId,
      payload: {
        ...payload,
        battle: {
          ...battle,
          outcome: 'lost',
          scattered: [entity('Host of Karak').id],
          city_outcome: null,
        },
      },
    });
    expect(lost.armies.find((a) => a.name === 'Host of Karak')).toMatchObject({
      status: 'scattered',
      hex: { x: 6, y: 5 }, // it doesn't advance
    });
    expect(lost.cities.find((c) => c.name === 'Underhold')!.status).toBe('active');
    // The same attack, utterly destroying everything.
    const razed = applyEvent(before, {
      ...last,
      type: 'action_taken',
      seq: attack.seq,
      god_id: attack.godId,
      payload: {
        ...payload,
        battle: {
          ...battle,
          scattered: [],
          destroyed: [entity('Pale Guard').id, entity('Underhold').id],
          city_outcome: 'destroyed',
        },
      },
    });
    expect(razed.armies.find((a) => a.name === 'Pale Guard')!.status).toBe('destroyed');
    expect(razed.cities.find((c) => c.name === 'Underhold')!.status).toBe('destroyed');
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

  it('rebuilds the view when an earlier action is undone later (DOW-53)', () => {
    const undo = events.findIndex((e) => e.type === 'action_retconned');
    const before = projectWorld(events.slice(0, undo));
    expect(before.actions[before.actions.length - 1].retconned).toBe(false);
    expect(before.map!.terrain[7 * before.map!.width]).toBe('hills');
    const after = projectWorld(events.slice(undo), before);
    expect(after).toEqual(projectWorld(events));
  });

  it('follows a vote on the next age, and the age beginning (DOW-52)', () => {
    const base = projectWorld(events);
    const [a, b] = base.turnOrder;
    const at = '2026-11-05T00:00:00Z';
    let seq = base.lastSeq;
    const ev = (type: string, god: string | null, payload: Record<string, unknown>): GameEvent => ({
      seq: ++seq,
      type,
      age: 1,
      round: base.round,
      god_id: god,
      payload,
      created_at: at,
    });
    const voting = projectWorld(
      [
        ev('proposal_opened', a, {
          proposal_id: 'p1',
          kind: 'advance_age',
          age: 2,
          solo: false,
          closes_at: null,
          reason: '',
        }),
        ev('vote_cast', a, { proposal_id: 'p1', choice: 'yes' }),
        ev('vote_cast', b, { proposal_id: 'p1', choice: 'yes' }),
      ],
      base,
    );
    expect(voting.proposals.find((x) => x.id === 'p1')).toMatchObject({
      kind: 'advanceAge',
      age: 2,
      status: 'open',
      votes: { [a]: 'yes', [b]: 'yes' },
    });
    expect(voting.agePending).toBe(false);
    const passed = projectWorld(
      [
        ev('proposal_resolved', null, {
          proposal_id: 'p1',
          kind: 'advance_age',
          outcome: 'passed',
        }),
      ],
      voting,
    );
    expect(passed.proposals.find((x) => x.id === 'p1')!.status).toBe('passed');
    expect(passed.agePending).toBe(true);
    const next = projectWorld(
      [ev('age_advanced', null, { age: 2, name: 'Second Age', years_per_round: 100, round: 9 })],
      passed,
    );
    expect(next.age).toBe(2);
    expect(next.agePending).toBe(false);
    expect(next.ageStartedRound).toBe(9);
    expect(next.ageChanges).toEqual([{ age: 2, name: 'Second Age', round: 9, seq }]);
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
