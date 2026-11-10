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

  it('has the same power costs and map options', () => {
    const sql2 = readFileSync(
      join(__dirname, '../../../supabase/migrations/20261110000000_map_and_terrain.sql'),
      'utf8',
    );
    const block = sql2.match(
      /-- ruleset:classic-powers-map:begin\s*'([\s\S]*?)'::jsonb\s*-- ruleset:classic-powers-map:end/,
    );
    expect(block).not.toBeNull();
    const server = JSON.parse(block![1]);
    // The map options were restated (with water terrains added) by the races migration.
    const sql3 = readFileSync(
      join(__dirname, '../../../supabase/migrations/20261111000000_races_and_cities.sql'),
      'utf8',
    );
    const races = sql3.match(
      /-- ruleset:classic-races:begin\s*'([\s\S]*?)'::jsonb\s*-- ruleset:classic-races:end/,
    );
    expect(races).not.toBeNull();
    expect(JSON.parse(races![1]).map).toEqual(classic.map);
    const { water: _water, ...mapBeforeWater } = classic.map;
    expect(server.map).toEqual(mapBeforeWater);
    expect(server.powers).toEqual(
      classic.powers.map((p) => ({
        id: p.id,
        costs: p.costs,
        ...('perArea' in p && p.perArea ? { perArea: true } : {}),
      })),
    );
  });

  it('uses the same income, ages and age-transition rules', () => {
    const server = JSON.parse(match![1]);
    expect(server.income).toEqual(classic.income);
    expect(server.ages).toEqual(classic.ages);
    expect(server.ageTransition).toEqual(classic.ageTransition);
  });
});
