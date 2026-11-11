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
import { Button, TextField } from '@/components/form';
import { Card, ErrorMessage, GodBadge } from '@/components/game-ui';
import { MapThumbnail } from '@/components/map-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { type ActionRecord, ageName, type GameView } from '@/game/project';
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
          <ThemedText>{action.description}</ThemedText>
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

const styles = StyleSheet.create({
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
