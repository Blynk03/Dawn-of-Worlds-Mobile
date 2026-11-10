/**
 * Random starting landmass for the host's map editor (DOW-30). Seeded, so the same seed always
 * gives the same map. Produces 'ocean' and 'grassland' only; gods shape the rest in play.
 */
import { hexFromIndex, neighbors } from './hex';

/** Small fast PRNG (mulberry32). Returns numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type LandmassOptions = {
  /** Roughly how much of the map is land, 0..1. */
  landShare?: number;
  /** Number of land "blobs" (continents and islands). */
  blobs?: number;
};

export function generateLandmass(
  width: number,
  height: number,
  seed: number,
  { landShare = 0.45, blobs = 4 }: LandmassOptions = {},
): string[] {
  const rand = seededRandom(seed);
  const centers = Array.from({ length: blobs }, (_, i) => ({
    x: width * (0.2 + 0.6 * rand()),
    y: height * (0.2 + 0.6 * rand()),
    r: (i === 0 ? 0.32 : 0.12 + 0.14 * rand()) * Math.min(width, height),
  }));

  // Score each hex by closeness to a blob center, plus noise.
  const scores = Array.from({ length: width * height }, (_, index) => {
    const { x, y } = hexFromIndex(index, width);
    const px = x + 0.5 * (y & 1);
    let best = 0;
    for (const c of centers) {
      const d = Math.hypot(px - c.x, (y - c.y) * 0.87) / c.r;
      best = Math.max(best, 1 - d);
    }
    // Keep a ring of ocean around the edge.
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
    const edgePenalty = edge < 1 ? 1 : edge < 2 ? 0.25 : 0;
    return best + (rand() - 0.5) * 0.35 - edgePenalty;
  });

  // Land is the top `landShare` of scores.
  const sorted = [...scores].sort((a, b) => b - a);
  const threshold = sorted[Math.max(0, Math.floor(scores.length * landShare) - 1)];
  let land = scores.map((s) => s >= threshold);

  // Two smoothing passes: fill in lone ocean hexes, drop lone land hexes.
  for (let pass = 0; pass < 2; pass++) {
    land = land.map((isLand, index) => {
      const around = neighbors(hexFromIndex(index, width), width, height);
      const landAround = around.filter((h) => land[h.y * width + h.x]).length;
      if (!isLand && landAround >= 5) return true;
      if (isLand && landAround <= 1) return false;
      return isLand;
    });
  }

  return land.map((isLand) => (isLand ? 'grassland' : 'ocean'));
}

export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
