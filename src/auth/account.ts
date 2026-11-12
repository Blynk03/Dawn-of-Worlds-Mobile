// DOW-17 (Google Play): deleting your account, in the app (the web page explains the same).
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/worlds/errors';

/** The public page about deleting your account (also listed in Google Play's Data safety form). */
export const DELETE_ACCOUNT_URL =
  'https://blynk03.github.io/Dawn-of-Worlds-Mobile/delete-account.html';
export const PRIVACY_POLICY_URL = 'https://blynk03.github.io/Dawn-of-Worlds-Mobile/privacy.html';

/**
 * Deletes the signed-in player's account: their sign-in and email, devices, comments and
 * reactions. Unstarted worlds are left (or deleted if nobody else is in them); in worlds being
 * played their god stays in the history, departed. Sign out afterwards.
 */
export async function deleteMyAccount(): Promise<void> {
  if (!supabase) throw new Error('The app isn’t connected to the server.');
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw new Error(friendlyError(error));
}
