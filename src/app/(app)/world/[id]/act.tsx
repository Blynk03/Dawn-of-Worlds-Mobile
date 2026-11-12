import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  ACT_OPTIONS,
  type ActKind,
  CostSummary,
  optionPowers,
  PowerPicker,
  RaceFields,
  type TargetKind,
} from '@/components/act-forms';
import { AdvancementPicker, TargetPicker } from '@/components/civ-forms';
import {
  AvatarCommandPicker,
  AvatarFields,
  type AvatarIntent,
  OrderFields,
  OrderPicker,
} from '@/components/order-avatar-forms';
import { AttackForm, CommandCityForm, MarchForm, type WarTarget } from '@/components/war-forms';
import { useAuth } from '@/auth/auth-provider';
import { Button, TextField } from '@/components/form';
import { Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { HexMap } from '@/components/hex-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  advance,
  attack,
  changeAlignment,
  commandAvatar,
  commandCity,
  commandOrder,
  createAvatar,
  createOrder,
  createRace,
  createSubrace,
  foundCity,
  marchArmy,
  resurrectAvatar,
  takeAction,
} from '@/game/api';
import {
  alignmentChangedThisTurn,
  alignmentLabel,
  avatarActedThisTurn,
  greatestAt,
  orderSurcharge,
  presentIn,
  regionAlignmentName,
  subraceCandidates,
} from '@/game/civilization';
import { useGame } from '@/game/hooks';
import { ageName, cityCandidates, type OrderType, settlementsAt } from '@/game/project';
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

