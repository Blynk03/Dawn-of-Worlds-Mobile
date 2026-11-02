import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { SIDE_PANEL_WIDTH } from '@/layout/breakpoints';

type SplitViewProps = {
  /** Main content, e.g. the map. Always shown. */
  main: ReactNode;
  /** Side panel content. Shown beside `main` on tablets only; on phones it lives in its own tab. */
  side: ReactNode;
};

/**
 * Tablet: main content and a side panel side by side.
 * Phone: main content only.
 */
export function SplitView({ main, side }: SplitViewProps) {
  const mode = useLayoutMode();

  if (mode === 'phone') {
    return (
      <View style={styles.fill} testID="split-view-phone">
        {main}
      </View>
    );
  }

  return (
    <View style={[styles.fill, styles.row]} testID="split-view-tablet">
      <View style={styles.fill}>{main}</View>
      <ThemedView type="backgroundElement" style={styles.side} testID="split-view-side">
        {side}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  side: { width: SIDE_PANEL_WIDTH },
});
