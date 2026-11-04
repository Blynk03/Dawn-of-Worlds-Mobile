/** Choices offered when creating a god (DOW-23). */

export const SPHERES = [
  'Light',
  'Darkness',
  'Life',
  'Death',
  'War',
  'Peace',
  'Nature',
  'Harvest',
  'Sea',
  'Sky',
  'Storms',
  'Fire',
  'Earth',
  'Knowledge',
  'Magic',
  'Craft',
  'Love',
  'Trickery',
  'Order',
  'Chaos',
  'Dreams',
  'Fate',
] as const;

export const MAX_SPHERES = 3;

/** Distinct, readable on both light and dark themes. Hex must be uppercase (database check). */
export const GOD_COLORS = [
  { hex: '#E3B05B', name: 'Gold' },
  { hex: '#DC2626', name: 'Crimson' },
  { hex: '#EA580C', name: 'Ember' },
  { hex: '#16A34A', name: 'Verdant' },
  { hex: '#0D9488', name: 'Tide' },
  { hex: '#2563EB', name: 'Azure' },
  { hex: '#7C3AED', name: 'Violet' },
  { hex: '#DB2777', name: 'Rose' },
  { hex: '#78716C', name: 'Stone' },
  { hex: '#A16207', name: 'Bronze' },
] as const;

/** Text symbols that render on iOS, Android and the web without an icon font. */
export const SIGILS = [
  { symbol: '☀', name: 'Sun' },
  { symbol: '☾', name: 'Moon' },
  { symbol: '★', name: 'Star' },
  { symbol: '✦', name: 'Spark' },
  { symbol: '⚔', name: 'Swords' },
  { symbol: '⚓', name: 'Anchor' },
  { symbol: '❄', name: 'Snowflake' },
  { symbol: '♛', name: 'Crown' },
  { symbol: '⚘', name: 'Flower' },
  { symbol: '☠', name: 'Skull' },
  { symbol: '⚡', name: 'Lightning' },
  { symbol: '♆', name: 'Trident' },
  { symbol: '⚒', name: 'Hammers' },
  { symbol: '☘', name: 'Clover' },
  { symbol: '♜', name: 'Tower' },
  { symbol: '◈', name: 'Gem' },
] as const;
