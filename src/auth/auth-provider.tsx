import type { Session } from '@supabase/supabase-js';
import { useLinkingURL } from 'expo-linking';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { unregisterForPush } from '@/notifications/push';
import { supabase, supabaseConfig } from '@/lib/supabase';

import { parseAuthCallback } from './parse-auth-callback';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unconfigured';

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  /** Problem completing a magic link (e.g. it expired), shown on the sign-in screen. */
  linkError: string | null;
  clearLinkError: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabase !== null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Keep the session in sync with Supabase (initial load, sign-in, refresh, sign-out).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  // Finish sign-in when the app is opened from a magic link.
  const url = useLinkingURL();
  const callback = useMemo(() => parseAuthCallback(url), [url]);
  const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
  const handledUrls = useRef(new Set<string>());
  useEffect(() => {
    if (!supabase || !url || handledUrls.current.has(url)) return;
    if (callback.kind !== 'tokens' && callback.kind !== 'code') return;
    handledUrls.current.add(url);
    const result =
      callback.kind === 'tokens'
        ? supabase.auth.setSession({
            access_token: callback.accessToken,
            refresh_token: callback.refreshToken,
          })
        : supabase.auth.exchangeCodeForSession(callback.code);
    result.then(({ error }) => {
      if (error) setSessionError(error.message);
    });
  }, [url, callback]);

  // An error in the link itself (e.g. expired) comes straight from the URL.
  const urlError = callback.kind === 'error' && url !== dismissedUrl ? callback.message : null;
  const linkError = sessionError ?? urlError;

  const signOut = useCallback(async () => {
    // Stop notifications to this device before the session (needed to unregister) goes away.
    await unregisterForPush();
    await supabase?.auth.signOut();
  }, []);
  const clearLinkError = useCallback(() => {
    setSessionError(null);
    setDismissedUrl(url);
  }, [url]);

  const value = useMemo<AuthContextValue>(() => {
    let status: AuthStatus;
    if (!supabaseConfig.ok) status = 'unconfigured';
    else if (loading) status = 'loading';
    else status = session ? 'signedIn' : 'signedOut';
    return { status, session, linkError, clearLinkError, signOut };
  }, [loading, session, linkError, clearLinkError, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
