import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import {
  actionEntities,
  describeAction,
  filterableEntities,
  type HistoryFilter,
  historyRows,
} from '@/chronicle/history';
import { useSocial } from '@/chronicle/hooks';
import { markWorldRead } from '@/chronicle/social';
import { FeedCard } from '@/components/feed-card';
import { Card, Chip, ErrorMessage, GodBadge, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useGame, useNow } from '@/game/hooks';
import { type ActionRecord, ageName, type GameView } from '@/game/project';
import { useLayoutMode } from '@/hooks/use-layout-mode';
import type { God } from '@/lib/database.types';
import { useLobby } from '@/worlds/hooks';

type Tab = 'feed' | 'history';

/**
 * The world's chronicle. Feed (DOW-37): what the gods did, newest first, with reactions and
 * comments. History (DOW-36): the History Chart, every action in order, filterable.
 */
export default function ChronicleScreen() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id;
  const { view, loaded, error } = useGame(id, true);
  const { data: lobby } = useLobby(id);
  const social = useSocial(id);
  const now = useNow();
  const [tab, setTab] = useState<Tab>(initialTab === 'history' ? 'history' : 'feed');

  // Opening the chronicle (and anything that arrives while it's open) counts as read.
  const seen = view.actions.length + social.comments.length;
  useEffect(() => {
    if (loaded) markWorldRead(id).catch(() => {});
  }, [id, loaded, seen]);

  if (!loaded || !lobby) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const openEntity = (entityId: string) =>
    router.push({ pathname: '/world/[id]/atlas', params: { id, entity: entityId } });
  const openHex = (hex: { x: number; y: number }) =>
    router.dismissTo({ pathname: '/world/[id]', params: { id, hex: `${hex.x},${hex.y}` } });

  const tabs = (
    <View style={styles.tabs}>
      <Chip label="Feed" selected={tab === 'feed'} onPress={() => setTab('feed')} />
      <Chip label="History" selected={tab === 'history'} onPress={() => setTab('history')} />
    </View>
  );

  return (
    <ThemedView style={styles.fill}>
      {tab === 'feed' ? (
        <FlatList
          data={[...view.actions].reverse()}
          keyExtractor={(a) => String(a.seq)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.gap}>
              {tabs}
              <ErrorMessage message={error ?? social.error} />
            </View>
          }
          ListEmptyComponent={<Empty />}
          renderItem={({ item }) => (
            <FeedCard
              worldId={id}
              action={item}
              view={view}
              gods={lobby.gods}
              members={lobby.members}
              myId={myId}
              comments={social.comments}
              reactions={social.reactions}
              now={now}
              onChanged={social.refresh}
              onOpenEntity={openEntity}
              onOpenHex={openHex}
            />
          )}
        />
      ) : (
        <History
          view={view}
          gods={lobby.gods}
          header={tabs}
          onOpenEntity={openEntity}
          onOpenHex={openHex}
        />
      )}
    </ThemedView>
  );
}

function Empty() {
  return (
    <Card>
      <ThemedText type="smallBold">Nothing has happened yet</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Every time a god uses a power, it&apos;s recorded here for everyone.
      </ThemedText>
    </Card>
  );
}

/** DOW-36: the History Chart. */
function History({
  view,
  gods,
  header,
  onOpenEntity,
  onOpenHex,
}: {
  view: GameView;
  gods: God[];
  header: ReactNode;
  onOpenEntity: (id: string) => void;
  onOpenHex: (hex: { x: number; y: number }) => void;
}) {
  const mode = useLayoutMode();
  const [filter, setFilter] = useState<HistoryFilter>({});
  const rows = historyRows(view, filter);
  const entities = filterableEntities(view);
  const ages = [1, 2, 3].filter((age) => age <= view.age);
  const godsInPlay = gods.filter((g) => view.actions.some((a) => a.godId === g.id));
  const set = (patch: HistoryFilter) => setFilter((f) => ({ ...f, ...patch }));

  const filters = (
    <View style={styles.gap}>
      {header}
      <SectionLabel>Age</SectionLabel>
      <View style={styles.wrap}>
        <Chip label="All ages" selected={filter.age == null} onPress={() => set({ age: null })} />
        {ages.map((age) => (
          <Chip
            key={age}
            label={ageName(age)}
            selected={filter.age === age}
            onPress={() => set({ age })}
          />
        ))}
      </View>
      {godsInPlay.length > 0 ? (
        <>
          <SectionLabel>God</SectionLabel>
          <View style={styles.wrap}>
            <Chip
              label="All gods"
              selected={filter.godId == null}
              onPress={() => set({ godId: null })}
            />
            {godsInPlay.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                selected={filter.godId === g.id}
                onPress={() => set({ godId: g.id })}
              />
            ))}
          </View>
        </>
      ) : null}
      {entities.length > 0 ? (
        <>
          <SectionLabel>Race or city</SectionLabel>
          <View style={styles.wrap}>
            <Chip
              label="Everything"
              selected={filter.entityId == null}
              onPress={() => set({ entityId: null })}
            />
            {entities.map((e) => (
              <Chip
                key={e.id}
                label={e.kind === 'city' ? `${e.name} (city)` : e.name}
                selected={filter.entityId === e.id}
                onPress={() => set({ entityId: e.id })}
              />
            ))}
          </View>
        </>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
      </ThemedText>
      {mode === 'tablet' && rows.length > 0 ? <TableHeader /> : null}
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(a) => String(a.seq)}
      contentContainerStyle={styles.list}
      ListHeaderComponent={filters}
      ListEmptyComponent={view.actions.length === 0 ? <Empty /> : undefined}
      renderItem={({ item }) => (
        <HistoryRow
          action={item}
          view={view}
          god={gods.find((g) => g.id === item.godId)}
          wide={mode === 'tablet'}
          onOpenEntity={onOpenEntity}
          onOpenHex={onOpenHex}
        />
      )}
    />
  );
}

