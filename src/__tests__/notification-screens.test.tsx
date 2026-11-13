import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import WorldSettingsScreen from '@/app/(app)/world/[id]/settings';
import type { World } from '@/lib/database.types';
import * as gameApi from '@/game/api';
import * as notificationsApi from '@/notifications/api';
import * as push from '@/notifications/push';
import { PushHandler } from '@/notifications/push-handler';
import * as worldsApi from '@/worlds/api';

const mockRouter = { push: jest.fn() };
let mockUser = 'u-host';
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: 'w1' }),
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
  };
});
jest.mock('@/auth/auth-provider', () => ({
  useAuth: () => ({ session: { user: { id: mockUser } } }),
}));
jest.mock('@/worlds/api');
jest.mock('@/game/api', () => ({
  OBJECTION_OPTIONS: [0, 1, 6, 12, 24, 48],
  REACTION_OPTIONS: [0, 1, 6, 12, 24, 48],
  setObjectionHours: jest.fn(),
  setReactionHours: jest.fn(),
}));
jest.mock('@/notifications/api', () => ({
  ...jest.requireActual('@/notifications/api'),
  loadWorldMuted: jest.fn(),
  setWorldMuted: jest.fn(),
  setReminderHours: jest.fn(),
}));
jest.mock('@/notifications/push', () => ({
  ...jest.requireActual('@/notifications/push'),
  registerForPush: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'default',
  setNotificationHandler: jest.fn(),
  useLastNotificationResponse: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(() => Promise.resolve()),
}));

const worlds = jest.mocked(worldsApi);
const api = jest.mocked(notificationsApi);
const pushApi = jest.mocked(push);
const notifications = jest.mocked(Notifications);

const world: World = {
  id: 'w1',
  name: 'Aerth',
  ruleset_id: 'classic',
  status: 'active',
  invite_code: 'ABC234',
  turn_time_limit_hours: null,
  reminder_hours: 24,
  objection_hours: 12,
  reaction_hours: 12,
  created_by: 'u-host',
  created_at: '',
  updated_at: '',
};
const member = (user_id: string, role: 'host' | 'player') => ({
  world_id: 'w1',
  user_id,
  role,
  is_gm: false,
  joined_at: '',
  profiles: { display_name: user_id },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = 'u-host';
  worlds.subscribeToWorld.mockReturnValue(() => {});
  worlds.getLobby.mockResolvedValue({
    world,
    members: [member('u-host', 'host'), member('u-bob', 'player')],
    gods: [],
    map: null,
  });
  api.loadWorldMuted.mockResolvedValue(false);
  api.setWorldMuted.mockResolvedValue();
  api.setReminderHours.mockResolvedValue();
  pushApi.registerForPush.mockResolvedValue('on');
});

describe('World settings (DOW-16/28)', () => {
  it('mutes and unmutes this world', async () => {
    await render(<WorldSettingsScreen />);
    const toggle = await screen.findByLabelText('Notifications from Aerth');
    expect(toggle.props.value).toBe(true);
    await fireEvent(toggle, 'valueChange', false);
    expect(api.setWorldMuted).toHaveBeenCalledWith('w1', true);
    expect(screen.getByLabelText('Notifications from Aerth').props.value).toBe(false);
  });

  it('puts the switch back if muting fails', async () => {
    api.setWorldMuted.mockRejectedValueOnce(new Error("You're not in this world"));
    await render(<WorldSettingsScreen />);
    await fireEvent(await screen.findByLabelText('Notifications from Aerth'), 'valueChange', false);
    expect(await screen.findByText("You're not in this world")).toBeTruthy();
    expect(screen.getByLabelText('Notifications from Aerth').props.value).toBe(true);
  });

  it('lets the host choose when slow turns get a reminder', async () => {
    await render(<WorldSettingsScreen />);
    // The first set of chips is reminders; the second, objections.
    expect((await screen.findAllByLabelText('24 hours'))[0].props.accessibilityState).toMatchObject(
      { checked: true },
    );
    await fireEvent.press(screen.getAllByLabelText('12 hours')[0]);
    expect(api.setReminderHours).toHaveBeenCalledWith('w1', 12);
    await fireEvent.press(screen.getAllByLabelText('Off')[0]);
    expect(api.setReminderHours).toHaveBeenCalledWith('w1', 0);
  });

  it('lets the host choose the battle reaction window (DOW-56)', async () => {
    await render(<WorldSettingsScreen />);
    expect(await screen.findByText('Before a battle')).toBeTruthy();
    expect(screen.getAllByLabelText('12 hours')[2].props.accessibilityState).toMatchObject({
      checked: true,
    });
    await fireEvent.press(screen.getByLabelText('At once'));
    expect(jest.mocked(gameApi).setReactionHours).toHaveBeenCalledWith('w1', 0);
    await fireEvent.press(screen.getAllByLabelText('1 hour')[1]);
    expect(jest.mocked(gameApi).setReactionHours).toHaveBeenCalledWith('w1', 1);
  });

  it('lets the host choose the objection window (DOW-53)', async () => {
    await render(<WorldSettingsScreen />);
    expect(await screen.findByText('Objections')).toBeTruthy();
    expect(screen.getAllByLabelText('12 hours')[1].props.accessibilityState).toMatchObject({
      checked: true,
    });
    await fireEvent.press(screen.getAllByLabelText('1 hour')[0]);
    expect(jest.mocked(gameApi).setObjectionHours).toHaveBeenCalledWith('w1', 1);
    await fireEvent.press(screen.getAllByLabelText('Off')[1]);
    expect(jest.mocked(gameApi).setObjectionHours).toHaveBeenCalledWith('w1', 0);
  });

  it('shows other players the reminder setting without changing it', async () => {
    mockUser = 'u-bob';
    await render(<WorldSettingsScreen />);
    expect(await screen.findAllByText(/The host chooses this\./)).toHaveLength(3);
    for (const chip of screen.getAllByLabelText('12 hours')) await fireEvent.press(chip);
    expect(api.setReminderHours).not.toHaveBeenCalled();
    expect(jest.mocked(gameApi).setObjectionHours).not.toHaveBeenCalled();
  });

  it.each([
    ['on', 'This device gets notifications.'],
    ['denied', /Turn them on in your device’s settings/],
    ['not-configured', 'Notifications aren’t set up in this version of the app yet.'],
    ['unsupported', /Notifications go to the Android app/],
  ] as const)('explains this device’s status: %s', async (status, text) => {
    pushApi.registerForPush.mockResolvedValue(status);
    await render(<WorldSettingsScreen />);
    expect(await screen.findByText(text)).toBeTruthy();
  });
});

describe('Tapping a notification', () => {
  const response = (id: string, url: string) =>
    ({
      actionIdentifier: 'default',
      notification: { request: { identifier: id, content: { data: { url } } } },
    }) as never;

  it('opens the world it is about, once', async () => {
    pushApi.registerForPush.mockResolvedValue('on');
    notifications.useLastNotificationResponse.mockReturnValue(response('n1', '/world/w1'));
    const view = await render(<PushHandler userId="u-host" />);
    expect(pushApi.registerForPush).toHaveBeenCalled();
    expect(mockRouter.push).toHaveBeenCalledWith('/world/w1');
    await view.rerender(<PushHandler userId="u-host" />);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a notification', async () => {
    notifications.useLastNotificationResponse.mockReturnValue(null);
    await render(<PushHandler userId="u-host" />);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
