import { Pressable, StyleSheet, View } from 'react-native';

import { TextField } from '@/components/form';
import { Card, Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The powers the composer offers, in the order shown. `power` is the ruleset id that sets the cost. */
export type ActKind =
  | 'shapeLand'
  | 'shapeClimate'
  | 'createRace'
  | 'createSubrace'
  | 'foundCity'
  | 'advance'
  | 'purify'
  | 'corrupt'
  | 'createOrder'
  | 'commandOrder'
  | 'createAvatar'
  | 'commandAvatar'
  | 'resurrectAvatar';

/** What Advance, Purify and Corrupt can be aimed at: a civilization (race), a city or a region. */
export type TargetKind = 'race' | 'city' | 'region';

export type ActOption = {
  kind: ActKind;
  power: string;
  category: string;
  name: string;
  blurb: string;
  perHex: boolean;
  /** When the price depends on the target, the ruleset power for each kind of target. */
  byTarget?: Partial<Record<TargetKind, string>>;
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
    kind: 'createSubrace',
    power: 'createSubrace',
    category: 'Races',
    name: 'Create Subrace',
    blurb: 'A splinter group of an existing race, starting next to its ancestors’ land.',
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
  {
    kind: 'advance',
    power: 'advanceCity',
    category: 'Civilizations',
    name: 'Advance',
    blurb: 'Make a race or city the greatest in the world at something, for as long as it lasts.',
    perHex: false,
    byTarget: { race: 'advanceCivilization', city: 'advanceCity' },
  },
  {
    kind: 'purify',
    power: 'purifyCity',
    category: 'Alignment',
    name: 'Purify',
    blurb: '+1 alignment for a civilization, city or region. Once per target each turn.',
    perHex: false,
    byTarget: { race: 'purifyCivilization', city: 'purifyCity', region: 'purifyRegion' },
  },
  {
    kind: 'corrupt',
    power: 'corruptCity',
    category: 'Alignment',
    name: 'Corrupt',
    blurb: '−1 alignment for a civilization, city or region. Once per target each turn.',
    perHex: false,
    byTarget: { race: 'corruptCivilization', city: 'corruptCity', region: 'corruptRegion' },
  },
  {
    kind: 'createOrder',
    power: 'createOrder',
    category: 'Orders',
    name: 'Create Order',
    blurb:
      'A sect, knights, thieves’ guild, brigands or pirates within a race. Your foothold among them.',
    perHex: false,
  },
  {
    kind: 'commandOrder',
    power: 'commandOrder',
    category: 'Orders',
    name: 'Command Order',
    blurb: 'Tell an order what to do. Another god’s order costs +10 (sect) or +5.',
    perHex: false,
  },
  {
    kind: 'createAvatar',
    power: 'createAvatar',
    category: 'Avatars',
    name: 'Create Avatar',
    blurb: 'A high priest, dragon, warrior or dynasty who walks the world for you.',
    perHex: false,
  },
  {
    kind: 'commandAvatar',
    power: 'commandAvatar',
    category: 'Avatars',
    name: 'Command Avatar',
    blurb:
      'Your avatar does one great deed this turn: found a city, create an order, purify a city…',
    perHex: false,
  },
  {
    kind: 'resurrectAvatar',
    power: 'resurrectAvatar',
    category: 'Avatars',
    name: 'Resurrect Avatar',
    blurb: 'Bring back one of your slain avatars.',
    perHex: false,
  },
];

/** The ruleset powers an option can cost, depending on its target. */
export function optionPowers(option: ActOption): string[] {
  return option.byTarget ? Object.values(option.byTarget) : [option.power];
}

/** DOW-26: powers grouped by category, with this age's cost; ones you can't use say why. */
export function PowerPicker({
  costs,
  disabledReasons,
  onPick,
}: {
  /** What each option costs in this age, e.g. "3 / hex", "22", "4–5". */
  costs: Record<ActKind, string>;
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
        Armies, battles, events and catastrophes arrive in later updates.
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
  cost: string;
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
      <ThemedText type="smallBold">{cost}</ThemedText>
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
