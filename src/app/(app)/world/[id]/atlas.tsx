import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from 'react-native';

import { Card, GodBadge } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useGame } from '@/game/hooks';
import { alignmentLabel, ORDER_TYPE_NAMES } from '@/game/civilization';
import {
  type AdvancementView,
  ageName,
  type AvatarView,
  type CityView,
  type OrderView,
  type RaceView,
} from '@/game/project';
import type { God } from '@/lib/database.types';
import { useTheme } from '@/hooks/use-theme';
import { useLobby } from '@/worlds/hooks';

/** DOW-34/35: every race in the world, with its sects and cities. */
export default function AtlasScreen() {
  // `entity` (a race or city id) scrolls to and highlights its card, e.g. from a chronicle link.
  const { id, entity } = useLocalSearchParams<{ id: string; entity?: string }>();
  const { view, loaded } = useGame(id, true);
  const { data: lobby } = useLobby(id);
  const scroll = useRef<ScrollViewInstance>(null);
  const targetRace =
    view.races.find((r) => r.id === entity)?.id ??
    view.cities.find((c) => c.id === entity)?.raceId ??
    null;

  if (!loaded || !lobby) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <ScrollView ref={scroll} contentContainerStyle={styles.list}>
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
              parentName={view.races.find((r) => r.id === race.parentId)?.name ?? null}
              subraces={view.races.filter((r) => r.parentId === race.id).map((r) => r.name)}
              advancements={view.advancements}
              gods={lobby.gods}
              highlight={race.id === targetRace ? entity : undefined}
              onLayoutY={
                race.id === targetRace
                  ? (y) => scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })
                  : undefined
              }
            />
          ))
        )}
        {view.avatars.length > 0 ? (
          <Card style={styles.card}>
            <ThemedText type="subtitle">Avatars</ThemedText>
            {view.avatars.map((a) => (
              <AvatarRow
                key={a.id}
                avatar={a}
                raceName={view.races.find((r) => r.id === a.raceId)?.name ?? null}
                creator={lobby.gods.find((g) => g.id === a.godId)}
              />
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function RaceCard({
  race,
  orders,
  cities,
  parentName,
  subraces,
  advancements,
  gods,
  highlight,
  onLayoutY,
}: {
  race: RaceView;
  orders: OrderView[];
  cities: CityView[];
  /** DOW-43: the race this one split from, if it's a subrace. */
  parentName: string | null;
  subraces: string[];
  advancements: AdvancementView[];
  gods: God[];
  /** The id of this race, or one of its cities, to highlight. */
  highlight?: string;
  /** Reports where the card is, so the screen can scroll to it. */
  onLayoutY?: (y: number) => void;
}) {
  const theme = useTheme();
  const creator = gods.find((g) => g.id === race.godId);
  const ring = { borderWidth: 2, borderColor: theme.accent };
  return (
    <Card
      style={[styles.card, highlight === race.id && ring]}
      onLayout={onLayoutY ? (e) => onLayoutY(e.nativeEvent.layout.y) : undefined}>
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
            {alignmentLabel(race.alignment)} · created by {creator?.name ?? 'a god'} in the{' '}
            {ageName(race.age)}, round {race.round}
          </ThemedText>
        </View>
      </View>
      {parentName ? (
        <ThemedText type="small" themeColor="textSecondary">
          A subrace of the {parentName}
        </ThemedText>
      ) : null}
      <ThemedText>{race.description}</ThemedText>
      <Greatest fields={greatestFields(advancements, race.id)} />
      {race.appearance ? (
        <ThemedText type="small" themeColor="textSecondary">
          Appearance: {race.appearance}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        Homeland: hex {race.hex.x}, {race.hex.y}
      </ThemedText>
      {subraces.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Subraces: {subraces.join(', ')}
        </ThemedText>
      ) : null}
      {orders.length > 0 ? (
        <View style={styles.orders}>
          <ThemedText type="smallBold">Orders</ThemedText>
          {orders.map((o) => {
            const founder = gods.find((g) => g.id === o.godId);
            return (
              <View key={o.id} accessibilityLabel={`Order ${o.name}`}>
                <ThemedText type="small">
                  <ThemedText type="smallBold">{o.name}</ThemedText>
                  {` · ${ORDER_TYPE_NAMES[o.orderType]} · ${founder?.name ?? 'a god'}’s${
                    o.status === 'destroyed' ? ' · wiped out' : ''
                  }`}
                </ThemedText>
                {o.purpose ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {o.purpose}
                  </ThemedText>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <ThemedText type="smallBold">
        {cities.length === 0
          ? 'No cities yet'
          : `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}`}
      </ThemedText>
      {cities.map((city) => {
        const founder = gods.find((g) => g.id === city.godId);
        return (
          <View
            key={city.id}
            style={[styles.city, highlight === city.id && [ring, styles.cityHighlight]]}
            accessibilityLabel={`City of ${city.name}`}>
            <ThemedText type="smallBold">{city.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Hex {city.hex.x}, {city.hex.y} · {alignmentLabel(city.alignment)} · founded at{' '}
              {founder?.name ?? 'a god'}&apos;s command in the {ageName(city.age)}, round{' '}
              {city.round}
            </ThemedText>
            <ThemedText type="small">“{city.description}”</ThemedText>
            <Greatest fields={greatestFields(advancements, city.id)} />
          </View>
        );
      })}
    </Card>
  );
}

/** DOW-45: an avatar: who and what they are, whose they are, where they walk. */
function AvatarRow({
  avatar,
  raceName,
  creator,
}: {
  avatar: AvatarView;
  raceName: string | null;
  creator: God | undefined;
}) {
  return (
    <View style={styles.avatar} accessibilityLabel={`Avatar ${avatar.name}`}>
      <GodBadge color={creator?.color ?? null} sigil={creator?.sigil ?? null} size={28} />
      <View style={styles.fill}>
        <ThemedText type="smallBold">
          {avatar.name}
          {avatar.status === 'destroyed' ? ' (slain)' : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {avatar.avatarType} · {creator?.name ?? 'a god'}’s ·{' '}
          {raceName ? `among the ${raceName}` : `at hex ${avatar.hex.x}, ${avatar.hex.y}`}
        </ThemedText>
        <ThemedText type="small">{avatar.description}</ThemedText>
      </View>
    </View>
  );
}

const greatestFields = (advancements: AdvancementView[], id: string) =>
  advancements.filter((a) => a.entityId === id).map((a) => a.field);

/** DOW-47: "Greatest in the world at Steel, Writing". */
function Greatest({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null;
  return (
    <ThemedText type="small" themeColor="accent">
      Greatest in the world at {fields.join(', ')}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  list: { gap: Spacing.three, padding: Spacing.three, paddingBottom: Spacing.six },
  card: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  city: { gap: Spacing.half, paddingLeft: Spacing.two },
  orders: { gap: Spacing.one },
  avatar: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  cityHighlight: { borderRadius: Spacing.two, padding: Spacing.two },
});
