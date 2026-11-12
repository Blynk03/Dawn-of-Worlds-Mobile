import { type GameEvent, projectWorld } from '../project';
import {
  armiesRaisedThisTurn,
  battleSuggestions,
  defendersOf,
  FIELD_MODIFIERS,
  structuresOf,
} from '../war';
import fixture from './fixtures/server-game.json';

// A real server-played game: Karak (the Dwarves) has the Iron Wall and raised the Host of Karak;
// the Deep Dwarves' Underhold raised the Pale Guard; the Host took Underhold. Durin, the Dwarves'
// avatar, stands on their homeland; the Dwarves are the greatest in the world at Steel.
const view = projectWorld(fixture.events as GameEvent[]);
const byName = <T extends { name: string }>(list: T[], name: string) =>
  list.find((x) => x.name === name)!;
const karak = byName(view.cities, 'Karak');
const underhold = byName(view.cities, 'Underhold');
const host = byName(view.armies, 'Host of Karak');
const guard = byName(view.armies, 'Pale Guard');

describe('defendersOf', () => {
  it('finds active armies raised in a city or standing on it', () => {
    // The Host of Karak stands on Underhold now, so it would defend it; the Pale Guard is scattered.
    expect(defendersOf(view, underhold.id).map((a) => a.name)).toEqual(['Host of Karak']);
    expect(defendersOf(view, underhold.id, host.id)).toEqual([]);
    // Karak's own army is away at Underhold, but it was raised in Karak.
    expect(defendersOf(view, karak.id).map((a) => a.name)).toEqual(['Host of Karak']);
    expect(defendersOf(view, 'nope')).toEqual([]);
  });
});

describe('armiesRaisedThisTurn', () => {
  it("counts a god's armies from a city this round", () => {
    expect(armiesRaisedThisTurn(view, host.godId!, karak.id)).toBe(1);
    expect(armiesRaisedThisTurn({ ...view, round: view.round + 1 }, host.godId!, karak.id)).toBe(0);
    expect(armiesRaisedThisTurn(view, 'someone-else', karak.id)).toBe(0);
  });
});

describe('battleSuggestions (DOW-54)', () => {
  it("suggests the attackers' advancements and the city's walls", () => {
    const { attacker, defender } = battleSuggestions(view, host, { kind: 'city', id: karak.id });
    expect(attacker).toEqual(['Steel', ...FIELD_MODIFIERS]);
    // Karak: the Dwarves' Steel, the Iron Wall; the Dwarves' avatar is on the homeland, not Karak.
    expect(defender).toEqual(['Steel', 'The Iron Wall', ...FIELD_MODIFIERS]);
    expect(structuresOf(view, karak.id).map((s) => s.name)).toEqual(['The Iron Wall']);
  });

  it('suggests an avatar standing with an army, and a target army’s own advancements', () => {
    const durin = view.avatars[0];
    const withDurin = { ...host, hex: durin.hex };
    const { attacker, defender } = battleSuggestions(view, withDurin, {
      kind: 'army',
      id: guard.id,
    });
    expect(attacker).toContain('Led by Durin');
    expect(defender).toEqual([...FIELD_MODIFIERS]); // the Deep Dwarves have no advancements
  });
});
