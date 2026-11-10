import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Button, TextField } from '@/components/form';
import { Card, Chip, ErrorMessage } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createWorld } from '@/worlds/api';
import { validateWorldName } from '@/worlds/validation';

const TURN_LIMITS: { label: string; hours: number | null }[] = [
  { label: 'No limit', hours: null },
  { label: '24 hours', hours: 24 },
  { label: '48 hours', hours: 48 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
];

/** DOW-22: create a world. The creator becomes its host. */
export default function NewWorldScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [isGm, setIsGm] = useState(false);
  const [turnLimit, setTurnLimit] = useState<number | null>(48);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameProblem = validateWorldName(name);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const world = await createWorld(name, isGm, turnLimit);
      router.replace(`/world/${world.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label="World name"
          value={name}
          onChangeText={setName}
          placeholder="Aerth"
          autoFocus
          maxLength={60}
          returnKeyType="done"
        />
        <Card>
          <ThemedText type="smallBold">Rules</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Classic Dawn of Worlds (2005): 2d6 power each round, costs change with each age.
          </ThemedText>
        </Card>
        <Card>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText type="smallBold">I&apos;m the game master</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                The GM can run the world without playing a god of their own. You can still make one.
              </ThemedText>
            </View>
            <Switch
              accessibilityLabel="I'm the game master"
              value={isGm}
              onValueChange={setIsGm}
              trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
            />
          </View>
        </Card>
        <Card>
          <ThemedText type="smallBold">Turn time limit</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            If someone doesn&apos;t take their turn in time, any player can skip it so the game
            keeps moving.
          </ThemedText>
          <View style={styles.chips}>
            {TURN_LIMITS.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                selected={turnLimit === option.hours}
                onPress={() => setTurnLimit(option.hours)}
              />
            ))}
          </View>
        </Card>
        <Button title="Create world" onPress={create} disabled={!!nameProblem} busy={busy} />
        <ErrorMessage message={error} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowText: { flex: 1, gap: Spacing.half },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
