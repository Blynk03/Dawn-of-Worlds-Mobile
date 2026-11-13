import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/form';
import { Card, ErrorMessage, GodBadge, SectionLabel } from '@/components/game-ui';
import { NudgeButton } from '@/components/nudge-button';
import { TableVotes } from '@/components/table-votes';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { God } from '@/lib/database.types';
import { endTurn, skipTimedOutTurn } from '@/game/api';
import { useGame, useNow } from '@/game/hooks';
import { ageName, describeDeadline, type GameView } from '@/game/project';
import type { LobbyMember } from '@/worlds/api';

type Props = {
  worldId: string;
  gods: God[];
  members: LobbyMember[];
  myId: string;
  /** Opens the action screen. Without it, the Act button is hidden. */
  onAct?: () => void;
  /** DOW-62: the GM has the final say on objections and disputed bonuses. */
  gmFinalSay?: boolean;
};

export type GameState = ReturnType<typeof useGame>;

/** The game in play, loading its own state. */
export function GamePanel(props: Props) {
  const game = useGame(props.worldId, true);
  return <GamePanelView {...props} game={game} />;
}

/** The game in play: round, year, whose turn it is, everyone's power, and your turn controls. */
export function GamePanelView({
  worldId,
  gods,
  members,
  myId,
  onAct,
  gmFinalSay = false,
  game,
}: Props & { game: GameState }) {
  const { view, error, loaded, refresh } = game;
  const now = useNow();
  const [busy, setBusy] = useState<'end' | 'pass' | 'skip' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!loaded) return <ActivityIndicator />;
  if (!view.started) {
    return (
      <Card>
        <ErrorMessage message={error ?? 'The game is starting…'} />
        <Button title="Refresh" variant="secondary" onPress={refresh} />
      </Card>
    );
  }

  const godById = new Map(gods.map((g) => [g.id, g]));
  const playerName = (godId: string | null) => {
    const god = godId ? godById.get(godId) : undefined;
    return members.find((m) => m.user_id === god?.user_id)?.profiles?.display_name ?? 'a player';
  };
  const active = view.activeGodId ? godById.get(view.activeGodId) : undefined;
  const myTurn = active?.user_id === myId;
  const myGod = gods.find((g) => g.user_id === myId);
  const deadlineText = describeDeadline(view.turnDeadline, now);
  const timedOut = !!view.turnDeadline && new Date(view.turnDeadline) <= now;

  const run = async (kind: 'end' | 'pass' | 'skip') => {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === 'skip') await skipTimedOutTurn(worldId);
      else await endTurn(worldId, kind === 'pass');
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.panel}>
      <Card>
        <ThemedText type="smallBold" accessibilityRole="header">
          Round {view.round} · {ageName(view.age)} · Year {view.year}
        </ThemedText>
        {myTurn ? (
          <>
            <ThemedText type="subtitle">Your turn</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {active?.name} has {view.powers[active?.id ?? '']?.power ?? 0} power. Use it to shape
              the world, then end your turn (or pass to save it).
            </ThemedText>
            {deadlineText ? (
              <ThemedText type="small" themeColor="accent">
                {deadlineText}
              </ThemedText>
            ) : null}
            {onAct ? <Button title="Shape the world" onPress={onAct} disabled={!!busy} /> : null}
            <Button
              title="End turn"
              onPress={() => run('end')}
              busy={busy === 'end'}
              disabled={!!busy}
            />
            <Button
              title="Pass"
              variant="secondary"
              onPress={() => run('pass')}
              busy={busy === 'pass'}
              disabled={!!busy}
            />
          </>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Waiting for {active?.name ?? '…'} ({playerName(view.activeGodId)})
              {deadlineText ? ` · ${deadlineText}` : ''}
            </ThemedText>
            {myGod ? (
              <ThemedText type="small" themeColor="textSecondary">
                You can use {myGod.name}&apos;s powers on your turn.
              </ThemedText>
            ) : null}
            {myGod && active ? (
              <NudgeButton worldId={worldId} myId={myId} activeName={active.name} />
            ) : null}
            {timedOut ? (
              <Button
                title={`Skip ${active?.name ?? 'this'}'s turn`}
                variant="secondary"
                onPress={() => run('skip')}
                busy={busy === 'skip'}
              />
            ) : null}
          </>
        )}
        <ErrorMessage message={actionError ?? error} />
      </Card>

      <TableVotes
        worldId={worldId}
        view={view}
        gods={gods}
        myGodId={myGod?.id ?? null}
        gm={{
          isMe: members.some((m) => m.user_id === myId && m.is_gm),
          finalSay: gmFinalSay,
        }}
        now={now}
        onChanged={refresh}
      />

      <SectionLabel>Turn order this round</SectionLabel>
      {view.turnOrder.map((godId, index) => (
        <TurnRow
          key={godId}
          god={godById.get(godId)}
          position={index + 1}
          view={view}
          isMine={godById.get(godId)?.id === myGod?.id}
          player={playerName(godId)}
        />
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Each round every god rolls 2d6 for power; the highest roll goes first.
        {view.roundTiebreaks.length > 0
          ? ` Ties were re-rolled: ${view.roundTiebreaks
              .map((t) => `${godById.get(t.godId ?? '')?.name ?? 'a god'} rolled ${t.total}`)
              .join(', ')}.`
          : ''}
      </ThemedText>
    </View>
  );
}

function TurnRow({
  god,
  position,
  view,
  isMine,
  player,
}: {
  god: God | undefined;
  position: number;
  view: GameView;
  isMine: boolean;
  player: string;
}) {
  if (!god) return null;
  const income = view.roundIncomes.find((i) => i.godId === god.id);
  const power = view.powers[god.id];
  const taken = view.turnsThisRound.find((t) => t.godId === god.id);
  const isActive = view.activeGodId === god.id;
  const status = isActive
    ? 'Taking their turn'
    : taken
      ? taken.how === 'pass'
        ? 'Passed'
        : taken.how === 'timeout'
          ? 'Ran out of time'
          : 'Done'
      : 'Waiting';

  return (
    <Card style={[styles.row, isActive && styles.activeRow]}>
      <ThemedText type="smallBold" style={styles.position}>
        {position}
      </ThemedText>
      <GodBadge color={god.color} sigil={god.sigil} size={32} label={god.name} />
      <View style={styles.rowText}>
        <ThemedText type="smallBold">
          {god.name}
          {isMine ? ' (you)' : ''}
        </ThemedText>
        <ThemedText type="small" themeColor={isActive ? 'accent' : 'textSecondary'}>
          {status} · {player}
        </ThemedText>
        {income ? (
          <ThemedText type="small" themeColor="textSecondary">
            Rolled {income.roll}
            {income.bonus > 0 ? ` +${income.bonus} bonus` : ''}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.power}>
        <ThemedText
          type="subtitle"
          accessibilityLabel={`${god.name} has ${power?.power ?? 0} power`}>
          {power?.power ?? 0}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          power
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  activeRow: { borderWidth: 2, borderColor: '#E3B05B' },
  position: { width: 16, textAlign: 'center' },
  rowText: { flex: 1, gap: Spacing.half },
  power: { alignItems: 'center', minWidth: 56 },
});
