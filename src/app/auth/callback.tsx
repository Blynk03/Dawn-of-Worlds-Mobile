import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { PlaceholderScreen } from '@/components/placeholder-screen';

/**
 * Magic links open the app here. The AuthProvider reads the link and creates the session;
 * this screen waits, then sends the user on.
 */
export default function AuthCallbackScreen() {
  const { status, linkError } = useAuth();

  if (status === 'signedIn') return <Redirect href="/" />;
  if (linkError) return <Redirect href="/sign-in" />;

  return (
    <PlaceholderScreen title="Signing you in…" description="One moment.">
      <ActivityIndicator />
    </PlaceholderScreen>
  );
}
