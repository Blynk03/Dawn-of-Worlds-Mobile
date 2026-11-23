// DOW-49/50: the forms for Events and Catastrophes.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CostSummary } from '@/components/act-forms';
import { Button, TextField } from '@/components/form';
import { Chip, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { CatastropheOrder, EventOrder } from '@/game/api';
import type { GameView } from '@/game/project';
import { type Hex, hexFromIndex } from '@/map/hex';
import { TERRAIN_IDS, terrainInfo } from '@/map/terrain';

const EVENT_KINDS = ['Gold found', 'Storm', 'Famine', 'Plague', 'Drought', 'Technology lost'];
const CATASTROPHE_KINDS = [
  'Earthquake',
  'Eruption',
  'Flood',
  'Wildfire',
  'Falling star',
  'Tempest',
];

type TargetKind = EventOrder['targetKind'];
const TARGET_KINDS: { kind: TargetKind; label: string }[] = [
  { kind: 'race', label: 'A civilization' },
  { kind: 'city', label: 'A city' },
  { kind: 'order', label: 'An order' },
  { kind: 'avatar', label: 'An avatar' },
];

/** Prices that wiping something out adds (the total-destruction rule). */
export type DestructionPrices = { order: number; city: number; army: number };

function KindPicker({
  kinds,
  value,
  onChange,
  label,
}: {
  kinds: string[];
  value: string;
  onChange: (kind: string) => void;
  label: string;
}) {
  const custom = !kinds.includes(value);
  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <View style={styles.wrap}>
        {kinds.map((k) => (
          <Chip key={k} label={k} selected={value === k} onPress={() => onChange(k)} />
        ))}
        <Chip
          label="Something else"
          selected={custom}
          onPress={() => onChange(custom ? value : '')}
        />
      </View>
      {custom ? (
        <TextField
          label="What is it?"
          value={value}
          onChangeText={onChange}
          placeholder="A comet, a migration, a miracle…"
          maxLength={40}
        />
      ) : null}
    </>
  );
}

/**
 * DOW-49: an event strikes one avatar, order, city or civilization. Most are told in words; an
 * event can also take an advancement away, slay an avatar, break up an order, or ruin a city.
 */
export function EventForm({
  view,
  cost,
  prices,
  power,
  busy,
  onSubmit,
}: {
  view: GameView;
  cost: number;
  prices: DestructionPrices;
  power: number;
  busy: boolean;
  onSubmit: (order: EventOrder) => void;
}) {
  const [targetKind, setTargetKind] = useState<TargetKind>('race');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [kind, setKind] = useState('Plague');
  const [lose, setLose] = useState<string | null>(null);
  const [fate, setFate] = useState<EventOrder['fate']>(null);
  const [description, setDescription] = useState('');

  const targets: { id: string; name: string }[] = (
    {
      race: view.races,
      city: view.cities,
      order: view.orders,
      avatar: view.avatars,
    }[targetKind] as { id: string; name: string; status?: string }[]
  ).filter((t) => (t.status ?? 'active') === 'active');
  const target = targets.find((t) => t.id === targetId);
  const advancements = target ? view.advancements.filter((a) => a.entityId === target.id) : [];
  const fates: { fate: NonNullable<EventOrder['fate']>; label: string; extra: number }[] =
    targetKind === 'avatar'
      ? [{ fate: 'slain', label: 'Slay the avatar', extra: 0 }]
      : targetKind === 'order'
        ? [{ fate: 'disbanded', label: 'Break up the order', extra: prices.order }]
        : targetKind === 'city'
          ? [
              { fate: 'ruined', label: 'Leave it in ruins', extra: 0 },
              { fate: 'destroyed', label: 'Destroy it utterly', extra: prices.city },
            ]
          : [];
  const extra = fates.find((f) => f.fate === fate)?.extra ?? 0;
  const total = cost + extra;

  const chooseKind = (k: TargetKind) => {
    setTargetKind(k);
    setTargetId(null);
    setLose(null);
    setFate(null);
  };

  return (
    <>
      <KindPicker label="What happens" kinds={EVENT_KINDS} value={kind} onChange={setKind} />
      <SectionLabel>It strikes</SectionLabel>
      <View style={styles.wrap}>
        {TARGET_KINDS.map((t) => (
          <Chip
            key={t.kind}
            label={t.label}
            selected={targetKind === t.kind}
            onPress={() => chooseKind(t.kind)}
          />
        ))}
      </View>
      {targets.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          There are none yet.
        </ThemedText>
      ) : null}
      <View style={styles.wrap}>
        {targets.map((t) => (
          <Chip
            key={t.id}
            label={t.name}
            selected={targetId === t.id}
            onPress={() => {
              setTargetId(t.id);
              setLose(null);
            }}
          />
        ))}
      </View>
      {target && advancements.length > 0 ? (
        <>
          <SectionLabel>An advancement lost? (optional)</SectionLabel>
          <View style={styles.wrap}>
            {advancements.map((a) => (
              <Chip
                key={a.id}
                label={`${a.field} lost`}
                selected={lose === a.id}
                onPress={() => setLose(lose === a.id ? null : a.id)}
              />
            ))}
          </View>
        </>
      ) : null}
      {target && fates.length > 0 ? (
        <>
          <SectionLabel>Its fate (optional)</SectionLabel>
          <View style={styles.wrap}>
            {fates.map((f) => (
              <Chip
                key={f.fate}
                label={f.extra ? `${f.label} · +${f.extra}` : f.label}
                selected={fate === f.fate}
                onPress={() => setFate(fate === f.fate ? null : f.fate)}
              />
            ))}
          </View>
          {extra > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Wiping something out entirely costs what it cost to create.
            </ThemedText>
          ) : null}
        </>
      ) : null}
      <CostSummary
        headline={
          target ? `${kind.trim() || 'An event'} strikes ${target.name}` : 'Choose what it strikes.'
        }
        cost={total}
        power={power}
        ready={!!target}
      />
      <TextField
        label="What happens?"
        value={description}
        onChangeText={setDescription}
        placeholder="Describe it for the chronicle…"
        maxLength={280}
        multiline
        style={styles.multiline}
      />
      <Button
        title="Make it happen"
        onPress={() => {
          if (!target) return;
          onSubmit({
            targetKind,
            targetId: target.id,
            kind: kind.trim(),
            loseAdvancement: lose,
            fate,
            description,
          });
        }}
        busy={busy}
        disabled={!target || !kind.trim() || !description.trim() || total > power}
      />
    </>
  );
}

