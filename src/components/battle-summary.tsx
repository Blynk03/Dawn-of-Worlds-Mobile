// DOW-55: how an attack went, battle by battle, with the dice each side rolled.
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { BattleView } from '@/game/project';

const dice = (d: number[]) => d.join(' + ');
const bonus = (n: number) => (n > 0 ? ` + ${n}` : '');

export function BattleSummary({ battle, target }: { battle: BattleView; target: string }) {
  const mods = (list: string[]) => (list.length > 0 ? list.join(', ') : 'none');
  return (
    <View style={styles.box} accessibilityLabel={`Battle for ${target}`}>
      <ThemedText type="small" themeColor="textSecondary">
        {battle.armyName}’s bonuses: {mods(battle.attackerModifiers)} · defenders’:{' '}
        {mods(battle.defenderModifiers)}
      </ThemedText>
      {battle.battles.length === 0 ? (
        <ThemedText type="small">{target} had no army to defend it.</ThemedText>
      ) : (
        battle.battles.map((b, i) => (
          <ThemedText key={`${b.defenderId}-${i}`} type="small">
            {b.winner === 'attacker' ? '⚔︎ Won' : '✕ Lost'} against {b.defenderName}:{' '}
            {dice(b.attackerDice)}
            {bonus(b.attackerBonus)}
            {b.fatigue > 0 ? ` − ${b.fatigue}` : ''} = {b.attackerTotal} vs {dice(b.defenderDice)}
            {bonus(b.defenderBonus)} = {b.defenderTotal}
          </ThemedText>
        ))
      )}
      <ThemedText type="smallBold">
        {battle.outcome === 'lost'
          ? `${battle.armyName} was beaten and scattered.`
          : battle.cityOutcome === 'destroyed'
            ? `${target} was utterly destroyed.`
            : battle.cityOutcome === 'ruined'
              ? `${target} lies in ruins.`
              : `${battle.armyName} won.`}
        {battle.destructionCost > 0 ? ` (+${battle.destructionCost} power to destroy)` : ''}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: Spacing.half },
});
