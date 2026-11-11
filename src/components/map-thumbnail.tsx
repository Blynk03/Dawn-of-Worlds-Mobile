import { memo } from 'react';
import Svg, { Polygon } from 'react-native-svg';

import type { WorldMapView } from '@/game/project';
import { hexCenter, hexCorners, hexIndex } from '@/map/hex';
import { terrainInfo } from '@/map/terrain';

const SIZE = 10;
/** Hexes of context shown around the action. */
const PAD = 2;

/**
 * DOW-37: a small, static picture of the part of the map an action touched, with those hexes
 * outlined. Draws only the surrounding window, so it's cheap enough for every card in a feed.
 */
export const MapThumbnail = memo(function MapThumbnail({
  map,
  hexes,
  width = 120,
  height = 84,
}: {
  map: WorldMapView;
  hexes: [number, number][];
  width?: number;
  height?: number;
}) {
  if (hexes.length === 0) return null;
  const xs = hexes.map((h) => h[0]);
  const ys = hexes.map((h) => h[1]);
  const x0 = Math.max(0, Math.min(...xs) - PAD);
  const x1 = Math.min(map.width - 1, Math.max(...xs) + PAD);
  const y0 = Math.max(0, Math.min(...ys) - PAD);
  const y1 = Math.min(map.height - 1, Math.max(...ys) + PAD);

  const window: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) window.push({ x, y });

  // The window's pixel bounds, so the SVG can scale it to fit.
  const w = Math.sqrt(3) * SIZE;
  const left = hexCenter({ x: x0, y: y0 }, SIZE).x - w;
  const right = hexCenter({ x: x1, y: y1 }, SIZE).x + w;
  const top = hexCenter({ x: x0, y: y0 }, SIZE).y - SIZE;
  const bottom = hexCenter({ x: x0, y: y1 }, SIZE).y + SIZE;
  const chosen = new Set(hexes.map(([x, y]) => hexIndex({ x, y }, map.width)));

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
      preserveAspectRatio="xMidYMid slice"
      accessibilityLabel={`Map around ${hexes.length === 1 ? 'the hex' : `${hexes.length} hexes`}`}>
      {window.map((h) => {
        const index = hexIndex(h, map.width);
        return (
          <Polygon
            key={index}
            points={hexCorners(h, SIZE)}
            fill={terrainInfo(map.terrain[index] ?? '').color}
            stroke="rgba(0,0,0,0.15)"
            strokeWidth={0.5}
          />
        );
      })}
      {[...chosen].map((index) => {
        const h = { x: index % map.width, y: Math.floor(index / map.width) };
        return (
          <Polygon
            key={`s${index}`}
            points={hexCorners(h, SIZE)}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={2}
          />
        );
      })}
    </Svg>
  );
});
