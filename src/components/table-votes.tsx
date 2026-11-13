// DOW-52/53: the votes in front of the table: moving to the next age, and objections.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { describeAction } from '@/chronicle/history';
import { BattleCard } from '@/components/battle-card';
import { Button } from '@/components/form';
import { Card, Chip, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { castVote, closeVote, proposeNextAge, type VoteChoice } from '@/game/api';
import { ageName, describeDeadline, type GameView, type ProposalView } from '@/game/project';
import { isExpired, openProposals, voteCounts } from '@/game/votes';
import type { God } from '@/lib/database.types';
import { ageTransition, CLASSIC_RULESET, majorityOf } from '@/rules';

type Props = {
  worldId: string;
  view: GameView;
  gods: God[];
  myGodId: string | null;
  now: Date;
  /** Called after voting or proposing, so the game refreshes at once. */
  onChanged: () => void;
};

const OBJECTION_CHOICES: { choice: VoteChoice; label: string }[] = [
  { choice: 'keep', label: 'Keep it' },
  { choice: 'undo', label: 'Undo it' },
  { choice: 'coin', label: 'Flip a coin' },
];

/** The next age, battles waiting to be rolled, and any open votes. */
export function TableVotes({ worldId, view, gods, myGodId, now, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = openProposals(view);
  const ageVote = open.find((p) => p.kind === 'advanceAge');
  const objections = open.filter((p) => p.kind === 'objection');
  const transition = ageTransition(CLASSIC_RULESET, view.age, view.round, view.ageStartedRound);
  const godName = (id: string | null) => gods.find((g) => g.id === id)?.name ?? 'A god';

  // Close votes whose time is up when we notice (the server also does every few minutes).
  const closing = useRef(new Set<string>());
  useEffect(() => {
    for (const p of open) {
      if (isExpired(p, now) && !closing.current.has(p.id)) {
        closing.current.add(p.id);
        (async () => {
          try {
            await closeVote(worldId, p.id);
            onChanged();
          } catch {
            // Someone else closed it first, or the server will on its next pass.
          }
        })();
      }
    }
  }, [open, now, worldId, onChanged]);

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

  const vote = (p: ProposalView, choice: VoteChoice) =>
    run(`${p.id}:${choice}`, () => castVote(worldId, p.id, choice));

  return (
    <View style={styles.list}>
      <Card>
        <SectionLabel>The age</SectionLabel>
        <AgeStatus
          view={view}
          transition={transition}
          ageVote={ageVote}
          gods={gods}
          myGodId={myGodId}
          godName={godName}
          busy={busy}
          onPropose={() => run('propose', () => proposeNextAge(worldId))}
          onVote={vote}
        />
      </Card>
      {view.battles
        .filter((b) => b.status === 'pending')
        .map((b) => (
          <BattleCard
            key={b.id}
            worldId={worldId}
            battle={b}
            view={view}
            gods={gods}
            myGodId={myGodId}
            now={now}
            onChanged={onChanged}
          />
        ))}
      {objections.map((p) => (
        <Objection
          key={p.id}
          proposal={p}
          view={view}
          gods={gods}
          myGodId={myGodId}
          godName={godName}
          now={now}
          busy={busy}
          onVote={vote}
        />
      ))}
      <ErrorMessage message={error} />
    </View>
  );
}

function AgeStatus({
  view,
  transition,
  ageVote,
  gods,
  myGodId,
  godName,
  busy,
  onPropose,
  onVote,
}: {
  view: GameView;
  transition: ReturnType<typeof ageTransition>;
  ageVote: ProposalView | undefined;
  gods: God[];
  myGodId: string | null;
  godName: (id: string | null) => string;
  busy: string | null;
  onPropose: () => void;
  onVote: (p: ProposalView, choice: VoteChoice) => void;
}) {
  const roundsInAge = view.round - view.ageStartedRound + 1;
  const where = `Round ${roundsInAge} of the ${ageName(view.age)}.`;
  const next = ageName(view.age + 1);

  if (view.agePending) {
    return (
      <ThemedText type="small" themeColor="accent">
        {where} The gods have agreed: the {next} begins when this round ends.
      </ThemedText>
    );
  }
  if (ageVote) {
    const counts = voteCounts(ageVote);
    const mine = myGodId ? ageVote.votes[myGodId] : undefined;
    return (
      <>
        <ThemedText type="small">
          {where} {godName(ageVote.godId)} proposes moving on to the {next}.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Yes {counts.yes} · No {counts.no} of {gods.length}. It needs {majorityOf(gods.length)} yes
          votes before this round ends.
        </ThemedText>
        {myGodId ? (
          <View style={styles.choices}>
            <Chip
              label="Yes, move on"
              selected={mine === 'yes'}
              disabled={!!busy}
              onPress={() => onVote(ageVote, 'yes')}
            />
            <Chip
              label="Not yet"
              selected={mine === 'no'}
              disabled={!!busy}
              onPress={() => onVote(ageVote, 'no')}
            />
          </View>
        ) : null}
      </>
    );
  }
  switch (transition.kind) {
    case 'lastAge':
      return (
        <ThemedText type="small" themeColor="textSecondary">
          {where} This is the last age; it lasts until the game ends.
        </ThemedText>
      );
    case 'tooEarly':
      return (
        <ThemedText type="small" themeColor="textSecondary">
          {where} An age lasts at least {transition.minRounds} rounds; from round{' '}
          {transition.minRounds} the gods can vote to move on to the {next}.
        </ThemedText>
      );
    case 'vote':
    case 'anyGod':
      return (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {where}{' '}
            {transition.kind === 'vote'
              ? `A majority of the gods can end it; the ${next} would begin next round.`
              : `It has run ten rounds: any god can end it, and the ${next} begins next round.`}
          </ThemedText>
          {myGodId ? (
            <Button
              title={transition.kind === 'vote' ? `Propose the ${next}` : `Begin the ${next}`}
              variant="secondary"
              onPress={onPropose}
              busy={busy === 'propose'}
              disabled={!!busy}
            />
          ) : null}
        </>
      );
  }
}

function Objection({
  proposal,
  view,
  gods,
  myGodId,
  godName,
  now,
  busy,
  onVote,
}: {
  proposal: ProposalView;
  view: GameView;
  gods: God[];
  myGodId: string | null;
  godName: (id: string | null) => string;
  now: Date;
  busy: string | null;
  onVote: (p: ProposalView, choice: VoteChoice) => void;
}) {
  const action = view.actions.find((a) => a.seq === proposal.targetSeq);
  const counts = voteCounts(proposal);
  const mine = myGodId ? proposal.votes[myGodId] : undefined;
  const ends = describeDeadline(proposal.closesAt, now);
  return (
    <Card>
      <SectionLabel>Objection</SectionLabel>
      <ThemedText type="small">
        <ThemedText type="smallBold">{godName(proposal.godId)}</ThemedText> objects to{' '}
        {godName(action?.godId ?? null)}’s{' '}
        {action ? `${describeAction(action).power}: ${describeAction(action).what}` : 'action'}.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        “{proposal.reason}”
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Keep {counts.keep} · Undo {counts.undo} · Coin {counts.coin} of {gods.length}
        {ends ? ` · ${ends.replace('Ends', 'Closes')}` : ''}. More than half decides; a tie is
        settled by a coin flip. Undoing it refunds it, along with anything built on it.
      </ThemedText>
      {myGodId ? (
        <View style={styles.choices}>
          {OBJECTION_CHOICES.map(({ choice, label }) => (
            <Chip
              key={choice}
              label={label}
              selected={mine === choice}
              disabled={!!busy}
              onPress={() => onVote(proposal, choice)}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
