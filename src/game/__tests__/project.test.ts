import {
  ageName,
  applyEvent,
  describeDeadline,
  EMPTY_GAME,
  type GameEvent,
  projectWorld,
} from '../project';
import fixture from './fixtures/server-game.json';

// A short game played by the real database functions (scripts/game-fixture.sql): round 1 with an
// end, a pass and a low-pool end; round 2 with an end and a timeout.
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