type Struck = { id: string; kind: 'city' | 'army' | 'avatar'; name: string };
type CatastropheFate = CatastropheOrder['fates'][number]['fate'];

/** What stands on the stricken hexes: cities, armies and avatars, and civilizations' homelands. */
export function struckBy(view: GameView, hexes: Hex[]): { struck: Struck[]; owners: string[] } {
  const on = (h: Hex) => hexes.some((x) => x.x === h.x && x.y === h.y);
  const struck: Struck[] = [
    ...view.cities
      .filter((c) => c.status === 'active' && on(c.hex))
      .map((c) => ({ id: c.id, kind: 'city' as const, name: c.name })),
    ...view.armies
      .filter((a) => a.status === 'active' && on(a.hex))
      .map((a) => ({ id: a.id, kind: 'army' as const, name: a.name })),
    ...view.avatars
      .filter((a) => a.status === 'active' && on(a.hex))
      .map((a) => ({ id: a.id, kind: 'avatar' as const, name: a.name })),
  ];
  const owners = [
    ...struck.filter((s) => s.kind === 'city').map((s) => s.id),
    ...view.races.filter((r) => on(r.hex)).map((r) => r.id),
  ];
  return { struck, owners };
}

/**
 * DOW-50: a catastrophe strikes up to 7 hexes (chosen on the map), may change their terrain, and
 * the god decides what becomes of each city, army and avatar there and which advancements are
 * lost. Anything not chosen is spared; utter destruction costs extra, as in battle.
 */
