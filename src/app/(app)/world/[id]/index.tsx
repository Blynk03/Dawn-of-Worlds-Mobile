import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { Button } from '@/components/form';
import { ActiveWorld } from '@/components/active-world';
import { Card, ErrorMessage, GodBadge, SectionLabel } from '@/components/game-ui';
import { HexMap } from '@/components/hex-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { God } from '@/lib/database.types';
import { type LobbyMember, removeMember, startWorld } from '@/worlds/api';
import { useLobby } from '@/worlds/hooks';
import { formatInviteCode } from '@/worlds/invite';
import { shareInvite } from '@/worlds/share';
import { canStart, MIN_GODS_TO_START, playersWithoutGods } from '@/worlds/summaries';

/** DOW-22: a world's lobby — invite friends, see everyone's gods, and start the game. */
export default function WorldScreen() {
  // `hex` ("x,y") opens the map at a place, e.g. from a chronicle link.
  const { id, hex } = useLocalSearchParams<{ id: string; hex?: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id ?? '';
  const { data: lobby, error, loading, refresh } = useLobby(id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (lobby === undefined) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        {error ? <ErrorMessage message={error} /> : <ActivityIndicator />}
      </ThemedView>
    );
  }
  if (lobby === null) {
    return (
      <ThemedView style={[styles.fill, styles.center, styles.content]}>
        <ThemedText>This world doesn&apos;t exist, or you&apos;re no longer a member.</ThemedText>
        <Button title="Back to my worlds" onPress={() => router.replace('/')} />
      </ThemedView>
    );
  }

  const { world, members, gods } = lobby;
  const me = members.find((m) => m.user_id === myId);
  const isHost = me?.role === 'host';
  const inLobby = world.status === 'lobby';
  const myGod = gods.find((g) => g.user_id === myId);
  const missing = playersWithoutGods(members, gods);
  const ready = canStart(members, gods);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await action();
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    const result = await shareInvite(world.name, world.invite_code);
    setShareNote(
      result === 'copied'
        ? 'Invite copied. Paste it into a message to your friends.'
        : result === 'unavailable'
          ? `Send your friends the code ${formatInviteCode(world.invite_code)}.`
          : null,
    );
  };

  if (!inLobby) {
    return (
      <ThemedView style={styles.fill}>
        <Stack.Screen options={{ title: world.name }} />
        <ActiveWorld worldId={world.id} gods={gods} members={members} myId={myId} focusHex={hex} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ title: world.name }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
        <Card>
          <SectionLabel>Invite friends</SectionLabel>
          <ThemedText type="subtitle" selectable accessibilityLabel="Invite code">
            {formatInviteCode(world.invite_code)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Friends enter this code on their Worlds screen, or open the link you send them.
          </ThemedText>
          <Button title="Share invite" variant="secondary" onPress={share} />
          {shareNote ? <ThemedText type="small">{shareNote}</ThemedText> : null}
        </Card>

        <Card>
          <SectionLabel>Starting landmass</SectionLabel>
          {lobby.map ? (
            <View style={styles.mapPreview}>
              <HexMap
                map={{
                  width: lobby.map.width,
                  height: lobby.map.height,
                  terrain: lobby.map.terrain,
                  climate: lobby.map.climate,
                }}
              />
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {isHost
                ? 'Sketch the land and seas your gods will start with, or leave it and a random one is made when the game starts.'
                : 'The host can sketch the starting land and seas. Otherwise a random one is made when the game starts.'}
            </ThemedText>
          )}
          {isHost ? (
            <Button
              title={lobby.map ? 'Edit the starting landmass' : 'Draw the starting landmass'}
              variant="secondary"
              onPress={() => router.push(`/world/${world.id}/landmass`)}
            />
          ) : null}
        </Card>

        <SectionLabel>Players ({members.length}/8)</SectionLabel>
        {members.map((member) => (
          <MemberRow
            key={member.user_id}
            member={member}
            god={gods.find((g) => g.user_id === member.user_id)}
            isMe={member.user_id === myId}
            canRemove={isHost && inLobby && member.user_id !== myId}
            confirming={confirmRemove === member.user_id}
            removing={busy === `remove:${member.user_id}`}
            onRemove={() => {
              if (confirmRemove !== member.user_id) {
                setConfirmRemove(member.user_id);
                return;
              }
              setConfirmRemove(null);
              run(`remove:${member.user_id}`, () => removeMember(world.id, member.user_id));
            }}
          />
        ))}

        <Button
          title={
            myGod
              ? 'Edit your god'
              : me?.is_gm
                ? 'Create a god (optional for the GM)'
                : 'Create your god'
          }
          variant={myGod ? 'secondary' : 'primary'}
          onPress={() => router.push(`/world/${world.id}/god`)}
        />

        {isHost && inLobby ? (
          <Card>
            <SectionLabel>Start the game</SectionLabel>
            {!ready ? (
              startBlockers(gods.length, missing).map((reason) => (
                <ThemedText key={reason} type="small" themeColor="textSecondary">
                  {reason}
                </ThemedText>
              ))
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Everyone has a god. Once you start, no one else can join and gods&apos; spheres,
                colors and sigils are locked.
              </ThemedText>
            )}
            <Button
              title="Start the First Age"
              onPress={() => run('start', () => startWorld(world.id))}
              disabled={!ready}
              busy={busy === 'start'}
            />
          </Card>
        ) : null}

        <ErrorMessage message={actionError ?? error} />
      </ScrollView>
    </ThemedView>
  );
}

/** Every reason the host can't start yet, in plain words. */
function startBlockers(godCount: number, missing: LobbyMember[]): string[] {
  const reasons: string[] = [];
  if (godCount < MIN_GODS_TO_START) {
    reasons.push(`You need at least ${MIN_GODS_TO_START} gods to start.`);
  }
  if (missing.length > 0) {
    const names = missing.map((m) => m.profiles?.display_name ?? 'a player').join(', ');
    reasons.push(`Waiting for ${names} to create a god.`);
  }
  return reasons;
}

function MemberRow({
  member,
  god,
  isMe,
  canRemove,
  confirming,
  removing,
  onRemove,
}: {
  member: LobbyMember;
  god: God | undefined;
  isMe: boolean;
  canRemove: boolean;
  confirming: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const player = member.profiles?.display_name ?? 'Player';
  const tags = [
    isMe ? 'you' : null,
    member.role === 'host' ? 'host' : null,
    member.is_gm ? 'GM' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card style={styles.memberRow}>
      <GodBadge color={god?.color ?? null} sigil={god?.sigil ?? null} label={god?.name} />
      <View style={styles.memberText}>
        <ThemedText type="smallBold">{god ? god.name : 'No god yet'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {player}
          {tags ? ` (${tags})` : ''}
        </ThemedText>
        {god ? (
          <ThemedText type="small" themeColor="textSecondary">
            {god.spheres.join(' · ')}
          </ThemedText>
        ) : null}
      </View>
      {canRemove ? (
        <Button
          title={confirming ? 'Tap to confirm' : 'Remove'}
          variant="secondary"
          onPress={onRemove}
          busy={removing}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  mapPreview: { height: 240, borderRadius: Spacing.two, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  memberText: { flex: 1, gap: Spacing.half },
});
