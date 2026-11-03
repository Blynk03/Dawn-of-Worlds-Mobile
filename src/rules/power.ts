/**
 * Power income (DOW-19), PDF section III "Power":
 *
 * - Each round every god rolls two six-sided dice and adds the total to their saved power.
 * - Points can be saved without limit.
 * - "Players who end any turn with five or fewer points gain a cumulative +1 point for the next
 *   round, up to a maximum of +3." Ending a turn above the threshold resets the bonus.
 */
import { type DiceRoll, type DieRoller, rollDice } from './dice';
import type { Ruleset } from './schema';

export type GodPower = {
  /** Saved power points. */
  power: number;
  /** Bonus to add at the start of the next round, earned by ending turns with a low pool. */
  lowPoolBonus: number;
};

export const INITIAL_GOD_POWER: GodPower = { power: 0, lowPoolBonus: 0 };

export type RoundIncome = {
  roll: DiceRoll;
  bonus: number;
  /** roll.total + bonus */
  gained: number;
  next: GodPower;
};

/** Start of a round: roll income dice and add them plus any low-pool bonus. */
export function collectRoundIncome(
  god: GodPower,
  ruleset: Ruleset,
  roller: DieRoller,
): RoundIncome {
  const { count, sides } = ruleset.income.dice;
  const roll = rollDice(count, sides, roller);
  const bonus = god.lowPoolBonus;
  const gained = roll.total + bonus;
  return {
    roll,
    bonus,
    gained,
    next: { ...god, power: god.power + gained },
  };
}

/** End of a god's turn (including a pass): update the low-pool bonus for the next round. */
export function endTurn(god: GodPower, ruleset: Ruleset): GodPower {
  const { threshold, bonusPerTurn, maxBonus } = ruleset.income.lowPool;
  const lowPoolBonus =
    god.power <= threshold ? Math.min(god.lowPoolBonus + bonusPerTurn, maxBonus) : 0;
  return { ...god, lowPoolBonus };
}
