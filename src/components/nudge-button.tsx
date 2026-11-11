import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/form';
import { ErrorMessage } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useNow } from '@/game/hooks';
import { loadNextNudge, nudge, waitText } from '@/notifications/api';

/** DOW-28: nudge whoever is taking their turn (once every 12 hours each). */
export function NudgeButton({
  worldId,
  myId,
  activeName,
}: {
  worldId: string;
  myId: string;
  activeName: string;
}) {
  const now = useNow();
  // undefined while loading; null when you can nudge now.
  const [next, setNext] = useState<Date | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadNextNudge(worldId, myId).then(setNext, () => setNext(null));
    }, [worldId, myId]),
  );

  if (next === undefined) return null;

  const press = async () => {
    setBusy(true);
    setError(null);
    try {
      setNext(await nudge(worldId));
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const waiting = next && next.getTime() > now.getTime();
  return (
    <View style={{ gap: Spacing.one }}>
      {waiting ? (
        <ThemedText type="small" themeColor="textSecondary">
          {sent ? `Nudged! ${activeName}'s player will get a notification. ` : 'You nudged them. '}
          You can nudge again {waitText(next, now)}.
        </ThemedText>
      ) : (
        <Button title={`Nudge ${activeName}`} variant="secondary" onPress={press} busy={busy} />
      )}
      <ErrorMessage message={error} />
    </View>
  );
}
