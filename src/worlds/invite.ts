/** Invite codes and links (DOW-22). */

/** Public web address of the app; links open there (or in the installed app via the code). */
export const WEB_APP_URL = 'https://blynk03.github.io/Dawn-of-Worlds-Mobile';

const CODE_ALPHABET = /^[A-HJKMNP-Z2-9]{6}$/;

/** Uppercases and strips spaces/dashes, so "abc-234" and "ABC 234" both work. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidInviteCode(input: string): boolean {
  return CODE_ALPHABET.test(normalizeInviteCode(input));
}

/** "ABC234" → "ABC-234", easier to read aloud at the table. */
export function formatInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code);
  return normalized.length === 6 ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : normalized;
}

export function inviteLink(code: string): string {
  return `${WEB_APP_URL}/join/${normalizeInviteCode(code)}`;
}

export function inviteMessage(worldName: string, code: string): string {
  return [
    `Join my Dawn of Worlds world "${worldName}"!`,
    `Invite code: ${formatInviteCode(code)}`,
    inviteLink(code),
  ].join('\n');
}

// Remembers an invite opened while signed out, so joining continues after sign-in.
// localStorage exists on web and, via expo-sqlite's polyfill (src/lib/supabase.ts), on iOS/Android.
const PENDING_KEY = 'dow.pendingInvite';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function savePendingInvite(code: string): void {
  try {
    storage()?.setItem(PENDING_KEY, normalizeInviteCode(code));
  } catch {
    // Not critical: the player can type the code instead.
  }
}

/** Returns the saved invite code (if any) and forgets it. */
export function takePendingInvite(): string | null {
  try {
    const store = storage();
    const code = store?.getItem(PENDING_KEY) ?? null;
    store?.removeItem(PENDING_KEY);
    return code && isValidInviteCode(code) ? code : null;
  } catch {
    return null;
  }
}
