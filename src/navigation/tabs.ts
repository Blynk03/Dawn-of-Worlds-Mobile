import type { MaterialIcon, SFSymbolIcon } from 'expo-router/native-tabs';

/**
 * The app's top-level tabs, shared by the native tab bar (iOS/Android) and the web tab list.
 * `name` must match a route file in src/app/.
 */
export type TabDefinition = {
  name: 'index' | 'map' | 'chronicle' | 'atlas' | 'god';
  href: '/' | '/map' | '/chronicle' | '/atlas' | '/god';
  label: string;
  /** SF Symbol (iOS). */
  sf: SFSymbolIcon['sf'];
  /** Material Symbol (Android). */
  md: MaterialIcon['md'];
};

export const TABS: readonly TabDefinition[] = [
  { name: 'index', href: '/', label: 'Worlds', sf: 'globe.americas.fill', md: 'public' },
  { name: 'map', href: '/map', label: 'Map', sf: 'map.fill', md: 'map' },
  {
    name: 'chronicle',
    href: '/chronicle',
    label: 'Chronicle',
    sf: 'book.closed.fill',
    md: 'menu_book',
  },
  { name: 'atlas', href: '/atlas', label: 'Atlas', sf: 'books.vertical.fill', md: 'auto_stories' },
  { name: 'god', href: '/god', label: 'My God', sf: 'sparkles', md: 'auto_awesome' },
];
