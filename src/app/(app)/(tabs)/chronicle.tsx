import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useUnreadCounts } from '@/chronicle/hooks';
import { Card, ErrorMessage, GodBadge, UnreadBadge } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/auth/auth-provider';
import { useMyWorlds } from '@/worlds/hooks';

/** DOW-37: what's new across your worlds; each opens that world's chronicle. */
export default function ChronicleTab() {
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id ?? '';
  const { data: worlds, error, loading, refresh } = useMyWorlds();
  const unread = useUnreadCounts();
  const inPlay = (worlds ?? [])
    .filter((w) => w.status === 'active')
    .sort((a, b) => (unread[b.id] ?? 0) - (unread[a.id] ?? 0));

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading && !!worlds} onRefresh={refresh} />}>
          <ThemedText type="subtitle">Chronicle</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            What the gods have done in your worlds. Open one to react, comment, or read its history.
          </ThemedText>
          <ErrorMessage message={error} />
          {worlds && inPlay.length === 0 ? (
            <Card>
              <ThemedText type="smallBold">No games in play</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Once a world&apos;s game starts, its chronicle shows up here.
              </ThemedText>
            </Card>
          ) : null}
          {inPlay.map((world) => {
            const myGod = world.gods.find((g) => g.user_id === myId);
            const count = unread[world.id] ?? 0;
            return (
              <Pressable
                key={world.id}
                accessibilityRole="button"
                accessibilityLabel={`Open the chronicle of ${world.name}`}
                onPress={() => router.push(`/world/${world.id}/chronicle`)}
                style={({ pressed }) => pressed && styles.pressed}>
                <Card style={styles.row}>
                  <GodBadge color={myGod?.color ?? null} sigil={myGod?.sigil ?? null} />
                  <View style={styles.fill}>
                    <ThemedText type="smallBold">{world.name}</ThemedText>
                    <ThemedText type="small" themeColor={count > 0 ? 'accent' : 'textSecondary'}>
                      {count > 0 ? 'New actions and comments' : 'Up to date'}
                    </ThemedText>
                  </View>
                  <UnreadBadge count={count} />
                </Card>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.four },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  pressed: { opacity: 0.7 },
});
