// Persists the auth session on iOS/Android via expo-sqlite's localStorage polyfill (no-op on web).
import 'expo-sqlite/localStorage/install';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from './database.types';
import { readSupabaseConfig } from './supabase-config';

// Expo inlines EXPO_PUBLIC_* only when referenced directly as process.env.NAME.
export const supabaseConfig = readSupabaseConfig({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

/** False during web static rendering, where there is no browser storage. */
const hasStorage = typeof localStorage !== 'undefined' && typeof window !== 'undefined';

/** The shared Supabase client, or null when the app isn't configured (see docs/supabase-setup.md). */
export const supabase: SupabaseClient<Database> | null = supabaseConfig.ok
  ? createClient<Database>(supabaseConfig.config.url, supabaseConfig.config.publishableKey, {
      auth: {
        storage: hasStorage ? localStorage : undefined,
        autoRefreshToken: hasStorage,
        persistSession: hasStorage,
        // We handle magic-link redirects ourselves (src/app/auth/callback.tsx).
        detectSessionInUrl: false,
      },
    })
  : null;

// Only refresh tokens while the app is in the foreground (Supabase's React Native guidance).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
