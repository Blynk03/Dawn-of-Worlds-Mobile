import type { ErrorBoundaryProps } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { Button } from '@/components/form';
import { ErrorMessage } from '@/components/game-ui';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { isStaleBundleError, reloadForUpdate } from '@/lib/stale-bundle';

function webReload(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return reloadForUpdate({ reload: () => window.location.reload(), storage, now: Date.now() });
}

/**
 * Shown instead of a screen that hit an unexpected error, so the app offers a way out
 * rather than closing. On the web, a tab left open across an update reloads itself to get the
 * new version.
 */
export function ScreenError({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();
  const stale = isStaleBundleError(error);
  // Reload straight away (once) to pick up the new version.
  useEffect(() => {
    if (stale) webReload();
  }, [stale]);

  if (stale) {
    return (
      <PlaceholderScreen
        title="The app has been updated"
        description="A new version of Dawn of Worlds was published while this page was open. Reload to get it.">
        <Button
          title="Reload"
          onPress={() => (Platform.OS === 'web' ? window.location.reload() : retry())}
        />
        <Button title="Back to my worlds" variant="secondary" onPress={() => router.replace('/')} />
      </PlaceholderScreen>
    );
  }
  return (
    <PlaceholderScreen
      title="Something went wrong"
      description="This screen hit an unexpected problem. Try again, or head back to your worlds.">
      <ErrorMessage message={error.message} />
      <Button title="Try again" onPress={retry} />
      <Button title="Back to my worlds" variant="secondary" onPress={() => router.replace('/')} />
    </PlaceholderScreen>
  );
}
