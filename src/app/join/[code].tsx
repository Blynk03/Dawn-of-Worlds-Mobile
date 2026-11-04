import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { Button } from '@/components/form';
import { ErrorMessage } from '@/components/game-ui';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { joinWorld } from '@/worlds/api';
import { formatInviteCode, isValidInviteCode, savePendingInvite } from '@/worlds/invite';

/**
 * Invite links open here: …/join/ABC234. Signed in: join and go to the world. Signed out:
 * remember the code, sign in, and the Worlds screen picks it up again.
 */
export default function JoinScreen() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const { status } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const valid = isValidInviteCode(code);

  useEffect(() => {
    if (status !== 'signedIn' || !valid || started.current) return;
    started.current = true;
    joinWorld(code).then(
      (worldId) => router.replace(`/world/${worldId}`),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [status, valid, code, router]);

  if (status === 'signedOut' && valid) {
    savePendingInvite(code);
    return <Redirect href="/sign-in" />;
  }

  const problem = !valid ? `"${code}" isn't a valid invite code.` : error;
  return (
    <PlaceholderScreen
      title={problem ? "Couldn't join" : 'Joining world…'}
      description={`Invite code ${formatInviteCode(code)}`}>
      {problem ? (
        <>
          <ErrorMessage message={problem} />
          <Button title="Go to my worlds" onPress={() => router.replace('/')} />
        </>
      ) : (
        <ActivityIndicator />
      )}
    </PlaceholderScreen>
  );
}
