import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/form';
import { GamePanelView } from '@/components/game-panel';
import { HexDetails } from '@/components/hex-details';
import { HexMap } from '@/components/hex-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useGame } from '@/game/hooks';
import type { God } from '@/lib/database.types';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { SIDE_PANEL_WIDTH } from '@/layout/breakpoints';
import { type Hex, hexIndex } from '@/map/hex';
import type { LobbyMember } from '@/worlds/api';

type Props = { worldId: string; gods: God[]; members: LobbyMember[]; myId: string };

/**
 * A world in play: the map (tap or long-press a hex for its story) and the game panel.
 * Tablets: map and panel side by side. Phones: map on top, panel below.
 */
export function ActiveWorld({ worldId, gods, members, myId }: Props) {
  const router = useRouter();
  const game = useGame(worldId, true);
  const mode = useLayoutMode();
  const [inspected, setInspected] = useState<Hex | null>(null);
  const map = game.view.map;
  const myGod = gods.find((g) => g.user_id === myId);

  const mapArea = (
    <View style={styles.fill}>
      {map ? (
        <HexMap
          map={map}
          focused={inspected ? hexIndex(inspected, map.width) : null}
          onTapHex={setInspected}
          onLongPressHex={setInspected}
        />
      ) : (
        <ThemedView style={[styles.fill, styles.center]}>
          <ThemedText type="small" themeColor="textSecondary">
            {game.loaded ? 'This world has no map yet.' : 'Loading the map…'}
          </ThemedText>
        </ThemedView>
      )}
      {map && inspected ? (
        <View style={styles.details}>
          <HexDetails
            hex={inspected}
            map={map}
            view={game.view}
            gods={gods}
            onClose={() => setInspected(null)}
          />
        </View>
      ) : null}
    </View>
  );

  const panel = (
    <ScrollView contentContainerStyle={styles.panel}>
      <GamePanelView
        worldId={worldId}
        gods={gods}
        members={members}
        myId={myId}
        game={game}
        onAct={map ? () => router.push(`/world/${worldId}/act`) : undefined}
      />
      {myGod ? (
        <Button
          title="Edit your god"
          variant="secondary"
          onPress={() => router.push(`/world/${worldId}/god`)}
        />
      ) : null}
    </ScrollView>
  );

  if (mode === 'tablet') {
    return (
      <View style={[styles.fill, styles.row]}>
        {mapArea}
        <ThemedView style={styles.side}>{panel}</ThemedView>
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <View style={styles.phoneMap}>{mapArea}</View>
      <ThemedView style={styles.fill}>{panel}</ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  center: { alignItems: 'center', justifyContent: 'center' },
  side: { width: SIDE_PANEL_WIDTH + 40 },
  phoneMap: { height: '45%' },
  panel: { gap: Spacing.three, padding: Spacing.three, paddingBottom: Spacing.six },
  details: { position: 'absolute', left: Spacing.two, right: 56, bottom: Spacing.two },
});
