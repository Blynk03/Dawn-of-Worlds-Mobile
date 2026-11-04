import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { Button, TextField } from '@/components/form';
import { Card, ErrorMessage, GodBadge } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { WorldSummary } from '@/worlds/api';
import { joinWorld } from '@/worlds/api';
import { useMyWorlds } from '@/worlds/hooks';
import { isValidInviteCode, takePendingInvite } from '@/worlds/invite';
import { sortWorldsForHome, worldAction, worldStatusLabel } from '@/worlds/summaries';

/** DOW-24: your worlds, what each one needs from you, and ways to start or join one. */
export default function WorldsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id ?? '';
  const { data: worlds, error, loading, refresh } = useMyWorlds();

  // Continue an invite link that was opened before signing in.
  useEffect(() => {
    const pending = takePendingInvite();
    if (pending) router.push(`/join/${pending}`);
  }, [router]);

  const sorted = useMemo(() => sortWorldsForHome(worlds ?? [], myId), [worlds, myId]);

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading && !!worlds} onRefresh={refresh} />}>
          <ThemedText type="subtitle">Worlds</ThemedText>

          <View style={styles.actions}>
            <Button title="New world" onPress={() => router.push('/world/new')} />
          </View>
          <JoinByCode onJoined={(id) => router.push(`/world/${id}`)} />

          <ErrorMessage message={error} />

          {worlds && sorted.length === 0 ? (
            <Card>
              <ThemedText type="smallBold">No worlds yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Create one and invite your friends, or enter a code a friend sent you.
              </ThemedText>
            </Card>
          ) : null}

          {sorted.map((world) => (
            <WorldCard
              key={world.id}
              world={world}
              myId={myId}
              onPress={() => router.push(`/world/${world.id}`)}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function WorldCard({
  world,
  myId,
  onPress,
}: {
  world: WorldSummary;
  myId: string;
  onPress: () => void;
}) {
  const myGod = world.gods.find((g) => g.user_id === myId);
  const needsYou = ['createGod', 'startGame'].includes(worldAction(world, myId));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${world.name}`}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <Card style={styles.worldCard}>
        <GodBadge color={myGod?.color ?? null} sigil={myGod?.sigil ?? null} />
        <View style={styles.worldText}>
          <ThemedText type="smallBold">{world.name}</ThemedText>
          <ThemedText type="small" themeColor={needsYou ? 'accent' : 'textSecondary'}>
            {worldStatusLabel(world, myId)}
          </ThemedText>
          {world.gods.length > 0 ? (
            <View style={styles.sigils}>
              {world.gods.map((g) => (
                <GodBadge key={g.id} color={g.color} sigil={g.sigil} size={22} label={g.name} />
              ))}
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

function JoinByCode({ onJoined }: { onJoined: (worldId: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const worldId = await joinWorld(code);
      setCode('');
      onJoined(worldId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <TextField
        label="Join with an invite code"
        value={code}
        onChangeText={setCode}
        placeholder="ABC-234"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={9}
        returnKeyType="go"
        onSubmitEditing={() => isValidInviteCode(code) && join()}
      />
      <Button
        title="Join world"
        variant="secondary"
        onPress={join}
        disabled={!isValidInviteCode(code)}
        busy={busy}
      />
      <ErrorMessage message={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  actions: { flexDirection: 'row', gap: Spacing.two },
  worldCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  worldText: { flex: 1, gap: Spacing.half },
  sigils: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.one },
  pressed: { opacity: 0.8 },
});
