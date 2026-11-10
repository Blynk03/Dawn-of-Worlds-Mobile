import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import classic from '../rulesets/classic.json';

/**
 * The server keeps its own copy of the rules it enforces (income dice, low-pool bonus, ages) in
 * the rulesets table. This test fails if that copy drifts from src/rules/rulesets/classic.json.
 */
describe('server ruleset matches the app ruleset', () => {
  const sql = readFileSync(
    join(__dirname, '../../../supabase/migrations/20261104000000_turns_and_rounds.sql'),
    'utf8',
  );
  const match = sql.match(/-- ruleset:classic:begin\s*'([\s\S]*?)'\s*-- ruleset:classic:end/);

  it('has a classic ruleset block in the migration', () => {
    expect(match).not.toBeNull();
  });

  it('uses the same income, ages and age-transition rules', () => {
    const server = JSON.parse(match![1]);
    expect(server.income).toEqual(classic.income);
    expect(server.ages).toEqual(classic.ages);
    expect(server.ageTransition).toEqual(classic.ageTransition);
  });
});
