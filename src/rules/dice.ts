/**
 * Dice are injected so the rules stay pure and testable. In the real game the server rolls
 * (DOW-15); tests pass fixed or seeded rollers.
 */

/** Returns an integer from 1 to `sides`, inclusive. */
export type DieRoller = (sides: number) => number;

export type DiceRoll = {
  dice: number[];
  total: number;
};

export function rollDice(count: number, sides: number, roll: DieRoller): DiceRoll {
  const dice: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = roll(sides);
    if (!Number.isInteger(value) || value < 1 || value > sides) {
      throw new RangeError(`die roller returned ${value} for a d${sides}`);
    }
    dice.push(value);
  }
  return { dice, total: dice.reduce((sum, value) => sum + value, 0) };
}

/** A roller that returns the given values in order, for tests and replays. */
export function fixedRoller(values: readonly number[]): DieRoller {
  let index = 0;
  return () => {
    if (index >= values.length) {
      throw new Error('fixedRoller ran out of values');
    }
    return values[index++];
  };
}
