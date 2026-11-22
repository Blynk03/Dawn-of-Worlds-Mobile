// DOW-78: the rules summary for one world (see the How to play screen).
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card, SectionLabel } from '@/components/game-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ageName, type GameView } from '@/game/project';
import type { God, World } from '@/lib/database.types';
import { type Age, CLASSIC_RULESET, incomeSummary, majorityOf, powerTable } from '@/rules';
import type { LobbyMember } from '@/worlds/api';

const hoursLabel = (hours: number) => (hours === 1 ? '1 hour' : `${hours} hours`);

export function RulesSummary({
  world,
  members,
  gods,
  view,
}: {
  world: World;
  members: LobbyMember[];
  gods: God[];
  view: GameView;
}) {
  const age = (view.started ? view.age : 1) as Age;
  const rules = CLASSIC_RULESET;
  const { minRounds, anyPlayerAfterRounds } = rules.ageTransition;
  const years = world.years_per_round ?? rules.ages.map((a) => a.yearsPerRound);
  const gm = members.find((m) => m.is_gm);
  const gmName = gm?.profiles?.display_name ?? 'The GM';
  const playing = gods.filter((g) => !g.departed_at).length;
  const roundsInAge = view.round - view.ageStartedRound + 1;

  return (
    <ThemedView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.page}>
        <ThemedText type="small" themeColor="textSecondary">
          The rules of Dawn of Worlds (N. Bob Pesall, 2005), as this app plays them, with this
          world’s settings.
          {view.started
            ? ` It’s the ${ageName(age)}, round ${roundsInAge} of it.`
            : ' The game hasn’t started yet.'}
        </ThemedText>

        <Card>
          <SectionLabel>On your turn</SectionLabel>
          <Step n={1}>
            <B>Power arrives each round.</B> {incomeSummary(rules)} Turn order is rolled each round
            {gm ? `; ${gmName}’s god, as GM, goes first` : ''}.
          </Step>
          <Step n={2}>
            <B>Tap Act and choose a power.</B> The list shows what each costs now and greys out what
            you can’t afford or can’t use yet.
          </Step>
          <Step n={3}>
            <B>Choose where or what</B> on the map or from the list, and <B>describe it</B> for the
            chronicle: what happens, in a line or two. Then confirm.
          </Step>
          <Step n={4}>
            <B>Repeat</B> while you have power, then <B>End turn</B> (keeping what’s left) or{' '}
            <B>Pass</B>. Saving power for a big act later is fine.
          </Step>
          {world.turn_time_limit_hours ? (
            <ThemedText type="small" themeColor="textSecondary">
              In this world a turn lasts up to {hoursLabel(world.turn_time_limit_hours)}; after that
              anyone can skip it.
            </ThemedText>
          ) : null}
        </Card>

        <Card>
          <SectionLabel>Powers in the {ageName(age)}</SectionLabel>
          <ThemedText type="small" themeColor="textSecondary">
            The cost now, then (in brackets) in the First, Second and Third Ages.
          </ThemedText>
          {powerTable(rules, age).map((group) => (
            <View key={group.category} style={styles.group}>
              <ThemedText type="smallBold">{group.title}</ThemedText>
              {group.powers.map((p) => (
                <View key={p.id} style={styles.powerRow} accessibilityLabel={`${p.name}: ${p.now}`}>
                  <ThemedText type="small" style={styles.powerName}>
                    {p.name}
                    {p.notes.length > 0 || p.comingSoon ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {' '}
                        ·{' '}
                        {[...p.notes, ...(p.comingSoon ? ['coming to the app soon'] : [])].join(
                          ' · ',
                        )}
                      </ThemedText>
                    ) : null}
                  </ThemedText>
                  <ThemedText type="smallBold">{p.now}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.costs}>
                    ({p.costs.join(' / ')})
                  </ThemedText>
                </View>
              ))}
            </View>
          ))}
        </Card>

        <Card>
          <SectionLabel>Good to know</SectionLabel>
          <Bullet>
            <B>Commanding needs presence.</B> To command a race or city (found a city, march,
            attack, build, raise an army) you need one of your orders or avatars among that race.
          </Bullet>
          <Bullet>
            <B>Creating a race</B> gives you a sect among them. A subrace starts next to its parent
            race.
          </Bullet>
          <Bullet>
            <B>Orders:</B> commanding another god’s order costs +10 if it’s a religious sect, +5
            otherwise.
          </Bullet>
          <Bullet>
            <B>Avatars</B> act once each time you command them (once per turn), can create one race,
            and cost 5 to bring back if slain.
          </Bullet>
          <Bullet>
            <B>A city raises one army a turn</B> (a second if your avatar commands it).
          </Bullet>
          <Bullet>
            <B>Purify and Corrupt</B> move alignment ±1, once per target each turn.
            {world.alignment_cap
              ? ` The GM has capped alignment at ±${world.alignment_cap}.`
              : ' There’s no limit.'}
          </Bullet>
          <Bullet>
            <B>Wiping something out entirely</B> costs what it cost to create; otherwise survivors
            remain.
          </Bullet>
        </Card>

        <Card>
          <SectionLabel>Battles</SectionLabel>
          <Bullet>
            Each side rolls <B>2d6, +1 for each advantage</B> the table agrees on: an advancement
            used in war, walls, higher ground, terrain, weather, an avatar leading them. Ties are
            rolled again.
          </Bullet>
          <Bullet>
            Against a city, each defending army is a battle, and the attacker tires:{' '}
            <B>−1 for each battle after the first</B>.
          </Bullet>
          <Bullet>
            Losers are scattered; a city whose defenders fall is left in ruins. You can choose to{' '}
            <B>destroy them utterly</B> for more power, paid only for what is destroyed.
          </Bullet>
          <Bullet>
            {world.reaction_hours > 0 ? (
              <>
                Declaring an attack gives the other gods{' '}
                <B>{hoursLabel(world.reaction_hours)} to respond</B> on their turns before the dice
                are rolled (or to waive). Anyone can propose a bonus for either side or dispute one;
                disputed bonuses are voted on.
              </>
            ) : (
              <>In this world battles are rolled as soon as they’re declared.</>
            )}
          </Bullet>
        </Card>

        <Card>
          <SectionLabel>Ages</SectionLabel>
          <Bullet>
            The First Age is for shaping the land, the Second for races, the Third for their
            relations. A round lasts{' '}
            <B>
              {years[0]} / {years[1]} / {years[2]} years
            </B>{' '}
            in the three ages{world.years_per_round ? ' (set by the GM)' : ''}.
          </Bullet>
          <Bullet>
            An age lasts at least <B>{minRounds} rounds</B>. From then, any god can propose the next
            age: it passes with {majorityOf(Math.max(playing, 2))} yes votes of {playing}. From
            round <B>{anyPlayerAfterRounds}</B>, any one god can begin it. The new age starts with
            the next round, and prices change with it.
          </Bullet>
        </Card>

        <Card>
          <SectionLabel>Objections</SectionLabel>
          {world.objection_hours > 0 ? (
            <>
              <Bullet>
                For <B>{hoursLabel(world.objection_hours)}</B> after an action, any other god can{' '}
                <B>Object</B> from its card in the chronicle, saying why.
              </Bullet>
              <Bullet>
                Every god votes to keep it, undo it or flip a coin. More than half decides; a tie is
                settled by a coin flip.
                {world.gm_final_say ? ` ${gmName}, as GM, can settle it at any time.` : ''}
              </Bullet>
              <Bullet>
                Undoing an action refunds it, and also undoes (and refunds) anything later that was
                built on it.
              </Bullet>
            </>
          ) : (
            <Bullet>Objections are turned off in this world.</Bullet>
          )}
        </Card>

        {gm ? (
          <Card>
            <SectionLabel>The GM</SectionLabel>
            <Bullet>
              {gmName} is this world’s GM. Their god goes first each round, and they can rule a new
              race non-traditional, so it costs double.
            </Bullet>
            {world.gm_final_say ? (
              <Bullet>They have the final say on objections and disputed battle bonuses.</Bullet>
            ) : null}
            <Bullet>Their rulings are logged in the chronicle.</Bullet>
          </Card>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function B({ children }: { children: ReactNode }) {
  return <ThemedText type="smallBold">{children}</ThemedText>;
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <View style={styles.item}>
      <ThemedText type="smallBold" style={styles.marker}>
        {n}.
      </ThemedText>
      <ThemedText type="small" style={styles.text}>
        {children}
      </ThemedText>
    </View>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <View style={styles.item}>
      <ThemedText type="small" style={styles.marker}>
        •
      </ThemedText>
      <ThemedText type="small" style={styles.text}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: {
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  group: { gap: Spacing.one, paddingTop: Spacing.two },
  powerRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  powerName: { flex: 1 },
  costs: { minWidth: 64, textAlign: 'right' },
  item: { flexDirection: 'row', gap: Spacing.two },
  marker: { width: 16 },
  text: { flex: 1 },
});
