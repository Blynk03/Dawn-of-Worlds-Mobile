import { Stack } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { ScreenError } from '@/components/screen-error';
import { useTheme } from '@/hooks/use-theme';
import { PushHandler } from '@/notifications/push-handler';

// Any error in a signed-in screen shows a recovery screen instead of crashing the app.
export const ErrorBoundary = ScreenError;

/** Everything a signed-in player sees: the tabs, plus world screens pushed on top of them. */
export default function AppLayout() {
  const theme = useTheme();
  const { session } = useAuth();
  return (
    <>
      {session ? <PushHandler userId={session.user.id} /> : null}
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
        <Stack.Screen
          name="world/[id]/god"
          options={{ title: 'Your god', presentation: 'modal' }}
        />
        <Stack.Screen name="world/[id]/act" options={{ title: 'Shape the world' }} />
        <Stack.Screen name="world/[id]/landmass" options={{ title: 'Starting landmass' }} />
        <Stack.Screen name="world/[id]/atlas" options={{ title: 'Atlas' }} />
        <Stack.Screen name="world/[id]/chronicle" options={{ title: 'Chronicle' }} />
        <Stack.Screen name="world/[id]/settings" options={{ title: 'World settings' }} />
      </Stack>
    </>
  );
}
