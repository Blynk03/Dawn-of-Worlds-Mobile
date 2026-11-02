/**
 * Action cost lookup, validation and deduction (DOW-20).
 *
 * Gods are limited only by their power: "If you have saved up 50 points and want to burn them all
 * raising armies, do it." Prerequisites such as Avatar/Order presence arrive in v2 (DOW-38+).
 */
import { findPower } from './ruleset';
import type { Age, Ruleset } from './schema';

export type ActionRequest = {
  godId: string;
  powerId: string;
  /** Number of 1-hex areas for per-area powers (Shape Land, Shape Climate, Catastrophe). Default 1. */
  areas?: number;
};

export type GameStateForActions = {
  age: Age;
  /** Whose turn it is. When set, only this god may act. */
  activeGodId?: string;
  gods: Record<string, { power: number }>;
};

export type ValidationResult = { ok: true; cost: number } | { ok: false; reasons: string[] };

/**
 * Cost of a power in the given age. Per-area powers cost their table value for each area.
 * Throws for unknown powers or invalid area counts; use validateAction for user input.
 */
export function getActionCost(ruleset: Ruleset, powerId: string, age: Age, areas = 1): number {
  const power = findPower(ruleset, powerId);
  if (!power) {
    throw new Error(`Unknown power "${powerId}"`);
  }
  const base = power.costs[age - 1];
  if (!power.perArea) {
    return base;
  }
  if (!Number.isInteger(areas) || areas < 1) {
    throw new RangeError(`areas must be a whole number of at least 1 (got ${areas})`);
  }
  return base * areas;
}

/** Checks whether a god may take an action right now. Reasons are written for players. */
export function validateAction(
  state: GameStateForActions,
  action: ActionRequest,
  ruleset: Ruleset,
): ValidationResult {
  const reasons: string[] = [];
  const power = findPower(ruleset, action.powerId);
  const god = state.gods[action.godId];

  if (!god) {
    reasons.push('That god is not part of this world.');
  }
  if (state.activeGodId !== undefined && state.activeGodId !== action.godId) {
    reasons.push("It isn't your turn.");
  }
  if (!power) {
    reasons.push(`"${action.powerId}" is not a power in this ruleset.`);
    return { ok: false, reasons };
  }

  const areas = action.areas ?? 1;
  if (power.perArea) {
    if (!Number.isInteger(areas) || areas < 1) {
      reasons.push(`${power.name} must cover at least one whole area.`);
      return { ok: false, reasons };
    }
  } else if (action.areas !== undefined && action.areas !== 1) {
    reasons.push(`${power.name} doesn't cover an area, so it can't be used on several areas.`);
  }

  const cost = getActionCost(ruleset, power.id, state.age, power.perArea ? areas : 1);
  if (god && god.power < cost) {
    reasons.push(`${power.name} costs ${cost} power; you have ${god.power}.`);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, cost };
}

/**
 * Validates and applies an action's cost, returning the updated state.
 * Throws if the action is invalid, so callers (and the server) can't skip validation.
 */
export function spendForAction<S extends GameStateForActions>(
  state: S,
  action: ActionRequest,
  ruleset: Ruleset,
): { state: S; cost: number } {
  const result = validateAction(state, action, ruleset);
  if (!result.ok) {
    throw new InvalidActionError(result.reasons);
  }
  const god = state.gods[action.godId];
  return {
    cost: result.cost,
    state: {
      ...state,
      gods: { ...state.gods, [action.godId]: { ...god, power: god.power - result.cost } },
    },
  };
}

export class InvalidActionError extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons.join(' '));
    this.name = 'InvalidActionError';
  }
}
