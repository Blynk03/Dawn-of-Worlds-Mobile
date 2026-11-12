import { ageTransition, majorityOf } from '../ages';
import { CLASSIC_RULESET } from '../ruleset';

describe('ageTransition (DOW-52)', () => {
  it('needs five rounds, then a vote, then anyone after ten', () => {
    expect(ageTransition(CLASSIC_RULESET, 1, 4, 1)).toEqual({
      kind: 'tooEarly',
      roundsInAge: 4,
      minRounds: 5,
    });
    expect(ageTransition(CLASSIC_RULESET, 1, 5, 1)).toEqual({
      kind: 'vote',
      roundsInAge: 5,
      nextAge: 2,
    });
    expect(ageTransition(CLASSIC_RULESET, 1, 9, 1).kind).toBe('vote');
    expect(ageTransition(CLASSIC_RULESET, 1, 10, 1)).toEqual({
      kind: 'anyGod',
      roundsInAge: 10,
      nextAge: 2,
    });
  });

  it('counts rounds from the start of the current age', () => {
    expect(ageTransition(CLASSIC_RULESET, 2, 10, 6)).toEqual({
      kind: 'vote',
      roundsInAge: 5,
      nextAge: 3,
    });
    expect(ageTransition(CLASSIC_RULESET, 2, 9, 6).kind).toBe('tooEarly');
  });

  it('never ends the Third Age', () => {
    expect(ageTransition(CLASSIC_RULESET, 3, 40, 1)).toEqual({ kind: 'lastAge' });
  });
});

describe('majorityOf', () => {
  it('is more than half', () => {
    expect([2, 3, 4, 5, 6].map(majorityOf)).toEqual([2, 2, 3, 3, 4]);
  });
});
