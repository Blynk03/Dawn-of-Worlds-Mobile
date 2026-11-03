import classicJson from '../rulesets/classic.json';
import {
  CLASSIC_RULESET,
  findPower,
  getAgeInfo,
  InvalidRulesetError,
  loadRuleset,
} from '../ruleset';

/**
 * The Table of Powers, typed in by hand from the PDF (section III) as an independent check on
 * rulesets/classic.json: [1st Age - Land, 2nd Age - Races, 3rd Age - Relations].
 */
const PDF_TABLE_OF_POWERS: Record<string, [number, number, number]> = {
  'Shape Land': [3, 5, 8],
  'Shape Climate': [2, 4, 6],
  'Create Race': [22, 6, 15],
  'Create Subrace': [12, 4, 10],
  'Command Race': [8, 4, 3],
  'Command City': [6, 4, 2],
  'Advance Civilization': [10, 5, 6],
  'Advance City': [8, 4, 5],
  'Purify Civilization (+1 alignment)': [5, 3, 4],
  'Corrupt Civilization (-1 alignment)': [4, 3, 3],
  'Purify City (+1 alignment)': [4, 3, 3],
  'Corrupt City (-1 alignment)': [3, 2, 2],
  Event: [10, 7, 9],
  'Create Order': [8, 6, 4],
  'Command Order': [4, 3, 2],
  'Create Avatar': [10, 7, 8],
  'Command Avatar': [2, 1, 1],
  Catastrophe: [10, 10, 10],
};

describe('Classic ruleset', () => {
  it('has exactly the powers in the PDF Table of Powers', () => {
    expect(CLASSIC_RULESET.powers.map((p) => p.name).sort()).toEqual(
      Object.keys(PDF_TABLE_OF_POWERS).sort(),
    );
  });

  it.each(Object.entries(PDF_TABLE_OF_POWERS))('%s costs %j by age', (name, costs) => {
    const power = CLASSIC_RULESET.powers.find((p) => p.name === name);
    expect(power?.costs).toEqual(costs);
  });

  it('charges per 1-inch (1-hex) area only for Shape Land, Shape Climate and Catastrophe', () => {
    const perArea = CLASSIC_RULESET.powers.filter((p) => p.perArea).map((p) => p.id);
    expect(perArea.sort()).toEqual(['catastrophe', 'shapeClimate', 'shapeLand']);
  });

  it('flags the footnoted powers', () => {
    const presence = CLASSIC_RULESET.powers.filter((p) => p.requiresPresence).map((p) => p.id);
    expect(presence.sort()).toEqual(['commandCity', 'commandRace']); // footnote **
    const oncePerTarget = CLASSIC_RULESET.powers
      .filter((p) => p.oncePerTargetPerTurn)
      .map((p) => p.id);
    expect(oncePerTarget.sort()).toEqual([
      'corruptCity',
      'corruptCivilization',
      'purifyCity',
      'purifyCivilization',
    ]); // footnote *
  });

  it('uses 2d6 income with a +1 per turn low-pool bonus, capped at +3, for 5 or fewer points', () => {
    expect(CLASSIC_RULESET.income).toEqual({
      dice: { count: 2, sides: 6 },
      lowPool: { threshold: 5, bonusPerTurn: 1, maxBonus: 3 },
    });
  });

  it('has the three ages with their time scales and transition rules', () => {
    expect(getAgeInfo(CLASSIC_RULESET, 1)).toMatchObject({ focus: 'Land', yearsPerRound: 500 });
    expect(getAgeInfo(CLASSIC_RULESET, 2)).toMatchObject({ focus: 'Races', yearsPerRound: 100 });
    expect(getAgeInfo(CLASSIC_RULESET, 3)).toMatchObject({ focus: 'Relations' });
    expect(CLASSIC_RULESET.ageTransition).toEqual({ minRounds: 5, anyPlayerAfterRounds: 10 });
  });

  it('finds powers by id', () => {
    expect(findPower(CLASSIC_RULESET, 'createRace')?.name).toBe('Create Race');
    expect(findPower(CLASSIC_RULESET, 'summonPizza')).toBeUndefined();
  });
});

describe('loadRuleset', () => {
  const clone = () => JSON.parse(JSON.stringify(classicJson));

  it('rejects a power with a missing age cost', () => {
    const json = clone();
    json.powers[0].costs = [3, 5];
    expect(() => loadRuleset(json)).toThrow(InvalidRulesetError);
  });

  it('rejects negative costs', () => {
    const json = clone();
    json.powers[0].costs = [3, -5, 8];
    expect(() => loadRuleset(json)).toThrow(/powers\.0\.costs\.1/);
  });

  it('rejects duplicate power ids', () => {
    const json = clone();
    json.powers[1].id = json.powers[0].id;
    expect(() => loadRuleset(json)).toThrow(/duplicate power id "shapeLand"/);
  });

  it('rejects ages out of order', () => {
    const json = clone();
    [json.ages[0], json.ages[1]] = [json.ages[1], json.ages[0]];
    expect(() => loadRuleset(json)).toThrow(/ages must be listed in order/);
  });

  it('lists every problem in the error', () => {
    const json = clone();
    delete json.income;
    json.powers[0].category = 'cooking';
    try {
      loadRuleset(json);
      throw new Error('expected loadRuleset to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRulesetError);
      expect((error as InvalidRulesetError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
