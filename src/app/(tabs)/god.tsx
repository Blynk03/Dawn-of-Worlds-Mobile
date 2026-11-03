import { useEffect, useState } from 'react';

import { useAuth } from '@/auth/auth-provider';
import { Button } from '@/components/form';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import type { Profile } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export default function MyGodScreen() {
  const { session, signOut } = useAuth();
  const userId = session?.user.id;
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile(data);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <PlaceholderScreen
      title="My God"
      description="Your god's name, spheres of influence, sigil and current power."
      stories={['DOW-23']}>
      <ThemedText type="smallBold">Signed in as {profile?.display_name ?? '…'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {session?.user.email}
      </ThemedText>
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </PlaceholderScreen>
  );
}
