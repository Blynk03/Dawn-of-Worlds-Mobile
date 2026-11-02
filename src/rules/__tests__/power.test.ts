import { fixedRoller, rollDice } from '../dice';
import { collectRoundIncome, endTurn, type GodPower, INITIAL_GOD_POWER } from '../power';
import { CLASSIC_RULESET as rules } from '../ruleset';

describe('rollDice', () => {
  it('sums the dice', () => {
    expect(rollDice(2, 6, fixedRoller([3, 4]))).toEqual({ dice: [3, 4], total: 7 });
  });

  it('rejects impossible die results', () => {
    expect(() => rollDice(1, 6, () => 7)).toThrow(RangeError);
    expect(() => rollDice(1, 6, () => 0)).toThrow(RangeError);
    expect(() => rollDice(1, 6, () => 2.5)).toThrow(RangeError);
  });
});

describe('collectRoundIncome', () => {
  it('adds 2d6 to saved power', () => {
    const income = collectRoundIncome({ power: 7, lowPoolBonus: 0 }, rules, fixedRoller([6, 4]));
    expect(income.roll.dice).toEqual([6, 4]);
    expect(income.gained).toBe(10);
    expect(income.next).toEqual({ power: 17, lowPoolBonus: 0 });
  });

  it('PDF example: Bob has 4 points, gets +1 for a low total and rolls 9, so he has 14', () => {
    const bob: GodPower = { power: 4, lowPoolBonus: 1 };
    const income = collectRoundIncome(bob, rules, fixedRoller([5, 4]));
    expect(income.bonus).toBe(1);
    expect(income.next.power).toBe(14);
  });

  it('does not use up the bonus; the next end of turn decides it again', () => {
    const income = collectRoundIncome({ power: 2, lowPoolBonus: 2 }, rules, fixedRoller([1, 1]));
    expect(income.next.lowPoolBonus).toBe(2);
  });
});

describe('endTurn (low-pool bonus)', () => {
  it('ending a turn with 5 or fewer points earns +1 for next round', () => {
    expect(endTurn({ power: 5, lowPoolBonus: 0 }, rules).lowPoolBonus).toBe(1);
    expect(endTurn({ power: 0, lowPoolBonus: 0 }, rules).lowPoolBonus).toBe(1);
  });

  it('ending a turn with more than 5 points earns nothing and resets the bonus', () => {
    expect(endTurn({ power: 6, lowPoolBonus: 0 }, rules).lowPoolBonus).toBe(0);
    expect(endTurn({ power: 6, lowPoolBonus: 3 }, rules).lowPoolBonus).toBe(0);
  });

  it('PDF: the bonus is cumulative (+1, then +2, then +3) and never exceeds +3', () => {
    let god: GodPower = { power: 4, lowPoolBonus: 0 };
    const bonuses: number[] = [];
    for (let turn = 0; turn < 5; turn++) {
      god = endTurn({ ...god, power: 4 }, rules);
      bonuses.push(god.lowPoolBonus);
    }
    expect(bonuses).toEqual([1, 2, 3, 3, 3]);
  });

  it('does not change saved power', () => {
    expect(endTurn({ power: 3, lowPoolBonus: 0 }, rules).power).toBe(3);
  });
});

describe('a few rounds of income', () => {
  it('a god who spends everything each turn gets the growing bonus', () => {
    const roller = fixedRoller([3, 3, 3, 3, 3, 3, 3, 3]);
    let god = INITIAL_GOD_POWER;
    const gained: number[] = [];
    for (let round = 0; round < 4; round++) {
      const income = collectRoundIncome(god, rules, roller);
      gained.push(income.gained);
      // Spend everything, then end the turn.
      god = endTurn({ ...income.next, power: 0 }, rules);
    }
    // First round has no bonus yet; then +1, +2, +3.
    expect(gained).toEqual([6, 7, 8, 9]);
  });
});
