import type { Ruleset } from './schema';

export type AgeTransition =
  /** The last age goes on until the game ends. */
  | { kind: 'lastAge' }
  /** Too early: the age has to run `minRounds` first. */
  | { kind: 'tooEarly'; roundsInAge: number; minRounds: number }
  /** A majority of the gods can vote to move on. */
  | { kind: 'vote'; roundsInAge: number; nextAge: number }
  /** Any one god can end it. */
  | { kind: 'anyGod'; roundsInAge: number; nextAge: number };

/**
 * DOW-52, rules section II: "Each age lasts a minimum of five rounds. After the fifth round, a
 * majority vote of the players can end the age. After the tenth round, any player can end it."
 * The app counts the round in which the change is agreed as the age's last, so an age lasts at
 * least five rounds. Mirrors propose_next_age() on the server.
 */
export function ageTransition(
  ruleset: Ruleset,
  age: number,
  round: number,
  ageStartedRound: number,
): AgeTransition {
  if (age >= ruleset.ages.length) return { kind: 'lastAge' };
  const roundsInAge = round - ageStartedRound + 1;
  const { minRounds, anyPlayerAfterRounds } = ruleset.ageTransition;
  if (roundsInAge < minRounds) return { kind: 'tooEarly', roundsInAge, minRounds };
  if (roundsInAge >= anyPlayerAfterRounds) return { kind: 'anyGod', roundsInAge, nextAge: age + 1 };
  return { kind: 'vote', roundsInAge, nextAge: age + 1 };
}

/** More than half of all the gods: what an age vote (or an objection) needs to pass outright. */
export function majorityOf(gods: number): number {
  return Math.floor(gods / 2) + 1;
}
