import classicJson from './rulesets/classic.json';
import { type Age, type Power, type Ruleset, RulesetSchema } from './schema';

/** Thrown when ruleset JSON doesn't match the schema. */
export class InvalidRulesetError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid ruleset:\n- ${issues.join('\n- ')}`);
    this.name = 'InvalidRulesetError';
  }
}

/** Validates ruleset JSON (e.g. a preset or house rules) and returns a typed Ruleset. */
export function loadRuleset(json: unknown): Ruleset {
  const result = RulesetSchema.safeParse(json);
  if (!result.success) {
    throw new InvalidRulesetError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

/** The original Dawn of Worlds rules (Pesall, 2005). The default for new worlds. */
export const CLASSIC_RULESET: Ruleset = loadRuleset(classicJson);

export function findPower(ruleset: Ruleset, powerId: string): Power | undefined {
  return ruleset.powers.find((power) => power.id === powerId);
}

export function getAgeInfo(ruleset: Ruleset, age: Age) {
  return ruleset.ages[age - 1];
}
