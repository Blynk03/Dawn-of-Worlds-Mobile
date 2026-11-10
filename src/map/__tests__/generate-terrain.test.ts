import classic from '@/rules/rulesets/classic.json';

import { generateLandmass, seededRandom } from '../generate';
import { CLIMATE_IDS, TERRAIN_IDS, TERRAINS } from '../terrain';

describe('terrain and climate definitions', () => {
  it('match the ruleset the server validates against', () => {
    expect([...TERRAIN_IDS].sort()).toEqual([...classic.map.terrains].sort());
    expect([...CLIMATE_IDS].sort()).toEqual([...classic.map.climates].sort());
  });

  it('use distinct colors', () => {
    const colors = Object.values(TERRAINS).map((t) => t.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('seededRandom', () => {
  it('is repeatable and in [0, 1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateLandmass', () => {
  const { width, height } = classic.map.defaultSize;

  it('is repeatable for a seed and different across seeds', () => {
    expect(generateLandmass(width, height, 7)).toEqual(generateLandmass(width, height, 7));
    expect(generateLandmass(width, height, 7)).not.toEqual(generateLandmass(width, height, 8));
  });

  it('fills every hex with ocean or grassland', () => {
    const cells = generateLandmass(width, height, 123);
    expect(cells).toHaveLength(width * height);
    expect(new Set(cells)).toEqual(new Set(['ocean', 'grassland']));
  });

  it('makes a sensible amount of land, with ocean along the edges', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const cells = generateLandmass(width, height, seed);
      const land = cells.filter((c) => c === 'grassland').length / cells.length;
      expect(land).toBeGreaterThan(0.3);
      expect(land).toBeLessThan(0.6);
      for (let x = 0; x < width; x++) {
        expect(cells[x]).toBe('ocean');
        expect(cells[(height - 1) * width + x]).toBe('ocean');
      }
    }
  });
});
