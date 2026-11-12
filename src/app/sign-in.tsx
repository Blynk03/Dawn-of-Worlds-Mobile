import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { looksLikeEmail, looksLikeEmailCode } from '@/auth/email';
import { authRedirectUrl } from '@/auth/redirect-url';
import { Button, TextField } from '@/components/form';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/lib/supabase';

// 'password': for accounts made in Supabase with a password, such as the one Google Play's
// reviewers use (they can't receive our emails). Nobody can sign up with a password.
type Step = { kind: 'email' } | { kind: 'sent'; email: string } | { kind: 'password' };

export default function SignInScreen() {
  const { linkError, clearLinkError } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async (address: string) => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    clearLinkError();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: authRedirectUrl() },
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

  const signInWithPassword = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    clearLinkError();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) setError(signInError.message);
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
          <Button
            title="Sign in with a password"
            variant="secondary"
            onPress={() => {
              setStep({ kind: 'password' });
              setError(null);
            }}
          />
          {shownError ? <ErrorText message={shownError} /> : null}
        </PlaceholderScreen>
      ) : step.kind === 'password' ? (
        <PlaceholderScreen
          title="Sign in with a password"
          description="For accounts that were given a password. Everyone else signs in with an emailed link.">
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={() => looksLikeEmail(email) && password && signInWithPassword()}
          />
          <Button
            title="Sign in"
            onPress={signInWithPassword}
            disabled={!looksLikeEmail(email) || !password}
            busy={busy}
          />
          <Button
            title="Use an emailed link instead"
            variant="secondary"
            onPress={() => {
              setStep({ kind: 'email' });
              setPassword('');
              setError(null);
            }}
            disabled={busy}
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
            placeholder="12345678"
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
