import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { actionEntities, describeAction, timeAgo } from '@/chronicle/history';
import {
  addComment,
  deleteComment,
  reactionCounts,
  threadsFor,
  toggleReaction,
} from '@/chronicle/social';
import { BattleSummary } from '@/components/battle-summary';
import { Button, TextField } from '@/components/form';
import { Card, ErrorMessage, GodBadge } from '@/components/game-ui';
import { MapThumbnail } from '@/components/map-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { objectToAction } from '@/game/api';
import { type ActionRecord, ageName, describeDeadline, type GameView } from '@/game/project';
import { canObject, objectionDeadline, objectionTo, voteCounts } from '@/game/votes';
import { useTheme } from '@/hooks/use-theme';
import type { CommentRow, God, ReactionRow } from '@/lib/database.types';
import type { LobbyMember } from '@/worlds/api';

type Props = {
  worldId: string;
  action: ActionRecord;
  view: GameView;
  gods: God[];
  members: LobbyMember[];
  myId: string | undefined;
  comments: CommentRow[];
  reactions: ReactionRow[];
  now: Date;
  /** DOW-53: hours after an action that others can object to it (0 = objections off). */
  objectionHours: number;
  /** Called after this player reacts or comments, so the feed can refresh at once. */
  onChanged: () => void;
  onOpenEntity: (entityId: string) => void;
  onOpenHex: (hex: { x: number; y: number }) => void;
};

