import { Pressable, StyleSheet, View } from 'react-native';

import { TextField } from '@/components/form';
import { Card, Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The powers the composer offers, in the order shown. `power` is the ruleset id that sets the cost. */
export type ActKind = 'shapeLand' | 'shapeClimate' | 'createRace' | 'foundCity';

export type ActOption = {
  kind: ActKind;
  power: string;
  category: string;
  name: string;
  blurb: string;
  perHex: boolean;
};

export const ACT_OPTIONS: ActOption[] = [
  {
    kind: 'shapeLand',
    power: 'shapeLand',
    category: 'Land',
    name: 'Shape Land',
    blurb: 'Raise mountains, plant forests, flood the lowlands.',
    perHex: true,
  },
  {
    kind: 'shapeClimate',
    power: 'shapeClimate',
    category: 'Land',
    name: 'Shape Climate',
    blurb: 'Set the weather that rules a region.',
    perHex: true,
  },
  {
    kind: 'createRace',
    power: 'createRace',
    category: 'Races',
    name: 'Create Race',
    blurb: 'Set a new people down on the land. You gain a sect among them.',
    perHex: false,
  },
  {
    kind: 'foundCity',
    power: 'commandRace',
    category: 'Races',
    name: 'Found a city',
    blurb: 'Command a race to build a city on or next to its land.',
    perHex: false,
  },
];

/** DOW-26: powers grouped by category, with this age's cost; ones you can't use say why. */
export function PowerPicker({
  costs,
  disabledReasons,
  onPick,
}: {
  costs: Record<ActKind, number>;
  disabledReasons: Partial<Record<ActKind, string>>;
  onPick: (kind: ActKind) => void;
}) {
  const categories = [...new Set(ACT_OPTIONS.map((o) => o.category))];
  return (
    <View style={styles.picker}>
      {categories.map((category) => (
        <View key={category} style={styles.group}>
          <SectionLabel>{category}</SectionLabel>
          {ACT_OPTIONS.filter((o) => o.category === category).map((option) => (
            <PowerRow
              key={option.kind}
              option={option}
              cost={costs[option.kind]}
              disabledReason={disabledReasons[option.kind]}
              onPress={() => onPick(option.kind)}
            />
          ))}
        </View>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Avatars, orders, events and more arrive in later updates.
      </ThemedText>
    </View>
  );
}

function PowerRow({
  option,
  cost,
  disabledReason,
  onPress,
}: {
  option: ActOption;
  cost: number;
  disabledReason?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const disabled = !!disabledReason;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={option.name}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.backgroundElement },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <View style={styles.rowText}>
        <ThemedText type="smallBold">{option.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {disabledReason ?? option.blurb}
        </ThemedText>
      </View>
      <ThemedText type="smallBold">
        {cost}
        {option.perHex ? ' / hex' : ''}
      </ThemedText>
    </Pressable>
  );
}

/** What the action costs and what you'll have left; an error if it's more than you have. */
export function CostSummary({
  headline,
  cost,
  power,
  ready,
}: {
  headline: string;
  cost: number;
  power: number;
  /** Whether enough is chosen for the cost to be meaningful. */
  ready: boolean;
}) {
  return (
    <Card>
      <ThemedText type="smallBold">{headline}</ThemedText>
      {ready && cost > power ? (
        <ErrorMessage message={`That costs ${cost} power; you have ${power}.`} />
      ) : ready ? (
        <ThemedText type="small" themeColor="textSecondary">
          Costs {cost}. You&apos;ll have {power - cost} power left.
        </ThemedText>
      ) : null}
    </Card>
  );
}

export const ALIGNMENT_OPTIONS: { value: -1 | 0 | 1; label: string }[] = [
  { value: 1, label: 'Good' },
  { value: 0, label: 'Neutral' },
  { value: -1, label: 'Evil' },
];

/** DOW-34: the race's name, nature, look and starting alignment. */
export function RaceFields({
  name,
  description,
  appearance,
  alignment,
  onChange,
}: {
  name: string;
  description: string;
  appearance: string;
  alignment: -1 | 0 | 1;
  onChange: (
    patch: Partial<{
      name: string;
      description: string;
      appearance: string;
      alignment: -1 | 0 | 1;
    }>,
  ) => void;
}) {
  return (
    <>
      <TextField
        label="Race name"
        value={name}
        onChangeText={(v) => onChange({ name: v })}
        placeholder="The Dwarves"
        maxLength={40}
      />
      <TextField
        label="What are they like?"
        value={description}
        onChangeText={(v) => onChange({ description: v })}
        placeholder="Stout folk who delve for the bones of the earth…"
        maxLength={500}
        multiline
        style={styles.multiline}
      />
      <TextField
        label="Appearance (optional)"
        value={appearance}
        onChangeText={(v) => onChange({ appearance: v })}
        placeholder="Short, broad and bearded"
        maxLength={280}
      />
      <SectionLabel>Starting alignment</SectionLabel>
      <View style={styles.wrap}>
        {ALIGNMENT_OPTIONS.map((a) => (
          <Chip
            key={a.value}
            label={a.label}
            selected={alignment === a.value}
            onPress={() => onChange({ alignment: a.value })}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  picker: { gap: Spacing.three },
  group: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowText: { flex: 1, gap: Spacing.half },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
