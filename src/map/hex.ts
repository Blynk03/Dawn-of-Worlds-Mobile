/**
 * Hex geometry for the world map (DOW-29). Pure math, no React.
 *
 * Layout: pointy-top hexes in "odd-r" offset coordinates. Rows are y, columns are x, and odd
 * rows are shifted half a hex to the right. A map is a width × height rectangle stored row by
 * row: index = y * width + x (the same layout the database uses).
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

export type Hex = { x: number; y: number };
export type Point = { x: number; y: number };

const SQRT3 = Math.sqrt(3);

export function hexIndex(hex: Hex, width: number): number {
  return hex.y * width + hex.x;
}

export function hexFromIndex(index: number, width: number): Hex {
  return { x: index % width, y: Math.floor(index / width) };
}

export function isOnMap(hex: Hex, width: number, height: number): boolean {
  return (
    Number.isInteger(hex.x) &&
    Number.isInteger(hex.y) &&
    hex.x >= 0 &&
    hex.y >= 0 &&
    hex.x < width &&
    hex.y < height
  );
}

/** Center of a hex in map pixels, for hexes of the given radius (center to corner). */
export function hexCenter(hex: Hex, size: number): Point {
  return {
    x: SQRT3 * size * (hex.x + 0.5 * (hex.y & 1)) + (SQRT3 * size) / 2,
    y: 1.5 * size * hex.y + size,
  };
}

/** Pixel size of the whole map. */
export function mapPixelSize(
  width: number,
  height: number,
  size: number,
): {
  width: number;
  height: number;
} {
  return {
    width: SQRT3 * size * (width + 0.5),
    height: 1.5 * size * (height - 1) + 2 * size,
  };
}

/** The six corners of a hex, as an SVG `points` string. */
export function hexCorners(hex: Hex, size: number): string {
  const c = hexCenter(hex, size);
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(
      `${(c.x + size * Math.cos(angle)).toFixed(2)},${(c.y + size * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return points.join(' ');
}

/** Which hex a map-pixel point falls in, or null if it's off the map. */
export function hexAtPoint(point: Point, size: number, width: number, height: number): Hex | null {
  // Shift so hex (0,0)'s center is the origin, then convert to fractional axial coordinates.
  const px = point.x - (SQRT3 * size) / 2;
  const py = point.y - size;
  const q = ((SQRT3 / 3) * px - (1 / 3) * py) / size;
  const r = ((2 / 3) * py) / size;

  // Round in cube coordinates.
  const cx = q;
  const cz = r;
  const cy = -cx - cz;
  let rx = Math.round(cx);
  const ry = Math.round(cy);
  let rz = Math.round(cz);
  const dx = Math.abs(rx - cx);
  const dy = Math.abs(ry - cy);
  const dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (!(dy > dz)) rz = -rx - ry;

  // Axial → odd-r offset.
  const hex = { x: rx + (rz - (rz & 1)) / 2, y: rz };
  return isOnMap(hex, width, height) ? hex : null;
}

/** The (up to six) neighbors of a hex that are on the map. */
export function neighbors(hex: Hex, width: number, height: number): Hex[] {
  const odd = hex.y & 1;
  const deltas = odd
    ? [
        [1, 0],
        [-1, 0],
        [0, -1],
        [1, -1],
        [0, 1],
        [1, 1],
      ]
    : [
        [1, 0],
        [-1, 0],
        [-1, -1],
        [0, -1],
        [-1, 1],
        [0, 1],
      ];
  return deltas
    .map(([dx, dy]) => ({ x: hex.x + dx, y: hex.y + dy }))
    .filter((h) => isOnMap(h, width, height));
}
