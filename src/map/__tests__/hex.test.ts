import {
  hexAtPoint,
  hexCenter,
  hexCorners,
  hexFromIndex,
  hexIndex,
  isOnMap,
  mapPixelSize,
  neighbors,
} from '../hex';

describe('hex indexing', () => {
  it('round-trips index and coordinates row by row', () => {
    for (let i = 0; i < 40; i++) expect(hexIndex(hexFromIndex(i, 10), 10)).toBe(i);
    expect(hexIndex({ x: 3, y: 2 }, 10)).toBe(23);
  });

  it('knows what is on the map', () => {
    expect(isOnMap({ x: 0, y: 0 }, 10, 8)).toBe(true);
    expect(isOnMap({ x: 9, y: 7 }, 10, 8)).toBe(true);
    expect(isOnMap({ x: 10, y: 0 }, 10, 8)).toBe(false);
    expect(isOnMap({ x: -1, y: 0 }, 10, 8)).toBe(false);
    expect(isOnMap({ x: 1.5, y: 0 }, 10, 8)).toBe(false);
  });
});

describe('geometry', () => {
  const size = 10;

  it('shifts odd rows half a hex to the right', () => {
    const even = hexCenter({ x: 0, y: 0 }, size);
    const odd = hexCenter({ x: 0, y: 1 }, size);
    expect(odd.x - even.x).toBeCloseTo((Math.sqrt(3) * size) / 2);
    expect(odd.y - even.y).toBeCloseTo(1.5 * size);
  });

  it('fits every hex inside the map size', () => {
    const { width, height } = mapPixelSize(10, 8, size);
    for (let i = 0; i < 80; i++) {
      for (const pair of hexCorners(hexFromIndex(i, 10), size).split(' ')) {
        const [x, y] = pair.split(',').map(Number);
        expect(x).toBeGreaterThanOrEqual(-0.01);
        expect(y).toBeGreaterThanOrEqual(-0.01);
        expect(x).toBeLessThanOrEqual(width + 0.01);
        expect(y).toBeLessThanOrEqual(height + 0.01);
      }
    }
  });

  it('finds the hex under every hex center (tapping)', () => {
    for (let i = 0; i < 80; i++) {
      const hex = hexFromIndex(i, 10);
      expect(hexAtPoint(hexCenter(hex, size), size, 10, 8)).toEqual(hex);
    }
  });

  it('finds the right hex near its edges', () => {
    const hex = { x: 4, y: 3 };
    const c = hexCenter(hex, size);
    for (let angle = 0; angle < 360; angle += 30) {
      const r = size * 0.8; // inside the hex, close to the edge
      const p = {
        x: c.x + r * Math.cos((angle * Math.PI) / 180),
        y: c.y + r * Math.sin((angle * Math.PI) / 180),
      };
      expect(hexAtPoint(p, size, 10, 8)).toEqual(hex);
    }
  });

  it('returns null off the map', () => {
    expect(hexAtPoint({ x: -50, y: -50 }, size, 10, 8)).toBeNull();
    expect(hexAtPoint({ x: 10_000, y: 10 }, size, 10, 8)).toBeNull();
  });
});

describe('neighbors', () => {
  it('a middle hex has six neighbors, each adjacent', () => {
    for (const hex of [
      { x: 4, y: 3 },
      { x: 4, y: 4 },
    ]) {
      const around = neighbors(hex, 10, 8);
      expect(around).toHaveLength(6);
      const c = hexCenter(hex, 10);
      for (const n of around) {
        const d = hexCenter(n, 10);
        expect(Math.hypot(d.x - c.x, d.y - c.y)).toBeCloseTo(Math.sqrt(3) * 10);
      }
    }
  });

  it('corner hexes have fewer neighbors', () => {
    expect(neighbors({ x: 0, y: 0 }, 10, 8)).toHaveLength(2);
  });
});
