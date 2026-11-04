import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

/** Everything a signed-in player sees: the tabs, plus world screens pushed on top of them. */
export default function AppLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="world/new" options={{ title: 'New world', presentation: 'modal' }} />
      <Stack.Screen name="world/[id]/index" options={{ title: 'World' }} />
      <Stack.Screen name="world/[id]/god" options={{ title: 'Your god', presentation: 'modal' }} />
    </Stack>
  );
}
