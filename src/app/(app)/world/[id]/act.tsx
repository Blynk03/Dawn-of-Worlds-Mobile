import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { Button, TextField } from '@/components/form';
import { Card, Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { HexMap } from '@/components/hex-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { takeAction } from '@/game/api';
import { useGame } from '@/game/hooks';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { SIDE_PANEL_WIDTH } from '@/layout/breakpoints';
import { type Hex, hexFromIndex, hexIndex } from '@/map/hex';
import { CLIMATE_IDS, CLIMATES, TERRAIN_IDS, TERRAINS } from '@/map/terrain';
import { getActionCost } from '@/rules/actions';
import { CLASSIC_RULESET } from '@/rules/ruleset';
import type { Age } from '@/rules/schema';
import { useLobby } from '@/worlds/hooks';

type PowerId = 'shapeLand' | 'shapeClimate';
const MAX_HEXES = 64;

const POWERS: { id: PowerId; name: string; blurb: string }[] = [
  {
    id: 'shapeLand',
    name: 'Shape Land',
    blurb: 'Raise mountains, plant forests, flood the lowlands.',
  },
  { id: 'shapeClimate', name: 'Shape Climate', blurb: 'Set the weather that rules a region.' },
];

/** DOW-26 (core) + DOW-31/32: choose a power, pick hexes on the map, describe it, and confirm. */
export default function ActScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const mode = useLayoutMode();
  const { view, loaded } = useGame(id, true);
  const { data: lobby } = useLobby(id);

  const [power, setPower] = useState<PowerId>('shapeLand');
  const [choice, setChoice] = useState<string>('mountains');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const map = view.map;
  const activeGod = lobby?.gods.find((g) => g.id === view.activeGodId);
  const myTurn = !!activeGod && activeGod.user_id === session?.user.id;

  if (!loaded || !lobby || !map) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        <ActivityIndicator />
      </ThemedView>
    );
  }
  if (!myTurn) {
    return (
      <ThemedView style={[styles.fill, styles.center, styles.pad]}>
        <ThemedText>It isn&apos;t your turn right now.</ThemedText>
        <Button title="Back to the world" onPress={() => router.back()} />
      </ThemedView>
    );
  }

  const myPower = view.powers[activeGod.id]?.power ?? 0;
  const count = selected.size;
  const cost = count > 0 ? getActionCost(CLASSIC_RULESET, power, view.age as Age, count) : 0;
  const perHex = getActionCost(CLASSIC_RULESET, power, view.age as Age, 1);
  const tooExpensive = cost > myPower;
  const choices: string[] =
    power === 'shapeLand' ? TERRAIN_IDS : [...CLIMATE_IDS.filter((c) => c !== 'none'), 'none']; // "No special climate" clears it

  const toggleHex = (hex: Hex) => {
    const index = hexIndex(hex, map.width);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else if (next.size < MAX_HEXES) next.add(index);
      return next;
    });
  };

  const pickPower = (next: PowerId) => {
    setPower(next);
    setChoice(next === 'shapeLand' ? 'mountains' : 'rain');
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const hexes = [...selected].map((i) => {
        const h = hexFromIndex(i, map.width);
        return [h.x, h.y] as [number, number];
      });
      await takeAction(id, power, hexes, choice, description);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const choiceName = (c: string) =>
    power === 'shapeLand'
      ? TERRAINS[c as keyof typeof TERRAINS].name
      : CLIMATES[c as keyof typeof CLIMATES].name;

  const controls = (
    <ScrollView contentContainerStyle={styles.controls} keyboardShouldPersistTaps="handled">
      <ThemedText type="small" themeColor="textSecondary">
        {activeGod.name} has {myPower} power.
      </ThemedText>

      <SectionLabel>Power</SectionLabel>
      <View style={styles.wrap}>
        {POWERS.map((p) => (
          <Chip
            key={p.id}
            label={p.name}
            selected={power === p.id}
            onPress={() => pickPower(p.id)}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {POWERS.find((p) => p.id === power)?.blurb} {perHex} power per hex in this age. Races,
        cities and other powers arrive in later updates.
      </ThemedText>

      <SectionLabel>{power === 'shapeLand' ? 'Terrain' : 'Climate'}</SectionLabel>
      <View style={styles.wrap}>
        {choices.map((c) => (
          <Chip
            key={c}
            label={choiceName(c)}
            selected={choice === c}
            onPress={() => setChoice(c)}
          />
        ))}
      </View>

      <Card>
        <ThemedText type="smallBold">
          {count === 0
            ? 'Tap hexes on the map to choose where.'
            : `${count} ${count === 1 ? 'hex' : 'hexes'} → ${choiceName(choice)} · costs ${cost}`}
        </ThemedText>
        {tooExpensive ? (
          <ErrorMessage message={`That costs ${cost} power; you have ${myPower}.`} />
        ) : count > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            You&apos;ll have {myPower - cost} power left.
          </ThemedText>
        ) : null}
        {count > 0 ? (
          <Button
            title="Clear selection"
            variant="secondary"
            onPress={() => setSelected(new Set())}
          />
        ) : null}
      </Card>

      <TextField
        label="What happens?"
        value={description}
        onChangeText={setDescription}
        placeholder="The Spine of the World rises from the plains…"
        maxLength={280}
        multiline
        style={styles.multiline}
      />
      <Button
        title={power === 'shapeLand' ? 'Shape the land' : 'Shape the climate'}
        onPress={confirm}
        busy={busy}
        disabled={count === 0 || tooExpensive || !description.trim()}
      />
      <ErrorMessage message={error} />
    </ScrollView>
  );

  const mapView = (
    <View style={styles.fill}>
      <HexMap map={map} selected={selected} onTapHex={toggleHex} />
    </View>
  );

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ title: 'Shape the world' }} />
      {mode === 'tablet' ? (
        <View style={[styles.fill, styles.row]}>
          {mapView}
          <View style={styles.side}>{controls}</View>
        </View>
      ) : (
        <View style={styles.fill}>
          <View style={styles.phoneMap}>{mapView}</View>
          <View style={styles.fill}>{controls}</View>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  pad: { padding: Spacing.four },
  side: { width: SIDE_PANEL_WIDTH + 40 },
  phoneMap: { height: '50%' },
  controls: { gap: Spacing.two, padding: Spacing.three, paddingBottom: Spacing.six },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