/** Which form to show: a power's own, or (for Command Avatar) the one its action uses. */
type FormKind = ActKind | 'deed';
const INTENT_FORM: Record<AvatarIntent, FormKind> = {
  deed: 'deed',
  foundCity: 'foundCity',
  createOrder: 'createOrder',
  commandOrder: 'commandOrder',
  purifyCity: 'purify',
  corruptCity: 'corrupt',
  createRace: 'createRace',
  commandCity: 'commandCity',
};
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
 * (DOW-34), Command Race to found a city (DOW-35), Create Subrace (DOW-43), Purify / Corrupt
 * (DOW-46, once per target per turn: DOW-40), Advance Civilization / City (DOW-47), orders and
 * avatars (DOW-44/45), and Command City, marching and attacking (DOW-48/54/55/41).
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
  // Create Race, Create Subrace, Found a city and region targets pick one hex.
  const [hex, setHex] = useState<number | null>(null);
  // Advance, Purify, Corrupt
  const [targetKind, setTargetKind] = useState<TargetKind>('race');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [field, setField] = useState('');
  const [customField, setCustomField] = useState(false);
  // Orders
  const [orderDraft, setOrderDraft] = useState<{
    name: string;
    orderType: OrderType;
    purpose: string;
  }>({ name: '', orderType: 'religious', purpose: '' });
  const [orderId, setOrderId] = useState<string | null>(null);
  // Avatars
  const [avatarDraft, setAvatarDraft] = useState<{
    name: string;
    avatarType: string;
    description: string;
    raceId: string | null;
  }>({ name: '', avatarType: 'High priest', description: '', raceId: null });
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [avatarIntent, setAvatarIntent] = useState<AvatarIntent | null>(null);
  // Armies (DOW-48/54/55)
  const [armyId, setArmyId] = useState<string | null>(null);
  const [warTarget, setWarTarget] = useState<WarTarget | null>(null);
  // Command Avatar runs another power's form, for the price of Command Avatar.
  const viaAvatar = kind === 'commandAvatar';
  const fk: FormKind | null = viaAvatar
    ? avatarId && avatarIntent
      ? INTENT_FORM[avatarIntent]
      : null
    : kind;

  const [description, setDescription] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const map = view.map;
  const gods = lobby?.gods;
  const markers = useMemo(() => (gods ? mapMarkers(view, gods) : []), [view, gods]);
  const activeGod = lobby?.gods.find((g) => g.id === view.activeGodId);
  // Founding a city yourself needs presence (DOW-38), so start with a race where you have it.
  const needsPresence = fk === 'foundCity' && !viaAvatar;
  const chosenRace =
    raceId ??
    (needsPresence && activeGod
      ? view.races.find((r) => presentIn(view, activeGod.id, r.id))?.id
      : view.races[0]?.id) ??
    null;
  const blocked = useMemo(
    () => (activeGod ? alignmentChangedThisTurn(view, activeGod.id) : new Set<string>()),
    [view, activeGod],
  );
  const candidates = useMemo(() => {
    if (!view.map) return undefined;
    const { width, height } = view.map;
    const near = (h: Hex) => neighbors(h, width, height);
    const index = (h: Hex) => h.y * width + h.x;
    if (fk === 'foundCity' && chosenRace) {
      return new Set(cityCandidates(view, chosenRace, isWater, near));
    }
    if (fk === 'createSubrace' && chosenRace) {
      return new Set(subraceCandidates(view, chosenRace, isWater, near));
    }
    if (fk === 'commandCity') {
      return new Set(view.cities.filter((c) => c.status === 'active').map((c) => index(c.hex)));
    }
    if (fk === 'attack') {
      return new Set([
        ...view.cities.filter((c) => c.status === 'active').map((c) => index(c.hex)),
        ...view.armies.filter((a) => a.status === 'active').map((a) => index(a.hex)),
      ]);
    }
    if (fk === 'advance' || fk === 'purify' || fk === 'corrupt') {
      const aligning = fk !== 'advance';
      if (targetKind === 'race') {
        return new Set(
          view.races.filter((r) => !aligning || !blocked.has(r.id)).map((r) => index(r.hex)),
        );
      }
      if (targetKind === 'city') {
        return new Set(
          view.cities.filter((c) => !aligning || !blocked.has(c.id)).map((c) => index(c.hex)),
        );
      }
    }
    return undefined;
  }, [fk, chosenRace, view, targetKind, blocked]);

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
  const priceOf = (power: string) => getActionCost(CLASSIC_RULESET, power, age, 1);
  const costLabels = {} as Record<ActKind, string>;
  const disabledReasons: Partial<Record<ActKind, string>> = {};
  for (const o of ACT_OPTIONS) {
    const prices = optionPowers(o).map(priceOf);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    costLabels[o.kind] = `${low === high ? low : `${low}–${high}`}${o.perHex ? ' / hex' : ''}`;
    if (low > myPower) {
      disabledReasons[o.kind] = `Needs ${low} power${o.perHex ? ' per hex' : ''}`;
    }
  }
  costLabels.commandOrder = `${priceOf('commandOrder')}+`;
  const me = activeGod.id;
  const myAvatars = view.avatars.filter((a) => a.godId === me);
  if (!view.races.some((r) => presentIn(view, me, r.id))) {
    disabledReasons.foundCity = 'You need an order or avatar among a race first';
  }
  if (!view.orders.some((o) => o.status === 'active')) {
    disabledReasons.commandOrder = 'No orders yet: create one first';
  }
  if (myAvatars.length === 0) {
    disabledReasons.commandAvatar = 'You have no avatars yet';
  } else if (!myAvatars.some((a) => a.status === 'active' && !avatarActedThisTurn(view, a.id))) {
    disabledReasons.commandAvatar = 'Your avatars have all acted (or are slain)';
  }
  if (!myAvatars.some((a) => a.status !== 'active')) {
    disabledReasons.resurrectAvatar = 'None of your avatars is slain';
  }
  const standingCities = view.cities.filter((c) => c.status === 'active');
  if (standingCities.length === 0) {
    disabledReasons.commandCity = 'No standing cities yet';
  } else if (!standingCities.some((c) => presentIn(view, me, c.raceId))) {
    disabledReasons.commandCity = 'You need an order or avatar among a city’s race';
  }
  if (!view.armies.some((a) => a.status === 'active' && presentIn(view, me, a.raceId))) {
    disabledReasons.march = 'No army you can command: raise one with Command City';
    disabledReasons.attack = disabledReasons.march;
  }
  if (view.races.length === 0) {
    for (const k of ['foundCity', 'createSubrace', 'advance', 'createOrder'] as const) {
      disabledReasons[k] = 'No races yet: create one first';
    }
  }

  const pick = (next: ActKind | null) => {
    setKind(next);
    setSelected(new Set());
    setHex(null);
    setNote(null);
    setError(null);
    setTargetId(null);
    setField('');
    setCustomField(false);
    setTargetKind(view.races.length > 0 || next === 'advance' ? 'race' : 'region');
    setOrderId(null);
    setAvatarId(null);
    setAvatarIntent(null);
    setArmyId(null);
    setWarTarget(null);
    if (next === 'shapeLand') setChoice('mountains');
    if (next === 'shapeClimate') setChoice('rain');
  };

  const onTapHex = (tapped: Hex) => {
    const index = hexIndex(tapped, map.width);
    setNote(null);
    if (fk === 'shapeLand' || fk === 'shapeClimate') {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else if (next.size < MAX_HEXES) next.add(index);
        return next;
      });
    } else if (fk === 'createRace') {
      const here = settlementsAt(view, tapped);
      if (isWater(map.terrain[index] ?? '')) setNote('That hex is water; choose land.');
      else if (here.race || here.city) setNote('Someone already lives there.');
      else setHex(index === hex ? null : index);
    } else if (fk === 'foundCity') {
      if (candidates?.has(index)) setHex(index === hex ? null : index);
      else setNote('Choose a highlighted hex, on or next to the race’s land.');
    } else if (fk === 'createSubrace') {
      if (candidates?.has(index)) setHex(index === hex ? null : index);
      else setNote('Choose a highlighted hex, next to the parent race’s land.');
    } else if (fk === 'createAvatar') {
      setHex(index === hex ? null : index);
    } else if (fk === 'commandCity') {
      const city = view.cities.find(
        (c) => c.status === 'active' && c.hex.x === tapped.x && c.hex.y === tapped.y,
      );
      if (city) setTargetId(city.id);
      else setNote('Tap a city.');
    } else if (fk === 'march') {
      if (isWater(map.terrain[index] ?? '')) setNote('Armies march on land; choose a land hex.');
      else setHex(index === hex ? null : index);
    } else if (fk === 'attack') {
      const at = (h: { x: number; y: number }) => h.x === tapped.x && h.y === tapped.y;
      const city = view.cities.find((c) => c.status === 'active' && at(c.hex));
      const army = view.armies.find((a) => a.status === 'active' && a.id !== armyId && at(a.hex));
      if (city) setWarTarget({ kind: 'city', id: city.id });
      else if (army) setWarTarget({ kind: 'army', id: army.id });
      else setNote('Tap a city or an army to attack.');
    } else if (fk === 'advance' || fk === 'purify' || fk === 'corrupt') {
      const aligning = fk !== 'advance';
      if (targetKind === 'region') {
        if (blocked.has(`${tapped.x},${tapped.y}`)) {
          setNote('You’ve already changed that region’s alignment this turn.');
        } else {
          setHex(index === hex ? null : index);
        }
        return;
      }
      const here = settlementsAt(view, tapped);
      const found = targetKind === 'race' ? here.race : here.city;
      if (!found) {
        setNote(targetKind === 'race' ? 'Tap a race’s homeland.' : 'Tap a city.');
      } else if (aligning && blocked.has(found.id)) {
        setNote(`You’ve already changed ${found.name}’s alignment this turn.`);
      } else {
        setTargetId(found.id);
      }
    }
  };

  const shaping = fk === 'shapeLand' || fk === 'shapeClimate';
  const count = shaping ? selected.size : hex === null ? 0 : 1;
  const current = ACT_OPTIONS.find((o) => o.kind === kind);
  const currentPower = current ? (current.byTarget?.[targetKind] ?? current.power) : null;
  const chosenOrder = view.orders.find((o) => o.id === orderId);
  const surcharge =
    fk === 'commandOrder' && !viaAvatar && chosenOrder ? orderSurcharge(chosenOrder, me) : 0;
  const cost = viaAvatar
    ? priceOf('commandAvatar')
    : currentPower
      ? getActionCost(CLASSIC_RULESET, currentPower, age, shaping ? Math.max(count, 1) : 1) +
        surcharge
      : 0;
  const avatar = view.avatars.find((a) => a.id === avatarId);
  const targetName =
    targetKind === 'region'
      ? null
      : targetKind === 'race'
        ? view.races.find((r) => r.id === targetId)?.name
        : view.cities.find((c) => c.id === targetId)?.name;
  const targetHex =
    targetKind === 'region'
      ? hex
      : (() => {
          const t =
            view.races.find((r) => r.id === targetId) ?? view.cities.find((c) => c.id === targetId);
          return t ? hexIndex(t.hex, map.width) : null;
        })();
  const targetChosen = targetKind === 'region' ? hex !== null : !!targetName;
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
                kind === 'shapeLand' ? 'shapeLand' : 'shapeClimate',
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
  } else if (fk === 'createRace') {
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
            run(() => {
              const at = hexFromIndex(hex!, map.width);
              return viaAvatar
                ? commandAvatar(id, avatarId!, {
                    intent: 'createRace',
                    name: race.name,
                    description: race.description,
                    appearance: race.appearance,
                    alignment: race.alignment,
                    x: at.x,
                    y: at.y,
                  })
                : createRace(id, {
                    name: race.name,
                    description: race.description,
                    appearance: race.appearance,
                    alignment: race.alignment,
                    hex: at,
                  });
            })
          }
          busy={busy}
          disabled={hex === null || !affordable || !race.name.trim() || !race.description.trim()}
        />
      </>
    );
  } else if (fk === 'foundCity') {
    const raceName = view.races.find((r) => r.id === chosenRace)?.name ?? 'the race';
    form = (
      <>
        <SectionLabel>Race</SectionLabel>
        <View style={styles.wrap}>
          {view.races.map((r) => {
            // DOW-38: commanding a race needs an order or avatar among it (an avatar founding
            // the city is there itself).
            const absent = !viaAvatar && !presentIn(view, me, r.id);
            return (
              <Chip
                key={r.id}
                label={absent ? `${r.name} · no order or avatar here` : r.name}
                selected={chosenRace === r.id}
                disabled={absent}
                onPress={() => {
                  setRaceId(r.id);
                  setHex(null);
                }}
              />
            );
          })}
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
            run(() => {
              const at = hexFromIndex(hex!, map.width);
              return viaAvatar
                ? commandAvatar(id, avatarId!, {
                    intent: 'foundCity',
                    race: chosenRace!,
                    name: cityName,
                    x: at.x,
                    y: at.y,
                    description,
                  })
                : foundCity(id, chosenRace!, cityName, at, description);
            })
          }
          busy={busy}
          disabled={
            !chosenRace || hex === null || !affordable || !cityName.trim() || !description.trim()
          }
        />
      </>
    );
  } else if (fk === 'createSubrace') {
    const parentName = view.races.find((r) => r.id === chosenRace)?.name ?? 'the parent race';
    form = (
      <>
        <SectionLabel>Splits from</SectionLabel>
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
        <RaceFields
          {...race}
          onChange={(patch) => setRace((current) => ({ ...current, ...patch }))}
        />
        <CostSummary
          headline={
            hex === null
              ? `Tap a highlighted hex, next to the ${parentName}’s land.`
              : `Homeland: ${hexLabel(hex)} (${terrainInfo(map.terrain[hex] ?? '').name})`
          }
          cost={cost}
          power={myPower}
          ready={hex !== null}
        />
        <Button
          title="Create the subrace"
          onPress={() =>
            run(() =>
              createSubrace(id, chosenRace!, {
                name: race.name,
                description: race.description,
                appearance: race.appearance,
                alignment: race.alignment,
                hex: hexFromIndex(hex!, map.width),
              }),
            )
          }
          busy={busy}
          disabled={
            !chosenRace ||
            hex === null ||
            !affordable ||
            !race.name.trim() ||
            !race.description.trim()
          }
        />
      </>
    );
  } else if (fk === 'advance') {
    const holder = field.trim() ? greatestAt(view, field) : null;
    form = (
      <>
        <TargetPicker
          view={view}
          kinds={['race', 'city']}
          kind={targetKind}
          onKind={(k) => {
            setTargetKind(k);
            setTargetId(null);
          }}
          targetId={targetId}
          onTarget={setTargetId}
          regionIndex={null}
          blocked={new Set()}
          showAlignment={false}
        />
        <AdvancementPicker
          view={view}
          field={field}
          custom={customField}
          onChange={(f, custom) => {
            setField(f);
            setCustomField(custom);
          }}
        />
        <CostSummary
          headline={
            !targetName
              ? `Choose a ${targetKind === 'race' ? 'civilization' : 'city'}.`
              : field.trim()
                ? `${targetName} becomes the greatest in the world at ${field.trim()}.`
                : `What will ${targetName} be the greatest at?`
          }
          cost={cost}
          power={myPower}
          ready={!!targetName && !!field.trim()}
        />
        <DescriptionField value={description} onChange={setDescription} />
        <Button
          title={targetName ? `Advance ${targetName}` : 'Advance'}
          onPress={() => run(() => advance(id, targetId!, field, description))}
          busy={busy}
          disabled={!targetName || !field.trim() || !!holder || !affordable || !description.trim()}
        />
      </>
    );
  } else if (fk === 'purify' || fk === 'corrupt') {
    const direction = fk === 'purify' ? 1 : -1;
    const before =
      targetKind === 'region'
        ? hex !== null
          ? (map.alignment?.[hex] ?? 0)
          : 0
        : ((targetKind === 'race'
            ? view.races.find((r) => r.id === targetId)?.alignment
            : view.cities.find((c) => c.id === targetId)?.alignment) ?? 0);
    const after = before + direction;
    const verb = fk === 'purify' ? 'Purify' : 'Corrupt';
    const name =
      targetKind === 'region' && hex !== null ? `the region at ${hexLabel(hex)}` : targetName;
    form = (
      <>
        <TargetPicker
          view={view}
          kinds={viaAvatar ? ['city'] : ['race', 'city', 'region']}
          kind={targetKind}
          onKind={(k) => {
            setTargetKind(k);
            setTargetId(null);
            setHex(null);
          }}
          targetId={targetId}
          onTarget={setTargetId}
          regionIndex={targetKind === 'region' ? hex : null}
          blocked={blocked}
          showAlignment
        />
        <CostSummary
          headline={
            !targetChosen
              ? 'Choose what to change.'
              : targetKind === 'region'
                ? `${name}: ${regionAlignmentName(before) ?? 'untouched'} → ${
                    regionAlignmentName(after) ?? 'untouched'
                  } (${after > 0 ? `+${after}` : after})`
                : `${name}: ${alignmentLabel(before)} → ${alignmentLabel(after)}`
          }
          cost={cost}
          power={myPower}
          ready={targetChosen}
        />
        <DescriptionField value={description} onChange={setDescription} />
        <Button
          title={name ? `${verb} ${name}` : verb}
          onPress={() =>
            run(() =>
              viaAvatar
                ? commandAvatar(id, avatarId!, {
                    intent: direction === 1 ? 'purifyCity' : 'corruptCity',
                    city: targetId!,
                    description,
                  })
                : changeAlignment(
                    id,
                    targetKind === 'region'
                      ? { kind: 'region', hex: hexFromIndex(hex!, map.width) }
                      : { kind: targetKind, id: targetId! },
                    direction,
                    description,
                  ),
            )
          }
          busy={busy}
          disabled={!targetChosen || !affordable || !description.trim()}
        />
      </>
    );
  }

  if (fk === 'commandCity') {
    form = (
      <CommandCityForm
        view={view}
        godId={me}
        viaAvatar={viaAvatar}
        cityId={targetId}
        onCity={setTargetId}
        cost={cost}
        power={myPower}
        busy={busy}
        onSubmit={(cityId, command) =>
          run(() =>
            viaAvatar
              ? commandAvatar(id, avatarId!, { intent: 'commandCity', city: cityId, ...command })
              : commandCity(id, cityId, command),
          )
        }
      />
    );
  } else if (fk === 'march') {
    form = (
      <MarchForm
        view={view}
        godId={me}
        armyId={armyId}
        onArmy={setArmyId}
        destination={hex === null ? null : hexLabel(hex)}
        cost={cost}
        power={myPower}
        busy={busy}
        onSubmit={(text) => run(() => marchArmy(id, armyId!, hexFromIndex(hex!, map.width), text))}
      />
    );
  } else if (fk === 'attack') {
    form = (
      <AttackForm
        view={view}
        godId={me}
        armyId={armyId}
        onArmy={(a) => {
          setArmyId(a);
          if (warTarget?.id === a) setWarTarget(null);
        }}
        target={warTarget}
        onTarget={setWarTarget}
        prices={{
          attack: cost,
          army: priceOf('commandCity'),
          city: priceOf('commandRace'),
        }}
        power={myPower}
        busy={busy}
        onSubmit={(order) =>
          run(() => attack(id, { ...order, armyId: armyId!, target: warTarget! }))
        }
      />
    );
  } else if (fk === 'createOrder') {
    const raceName = view.races.find((r) => r.id === chosenRace)?.name;
    form = (
      <>
        <SectionLabel>Within</SectionLabel>
        <View style={styles.wrap}>
          {view.races.map((r) => (
            <Chip
              key={r.id}
              label={r.name}
              selected={chosenRace === r.id}
              onPress={() => setRaceId(r.id)}
            />
          ))}
        </View>
        <OrderFields
          {...orderDraft}
          onChange={(patch) => setOrderDraft((d) => ({ ...d, ...patch }))}
        />
        <CostSummary
          headline={
            raceName
              ? `${orderDraft.name.trim() || 'A new order'} among the ${raceName}`
              : 'Choose a race.'
          }
          cost={cost}
          power={myPower}
          ready={!!raceName}
        />
        <Button
          title="Create the order"
          onPress={() =>
            run(() =>
              viaAvatar
                ? commandAvatar(id, avatarId!, {
                    intent: 'createOrder',
                    race: chosenRace!,
                    name: orderDraft.name,
                    order_type: orderDraft.orderType,
                    purpose: orderDraft.purpose,
                  })
                : createOrder(
                    id,
                    chosenRace!,
                    orderDraft.name,
                    orderDraft.orderType,
                    orderDraft.purpose,
                  ),
            )
          }
          busy={busy}
          disabled={
            !raceName || !orderDraft.name.trim() || !orderDraft.purpose.trim() || !affordable
          }
        />
      </>
    );
  } else if (fk === 'commandOrder') {
    form = (
      <>
        <OrderPicker
          view={view}
          godId={me}
          orderId={orderId}
          onPick={setOrderId}
          baseCost={viaAvatar ? cost : priceOf('commandOrder')}
          viaAvatar={viaAvatar}
        />
        <CostSummary
          headline={chosenOrder ? `Command ${chosenOrder.name}` : 'Choose an order.'}
          cost={cost}
          power={myPower}
          ready={!!chosenOrder}
        />
        <TextField
          label="What do they do?"
          value={description}
          onChangeText={setDescription}
          placeholder="Ride to the border…"
          maxLength={280}
          multiline
          style={styles.multiline}
        />
        <Button
          title={chosenOrder ? `Command ${chosenOrder.name}` : 'Command the order'}
          onPress={() =>
            run(() =>
              viaAvatar
                ? commandAvatar(id, avatarId!, {
                    intent: 'commandOrder',
                    order: orderId!,
                    directive: description,
                  })
                : commandOrder(id, orderId!, description),
            )
          }
          busy={busy}
          disabled={!chosenOrder || !description.trim() || !affordable}
        />
      </>
    );
  } else if (fk === 'createAvatar') {
    form = (
      <>
        <AvatarFields
          view={view}
          {...avatarDraft}
          onChange={(patch) => setAvatarDraft((d) => ({ ...d, ...patch }))}
        />
        <CostSummary
          headline={
            hex === null
              ? 'Tap a hex on the map for where they are.'
              : `${avatarDraft.name.trim() || 'Your avatar'} appears at ${hexLabel(hex)}`
          }
          cost={cost}
          power={myPower}
          ready={hex !== null}
        />
        <Button
          title="Create the avatar"
          onPress={() =>
            run(() =>
              createAvatar(id, {
                name: avatarDraft.name,
                avatarType: avatarDraft.avatarType,
                description: avatarDraft.description,
                raceId: avatarDraft.raceId,
                hex: hexFromIndex(hex!, map.width),
              }),
            )
          }
          busy={busy}
          disabled={
            hex === null ||
            !avatarDraft.name.trim() ||
            !avatarDraft.avatarType.trim() ||
            !avatarDraft.description.trim() ||
            !affordable
          }
        />
      </>
    );
  } else if (fk === 'deed') {
    form = (
      <>
        <CostSummary
          headline={`${avatar?.name ?? 'Your avatar'} acts in the world.`}
          cost={cost}
          power={myPower}
          ready
        />
        <TextField
          label={`What does ${avatar?.name ?? 'your avatar'} do?`}
          value={description}
          onChangeText={setDescription}
          placeholder="Leads an army, slays a beast, takes a throne…"
          maxLength={280}
          multiline
          style={styles.multiline}
        />
        <Button
          title={`Command ${avatar?.name ?? 'the avatar'}`}
          onPress={() => run(() => commandAvatar(id, avatarId!, { intent: 'deed', description }))}
          busy={busy}
          disabled={!description.trim() || !affordable}
        />
      </>
    );
  } else if (fk === 'resurrectAvatar') {
    const slain = myAvatars.filter((a) => a.status !== 'active');
    const chosen = slain.find((a) => a.id === avatarId);
    form = (
      <>
        <SectionLabel>Slain avatar</SectionLabel>
        <View style={styles.wrap}>
          {slain.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              selected={avatarId === a.id}
              onPress={() => setAvatarId(a.id)}
            />
          ))}
        </View>
        <CostSummary
          headline={chosen ? `${chosen.name} returns.` : 'Choose who returns.'}
          cost={cost}
          power={myPower}
          ready={!!chosen}
        />
        <DescriptionField value={description} onChange={setDescription} />
        <Button
          title={chosen ? `Resurrect ${chosen.name}` : 'Resurrect'}
          onPress={() => run(() => resurrectAvatar(id, avatarId!, description))}
          busy={busy}
          disabled={!chosen || !description.trim() || !affordable}
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
                {option.blurb} {costLabels[option.kind].replace(' / hex', '')} power
                {option.perHex ? ' per hex' : ''} in the {ageName(age)}.
              </ThemedText>
            </View>
          </View>
          <Button title="Choose another power" variant="secondary" onPress={() => pick(null)} />
          {viaAvatar ? (
            <AvatarCommandPicker
              view={view}
              godId={me}
              avatarId={avatarId}
              onAvatar={(a) => {
                setAvatarId(a);
                setAvatarIntent(null);
              }}
              intent={avatarIntent}
              onIntent={(i) => {
                setAvatarIntent(i);
                setHex(null);
                setTargetId(null);
                setNote(null);
                if (i === 'purifyCity' || i === 'corruptCity') setTargetKind('city');
              }}
            />
          ) : null}
          {note ? <ErrorMessage message={note} /> : null}
          {form}
          <ErrorMessage message={error} />
        </>
      ) : (
        <PowerPicker costs={costLabels} disabledReasons={disabledReasons} onPick={pick} />
      )}
    </ScrollView>
  );

  const warHex = (() => {
    const place =
      fk === 'commandCity'
        ? view.cities.find((c) => c.id === targetId)
        : fk === 'attack' && warTarget
          ? warTarget.kind === 'city'
            ? view.cities.find((c) => c.id === warTarget.id)
            : view.armies.find((a) => a.id === warTarget.id)
          : undefined;
    return place ? hexIndex(place.hex, map.width) : null;
  })();
  const pickedHex =
    fk === 'commandCity' || fk === 'attack'
      ? warHex
      : fk === 'advance' || fk === 'purify' || fk === 'corrupt'
        ? targetHex
        : fk === 'commandOrder' || fk === 'deed' || fk === 'resurrectAvatar' || fk === 'createOrder'
          ? null
          : hex;
  const mapSelection = shaping ? selected : pickedHex === null ? undefined : new Set([pickedHex]);
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
