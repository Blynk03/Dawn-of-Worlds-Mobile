import { StyleSheet, View } from 'react-native';

import type { TargetKind } from '@/components/act-forms';
import { TextField } from '@/components/form';
import { Chip, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  ADVANCEMENT_SUGGESTIONS,
  alignmentLabel,
  entityName,
  greatestAt,
  regionAlignmentName,
} from '@/game/civilization';
import type { GameView } from '@/game/project';

const KIND_LABELS: Record<TargetKind, string> = {
  race: 'Civilization',
  city: 'City',
  region: 'Region',
};

/**
 * DOW-46/47: what Advance, Purify or Corrupt is aimed at. Races and cities are listed (and can
 * be tapped on the map); a region is a hex tapped on the map.
 */
export function TargetPicker({
  view,
  kinds,
  kind,
  onKind,
  targetId,
  onTarget,
  regionIndex,
  blocked,
  showAlignment,
}: {
  view: GameView;
  kinds: TargetKind[];
  kind: TargetKind;
  onKind: (kind: TargetKind) => void;
  targetId: string | null;
  onTarget: (id: string) => void;
  regionIndex: number | null;
  /** Targets this god can't choose again this turn (ids, or "x,y" for regions). */
  blocked: ReadonlySet<string>;
  showAlignment: boolean;
}) {
  const map = view.map;
  const entities =
    kind === 'race'
      ? view.races.map((r) => ({ id: r.id, name: r.name, alignment: r.alignment }))
      : kind === 'city'
        ? view.cities.map((c) => ({ id: c.id, name: c.name, alignment: c.alignment }))
        : [];
  const regionHex =
    regionIndex !== null && map
      ? { x: regionIndex % map.width, y: Math.floor(regionIndex / map.width) }
      : null;
  const regionAlignment = regionIndex !== null ? (map?.alignment?.[regionIndex] ?? 0) : 0;

  return (
    <>
      <SectionLabel>Target</SectionLabel>
      {kinds.length > 1 ? (
        <View style={styles.wrap}>
          {kinds.map((k) => (
            <Chip key={k} label={KIND_LABELS[k]} selected={kind === k} onPress={() => onKind(k)} />
          ))}
        </View>
      ) : null}
      {kind === 'region' ? (
        <ThemedText type="small" themeColor="textSecondary">
          {regionHex
            ? `The region at hex ${regionHex.x}, ${regionHex.y}: ${
                regionAlignmentName(regionAlignment) ?? 'untouched'
              } (${regionAlignment > 0 ? `+${regionAlignment}` : regionAlignment}).`
            : 'Tap a hex on the map.'}
        </ThemedText>
      ) : entities.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {kind === 'race' ? 'There are no races yet.' : 'There are no cities yet.'}
        </ThemedText>
      ) : (
        <>
          <View style={styles.wrap}>
            {entities.map((e) => {
              const done = blocked.has(e.id);
              return (
                <Chip
                  key={e.id}
                  label={`${e.name}${showAlignment ? ` · ${alignmentLabel(e.alignment)}` : ''}${
                    done ? ' · done this turn' : ''
                  }`}
                  selected={targetId === e.id}
                  disabled={done}
                  onPress={() => onTarget(e.id)}
                />
              );
            })}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Or tap {kind === 'race' ? 'a homeland' : 'a city'} on the map.
          </ThemedText>
        </>
      )}
    </>
  );
}

/** DOW-47: the field to become the greatest in the world at: a suggestion or your own. */
export function AdvancementPicker({
  view,
  field,
  custom,
  onChange,
}: {
  view: GameView;
  field: string;
  custom: boolean;
  onChange: (field: string, custom: boolean) => void;
}) {
  const holderOf = (f: string) => {
    const held = greatestAt(view, f);
    return held ? entityName(view, held.entityId) : null;
  };
  const customHolder = custom && field.trim() ? holderOf(field) : null;
  return (
    <>
      <SectionLabel>Greatest in the world at</SectionLabel>
      <View style={styles.wrap}>
        {ADVANCEMENT_SUGGESTIONS.map((s) => {
          const holder = holderOf(s);
          return (
            <Chip
              key={s}
              label={holder ? `${s} · ${holder}` : s}
              selected={!custom && field === s}
              disabled={!!holder}
              onPress={() => onChange(s, false)}
            />
          );
        })}
        <Chip
          label="Something else"
          selected={custom}
          onPress={() => onChange(custom ? field : '', true)}
        />
      </View>
      {custom ? (
        <TextField
          label="Field of knowledge"
          value={field}
          onChangeText={(v) => onChange(v, true)}
          placeholder="Astronomy, dragon taming…"
          maxLength={40}
        />
      ) : null}
      {customHolder ? (
        <ThemedText type="small" themeColor="accent">
          {customHolder} is already the greatest in the world at that.
        </ThemedText>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
