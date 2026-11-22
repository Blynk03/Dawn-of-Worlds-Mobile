// DOW-78: a summary of the rules, for this world: what to do on your turn, what each power costs
// in the current age, and how battles, ages, objections and the GM work here.
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { RulesSummary } from '@/components/rules-summary';
import { ThemedView } from '@/components/themed-view';
import { useGame } from '@/game/hooks';
import { useLobby } from '@/worlds/hooks';

export default function RulesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { view, loaded } = useGame(id, true);
  const { data: lobby } = useLobby(id);

  if (!loaded || !lobby) {
    return (
      <ThemedView style={[styles.fill, styles.center]}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return <RulesSummary world={lobby.world} members={lobby.members} gods={lobby.gods} view={view} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
