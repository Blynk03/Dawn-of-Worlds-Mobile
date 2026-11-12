import { StyleSheet, View } from 'react-native';

import { TextField } from '@/components/form';
import { Chip, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  AVATAR_SUGGESTIONS,
  avatarActedThisTurn,
  avatarCreatedRace,
  ORDER_TYPE_NAMES,
  orderSurcharge,
} from '@/game/civilization';
import type { GameView, OrderType } from '@/game/project';

const ORDER_TYPES = Object.keys(ORDER_TYPE_NAMES) as OrderType[];

/** DOW-44: a new order's name, kind and purpose. */
export function OrderFields({
  name,
  orderType,
  purpose,
  onChange,
}: {
  name: string;
  orderType: OrderType;
  purpose: string;
  onChange: (patch: Partial<{ name: string; orderType: OrderType; purpose: string }>) => void;
}) {
  return (
    <>
      <TextField
        label="Order name"
        value={name}
        onChangeText={(v) => onChange({ name: v })}
        placeholder="The Hammers of the Deep"
        maxLength={40}
      />
      <SectionLabel>Kind of order</SectionLabel>
      <View style={styles.wrap}>
        {ORDER_TYPES.map((t) => (
          <Chip
            key={t}
            label={ORDER_TYPE_NAMES[t]}
            selected={orderType === t}
            onPress={() => onChange({ orderType: t })}
          />
        ))}
      </View>
      <TextField
        label="What is it for?"
        value={purpose}
        onChangeText={(v) => onChange({ purpose: v })}
        placeholder="Guard the mountain gates…"
        maxLength={280}
        multiline
        style={styles.multiline}
      />
    </>
  );
}

/** DOW-44/39: the orders a god can command, with what each costs them. */
export function OrderPicker({
  view,
  godId,
  orderId,
  onPick,
  baseCost,
  viaAvatar,
}: {
  view: GameView;
  godId: string;
  orderId: string | null;
  onPick: (id: string) => void;
  baseCost: number;
  /** Through an avatar, the order costs the same whoever made it. */
  viaAvatar: boolean;
}) {
  const orders = view.orders.filter((o) => o.status === 'active');
  if (orders.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        There are no orders yet.
      </ThemedText>
    );
  }
  return (
    <>
      <SectionLabel>Order</SectionLabel>
      <View style={styles.wrap}>
        {orders.map((o) => {
          const race = view.races.find((r) => r.id === o.raceId)?.name ?? '';
          const extra = viaAvatar ? 0 : orderSurcharge(o, godId);
          return (
            <Chip
              key={o.id}
              label={`${o.name} (${race}) · ${baseCost + extra}${extra ? ` incl. +${extra}` : ''}`}
              selected={orderId === o.id}
              onPress={() => onPick(o.id)}
            />
          );
        })}
      </View>
      {!viaAvatar ? (
        <ThemedText type="small" themeColor="textSecondary">
          Commanding another god’s order costs +10 for a religious sect, +5 for any other.
        </ThemedText>
      ) : null}
    </>
  );
}

/** DOW-45: a new avatar's name, kind, story and the race it walks among. */
export function AvatarFields({
  view,
  name,
  avatarType,
  description,
  raceId,
  onChange,
}: {
  view: GameView;
  name: string;
  avatarType: string;
  description: string;
  raceId: string | null;
  onChange: (
    patch: Partial<{
      name: string;
      avatarType: string;
      description: string;
      raceId: string | null;
    }>,
  ) => void;
}) {
  const suggested = (AVATAR_SUGGESTIONS as readonly string[]).includes(avatarType);
  return (
    <>
      <TextField
        label="Avatar name"
        value={name}
        onChangeText={(v) => onChange({ name: v })}
        placeholder="Durin the Deathless"
        maxLength={40}
      />
      <SectionLabel>What are they?</SectionLabel>
      <View style={styles.wrap}>
        {AVATAR_SUGGESTIONS.map((s) => (
          <Chip
            key={s}
            label={s}
            selected={avatarType === s}
            onPress={() => onChange({ avatarType: s })}
          />
        ))}
      </View>
      <TextField
        label="Or something else"
        value={suggested ? '' : avatarType}
        onChangeText={(v) => onChange({ avatarType: v })}
        placeholder="Sea serpent, witch-queen…"
        maxLength={40}
      />
      <TextField
        label="Who are they?"
        value={description}
        onChangeText={(v) => onChange({ description: v })}
        placeholder="Their legend…"
        maxLength={500}
        multiline
        style={styles.multiline}
      />
      <SectionLabel>Walks among</SectionLabel>
      <View style={styles.wrap}>
        <Chip
          label="No race"
          selected={raceId === null}
          onPress={() => onChange({ raceId: null })}
        />
        {view.races.map((r) => (
          <Chip
            key={r.id}
            label={r.name}
            selected={raceId === r.id}
            onPress={() => onChange({ raceId: r.id })}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        An avatar among a race lets you command that race.
      </ThemedText>
    </>
  );
}

export type AvatarIntent =
  | 'deed'
  | 'foundCity'
  | 'createOrder'
  | 'commandOrder'
  | 'purifyCity'
  | 'corruptCity'
  | 'createRace'
  | 'commandCity';

export const AVATAR_INTENTS: { intent: AvatarIntent; label: string }[] = [
  { intent: 'deed', label: 'A mortal deed' },
  { intent: 'foundCity', label: 'Found a city' },
  { intent: 'createOrder', label: 'Create an order' },
  { intent: 'commandOrder', label: 'Command an order' },
  { intent: 'purifyCity', label: 'Purify a city' },
  { intent: 'corruptCity', label: 'Corrupt a city' },
  { intent: 'commandCity', label: 'Command a city' },
  { intent: 'createRace', label: 'Create a race (once)' },
];

/**
 * DOW-45: one of the god's avatars, and what it should do. Avatars that already acted this turn
 * or are slain can't be chosen.
 */
export function AvatarCommandPicker({
  view,
  godId,
  avatarId,
  onAvatar,
  intent,
  onIntent,
}: {
  view: GameView;
  godId: string;
  avatarId: string | null;
  onAvatar: (id: string) => void;
  intent: AvatarIntent | null;
  onIntent: (intent: AvatarIntent) => void;
}) {
  const mine = view.avatars.filter((a) => a.godId === godId);
  const usedRace = avatarId ? avatarCreatedRace(view, avatarId) : false;
  return (
    <>
      <SectionLabel>Avatar</SectionLabel>
      <View style={styles.wrap}>
        {mine.map((a) => {
          const why =
            a.status !== 'active'
              ? ' · slain'
              : avatarActedThisTurn(view, a.id)
                ? ' · acted this turn'
                : '';
          return (
            <Chip
              key={a.id}
              label={`${a.name}${why}`}
              selected={avatarId === a.id}
              disabled={!!why}
              onPress={() => onAvatar(a.id)}
            />
          );
        })}
      </View>
      {avatarId ? (
        <>
          <SectionLabel>Does</SectionLabel>
          <View style={styles.wrap}>
            {AVATAR_INTENTS.map((i) => (
              <Chip
                key={i.intent}
                label={i.intent === 'createRace' && usedRace ? `${i.label} · used` : i.label}
                selected={intent === i.intent}
                disabled={i.intent === 'createRace' && usedRace}
                onPress={() => onIntent(i.intent)}
              />
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
