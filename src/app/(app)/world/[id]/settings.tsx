import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { Card, Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  loadWorldMuted,
  REMINDER_OPTIONS,
  setReminderHours,
  setWorldMuted,
} from '@/notifications/api';
import { type PushStatus, registerForPush } from '@/notifications/push';
import { useLobby } from '@/worlds/hooks';

const DEVICE_STATUS: Record<PushStatus, string> = {
  on: 'This device gets notifications.',
  denied:
    'Notifications are blocked for this app. Turn them on in your device’s settings (Apps → Dawn of Worlds → Notifications).',
  'not-configured': 'Notifications aren’t set up in this version of the app yet.',
  error: 'This device couldn’t sign up for notifications. Try again after updating the app.',
  unsupported:
    'Notifications go to the Android app. In the browser, watch for the “new” badges on your worlds.',
};

/** DOW-16/28: notification settings for one world. */
export default function WorldSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const lobby = useLobby(id);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [device, setDevice] = useState<PushStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWorldMuted(id).then(setMuted, (e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => {
    registerForPush().then(setDevice);
  }, []);

  if (!lobby.data || muted === null) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        {error ? <ErrorMessage message={error} /> : <ActivityIndicator />}
      </ThemedView>
    );
  }

  const { world, members } = lobby.data;
  const isHost = members.some((m) => m.user_id === session?.user.id && m.role === 'host');

  const toggleMute = async (on: boolean) => {
    setError(null);
    setMuted(!on);
    try {
      await setWorldMuted(id, !on);
    } catch (e) {
      setMuted(on);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const chooseReminder = async (hours: number) => {
    setError(null);
    try {
      await setReminderHours(id, hours);
      lobby.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={styles.row}>
            <View style={styles.fill}>
              <ThemedText type="smallBold">Notifications from {world.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Your turn, new rounds, nudges and reminders.
              </ThemedText>
            </View>
            <Switch
              accessibilityLabel={`Notifications from ${world.name}`}
              value={!muted}
              onValueChange={toggleMute}
            />
          </View>
          {device ? (
            <ThemedText
              type="small"
              themeColor={device === 'on' || device === 'unsupported' ? 'textSecondary' : 'accent'}>
              {DEVICE_STATUS[device]}
            </ThemedText>
          ) : Platform.OS !== 'web' ? (
            <ActivityIndicator />
          ) : null}
        </Card>

        <Card>
          <SectionLabel>Turn reminders</SectionLabel>
          <ThemedText type="small" themeColor="textSecondary">
            If a turn sits this long, the player whose turn it is gets a reminder.
            {isHost ? '' : ' The host chooses this.'}
          </ThemedText>
          <View style={styles.wrap}>
            {REMINDER_OPTIONS.map((hours) => (
              <Chip
                key={hours}
                label={hours === 0 ? 'Off' : `${hours} hours`}
                selected={world.reminder_hours === hours}
                onPress={isHost ? () => chooseReminder(hours) : () => {}}
              />
            ))}
          </View>
        </Card>
        <ErrorMessage message={error} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { gap: Spacing.three, padding: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
