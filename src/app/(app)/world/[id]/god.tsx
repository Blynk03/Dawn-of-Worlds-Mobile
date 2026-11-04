import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { Button, TextField } from '@/components/form';
import {
  Card,
  Chip,
  ChoiceCircle,
  ErrorMessage,
  GodBadge,
  SectionLabel,
} from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { God } from '@/lib/database.types';
import { createGod, updateGod } from '@/worlds/api';
import { GOD_COLORS, MAX_SPHERES, SIGILS, SPHERES } from '@/worlds/god-options';
import { useLobby } from '@/worlds/hooks';
import { type GodDraft, hasErrors, toggleSphere, validateGod } from '@/worlds/validation';

/** DOW-23: create or edit your god for a world. */
export default function GodScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const myId = session?.user.id ?? '';
  const { data: lobby, error } = useLobby(id);

  if (!lobby) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        {error || lobby === null ? (
          <ErrorMessage message={error ?? 'This world could not be found.'} />
        ) : (
          <ActivityIndicator />
        )}
      </ThemedView>
    );
  }

  const mine = lobby.gods.find((g) => g.user_id === myId);
  const others = lobby.gods.filter((g) => g.user_id !== myId);
  // Remount the form if my god appears (e.g. saved from another device) so it starts from it.
  return (
    <GodForm
      key={mine?.id ?? 'new'}
      worldId={lobby.world.id}
      existing={mine}
      others={others}
      locked={lobby.world.status !== 'lobby'}
    />
  );
}

function GodForm({
  worldId,
  existing,
  others,
  locked,
}: {
  worldId: string;
  existing: God | undefined;
  others: God[];
  locked: boolean;
}) {
  const router = useRouter();
  const theme = useTheme();
  const [draft, setDraft] = useState<GodDraft>({
    name: existing?.name ?? '',
    spheres: existing?.spheres ?? [],
    personality: existing?.personality ?? '',
    color: existing?.color ?? null,
    sigil: existing?.sigil ?? null,
  });
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = validateGod(draft, others);
  const takenColors = new Set(others.map((g) => g.color));
  const set = (patch: Partial<GodDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setShowErrors(true);
    if (hasErrors(errors)) return;
    setBusy(true);
    setSaveError(null);
    try {
      const fields = {
        name: draft.name,
        spheres: draft.spheres,
        personality: draft.personality.trim(),
        color: draft.color!,
        sigil: draft.sigil!,
      };
      if (existing) {
        // After the game starts, only the name and personality can change.
        await updateGod(
          existing.id,
          locked ? { name: fields.name, personality: fields.personality } : fields,
        );
      } else {
        await createGod(worldId, fields);
      }
      router.back();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const shown = (key: keyof GodDraft) => (showErrors ? errors[key] : undefined);

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.preview}>
          <GodBadge color={draft.color} sigil={draft.sigil} size={64} />
          <View style={styles.previewText}>
            <ThemedText type="smallBold">{draft.name.trim() || 'Your god'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {draft.spheres.length > 0 ? draft.spheres.join(' · ') : 'No spheres yet'}
            </ThemedText>
          </View>
        </Card>

        {locked ? (
          <ThemedText type="small" themeColor="textSecondary">
            The game has started, so spheres, color and sigil are locked. You can still rename your
            god or change their personality.
          </ThemedText>
        ) : null}

        <TextField
          label="Name"
          value={draft.name}
          onChangeText={(name) => set({ name })}
          placeholder="Solara"
          maxLength={30}
        />
        <ErrorMessage message={shown('name')} />

        <SectionLabel>
          Spheres of influence ({draft.spheres.length}/{MAX_SPHERES})
        </SectionLabel>
        <View style={styles.wrap}>
          {SPHERES.map((sphere) => {
            const selected = draft.spheres.includes(sphere);
            return (
              <Chip
                key={sphere}
                label={sphere}
                selected={selected}
                disabled={locked || (!selected && draft.spheres.length >= MAX_SPHERES)}
                onPress={() => set({ spheres: toggleSphere(draft.spheres, sphere) })}
              />
            );
          })}
        </View>
        <ErrorMessage message={shown('spheres')} />

        <SectionLabel>Color</SectionLabel>
        <View style={styles.wrap}>
          {GOD_COLORS.map((c) => {
            const taken = takenColors.has(c.hex);
            return (
              <ChoiceCircle
                key={c.hex}
                label={taken ? `${c.name} (taken)` : c.name}
                color={c.hex}
                selected={draft.color === c.hex}
                disabled={locked || taken}
                onPress={() => set({ color: c.hex })}
              />
            );
          })}
        </View>
        <ErrorMessage message={shown('color')} />

        <SectionLabel>Sigil</SectionLabel>
        <View style={styles.wrap}>
          {SIGILS.map((s) => (
            <ChoiceCircle
              key={s.symbol}
              label={s.name}
              selected={draft.sigil === s.symbol}
              disabled={locked}
              onPress={() => set({ sigil: s.symbol })}>
              <Text style={[styles.sigil, { color: theme.text }]}>{s.symbol}</Text>
            </ChoiceCircle>
          ))}
        </View>
        <ErrorMessage message={shown('sigil')} />

        <TextField
          label="Personality (optional)"
          value={draft.personality}
          onChangeText={(personality) => set({ personality })}
          placeholder="Proud and warm, quick to anger, generous to the faithful…"
          multiline
          maxLength={500}
          style={styles.multiline}
        />
        <ErrorMessage message={shown('personality')} />

        <Button title={existing ? 'Save changes' : 'Create god'} onPress={save} busy={busy} />
        {showErrors && hasErrors(errors) ? (
          <ErrorMessage message="Fill in the highlighted parts above." />
        ) : null}
        <ErrorMessage message={saveError} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  preview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  previewText: { flex: 1, gap: Spacing.half },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sigil: { fontSize: 20 },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