export function CatastropheForm({
  view,
  mapWidth,
  selected,
  perHex,
  prices,
  power,
  busy,
  onClear,
  onSubmit,
}: {
  view: GameView;
  mapWidth: number;
  /** Hex indexes chosen on the map. */
  selected: ReadonlySet<number>;
  perHex: number;
  prices: DestructionPrices;
  power: number;
  busy: boolean;
  onClear: () => void;
  onSubmit: (order: CatastropheOrder) => void;
}) {
  const [kind, setKind] = useState('Earthquake');
  const [terrain, setTerrain] = useState<string | null>(null);
  const [fates, setFates] = useState<Record<string, CatastropheFate>>({});
  const [lost, setLost] = useState<string[]>([]);
  const [description, setDescription] = useState('');

  const hexes = [...selected].map((i) => hexFromIndex(i, mapWidth));
  const { struck, owners } = struckBy(view, hexes);
  const advancements = view.advancements.filter((a) => owners.includes(a.entityId));
  const chosenFates = struck.filter((s) => fates[s.id]);
  const extra = chosenFates.reduce(
    (sum, s) =>
      sum + (fates[s.id] === 'destroyed' ? (s.kind === 'city' ? prices.city : prices.army) : 0),
    0,
  );
  const total = perHex * Math.max(hexes.length, 1) + extra;
  const options = (s: Struck): { fate: CatastropheFate; label: string }[] =>
    s.kind === 'city'
      ? [
          { fate: 'ruined', label: 'Ruined' },
          { fate: 'destroyed', label: `Destroyed · +${prices.city}` },
        ]
      : s.kind === 'army'
        ? [
            { fate: 'scattered', label: 'Scattered' },
            { fate: 'destroyed', label: `Destroyed · +${prices.army}` },
          ]
        : [{ fate: 'slain', label: 'Slain' }];
  const ownerName = (id: string) =>
    view.cities.find((c) => c.id === id)?.name ?? view.races.find((r) => r.id === id)?.name ?? '';

  return (
    <>
      <KindPicker label="What strikes" kinds={CATASTROPHE_KINDS} value={kind} onChange={setKind} />
      <ThemedText type="small" themeColor="textSecondary">
        Tap up to 7 hexes on the map. {perHex} power a hex.
      </ThemedText>
      <SectionLabel>The land afterwards</SectionLabel>
      <View style={styles.wrap}>
        <Chip label="Unchanged" selected={terrain === null} onPress={() => setTerrain(null)} />
        {TERRAIN_IDS.map((t) => (
          <Chip
            key={t}
            label={terrainInfo(t).name}
            selected={terrain === t}
            onPress={() => setTerrain(t)}
          />
        ))}
      </View>
      {struck.length > 0 ? (
        <>
          <SectionLabel>Caught in it</SectionLabel>
          <ThemedText type="small" themeColor="textSecondary">
            Spared unless you choose otherwise.
          </ThemedText>
          {struck.map((s) => (
            <View key={s.id} style={styles.struck}>
              <ThemedText type="smallBold">{s.name}</ThemedText>
              <View style={styles.wrap}>
                <Chip
                  label="Spared"
                  selected={!fates[s.id]}
                  onPress={() => setFates(({ [s.id]: _dropped, ...rest }) => rest)}
                />
                {options(s).map((o) => (
                  <Chip
                    key={o.fate}
                    label={o.label}
                    selected={fates[s.id] === o.fate}
                    onPress={() => setFates((f) => ({ ...f, [s.id]: o.fate }))}
                  />
                ))}
              </View>
            </View>
          ))}
        </>
      ) : null}
      {advancements.length > 0 ? (
        <>
          <SectionLabel>Advancements lost (optional)</SectionLabel>
          <View style={styles.wrap}>
            {advancements.map((a) => (
              <Chip
                key={a.id}
                label={`${a.field} (${ownerName(a.entityId)})`}
                selected={lost.includes(a.id)}
                onPress={() =>
                  setLost((l) => (l.includes(a.id) ? l.filter((x) => x !== a.id) : [...l, a.id]))
                }
              />
            ))}
          </View>
        </>
      ) : null}
      <CostSummary
        headline={
          hexes.length === 0
            ? 'Tap hexes on the map to choose where.'
            : `${kind.trim() || 'A catastrophe'} strikes ${hexes.length} ${
                hexes.length === 1 ? 'hex' : 'hexes'
              }`
        }
        cost={total}
        power={power}
        ready={hexes.length > 0}
      />
      {hexes.length > 0 ? (
        <Button title="Clear selection" variant="secondary" onPress={onClear} />
      ) : null}
      <TextField
        label="What happens?"
        value={description}
        onChangeText={setDescription}
        placeholder="The mountain wakes…"
        maxLength={280}
        multiline
        style={styles.multiline}
      />
      <Button
        title="Unleash it"
        onPress={() =>
          onSubmit({
            hexes: hexes.map((h) => [h.x, h.y]),
            kind: kind.trim(),
            terrain,
            fates: chosenFates.map((s) => ({ id: s.id, fate: fates[s.id] })),
            lostAdvancements: lost.filter((id) => advancements.some((a) => a.id === id)),
            description,
          })
        }
        busy={busy}
        disabled={hexes.length === 0 || !kind.trim() || !description.trim() || total > power}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  struck: { gap: Spacing.one },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
