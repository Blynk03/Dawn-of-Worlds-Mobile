import { z } from 'zod';

/** The game's three ages: 1 = Land, 2 = Races, 3 = Relations. */
export const AgeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const cost = z.number().int().nonnegative();

export const PowerSchema = z.object({
  /** Stable identifier used in actions and saved games. */
  id: z.string().regex(/^[a-z][A-Za-z]*$/, 'power ids are camelCase'),
  name: z.string().min(1),
  /** Groups powers in the action picker. */
  category: z.enum(['land', 'races', 'cities', 'alignment', 'fate', 'orders', 'avatars']),
  /** Cost in the first, second and third age. */
  costs: z.tuple([cost, cost, cost]),
  /** Cost is charged per 1-hex area (the PDF's 1-inch area): Shape Land, Shape Climate, Catastrophe. */
  perArea: z.boolean().optional(),
  /** The god needs an Avatar or Order present in the target (Table of Powers footnote **). */
  requiresPresence: z.boolean().optional(),
  /** Only once per target per turn (Table of Powers footnote *). */
  oncePerTargetPerTurn: z.boolean().optional(),
});

export const RulesetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: z.string().optional(),
    income: z.object({
      /** Power gained each round, e.g. 2d6. */
      dice: z.object({
        count: z.number().int().positive(),
        sides: z.number().int().min(2),
      }),
      /** "Players who end any turn with five or fewer points gain a cumulative +1 ... up to +3." */
      lowPool: z.object({
        threshold: z.number().int().nonnegative(),
        bonusPerTurn: z.number().int().nonnegative(),
        maxBonus: z.number().int().nonnegative(),
      }),
    }),
    ages: z
      .array(
        z.object({
          age: AgeSchema,
          name: z.string().min(1),
          focus: z.string().min(1),
          yearsPerRound: z.number().positive(),
        }),
      )
      .length(3),
    ageTransition: z.object({
      /** Minimum rounds before a majority vote may change the age. */
      minRounds: z.number().int().nonnegative(),
      /** After this many rounds any single player may change the age. */
      anyPlayerAfterRounds: z.number().int().nonnegative(),
    }),
    /** Map options: the server validates terrain and climate choices against these lists. */
    map: z.object({
      defaultSize: z.object({
        width: z.number().int().min(8).max(64),
        height: z.number().int().min(8).max(64),
      }),
      terrains: z.array(z.string().regex(/^[a-z]+$/)).min(2),
      /** Terrains that are water: races and cities can't be placed there. */
      water: z.array(z.string().regex(/^[a-z]+$/)),
      climates: z.array(z.string().regex(/^[a-z]+$/)).min(1),
    }),
    powers: z.array(PowerSchema).min(1),
  })
  .superRefine((ruleset, ctx) => {
    const seen = new Set<string>();
    ruleset.powers.forEach((power, index) => {
      if (seen.has(power.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate power id "${power.id}"`,
          path: ['powers', index, 'id'],
        });
      }
      seen.add(power.id);
    });
    ruleset.ages.forEach((age, index) => {
      if (age.age !== index + 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'ages must be listed in order 1, 2, 3',
          path: ['ages', index, 'age'],
        });
      }
    });
  });

export type Age = z.infer<typeof AgeSchema>;
export type Power = z.infer<typeof PowerSchema>;
export type Ruleset = z.infer<typeof RulesetSchema>;
