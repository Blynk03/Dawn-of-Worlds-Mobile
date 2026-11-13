// DOW-56/54: a declared battle waiting out its reaction window: its bonuses, disputes and waivers.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, TextField } from '@/components/form';
import { Card, Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  castVote,
  closeBattle,
  disputeBonus,
  gmRule,
  proposeBonus,
  type VoteChoice,
  waiveReaction,
} from '@/game/api';
import {
  type BonusView,
  type DeclaredBattleView,
  describeDeadline,
  type GameView,
} from '@/game/project';
import { voteCounts } from '@/game/votes';
import type { God } from '@/lib/database.types';

type Props = {
  worldId: string;
  battle: DeclaredBattleView;
  view: GameView;
  gods: God[];
  myGodId: string | null;
  /** DOW-62: you're the GM and have the final say on disputed bonuses. */
  canRule?: boolean;
  now: Date;
  onChanged: () => void;
};

export function BattleCard({
  worldId,
  battle,
  view,
  gods,
  myGodId,
  canRule = false,
  now,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const godName = (id: string | null) => gods.find((g) => g.id === id)?.name ?? 'A god';
  const playing = gods.filter((g) => !view.departedGods.includes(g.id) && g.id !== battle.godId);
  const iWaived = !!myGodId && battle.waived.includes(myGodId);
  const ends = describeDeadline(battle.closesAt, now);
  const expired = !!battle.closesAt && new Date(battle.closesAt) <= now;

  // Roll a battle whose window has closed when we notice (the server also does every few minutes).
  const closing = useRef(false);
  useEffect(() => {
    if (expired && !closing.current) {
      closing.current = true;
      (async () => {
        try {
          await closeBattle(worldId, battle.id);
          onChanged();
        } catch {
          // Someone else rolled it first, or the server will on its next pass.
        }
      })();
    }
  }, [expired, worldId, battle.id, onChanged]);

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sideProps = {
    worldId,
    battle,
    view,
    myGodId,
    canRule,
    busy,
    godName,
    run,
  };
  return (
    <Card>
      <SectionLabel>Battle declared</SectionLabel>
      <ThemedText type="smallBold">
        ⚔︎ {battle.army.name} marches on {battle.target.name}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {godName(battle.godId)}: “{battle.description}”
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {expired ? 'Rolling now…' : ends ? `${ends.replace('Ends in', 'Rolled in')}` : ''}
        {
          ', or as soon as every other god waives. Until then, answer it on your turn: march an army in, shape the land, raise walls.'
        }
        {battle.utterlyDestroy ? ' The attacker means to destroy them utterly.' : ''}
      </ThemedText>
      <Side side="attacker" title={`${battle.army.name}’s bonuses`} {...sideProps} />
      <Side side="defender" title={`${battle.target.name}’s bonuses`} {...sideProps} />
      <ThemedText type="small" themeColor="textSecondary">
        Waived: {battle.waived.length} of {playing.length}
        {battle.waived.length > 0 ? ` (${battle.waived.map(godName).join(', ')})` : ''}
      </ThemedText>
      {myGodId && myGodId !== battle.godId && !iWaived ? (
        <Button
          title="Waive: roll it without me"
          variant="secondary"
          onPress={() => run('waive', () => waiveReaction(worldId, battle.id))}
          busy={busy === 'waive'}
          disabled={!!busy}
        />
      ) : null}
      <ErrorMessage message={error} />
    </Card>
  );
}

function Side({
  side,
  title,
  worldId,
  battle,
  view,
  myGodId,
  canRule,
  busy,
  godName,
  run,
}: {
  side: BonusView['side'];
  title: string;
  worldId: string;
  battle: DeclaredBattleView;
  view: GameView;
  myGodId: string | null;
  canRule: boolean;
  busy: string | null;
  godName: (id: string | null) => string;
  run: (key: string, work: () => Promise<unknown>) => void;
}) {
  const [label, setLabel] = useState('');
  const bonuses = battle.bonuses.filter((b) => b.side === side);
  const counting = bonuses.filter((b) => b.status === 'agreed' || b.status === 'kept').length;
  return (
    <View style={styles.side}>
      <ThemedText type="smallBold">
        {title}: 2d6 + {counting}
      </ThemedText>
      {bonuses.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          None yet.
        </ThemedText>
      ) : null}
      {bonuses.map((bonus) => {
        const vote = view.proposals.find((p) => p.bonusId === bonus.id && p.status === 'open');
        const byGm = view.proposals.some((p) => p.bonusId === bonus.id && p.byGm);
        const counts = vote ? voteCounts(vote) : null;
        const mine = vote && myGodId ? vote.votes[myGodId] : undefined;
        const castOn = (choice: VoteChoice) => () =>
          run(`${bonus.id}:${choice}`, () => castVote(worldId, vote!.id, choice));
        return (
          <View key={bonus.id} style={styles.bonus}>
            <ThemedText
              type="small"
              themeColor={bonus.status === 'dropped' ? 'textSecondary' : undefined}>
              +1 {bonus.label}
              {` · ${godName(bonus.godId)}`}
              {bonus.status === 'disputed' ? ' · disputed' : ''}
              {bonus.status === 'kept' ? ` · kept by ${byGm ? 'the GM' : 'vote'}` : ''}
              {bonus.status === 'dropped' ? ` · dropped by ${byGm ? 'the GM' : 'vote'}` : ''}
            </ThemedText>
            {vote && counts ? (
              <View style={styles.row}>
                <ThemedText type="small" themeColor="textSecondary">
                  Keep {counts.keep} · Drop {counts.drop}
                </ThemedText>
                {myGodId ? (
                  <>
                    <Chip
                      label="Count it"
                      selected={mine === 'keep'}
                      disabled={!!busy}
                      onPress={castOn('keep')}
                    />
                    <Chip
                      label="Drop it"
                      selected={mine === 'drop'}
                      disabled={!!busy}
                      onPress={castOn('drop')}
                    />
                  </>
                ) : null}
                {canRule ? (
                  <>
                    <Chip
                      label="GM: count it"
                      selected={false}
                      disabled={!!busy}
                      onPress={() => run(`${bonus.id}:gm`, () => gmRule(worldId, vote.id, 'keep'))}
                    />
                    <Chip
                      label="GM: drop it"
                      selected={false}
                      disabled={!!busy}
                      onPress={() => run(`${bonus.id}:gm`, () => gmRule(worldId, vote.id, 'drop'))}
                    />
                  </>
                ) : null}
              </View>
            ) : bonus.status === 'agreed' && myGodId && bonus.godId !== myGodId ? (
              <View style={styles.row}>
                <Chip
                  label={`Dispute ${bonus.label}`}
                  selected={false}
                  disabled={!!busy}
                  onPress={() => run(`dispute:${bonus.id}`, () => disputeBonus(worldId, bonus.id))}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {myGodId ? (
        <View style={styles.addRow}>
          <View style={styles.fill}>
            <TextField
              label={`Propose a bonus for ${side === 'attacker' ? 'the attackers' : 'the defenders'}`}
              value={label}
              onChangeText={setLabel}
              placeholder={
                side === 'attacker' ? 'Cavalry, a night march…' : 'Higher ground, a river…'
              }
              maxLength={60}
            />
          </View>
          <Button
            title="Add"
            variant="secondary"
            disabled={!label.trim() || !!busy}
            onPress={() =>
              run(`add:${side}`, async () => {
                await proposeBonus(worldId, battle.id, side, label);
                setLabel('');
              })
            }
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  side: { gap: Spacing.one, paddingTop: Spacing.two },
  bonus: { gap: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  fill: { flex: 1 },
});
