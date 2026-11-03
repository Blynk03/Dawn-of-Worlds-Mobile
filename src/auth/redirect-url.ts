import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export const AUTH_CALLBACK_PATH = '/auth/callback';

/**
 * Where magic links should send the user back to.
 *
 * Native: the app's deep link (dawnofworlds://auth/callback, or exp://… in Expo Go).
 * Web: the site's own /auth/callback page, including the base path when the site is hosted in a
 * sub-folder (GitHub Pages serves it from /Dawn-of-Worlds-Mobile). Linking.createURL ignores the
 * base path on web, so we build that URL ourselves.
 */
export function authRedirectUrl(): string {
  if (Platform.OS !== 'web') {
    return Linking.createURL(AUTH_CALLBACK_PATH);
  }
  return webAuthRedirectUrl(
    typeof window === 'undefined' ? '' : window.location.origin,
    process.env.EXPO_PUBLIC_BASE_URL,
  );
}

export function webAuthRedirectUrl(origin: string, baseUrl: string | undefined): string {
  const base = (baseUrl ?? '').trim().replace(/\/+$/, '');
  const prefix = base && !base.startsWith('/') ? `/${base}` : base;
  return `${origin}${prefix}${AUTH_CALLBACK_PATH}`;
}
