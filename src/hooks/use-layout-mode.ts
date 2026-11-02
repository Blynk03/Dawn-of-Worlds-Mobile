import { useWindowDimensions } from 'react-native';

import { getLayoutMode, type LayoutMode } from '@/layout/breakpoints';

/** Current layout mode. Updates on rotation, split-screen, and window resizes. */
export function useLayoutMode(): LayoutMode {
  const { width } = useWindowDimensions();
  return getLayoutMode(width);
}
