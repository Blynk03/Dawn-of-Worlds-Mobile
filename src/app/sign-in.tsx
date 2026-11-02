import * as Linking from 'expo-linking';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { looksLikeEmail, looksLikeEmailCode } from '@/auth/email';
import { Button, TextField } from '@/components/form';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/lib/supabase';

type Step = { kind: 'email' } | { kind: 'sent'; email: string };

export default function SignInScreen() {
  const { linkError, clearLinkError } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async (address: string) => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    clearLinkError();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: Linking.createURL('/auth/callback') },
    });
    setBusy(false);
    if (sendError) {
      setError(sendError.message);
    } else {
      setStep({ kind: 'sent', email: address });
    }
  };

  const verifyCode = async (address: string) => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: address,
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    // On success the auth provider sees the new session and the app switches to the tabs.
    if (verifyError) setError(verifyError.message);
  };

  const shownError = error ?? linkError;

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {step.kind === 'email' ? (
        <PlaceholderScreen
          title="Dawn of Worlds"
          description="Sign in with your email. We'll send you a link, no password needed.">
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={() => looksLikeEmail(email) && sendLink(email.trim())}
          />
          <Button
            title="Send sign-in link"
            onPress={() => sendLink(email.trim())}
            disabled={!looksLikeEmail(email)}
            busy={busy}
          />
          {shownError ? <ErrorText message={shownError} /> : null}
        </PlaceholderScreen>
      ) : (
        <PlaceholderScreen
          title="Check your email"
          description={`We sent a sign-in link to ${step.email}. Open it on this device, or type the code from the email below.`}>
          <TextField
            label="Code from the email"
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={10}
          />
          <Button
            title="Sign in with code"
            onPress={() => verifyCode(step.email)}
            disabled={!looksLikeEmailCode(code)}
            busy={busy}
          />
          <Button
            title="Send a new link"
            variant="secondary"
            onPress={() => sendLink(step.email)}
            disabled={busy}
          />
          <Button
            title="Use a different email"
            variant="secondary"
            onPress={() => {
              setStep({ kind: 'email' });
              setCode('');
              setError(null);
            }}
            disabled={busy}
          />
          {shownError ? <ErrorText message={shownError} /> : null}
        </PlaceholderScreen>
      )}
    </KeyboardAvoidingView>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <ThemedText accessibilityRole="alert" type="small" style={styles.error}>
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  error: { color: '#C2410C' },
});
