import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerForPush, showNotificationsInForeground, urlFromResponse } from './push';

showNotificationsInForeground();

/** Notifications already opened, so each tap navigates once. */
const opened = new Set<string>();

/**
 * Mounted inside the signed-in part of the app: registers this device for notifications and
 * opens the right world when a notification is tapped. Renders nothing.
 */
export function PushHandler({ userId }: { userId: string }) {
  if (Platform.OS === 'web') return null;
  return <NativePushHandler userId={userId} />;
}

function NativePushHandler({ userId }: { userId: string }) {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    registerForPush();
  }, [userId]);

  const id = response?.notification.request.identifier ?? null;
  const url = urlFromResponse(response);
  useEffect(() => {
    if (url && id && !opened.has(id)) {
      opened.add(id);
      router.push(url as never);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }
  }, [url, id, router]);

  return null;
}
