import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/form';
import { Card, GodBadge } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { describeAction } from '@/chronicle/history';
import {
  type ActionRecord,
  ageName,
  type GameView,
  hexChanges,
  settlementsAt,
  type WorldMapView,
} from '@/game/project';
import type { God } from '@/lib/database.types';
import { type Hex, hexIndex } from '@/map/hex';
import { climateInfo, terrainInfo } from '@/map/terrain';

/** e.g. "Shape Land: Hills", "Create Race: Dwarves", "Command Race: founded Karak". */
function describeChange(change: ActionRecord): string {
  const { power, what } = describeAction(change);
  return `${power}: ${what}`;
}

const ALIGNMENT = (n: number) => (n > 0 ? 'good' : n < 0 ? 'evil' : 'neutral');

/** DOW-33: what a hex is now, and every change gods have made to it. */
export function HexDetails({
  hex,
  map,
  view,
  gods,
  onClose,
}: {
  hex: Hex;
  map: WorldMapView;
  view: GameView | null;
  gods: God[];
  onClose: () => void;
}) {
  const index = hexIndex(hex, map.width);
  const terrain = terrainInfo(map.terrain[index]);
  const climate =
    map.climate[index] && map.climate[index] !== 'none' ? climateInfo(map.climate[index]) : null;
  const changes = view ? hexChanges(view, index) : [];
  const { race, city } = view ? settlementsAt(view, hex) : { race: null, city: null };
  const cityRace = city && view ? view.races.find((r) => r.id === city.raceId) : null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <ThemedText type="smallBold">
            {terrain.name}
            {climate ? ` · ${climate.name}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Hex {hex.x}, {hex.y}
          </ThemedText>
        </View>
        <Button title="Close" variant="secondary" onPress={onClose} />
      </View>
      {race ? (
        <ThemedText type="small">
          <ThemedText type="smallBold">Homeland of the {race.name}</ThemedText>
          {` · ${ALIGNMENT(race.alignment)}`}
        </ThemedText>
      ) : null}
      {city ? (
        <ThemedText type="small">
          <ThemedText type="smallBold">City of {city.name}</ThemedText>
          {cityRace ? ` · built by the ${cityRace.name}` : ''}
        </ThemedText>
      ) : null}
      {changes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Untouched since the dawn of the world.
        </ThemedText>
      ) : (
        changes.map((change) => {
          const god = gods.find((g) => g.id === change.godId);
          return (
            <View key={change.seq} style={styles.change}>
              <GodBadge
                color={god?.color ?? null}
                sigil={god?.sigil ?? null}
                size={24}
                label={god?.name}
              />
              <View style={styles.changeText}>
                <ThemedText type="small">
                  <ThemedText type="smallBold">{god?.name ?? 'A god'}</ThemedText>
                  {` · ${describeChange(change)}`}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  “{change.description}” · {ageName(change.age)}, round {change.round}
                </ThemedText>
              </View>
            </View>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerText: { flex: 1 },
  change: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  changeText: { flex: 1, gap: Spacing.half },
});