const COLUMNS = { age: 110, round: 60, year: 70, god: 140, action: 190 };

function TableHeader() {
  return (
    <View style={[styles.tableRow, styles.tableHeader]}>
      {(['Age', 'Round', 'Year', 'God', 'Action'] as const).map((label) => (
        <ThemedText
          key={label}
          type="smallBold"
          style={{ width: COLUMNS[label.toLowerCase() as keyof typeof COLUMNS] }}>
          {label}
        </ThemedText>
      ))}
      <ThemedText type="smallBold" style={styles.fill}>
        Description
      </ThemedText>
    </View>
  );
}

function HistoryRow({
  action,
  view,
  god,
  wide,
  onOpenEntity,
  onOpenHex,
}: {
  action: ActionRecord;
  view: GameView;
  god: God | undefined;
  wide: boolean;
  onOpenEntity: (id: string) => void;
  onOpenHex: (hex: { x: number; y: number }) => void;
}) {
  const { power, what } = describeAction(action);
  const first = action.hexes[0];
  const links = (
    <View style={styles.wrap}>
      {actionEntities(view, action).map((e) => (
        <Link
          key={e.id}
          label={e.name}
          a11y={`Open ${e.name} in the Atlas`}
          onPress={() => onOpenEntity(e.id)}
        />
      ))}
      {first ? (
        <Link
          label={
            action.hexes.length === 1
              ? `Hex ${first[0]}, ${first[1]}`
              : `${action.hexes.length} hexes from ${first[0]}, ${first[1]}`
          }
          a11y={`Show hex ${first[0]}, ${first[1]} on the map`}
          onPress={() => onOpenHex({ x: first[0], y: first[1] })}
        />
      ) : null}
    </View>
  );
  const godCell = (
    <View style={styles.godCell}>
      <GodBadge color={god?.color ?? null} sigil={god?.sigil ?? null} size={20} />
      <ThemedText type="small">{god?.name ?? 'A god'}</ThemedText>
    </View>
  );

  if (wide) {
    return (
      <View style={styles.tableRow} accessibilityLabel={`History entry ${action.seq}`}>
        <ThemedText type="small" style={{ width: COLUMNS.age }}>
          {ageName(action.age)}
        </ThemedText>
        <ThemedText type="small" style={{ width: COLUMNS.round }}>
          {action.round}
        </ThemedText>
        <ThemedText type="small" style={{ width: COLUMNS.year }}>
          {action.year}
        </ThemedText>
        <View style={{ width: COLUMNS.god }}>{godCell}</View>
        <ThemedText type="small" style={{ width: COLUMNS.action }}>
          {power}: {what}
        </ThemedText>
        <View style={[styles.fill, styles.gapSmall]}>
          <ThemedText type="small">{action.description}</ThemedText>
          {links}
        </View>
      </View>
    );
  }
  return (
    <Card style={styles.gapSmall}>
      <ThemedText type="small" themeColor="textSecondary">
        {ageName(action.age)} · Round {action.round} · Year {action.year}
      </ThemedText>
      <View style={styles.godCell}>
        {godCell}
        <ThemedText type="smallBold">
          · {power}: {what}
        </ThemedText>
      </View>
      <ThemedText type="small">{action.description}</ThemedText>
      {links}
    </Card>
  );
}

function Link({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y} onPress={onPress} hitSlop={6}>
      <ThemedText type="smallBold" themeColor="accent">
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  list: { gap: Spacing.three, padding: Spacing.three, paddingBottom: Spacing.six },
  gap: { gap: Spacing.two },
  gapSmall: { gap: Spacing.one },
  tabs: { flexDirection: 'row', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  godCell: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  tableRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  tableHeader: { paddingTop: Spacing.three },
});
