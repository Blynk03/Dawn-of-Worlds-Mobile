import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  ACT_OPTIONS,
  type ActKind,
  CostSummary,
  PowerPicker,
  RaceFields,
} from '@/components/act-forms';
import { useAuth } from '@/auth/auth-provider';
import { Button, TextField } from '@/components/form';
import { Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { HexMap } from '@/components/hex-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { createRace, foundCity, takeAction } from '@/game/api';
import { useGame } from '@/game/hooks';
import { ageName, cityCandidates, settlementsAt } from '@/game/project';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import { SIDE_PANEL_WIDTH } from '@/layout/breakpoints';
import { type Hex, hexFromIndex, hexIndex, neighbors } from '@/map/hex';
import { mapMarkers } from '@/map/markers';
import { CLIMATE_IDS, CLIMATES, TERRAIN_IDS, TERRAINS, terrainInfo } from '@/map/terrain';
import { getActionCost } from '@/rules/actions';
import { CLASSIC_RULESET } from '@/rules/ruleset';
import type { Age } from '@/rules/schema';
import { useLobby } from '@/worlds/hooks';

const MAX_HEXES = 64;
const isWater = (terrain: string) => terrainInfo(terrain).water;

type RaceDraft = {
  name: string;
  description: string;
  appearance: string;
  alignment: -1 | 0 | 1;
};

/**
 * DOW-26: the action composer. Pick a power (grouped, with this age's cost), choose where on the
 * map, describe it, and confirm. Powers: Shape Land and Shape Climate (DOW-31/32), Create Race
 * (DOW-34) and Command Race to found a city (DOW-35).
 */
export default function ActScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const mode = useLayoutMode();
  const { view, loaded } = useGame(id, true);
  const { data: lobby } = useLobby(id);

  const [kind, setKind] = useState<ActKind | null>(null);
  // Shape Land / Shape Climate
  const [choice, setChoice] = useState<string>('mountains');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Create Race
  const [race, setRace] = useState<RaceDraft>({
    name: '',
    description: '',
    appearance: '',
    alignment: 0,
  });
  // Found a city
  const [raceId, setRaceId] = useState<string | null>(null);
  const [cityName, setCityName] = useState('');
  // Create Race and Found a city both pick one hex.
  const [hex, setHex] = useState<number | null>(null);

  const [description, setDescription] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const map = view.map;
  const gods = lobby?.gods;
  const markers = useMemo(() => (gods ? mapMarkers(view, gods) : []), [view, gods]);
  const chosenRace = raceId ?? view.races[0]?.id ?? null;
  const candidates = useMemo(() => {
    if (kind !== 'foundCity' || !chosenRace || !view.map) return undefined;
    const { width, height } = view.map;
    return new Set(cityCandidates(view, chosenRace, isWater, (h) => neighbors(h, width, height)));
  }, [kind, chosenRace, view]);

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

  const age = view.age as Age;
  const myPower = view.powers[activeGod.id]?.power ?? 0;
  const unitCost = Object.fromEntries(
    ACT_OPTIONS.map((o) => [o.kind, getActionCost(CLASSIC_RULESET, o.power, age, 1)]),
  ) as Record<ActKind, number>;
  const disabledReasons: Partial<Record<ActKind, string>> = {};
  for (const o of ACT_OPTIONS) {
    if (unitCost[o.kind] > myPower) {
      disabledReasons[o.kind] = `Needs ${unitCost[o.kind]} power${o.perHex ? ' per hex' : ''}`;
    }
  }
  if (view.races.length === 0) disabledReasons.foundCity = 'No races yet: create one first';

  const pick = (next: ActKind | null) => {
    setKind(next);
    setSelected(new Set());
    setHex(null);
    setNote(null);
    setError(null);
    if (next === 'shapeLand') setChoice('mountains');
    if (next === 'shapeClimate') setChoice('rain');
  };

  const onTapHex = (tapped: Hex) => {
    const index = hexIndex(tapped, map.width);
    setNote(null);
    if (kind === 'shapeLand' || kind === 'shapeClimate') {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else if (next.size < MAX_HEXES) next.add(index);
        return next;
      });
    } else if (kind === 'createRace') {
      const here = settlementsAt(view, tapped);
      if (isWater(map.terrain[index] ?? '')) setNote('That hex is water; choose land.');
      else if (here.race || here.city) setNote('Someone already lives there.');
      else setHex(index === hex ? null : index);
    } else if (kind === 'foundCity') {
      if (candidates?.has(index)) setHex(index === hex ? null : index);
      else setNote('Choose a highlighted hex, on or next to the race’s land.');
    }
  };

  const shaping = kind === 'shapeLand' || kind === 'shapeClimate';
  const count = shaping ? selected.size : hex === null ? 0 : 1;
  const cost = kind
    ? getActionCost(
        CLASSIC_RULESET,
        ACT_OPTIONS.find((o) => o.kind === kind)!.power,
        age,
        shaping ? Math.max(count, 1) : 1,
      )
    : 0;
  const affordable = cost <= myPower;
  const hexLabel = (index: number) => {
    const h = hexFromIndex(index, map.width);
    return `hex ${h.x}, ${h.y}`;
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const choiceName = (c: string) =>
    kind === 'shapeLand'
      ? TERRAINS[c as keyof typeof TERRAINS].name
      : CLIMATES[c as keyof typeof CLIMATES].name;

  let form: ReactNode = null;
  if (shaping) {
    const choices: string[] =
      kind === 'shapeLand' ? TERRAIN_IDS : [...CLIMATE_IDS.filter((c) => c !== 'none'), 'none']; // "No special climate" clears it
    form = (
      <>
        <SectionLabel>{kind === 'shapeLand' ? 'Terrain' : 'Climate'}</SectionLabel>
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
        <CostSummary
          headline={
            count === 0
              ? 'Tap hexes on the map to choose where.'
              : `${count} ${count === 1 ? 'hex' : 'hexes'} → ${choiceName(choice)}`
          }
          cost={cost}
          power={myPower}
          ready={count > 0}
        />
        {count > 0 ? (
          <Button
            title="Clear selection"
            variant="secondary"
            onPress={() => setSelected(new Set())}
          />
        ) : null}
        <DescriptionField value={description} onChange={setDescription} />
        <Button
          title={kind === 'shapeLand' ? 'Shape the land' : 'Shape the climate'}
          onPress={() =>
            run(() =>
              takeAction(
                id,
                kind,
                [...selected].map((i) => {
                  const h = hexFromIndex(i, map.width);
                  return [h.x, h.y] as [number, number];
                }),
                choice,
                description,
              ),
            )
          }
          busy={busy}
          disabled={count === 0 || !affordable || !description.trim()}
        />
      </>
    );
  } else if (kind === 'createRace') {
    form = (
      <>
        <RaceFields
          {...race}
          onChange={(patch) => setRace((current) => ({ ...current, ...patch }))}
        />
        <CostSummary
          headline={
            hex === null
              ? 'Tap a land hex on the map for their homeland.'
              : `Homeland: ${hexLabel(hex)} (${terrainInfo(map.terrain[hex] ?? '').name})`
          }
          cost={cost}
          power={myPower}
          ready={hex !== null}
        />
        <Button
          title="Create the race"
          onPress={() =>
            run(() =>
              createRace(id, {
                name: race.name,
                description: race.description,
                appearance: race.appearance,
                alignment: race.alignment,
                hex: hexFromIndex(hex!, map.width),
              }),
            )
          }
          busy={busy}
          disabled={hex === null || !affordable || !race.name.trim() || !race.description.trim()}
        />
      </>
    );
  } else if (kind === 'foundCity') {
    const raceName = view.races.find((r) => r.id === chosenRace)?.name ?? 'the race';
    form = (
      <>
        <SectionLabel>Race</SectionLabel>
        <View style={styles.wrap}>
          {view.races.map((r) => (
            <Chip
              key={r.id}
              label={r.name}
              selected={chosenRace === r.id}
              onPress={() => {
                setRaceId(r.id);
                setHex(null);
              }}
            />
          ))}
        </View>
        <TextField
          label="City name"
          value={cityName}
          onChangeText={setCityName}
          placeholder="Karak Varn"
          maxLength={40}
        />
        <CostSummary
          headline={
            hex === null
              ? `Tap a highlighted hex, on or next to the ${raceName}’s land.`
              : `${cityName.trim() || 'The city'} on ${hexLabel(hex)}`
          }
          cost={cost}
          power={myPower}
          ready={hex !== null}
        />
        <DescriptionField value={description} onChange={setDescription} />
        <Button
          title="Found the city"
          onPress={() =>
            run(() =>
              foundCity(id, chosenRace!, cityName, hexFromIndex(hex!, map.width), description),
            )
          }
          busy={busy}
          disabled={
            !chosenRace || hex === null || !affordable || !cityName.trim() || !description.trim()
          }
        />
      </>
    );
  }

  const option = ACT_OPTIONS.find((o) => o.kind === kind);
  const controls = (
    <ScrollView contentContainerStyle={styles.controls} keyboardShouldPersistTaps="handled">
      <ThemedText type="small" themeColor="textSecondary">
        {activeGod.name} has {myPower} power.
      </ThemedText>
      {option ? (
        <>
          <View style={styles.titleRow}>
            <View style={styles.fill}>
              <ThemedText type="subtitle">{option.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {option.blurb} {unitCost[option.kind]} power
                {option.perHex ? ' per hex' : ''} in the {ageName(age)}.
              </ThemedText>
            </View>
          </View>
          <Button title="Choose another power" variant="secondary" onPress={() => pick(null)} />
          {note ? <ErrorMessage message={note} /> : null}
          {form}
          <ErrorMessage message={error} />
        </>
      ) : (
        <PowerPicker costs={unitCost} disabledReasons={disabledReasons} onPick={pick} />
      )}
    </ScrollView>
  );

  const mapSelection = shaping ? selected : hex === null ? undefined : new Set([hex]);
  const mapView = (
    <View style={styles.fill}>
      <HexMap
        map={map}
        markers={markers}
        candidates={candidates}
        selected={mapSelection}
        onTapHex={kind ? onTapHex : undefined}
      />
    </View>
  );

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ title: option?.name ?? 'Use a power' }} />
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

function DescriptionField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextField
      label="What happens?"
      value={value}
      onChangeText={onChange}
      placeholder="Describe it for the chronicle…"
      maxLength={280}
      multiline
      style={styles.multiline}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  pad: { padding: Spacing.four },
  side: { width: SIDE_PANEL_WIDTH + 40 },
  phoneMap: { height: '45%' },
  controls: { gap: Spacing.two, padding: Spacing.three, paddingBottom: Spacing.six },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
