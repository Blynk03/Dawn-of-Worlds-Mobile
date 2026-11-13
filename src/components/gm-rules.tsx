// DOW-62: the GM's rules for a world, in World settings: final say, alignment cap, years per round.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, TextField } from '@/components/form';
import { Card, Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { type GmRules, gmSetRules } from '@/game/api';
import { ageName } from '@/game/project';
import type { World } from '@/lib/database.types';
import { CLASSIC_RULESET } from '@/rules';

const CAPS: (number | null)[] = [null, 3, 5, 10];
const RULESET_YEARS = CLASSIC_RULESET.ages.map((a) => a.yearsPerRound);

type Props = {
  world: World;
  /** Who the GM is, if the world has one. */
  gmName: string | null;
  isGm: boolean;
  onSaved: () => void;
};

export function GmRulesCard({ world, gmName, isGm, onSaved }: Props) {
  const current: GmRules = {
    finalSay: world.gm_final_say ?? false,
    alignmentCap: world.alignment_cap ?? null,
    yearsPerRound: (world.years_per_round as GmRules['yearsPerRound']) ?? null,
  };
  const [years, setYears] = useState<string[]>(
    (current.yearsPerRound ?? RULESET_YEARS).map(String),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!gmName) {
    return (
      <Card>
        <SectionLabel>Game master</SectionLabel>
        <ThemedText type="small" themeColor="textSecondary">
          This world has no GM. The host can take the role before the game starts.
        </ThemedText>
      </Card>
    );
  }

  const save = async (next: Partial<GmRules>) => {
    setBusy(true);
    setError(null);
    try {
      await gmSetRules(world.id, { ...current, ...next });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const parsedYears = years.map((y) => Number(y.trim()));
  const yearsValid = parsedYears.every((y) => Number.isInteger(y) && y >= 1 && y <= 10000);
  const yearsChanged = parsedYears.join(',') !== (current.yearsPerRound ?? RULESET_YEARS).join(',');

  return (
    <Card>
      <SectionLabel>Game master</SectionLabel>
      <ThemedText type="small" themeColor="textSecondary">
        {isGm
          ? 'You are the GM: your god goes first each round, and you can rule a new race non-traditional (it costs double).'
          : `${gmName} is the GM: their god goes first each round, and they can rule a new race non-traditional (it costs double).`}{' '}
        {isGm ? 'Your changes here are logged in the chronicle.' : 'Only the GM changes these.'}
      </ThemedText>

      <ThemedText type="smallBold">Final say on objections and disputed bonuses</ThemedText>
      <View style={styles.wrap}>
        <Chip
          label="The gods vote"
          selected={!current.finalSay}
          disabled={busy}
          onPress={isGm ? () => save({ finalSay: false }) : () => {}}
        />
        <Chip
          label="The GM rules"
          selected={current.finalSay}
          disabled={busy}
          onPress={isGm ? () => save({ finalSay: true }) : () => {}}
        />
      </View>

      <ThemedText type="smallBold">Alignment</ThemedText>
      <View style={styles.wrap}>
        {CAPS.map((cap) => (
          <Chip
            key={cap ?? 'none'}
            label={cap === null ? 'No limit' : `Capped at ±${cap}`}
            selected={current.alignmentCap === cap}
            disabled={busy}
            onPress={isGm ? () => save({ alignmentCap: cap }) : () => {}}
          />
        ))}
      </View>

      <ThemedText type="smallBold">Years per round</ThemedText>
      {isGm ? (
        <>
          <View style={styles.wrap}>
            {years.map((value, i) => (
              <View key={i} style={styles.year}>
                <TextField
                  label={ageName(i + 1)}
                  value={value}
                  onChangeText={(text) =>
                    setYears((ys) => ys.map((y, j) => (j === i ? text.replace(/\D/g, '') : y)))
                  }
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>
            ))}
          </View>
          <View style={styles.wrap}>
            <Button
              title="Save years"
              variant="secondary"
              onPress={() => save({ yearsPerRound: parsedYears as [number, number, number] })}
              disabled={busy || !yearsValid || !yearsChanged}
            />
            {current.yearsPerRound ? (
              <Button
                title="Use the rules’ years"
                variant="secondary"
                onPress={() => {
                  setYears(RULESET_YEARS.map(String));
                  save({ yearsPerRound: null });
                }}
                disabled={busy}
              />
            ) : null}
          </View>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {(current.yearsPerRound ?? RULESET_YEARS).join(' / ')} years in the three ages
          {current.yearsPerRound ? ' (set by the GM)' : ''}.
        </ThemedText>
      )}
      <ErrorMessage message={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  year: { width: 110 },
});
