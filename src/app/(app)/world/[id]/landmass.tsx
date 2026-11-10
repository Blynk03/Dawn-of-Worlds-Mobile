import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { Button } from '@/components/form';
import { Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { HexMap } from '@/components/hex-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { WorldMapView } from '@/game/project';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { SIDE_PANEL_WIDTH } from '@/layout/breakpoints';
import type { WorldMapRow } from '@/lib/database.types';
import { generateLandmass, newSeed } from '@/map/generate';
import { type Hex, hexIndex } from '@/map/hex';
import { setInitialMap } from '@/worlds/api';
import { useLobby } from '@/worlds/hooks';

export const MAP_SIZES = [
  { label: 'Small', width: 24, height: 18 },
  { label: 'Medium', width: 32, height: 24 },
  { label: 'Large', width: 44, height: 32 },
] as const;

type Brush = 'grassland' | 'ocean';

/** DOW-30: the host sketches the starting landmass before play begins (free). */
export default function LandmassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { data: lobby } = useLobby(id);

  if (!lobby) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        <ActivityIndicator />
      </ThemedView>
    );
  }
  const isHost = lobby.members.some((m) => m.user_id === session?.user.id && m.role === 'host');
  if (!isHost || lobby.world.status !== 'lobby') {
    return (
      <ThemedView style={[styles.fill, styles.center, styles.pad]}>
        <ThemedText>
          Only the host can shape the starting landmass, before the game starts.
        </ThemedText>
      </ThemedView>
    );
  }
  return <LandmassEditor worldId={id} saved={lobby.map} />;
}

function LandmassEditor({ worldId, saved }: { worldId: string; saved: WorldMapRow | null }) {
  const router = useRouter();
  const mode = useLayoutMode();
  const [size, setSize] = useState(() =>
    saved ? { width: saved.width, height: saved.height } : { width: 32, height: 24 },
  );
  const [terrain, setTerrain] = useState<string[]>(
    () => saved?.terrain ?? generateLandmass(32, 24, newSeed()),
  );
  const [brush, setBrush] = useState<Brush>('grassland');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const map: WorldMapView = useMemo(
    () => ({
      width: size.width,
      height: size.height,
      terrain,
      climate: terrain.map(() => 'none'),
    }),
    [size, terrain],
  );
  const landShare = terrain.filter((t) => t !== 'ocean').length / terrain.length;

  const paint = (hex: Hex) => {
    const index = hexIndex(hex, size.width);
    setTerrain((current) => {
      if (current[index] === brush) return current;
      const next = [...current];
      next[index] = brush;
      return next;
    });
  };

  const regenerate = (width = size.width, height = size.height) => {
    setSize({ width, height });
    setTerrain(generateLandmass(width, height, newSeed()));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setInitialMap(worldId, size.width, size.height, terrain);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const controls = (
    <ScrollView contentContainerStyle={styles.controls}>
      <ThemedText type="small" themeColor="textSecondary">
        Sketch the rough land and seas before play begins. It&apos;s free, and it&apos;s locked once
        the First Age starts; after that, gods spend power to reshape it. Tap hexes to paint.
      </ThemedText>
      <SectionLabel>Paint</SectionLabel>
      <View style={styles.wrap}>
        <Chip label="Land" selected={brush === 'grassland'} onPress={() => setBrush('grassland')} />
        <Chip label="Ocean" selected={brush === 'ocean'} onPress={() => setBrush('ocean')} />
      </View>
      <SectionLabel>Map size</SectionLabel>
      <View style={styles.wrap}>
        {MAP_SIZES.map((s) => (
          <Chip
            key={s.label}
            label={`${s.label} (${s.width}×${s.height})`}
            selected={size.width === s.width && size.height === s.height}
            onPress={() => regenerate(s.width, s.height)}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {Math.round(landShare * 100)}% land. Changing the size starts a new random landmass.
      </ThemedText>
      <Button title="New random landmass" variant="secondary" onPress={() => regenerate()} />
      <Button title="Save landmass" onPress={save} busy={busy} />
      <ErrorMessage message={error} />
    </ScrollView>
  );

  const mapView = (
    <View style={styles.fill}>
      <HexMap map={map} onTapHex={paint} />
    </View>
  );

  return (
    <ThemedView style={styles.fill}>
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
  phoneMap: { height: '55%' },
  controls: { gap: Spacing.two, padding: Spacing.three, paddingBottom: Spacing.six },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
