import { GOD_COLORS, SIGILS, SPHERES } from '../god-options';
import {
  type GodDraft,
  hasErrors,
  toggleSphere,
  validateGod,
  validateWorldName,
} from '../validation';

describe('validateWorldName', () => {
  it('requires a name', () => {
    expect(validateWorldName('   ')).toMatch(/name/);
  });
  it('limits length', () => {
    expect(validateWorldName('x'.repeat(61))).toMatch(/60/);
    expect(validateWorldName('x'.repeat(60))).toBeNull();
  });
  it('accepts a normal name', () => {
    expect(validateWorldName(' Aerth ')).toBeNull();
  });
});

const good: GodDraft = {
  name: 'Solara',
  spheres: ['Light', 'Fire'],
  personality: 'Proud and warm',
  color: GOD_COLORS[0].hex,
  sigil: SIGILS[0].symbol,
};

describe('validateGod', () => {
  it('accepts a complete god', () => {
    expect(validateGod(good)).toEqual({});
    expect(hasErrors(validateGod(good))).toBe(false);
  });

  it('requires name, spheres, color and sigil', () => {
    const errors = validateGod({
      name: ' ',
      spheres: [],
      personality: '',
      color: null,
      sigil: null,
    });
    expect(Object.keys(errors).sort()).toEqual(['color', 'name', 'sigil', 'spheres']);
  });

  it('allows at most 3 spheres', () => {
    expect(validateGod({ ...good, spheres: ['War', 'Sea', 'Sky', 'Fire'] }).spheres).toBeDefined();
  });

  it('keeps names and colors unique within the world', () => {
    const others = [{ name: 'solara ', color: '#123456' }];
    expect(validateGod(good, others).name).toMatch(/already has that name/);
    expect(
      validateGod({ ...good, name: 'Umbra' }, [{ name: 'X', color: good.color! }]).color,
    ).toMatch(/already uses that color/);
  });

  it('limits personality length', () => {
    expect(validateGod({ ...good, personality: 'x'.repeat(501) }).personality).toBeDefined();
  });
});

describe('toggleSphere', () => {
  it('adds and removes', () => {
    expect(toggleSphere(['War'], 'Sea')).toEqual(['War', 'Sea']);
    expect(toggleSphere(['War', 'Sea'], 'War')).toEqual(['Sea']);
  });
  it('does not go over 3', () => {
    expect(toggleSphere(['War', 'Sea', 'Sky'], 'Fire')).toEqual(['War', 'Sea', 'Sky']);
  });
});

describe('god options', () => {
  it('colors are unique uppercase hex (database check)', () => {
    const hexes = GOD_COLORS.map((c) => c.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
    hexes.forEach((hex) => expect(hex).toMatch(/^#[0-9A-F]{6}$/));
  });
  it('sigils fit the database limit and are unique', () => {
    const symbols = SIGILS.map((s) => s.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    symbols.forEach((s) => expect(s.length).toBeLessThanOrEqual(8));
  });
  it('spheres are unique', () => {
    expect(new Set(SPHERES).size).toBe(SPHERES.length);
  });
});
