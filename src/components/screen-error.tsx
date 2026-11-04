import type { ErrorBoundaryProps } from 'expo-router';
import { useRouter } from 'expo-router';

import { Button } from '@/components/form';
import { ErrorMessage } from '@/components/game-ui';
import { PlaceholderScreen } from '@/components/placeholder-screen';

/**
 * Shown instead of a screen that hit an unexpected error, so the app offers a way out
 * rather than closing.
 */
export function ScreenError({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();
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
