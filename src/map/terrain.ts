/**
 * How terrain and climate look and read (DOW-31/32). The ids must match the ruleset's map lists
 * (src/rules/rulesets/classic.json), which the server validates against; a test checks this.
 */

export type TerrainId =
  | 'ocean'
  | 'lake'
  | 'grassland'
  | 'forest'
  | 'jungle'
  | 'hills'
  | 'mountains'
  | 'desert'
  | 'tundra'
  | 'swamp';

export type ClimateId = 'none' | 'fog' | 'rain' | 'snow' | 'sun' | 'heat' | 'cold' | 'sleet';

export const TERRAINS: Record<
  TerrainId,
  { name: string; color: string; water: boolean; glyph: string }
> = {
  ocean: { name: 'Ocean', color: '#2F6690', water: true, glyph: '' },
  lake: { name: 'Lake', color: '#5DA9E9', water: true, glyph: '' },
  grassland: { name: 'Grassland', color: '#9BC53D', water: false, glyph: '' },
  forest: { name: 'Forest', color: '#3A7D44', water: false, glyph: '♣' },
  jungle: { name: 'Jungle', color: '#1B5E20', water: false, glyph: '♠' },
  hills: { name: 'Hills', color: '#B5A267', water: false, glyph: '⌒' },
  mountains: { name: 'Mountains', color: '#8D8D8D', water: false, glyph: '▲' },
  desert: { name: 'Desert', color: '#E9C46A', water: false, glyph: '∴' },
  tundra: { name: 'Tundra', color: '#D9E4E8', water: false, glyph: '' },
  swamp: { name: 'Swamp', color: '#6B7F4A', water: false, glyph: '≈' },
};

export const TERRAIN_IDS = Object.keys(TERRAINS) as TerrainId[];

export const CLIMATES: Record<ClimateId, { name: string; glyph: string }> = {
  none: { name: 'No special climate', glyph: '' },
  fog: { name: 'Fog', glyph: '≋' },
  rain: { name: 'Rain', glyph: '☂' },
  snow: { name: 'Snow', glyph: '❄' },
  sun: { name: 'Sun', glyph: '☀' },
  heat: { name: 'Heat', glyph: '♨' },
  cold: { name: 'Cold', glyph: '✳' },
  sleet: { name: 'Sleet', glyph: '⁂' },
};

export const CLIMATE_IDS = Object.keys(CLIMATES) as ClimateId[];

export function terrainInfo(id: string) {
  return TERRAINS[id as TerrainId] ?? { name: id, color: '#999999', water: false, glyph: '?' };
}

export function climateInfo(id: string) {
  return CLIMATES[id as ClimateId] ?? { name: id, glyph: '' };
}
