import { StyleSheet } from 'react-native';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { SplitView } from '@/components/split-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function MapScreen() {
  return (
    <SplitView
      main={
        <PlaceholderScreen
          title="Map"
          description="The shared hex map of your world."
          stories={['DOW-29', 'DOW-31']}
        />
      }
      side={
        <ThemedView type="backgroundElement" style={styles.side}>
          <ThemedText type="smallBold">Turn panel</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            On tablets, your power, the Act button and recent chronicle entries sit beside the map.
          </ThemedText>
        </ThemedView>
      }
    />
  );
}

const styles = StyleSheet.create({
  side: { flex: 1, gap: Spacing.two, padding: Spacing.four, paddingTop: Spacing.six },
});
