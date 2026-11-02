import {
  type GameStateForActions,
  getActionCost,
  InvalidActionError,
  spendForAction,
  validateAction,
} from '../actions';
import { CLASSIC_RULESET as rules } from '../ruleset';

describe('getActionCost', () => {
  it('uses the cost for the current age', () => {
    expect(getActionCost(rules, 'createRace', 1)).toBe(22);
    expect(getActionCost(rules, 'createRace', 2)).toBe(6);
    expect(getActionCost(rules, 'createRace', 3)).toBe(15);
  });

  it('charges per area for per-area powers', () => {
    expect(getActionCost(rules, 'shapeLand', 1, 3)).toBe(9);
    expect(getActionCost(rules, 'catastrophe', 2, 2)).toBe(20);
  });

  it('ignores areas for powers that are not per area', () => {
    expect(getActionCost(rules, 'createRace', 1, 5)).toBe(22);
  });

  it('throws for unknown powers and bad area counts', () => {
    expect(() => getActionCost(rules, 'summonPizza', 1)).toThrow(/Unknown power/);
    expect(() => getActionCost(rules, 'shapeLand', 1, 0)).toThrow(RangeError);
    expect(() => getActionCost(rules, 'shapeLand', 1, 1.5)).toThrow(RangeError);
  });
});

describe('PDF "An Example of Play" (First Age)', () => {
  it('Bob spends 9 points on a 3-area mountain range', () => {
    expect(getActionCost(rules, 'shapeLand', 1, 3)).toBe(9);
  });

  it('Alexi spends 3 points adding trees to one area', () => {
    expect(getActionCost(rules, 'shapeLand', 1, 1)).toBe(3);
  });

  it('Trever burns 22 to create the High Elves, then 8 to have them build Amberel', () => {
    let state: GameStateForActions = { age: 1, gods: { trever: { power: 30 } } };
    ({ state } = spendForAction(state, { godId: 'trever', powerId: 'createRace' }, rules));
    expect(state.gods.trever.power).toBe(8);
    ({ state } = spendForAction(state, { godId: 'trever', powerId: 'commandRace' }, rules));
    expect(state.gods.trever.power).toBe(0);
  });

  it('PDF Power example: in the Second Age, Bob spends 10 of his 14 points on a Catastrophe', () => {
    const state: GameStateForActions = { age: 2, gods: { bob: { power: 14 } } };
    const result = spendForAction(state, { godId: 'bob', powerId: 'catastrophe' }, rules);
    expect(result.cost).toBe(10);
    expect(result.state.gods.bob.power).toBe(4);
  });
});

describe('validateAction', () => {
  const state: GameStateForActions = {
    age: 1,
    activeGodId: 'alexi',
    gods: { alexi: { power: 10 }, bob: { power: 50 } },
  };

  it('accepts an affordable action and returns its cost', () => {
    expect(
      validateAction(state, { godId: 'alexi', powerId: 'shapeLand', areas: 3 }, rules),
    ).toEqual({ ok: true, cost: 9 });
  });

  it('allows spending exactly all of your power', () => {
    expect(validateAction(state, { godId: 'alexi', powerId: 'event' }, rules)).toEqual({
      ok: true,
      cost: 10,
    });
  });

  it('rejects actions you cannot afford, with a readable reason', () => {
    const result = validateAction(state, { godId: 'alexi', powerId: 'createRace' }, rules);
    expect(result).toEqual({ ok: false, reasons: ['Create Race costs 22 power; you have 10.'] });
  });

  it('rejects actions when it is not your turn', () => {
    const result = validateAction(state, { godId: 'bob', powerId: 'shapeLand' }, rules);
    expect(result).toEqual({ ok: false, reasons: ["It isn't your turn."] });
  });

  it('allows anyone to act when no active god is set', () => {
    const open = { ...state, activeGodId: undefined };
    expect(validateAction(open, { godId: 'bob', powerId: 'shapeLand' }, rules).ok).toBe(true);
  });

  it('rejects unknown gods and unknown powers', () => {
    const result = validateAction(state, { godId: 'zeus', powerId: 'summonPizza' }, rules);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          'That god is not part of this world.',
          '"summonPizza" is not a power in this ruleset.',
        ]),
      );
    }
  });

  it('rejects zero or fractional areas for per-area powers', () => {
    expect(
      validateAction(state, { godId: 'alexi', powerId: 'shapeLand', areas: 0 }, rules).ok,
    ).toBe(false);
    expect(
      validateAction(state, { godId: 'alexi', powerId: 'shapeLand', areas: 1.5 }, rules).ok,
    ).toBe(false);
  });

  it('rejects multiple areas for powers that are not per area', () => {
    const result = validateAction(
      state,
      { godId: 'alexi', powerId: 'commandAvatar', areas: 2 },
      rules,
    );
    expect(result.ok).toBe(false);
  });

  it('uses the current age', () => {
    const thirdAge = { ...state, age: 3 as const };
    expect(validateAction(thirdAge, { godId: 'alexi', powerId: 'shapeLand' }, rules)).toEqual({
      ok: true,
      cost: 8,
    });
  });
});

describe('spendForAction', () => {
  const state: GameStateForActions = { age: 2, gods: { alexi: { power: 10 }, bob: { power: 3 } } };

  it('deducts the cost without mutating the original state', () => {
    const result = spendForAction(state, { godId: 'alexi', powerId: 'createRace' }, rules);
    expect(result.cost).toBe(6);
    expect(result.state.gods.alexi.power).toBe(4);
    expect(result.state.gods.bob.power).toBe(3);
    expect(state.gods.alexi.power).toBe(10);
  });

  it('throws InvalidActionError with reasons for invalid actions', () => {
    expect(() => spendForAction(state, { godId: 'bob', powerId: 'event' }, rules)).toThrow(
      InvalidActionError,
    );
    try {
      spendForAction(state, { godId: 'bob', powerId: 'event' }, rules);
    } catch (error) {
      expect((error as InvalidActionError).reasons).toEqual(['Event costs 7 power; you have 3.']);
    }
  });
});
