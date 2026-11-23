import { CLASSIC_RULESET } from '../ruleset';
import { incomeSummary, powerTable } from '../summary';

describe('powerTable (DOW-78)', () => {
  it('groups every power, priced for the age', () => {
    const table = powerTable(CLASSIC_RULESET, 2);
    const all = table.flatMap((g) => g.powers);
    expect(all).toHaveLength(CLASSIC_RULESET.powers.length);
    expect(table.map((g) => g.title)).toEqual([
      'Land and climate',
      'Races and civilizations',
      'Cities and armies',
      'Orders',
      'Avatars',
      'Good and evil',
      'Fate',
    ]);
    const race = all.find((p) => p.id === 'createRace')!;
    expect(race).toMatchObject({ now: 6, costs: [22, 6, 15], notes: [], comingSoon: false });
  });

  it('carries the footnotes', () => {
    const all = powerTable(CLASSIC_RULESET, 1).flatMap((g) => g.powers);
    const byId = (id: string) => all.find((p) => p.id === id)!;
    expect(byId('shapeLand').notes).toEqual(['per hex']);
    expect(byId('commandRace').notes).toEqual(['needs your order or avatar among them']);
    expect(byId('purifyCity').notes).toEqual(['once per target each turn']);
    expect(byId('catastrophe')).toMatchObject({ comingSoon: true, now: 10 });
    expect(byId('event').comingSoon).toBe(true);
  });
});

describe('incomeSummary', () => {
  it('describes the dice and the low-pool bonus', () => {
    expect(incomeSummary(CLASSIC_RULESET)).toBe(
      '2d6 power at the start of each round. End a turn with 5 or less and you gain +1 more each round (it adds up, to +3) until you end a turn with more.',
    );
  });
});
