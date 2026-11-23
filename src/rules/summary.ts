import { getActionCost } from './actions';
import type { Age, Power, Ruleset } from './schema';

/** The order and headings of the power groups on the rules summary. */
export const POWER_GROUPS: { category: Power['category']; title: string }[] = [
  { category: 'land', title: 'Land and climate' },
  { category: 'races', title: 'Races and civilizations' },
  { category: 'cities', title: 'Cities and armies' },
  { category: 'orders', title: 'Orders' },
  { category: 'avatars', title: 'Avatars' },
  { category: 'alignment', title: 'Good and evil' },
  { category: 'fate', title: 'Fate' },
];

/** Powers in the rules that the app can't use yet. */
export const COMING_SOON = new Set(['event', 'catastrophe']);

export type PowerRow = {
  id: string;
  name: string;
  /** The cost in the current age (per hex for land, climate and catastrophes). */
  now: number;
  /** The cost in each age, first to third. */
  costs: [number, number, number];
  /** Short notes: "per hex", "needs an order or avatar there", "once per target each turn". */
  notes: string[];
  comingSoon: boolean;
};

/**
 * DOW-78: the Table of Powers for the rules summary, grouped, with each power's cost now and in
 * every age, and the footnotes that apply to it.
 */
export function powerTable(
  ruleset: Ruleset,
  age: Age,
): { category: Power['category']; title: string; powers: PowerRow[] }[] {
  return POWER_GROUPS.map(({ category, title }) => ({
    category,
    title,
    powers: ruleset.powers
      .filter((p) => p.category === category)
      .map((p) => ({
        id: p.id,
        name: p.name,
        now: getActionCost(ruleset, p.id, age),
        costs: p.costs,
        notes: [
          ...(p.perArea ? ['per hex'] : []),
          ...(p.requiresPresence ? ['needs your order or avatar among them'] : []),
          ...(p.oncePerTargetPerTurn ? ['once per target each turn'] : []),
        ],
        comingSoon: COMING_SOON.has(p.id),
      })),
  })).filter((group) => group.powers.length > 0);
}

/** "2d6 each round; end a turn with 5 or less and get +1 next round (up to +3)." */
export function incomeSummary(ruleset: Ruleset): string {
  const { dice, lowPool } = ruleset.income;
  return (
    `${dice.count}d${dice.sides} power at the start of each round. End a turn with ` +
    `${lowPool.threshold} or less and you gain +${lowPool.bonusPerTurn} more each round ` +
    `(it adds up, to +${lowPool.maxBonus}) until you end a turn with more.`
  );
}