/** DOW-37: one action in the activity feed, with reactions and threaded comments. */
export function FeedCard({
  worldId,
  action,
  view,
  gods,
  members,
  myId,
  comments,
  reactions,
  now,
  objectionHours,
  onChanged,
  onOpenEntity,
  onOpenHex,
}: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const god = gods.find((g) => g.id === action.godId);
  const { power, what } = describeAction(action);
  const entities = actionEntities(view, action);
  const threads = threadsFor(comments, action.seq);
  const commentCount = threads.reduce((n, t) => n + 1 + t.replies.length, 0);
  const authorName = (userId: string) =>
    members.find((m) => m.user_id === userId)?.profiles?.display_name ?? 'A player';

  const attempt = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const post = async () => {
    setBusy(true);
    await attempt(async () => {
      await addComment(worldId, action.seq, draft, replyTo?.id ?? null);
      setDraft('');
      setReplyTo(null);
    });
    setBusy(false);
  };

  const renderComment = (c: CommentRow, reply: boolean) => (
    <View key={c.id} style={[styles.comment, reply && styles.reply]}>
      <ThemedText type="small">
        <ThemedText type="smallBold">{authorName(c.user_id)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {` · ${timeAgo(c.created_at, now)}`}
        </ThemedText>
      </ThemedText>
      <ThemedText type="small">{c.body}</ThemedText>
      <View style={styles.row}>
        <TextLink label="Reply" onPress={() => setReplyTo(c)} />
        {c.user_id === myId ? (
          <TextLink label="Delete" onPress={() => attempt(() => deleteComment(c.id))} />
        ) : null}
      </View>
    </View>
  );

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <GodBadge
          color={god?.color ?? null}
          sigil={god?.sigil ?? null}
          size={32}
          label={god?.name}
        />
        <View style={styles.fill}>
          <ThemedText type="smallBold">
            {god?.name ?? 'A god'} · {power}: {what}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {ageName(action.age)} · Round {action.round} · Year {action.year} ·{' '}
            {timeAgo(action.at, now)}
          </ThemedText>
        </View>
      </View>

      <View style={styles.body}>
        <View style={[styles.fill, styles.gap]}>
          <ThemedText themeColor={action.retconned ? 'textSecondary' : undefined}>
            {action.description}
          </ThemedText>
          <ObjectionStatus
            worldId={worldId}
            action={action}
            view={view}
            gods={gods}
            myGodId={gods.find((g) => g.user_id === myId)?.id ?? null}
            hours={objectionHours}
            now={now}
            onChanged={onChanged}
          />
          {action.battle ? <BattleSummary battle={action.battle} target={action.choice} /> : null}
          {entities.length > 0 ? (
            <View style={styles.row}>
              {entities.map((e) => (
                <TextLink
                  key={e.id}
                  label={e.name}
                  accessibilityLabel={`Open ${e.name} in the Atlas`}
                  onPress={() => onOpenEntity(e.id)}
                />
              ))}
            </View>
          ) : null}
        </View>
        {view.map && action.hexes.length > 0 ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Show on the map"
            onPress={() => onOpenHex({ x: action.hexes[0][0], y: action.hexes[0][1] })}
            style={styles.thumbnail}>
            <MapThumbnail map={view.map} hexes={action.hexes} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.reactions}>
        {reactionCounts(reactions, action.seq, myId).map((r) => (
          <Pressable
            key={r.emoji}
            accessibilityRole="button"
            accessibilityLabel={`${r.emoji} ${r.count}`}
            accessibilityState={{ selected: r.mine }}
            onPress={() => attempt(() => toggleReaction(worldId, action.seq, r.emoji))}
            style={[
              styles.reaction,
              {
                borderColor: r.mine ? theme.accent : theme.backgroundSelected,
                backgroundColor: r.mine ? theme.backgroundSelected : 'transparent',
              },
            ]}>
            <ThemedText type="small">
              {r.emoji}
              {r.count > 0 ? ` ${r.count}` : ''}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <TextLink
        label={
          open
            ? 'Hide comments'
            : commentCount === 0
              ? 'Comment'
              : `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`
        }
        onPress={() => setOpen((o) => !o)}
      />

      {open ? (
        <View style={styles.gap}>
          {threads.map((t) => (
            <View key={t.comment.id} style={styles.gap}>
              {renderComment(t.comment, false)}
              {t.replies.map((r) => renderComment(r, true))}
            </View>
          ))}
          {replyTo ? (
            <View style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary">
                Replying to {authorName(replyTo.user_id)}
              </ThemedText>
              <TextLink label="Cancel" onPress={() => setReplyTo(null)} />
            </View>
          ) : null}
          <TextField
            label={replyTo ? 'Your reply' : 'Add a comment'}
            value={draft}
            onChangeText={setDraft}
            placeholder="Say something about this…"
            maxLength={1000}
            multiline
          />
          <Button title="Post" onPress={post} busy={busy} disabled={!draft.trim()} />
        </View>
      ) : null}
      <ErrorMessage message={error} />
    </Card>
  );
}

function TextLink({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={8}>
      <ThemedText type="smallBold" themeColor="accent">
        {label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * DOW-53: whether an action was undone, the objection to it and how the vote went, or (for the
 * other gods, inside the objection window) a way to object.
 */
function ObjectionStatus({
  worldId,
  action,
  view,
  gods,
  myGodId,
  hours,
  now,
  onChanged,
}: {
  worldId: string;
  action: ActionRecord;
  view: GameView;
  gods: God[];
  myGodId: string | null;
  hours: number;
  now: Date;
  onChanged: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objection = objectionTo(view, action.seq);
  const godName = (id: string | null) => gods.find((g) => g.id === id)?.name ?? 'A god';

  if (action.retconned && !objection) {
    const cause = view.actions.find((a) => a.seq === action.undoneBecauseOf);
    return (
      <ThemedText type="smallBold" themeColor="accent">
        Undone{cause ? ` along with “${describeAction(cause).what}”, which it built on` : ''}; its
        cost was refunded.
      </ThemedText>
    );
  }
  if (objection) {
    const counts = voteCounts(objection);
    const result =
      objection.status === 'open'
        ? 'The gods are voting: vote on the world screen.'
        : objection.status === 'undone'
          ? `Undone${objection.coin ? ' on a coin flip' : ` by vote (${counts.undo} to ${counts.keep})`}; its cost was refunded.`
          : `Kept${objection.coin ? ' on a coin flip' : ` by vote (${counts.keep} to ${counts.undo})`}.`;
    return (
      <View style={styles.objection}>
        <ThemedText type="small">
          <ThemedText type="smallBold">{godName(objection.godId)} objected:</ThemedText> “
          {objection.reason}”
        </ThemedText>
        <ThemedText
          type="smallBold"
          themeColor={objection.status === 'undone' ? 'accent' : 'textSecondary'}>
          {result}
        </ThemedText>
      </View>
    );
  }
  if (!canObject(view, action, myGodId, hours, now)) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await objectToAction(worldId, action.seq, reason);
      setWriting(false);
      setReason('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const closes = describeDeadline(objectionDeadline(action, hours)?.toISOString() ?? null, now);
  return writing ? (
    <View style={styles.objection}>
      <TextField
        label="Why do you object?"
        value={reason}
        onChangeText={setReason}
        placeholder="That breaks what we agreed about the north…"
        maxLength={280}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Every god votes to keep it, undo it, or flip a coin. Undoing it refunds it, along with
        anything built on it.
      </ThemedText>
      <View style={styles.row}>
        <Button title="Object" onPress={submit} busy={busy} disabled={!reason.trim()} />
        <Button title="Cancel" variant="secondary" onPress={() => setWriting(false)} />
      </View>
      <ErrorMessage message={error} />
    </View>
  ) : (
    <TextLink
      label={`Object${closes ? ` (${closes.replace('Ends in', 'closes in')})` : ''}`}
      onPress={() => setWriting(true)}
    />
  );
}

const styles = StyleSheet.create({
  objection: { gap: Spacing.one },
  fill: { flex: 1 },
  gap: { gap: Spacing.two },
  card: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  body: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  thumbnail: { borderRadius: Spacing.two, overflow: 'hidden' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  reaction: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  comment: { gap: Spacing.half },
  reply: { marginLeft: Spacing.four },
});
