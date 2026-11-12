import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { deleteMyAccount, PRIVACY_POLICY_URL } from '@/auth/account';
import { useAuth } from '@/auth/auth-provider';
import { Button } from '@/components/form';
import { Card, ErrorMessage, SectionLabel } from '@/components/game-ui';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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
      <Button
        title="Privacy policy"
        variant="secondary"
        onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
      />
      <DeleteAccount onDeleted={signOut} />
    </PlaceholderScreen>
  );
}

/** DOW-17: Google Play requires a way to delete your account from inside the app. */
function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button title="Delete my account…" variant="secondary" onPress={() => setConfirming(true)} />
    );
  }
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Card>
      <SectionLabel>Delete your account?</SectionLabel>
      <ThemedText type="small">
        This deletes your sign-in and email address, your comments and reactions, and your devices
        for notifications. It can’t be undone.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Worlds that haven’t started: you leave them (one only you are in is deleted). Worlds being
        played: your god’s past deeds stay in that world’s history so your friends’ game still makes
        sense, but your god departs and takes no more turns. If you host a world, the next player
        becomes host.
      </ThemedText>
      <View style={styles.row}>
        <Button title="Delete my account" onPress={remove} busy={busy} />
        <Button
          title="Keep it"
          variant="secondary"
          onPress={() => setConfirming(false)}
          disabled={busy}
        />
      </View>
      <ErrorMessage message={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
