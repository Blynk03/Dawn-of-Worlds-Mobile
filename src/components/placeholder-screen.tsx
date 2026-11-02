import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

type PlaceholderScreenProps = {
  title: string;
  description: string;
  /** Jira stories that will fill in this screen, e.g. ["DOW-24"]. */
  stories?: string[];
  children?: ReactNode;
};

/** Temporary screen body used until each tab's real UI is built. */
export function PlaceholderScreen({
  title,
  description,
  stories,
  children,
}: PlaceholderScreenProps) {
  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <ThemedText themeColor="textSecondary">{description}</ThemedText>
          {stories && stories.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Coming in {stories.join(', ')}
            </ThemedText>
          ) : null}
          {children}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
