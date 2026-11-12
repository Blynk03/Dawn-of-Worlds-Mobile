import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import classic from '../rulesets/classic.json';

/**
 * The server keeps its own copy of the rules it enforces (income dice, low-pool bonus, ages) in
 * the rulesets table. This test fails if that copy drifts from src/rules/rulesets/classic.json.
 */
/**
 * The server's copy of the rules, rebuilt the way the database builds it: every
 * `-- ruleset:<name>:begin '…' -- ruleset:<name>:end` block in the migrations, in order, with
 * later blocks replacing the top-level keys they restate (Postgres `config || block`).
 */
function serverRuleset() {
  const dir = join(__dirname, '../../../supabase/migrations');
  const blocks: { file: string; name: string; json: Record<string, unknown> }[] = [];
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const pattern = /-- ruleset:([\w-]+):begin\s*'([\s\S]*?)'(?:::jsonb)?\s*-- ruleset:\1:end/g;
    for (const m of sql.matchAll(pattern)) {
      blocks.push({ file, name: m[1], json: JSON.parse(m[2]) });
    }
  }
  return { blocks, config: Object.assign({}, ...blocks.map((b) => b.json)) };
}

const normalizePowers = (powers: { id: string; costs: number[]; perArea?: boolean }[]) =>
  powers.map((p) => ({ id: p.id, costs: p.costs, ...(p.perArea ? { perArea: true } : {}) }));

describe('server ruleset matches the app ruleset', () => {
  const { blocks, config } = serverRuleset();

  it('finds the ruleset blocks in the migrations, starting with the classic rules', () => {
    expect(blocks[0]).toMatchObject({ name: 'classic' });
    expect(blocks.map((b) => b.name)).toEqual(
      expect.arrayContaining(['classic-powers-map', 'classic-races', 'classic-civ']),
    );
  });

  it('has the same power costs', () => {
    expect(normalizePowers(config.powers)).toEqual(normalizePowers(classic.powers));
  });

  it('has the same map options', () => {
    expect(config.map).toEqual(classic.map);
  });

  it('uses the same income, ages and age-transition rules', () => {
    expect(config.income).toEqual(classic.income);
    expect(config.ages).toEqual(classic.ages);
    expect(config.ageTransition).toEqual(classic.ageTransition);
  });
});
