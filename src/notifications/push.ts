// DOW-16: this device's Expo push token. Native (Android/iOS) only; on the web, and until the
// app is set up with an Expo project ID, this quietly does nothing.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken, unregisterPushToken } from './api';

/** The Android channel notifications are posted to (the server sends channelId "turns"). */
export const CHANNEL_ID = 'turns';

let registered: string | null = null;

/** Expo project ID from app.config.js (extra.eas.projectId), if the app has one. */
export function expoProjectId(): string | null {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  return fromConfig ?? Constants.easConfig?.projectId ?? null;
}

export type PushStatus = 'unsupported' | 'not-configured' | 'denied' | 'on' | 'error';

/**
 * Asks for permission (once; Android 13+ shows a prompt), gets this device's push token and
 * registers it for the signed-in player. Safe to call on every launch.
 */
export async function registerForPush(): Promise<PushStatus> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'unsupported';
  const projectId = expoProjectId();
  if (!projectId) return 'not-configured';
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Turns and reminders',
        // eslint-disable-next-line import/namespace -- re-exported with `export *`, which this rule can't follow
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted) ({ granted } = await Notifications.requestPermissionsAsync());
    if (!granted) return 'denied';
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(token, Platform.OS);
    registered = token;
    return 'on';
  } catch (error) {
    // e.g. Firebase isn't set up in this build yet. Notifications are optional; carry on.
    console.warn('Push notifications unavailable:', error);
    return 'error';
  }
}

/** On sign-out: stop notifications to this device. */
export async function unregisterForPush(): Promise<void> {
  if (!registered) return;
  const token = registered;
  registered = null;
  try {
    await unregisterPushToken(token);
  } catch (error) {
    console.warn('Could not unregister this device:', error);
  }
}

/** Show notifications that arrive while the app is open, too. */
export function showNotificationsInForeground() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** The in-app path a notification should open, e.g. "/world/abc". */
export function urlFromResponse(response: Notifications.NotificationResponse | null | undefined) {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return null;
  }
  const url = response.notification.request.content.data?.url;
  return typeof url === 'string' && url.startsWith('/') ? url : null;
}
