import { Platform, Share } from 'react-native';

import { inviteMessage } from './invite';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'unavailable';

/**
 * Opens the system share sheet with the invite (Messages, WhatsApp, Discord…). On desktop
 * browsers without a share sheet, copies the invite to the clipboard instead.
 */
export async function shareInvite(worldName: string, code: string): Promise<ShareResult> {
  const message = inviteMessage(worldName, code);

  if (Platform.OS === 'web') {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    if (nav?.share) {
      try {
        await nav.share({ title: 'Dawn of Worlds invite', text: message });
        return 'shared';
      } catch {
        return 'cancelled';
      }
    }
    if (nav?.clipboard) {
      await nav.clipboard.writeText(message);
      return 'copied';
    }
    return 'unavailable';
  }

  // The message already contains the link; passing `url` too would show it twice on iOS.
  const result = await Share.share({ message });
  return result.action === Share.dismissedAction ? 'cancelled' : 'shared';
}
