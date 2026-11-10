import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Card, GodBadge } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useGame } from '@/game/hooks';
import { ageName, type CityView, type OrderView, type RaceView } from '@/game/project';
import type { God } from '@/lib/database.types';
import { useLobby } from '@/worlds/hooks';

const ALIGNMENTS: Record<string, string> = { '1': 'Good', '0': 'Neutral', '-1': 'Evil' };
const alignmentName = (n: number) =>
  ALIGNMENTS[String(n)] ?? (n > 0 ? `Good (+${n})` : `Evil (${n})`);

/** DOW-34/35: every race in the world, with its sects and cities. */
export default function AtlasScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { view, loaded } = useGame(id, true);
  const { data: lobby } = useLobby(id);

  if (!loaded || !lobby) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.list}>
        {view.races.length === 0 ? (
          <Card>
            <ThemedText type="smallBold">No races yet</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              On your turn, choose Create Race to set the first people down on the land.
            </ThemedText>
          </Card>
        ) : (
          view.races.map((race) => (
            <RaceCard
              key={race.id}
              race={race}
              orders={view.orders.filter((o) => o.raceId === race.id)}
              cities={view.cities.filter((c) => c.raceId === race.id)}
              gods={lobby.gods}
            />
          ))
        )}
      </ScrollView>
    </ThemedView>
  );
}

function RaceCard({
  race,
  orders,
  cities,
  gods,
}: {
  race: RaceView;
  orders: OrderView[];
  cities: CityView[];
  gods: God[];
}) {
  const creator = gods.find((g) => g.id === race.godId);
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <GodBadge
          color={creator?.color ?? null}
          sigil={creator?.sigil ?? null}
          size={36}
          label={creator?.name}
        />
        <View style={styles.fill}>
          <ThemedText type="subtitle">{race.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {alignmentName(race.alignment)} · created by {creator?.name ?? 'a god'} in the{' '}
            {ageName(race.age)}, round {race.round}
          </ThemedText>
        </View>
      </View>
      <ThemedText>{race.description}</ThemedText>
      {race.appearance ? (
        <ThemedText type="small" themeColor="textSecondary">
          Appearance: {race.appearance}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        Homeland: hex {race.hex.x}, {race.hex.y}
      </ThemedText>
      {orders.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Sects: {orders.map((o) => o.name).join(', ')}
        </ThemedText>
      ) : null}

      <ThemedText type="smallBold">
        {cities.length === 0
          ? 'No cities yet'
          : `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}`}
      </ThemedText>
      {cities.map((city) => {
        const founder = gods.find((g) => g.id === city.godId);
        return (
          <View key={city.id} style={styles.city} accessibilityLabel={`City of ${city.name}`}>
            <ThemedText type="smallBold">{city.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Hex {city.hex.x}, {city.hex.y} · {alignmentName(city.alignment)} · founded at{' '}
              {founder?.name ?? 'a god'}&apos;s command in the {ageName(city.age)}, round{' '}
              {city.round}
            </ThemedText>
            <ThemedText type="small">“{city.description}”</ThemedText>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  list: { gap: Spacing.three, padding: Spacing.three, paddingBottom: Spacing.six },
  card: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  city: { gap: Spacing.half, paddingLeft: Spacing.two },
});
