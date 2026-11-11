/** Supabase calls for notifications (DOW-16) and nudges (DOW-28). */
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/worlds/errors';

function client() {
  if (!supabase) throw new Error('The app is not connected to Supabase.');
  return supabase;
}

/** Tells the server this device can receive notifications for the signed-in player. */
export async function registerPushToken(token: string, platform: 'android' | 'ios') {
  const { error } = await client().rpc('register_push_token', { token, platform });
  if (error) throw new Error(friendlyError(error));
}

/** Stops notifications to this device (on sign-out). */
export async function unregisterPushToken(token: string) {
  const { error } = await client().rpc('unregister_push_token', { token });
  if (error) throw new Error(friendlyError(error));
}

/** Whether you've muted this world's notifications. */
export async function loadWorldMuted(worldId: string): Promise<boolean> {
  const { data, error } = await client()
    .from('world_notification_settings')
    .select('muted')
    .eq('world_id', worldId)
    .maybeSingle();
  if (error) throw new Error(friendlyError(error));
  return data?.muted ?? false;
}

export async function setWorldMuted(worldId: string, muted: boolean) {
  const { error } = await client().rpc('set_world_muted', { target_world: worldId, muted });
  if (error) throw new Error(friendlyError(error));
}

/** The host's setting: hours a turn can wait before a reminder (0 = never). */
export const REMINDER_OPTIONS = [0, 6, 12, 24, 48] as const;

export async function setReminderHours(worldId: string, hours: number) {
  const { error } = await client()
    .from('worlds')
    .update({ reminder_hours: hours })
    .eq('id', worldId);
  if (error) throw new Error(friendlyError(error));
}

/** Nudges whoever is taking their turn. Returns when you can nudge again. */
export async function nudge(worldId: string): Promise<Date> {
  const { data, error } = await client().rpc('nudge', { target_world: worldId });
  if (error) throw new Error(friendlyError(error));
  return new Date(data);
}

const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/** When you can next nudge in this world (null = now). */
export async function loadNextNudge(worldId: string, myId: string): Promise<Date | null> {
  const { data, error } = await client()
    .from('world_nudges')
    .select('created_at')
    .eq('world_id', worldId)
    .eq('from_user', myId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(friendlyError(error));
  const last = data?.[0]?.created_at;
  return last ? new Date(new Date(last).getTime() + NUDGE_COOLDOWN_MS) : null;
}

/** e.g. "in 9h", "in 25m". */
export function waitText(until: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return minutes >= 60 ? `in ${Math.ceil(minutes / 60)}h` : `in ${minutes}m`;
}
