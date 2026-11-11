import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import * as api from '../api';
import { registerForPush, unregisterForPush, urlFromResponse } from '../push';

let mockProjectId: string | undefined = 'proj-123';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { eas: { projectId: mockProjectId } } };
    },
    easConfig: null,
  },
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 6 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
}));
jest.mock('../api');

const notifications = jest.mocked(Notifications);
const mockedApi = jest.mocked(api);
const TOKEN = 'ExponentPushToken[abc]';

beforeEach(() => {
  jest.clearAllMocks();
  mockProjectId = 'proj-123';
  Platform.OS = 'android';
  notifications.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
  notifications.requestPermissionsAsync.mockResolvedValue({ granted: true } as never);
  notifications.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: TOKEN });
  mockedApi.registerPushToken.mockResolvedValue();
  mockedApi.unregisterPushToken.mockResolvedValue();
});

describe('registerForPush (DOW-16)', () => {
  it('sets up the Android channel, gets the token and registers it', async () => {
    await expect(registerForPush()).resolves.toBe('on');
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'turns',
      expect.objectContaining({ importance: 6 }),
    );
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(mockedApi.registerPushToken).toHaveBeenCalledWith(TOKEN, 'android');
  });

  it('asks for permission when it hasn’t been given, and respects a no', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false } as never);
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: false } as never);
    await expect(registerForPush()).resolves.toBe('denied');
    expect(notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(mockedApi.registerPushToken).not.toHaveBeenCalled();
  });

  it('does nothing until the app has an Expo project', async () => {
    mockProjectId = undefined;
    await expect(registerForPush()).resolves.toBe('not-configured');
    expect(notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does nothing on the web', async () => {
    Platform.OS = 'web';
    await expect(registerForPush()).resolves.toBe('unsupported');
  });

  it('carries on if the device can’t get a token', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    notifications.getExpoPushTokenAsync.mockRejectedValue(new Error('FirebaseApp not initialized'));
    await expect(registerForPush()).resolves.toBe('error');
  });

  it('unregisters this device on sign-out, once', async () => {
    await registerForPush();
    await unregisterForPush();
    await unregisterForPush();
    expect(mockedApi.unregisterPushToken).toHaveBeenCalledTimes(1);
    expect(mockedApi.unregisterPushToken).toHaveBeenCalledWith(TOKEN);
  });
});

describe('urlFromResponse', () => {
  const response = (url: unknown, action = 'expo.modules.notifications.actions.DEFAULT') =>
    ({
      actionIdentifier: action,
      notification: { request: { identifier: 'n1', content: { data: { url } } } },
    }) as never;

  it('opens in-app paths from tapped notifications', () => {
    expect(urlFromResponse(response('/world/w1'))).toBe('/world/w1');
  });

  it('ignores anything else', () => {
    expect(urlFromResponse(null)).toBeNull();
    expect(urlFromResponse(response('https://evil.example'))).toBeNull();
    expect(urlFromResponse(response(42))).toBeNull();
    expect(urlFromResponse(response('/world/w1', 'reply'))).toBeNull();
  });
});

describe('waitText', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  it.each([
    ['2026-11-11T21:00:00Z', 'in 9h'],
    ['2026-11-11T12:25:00Z', 'in 25m'],
    ['2026-11-11T12:00:10Z', 'in 1m'],
  ])('%s → %s', (until, text) => {
    expect(jest.requireActual<typeof api>('../api').waitText(new Date(until), now)).toBe(text);
  });
});
