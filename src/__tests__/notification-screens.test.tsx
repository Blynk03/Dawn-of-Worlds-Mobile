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
  gmSetRules: jest.fn(),
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
  gm_final_say: false,
  alignment_cap: null,
  years_per_round: null,
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

describe('The GM’s rules (DOW-62)', () => {
  const gmLobby = (gmUser: string, extra: Partial<World> = {}) =>
    worlds.getLobby.mockResolvedValue({
      world: { ...world, ...extra },
      members: [
        { ...member('u-host', 'host'), is_gm: gmUser === 'u-host' },
        member('u-bob', 'player'),
      ],
      gods: [],
      map: null,
    });

  it('says when a world has no GM', async () => {
    await render(<WorldSettingsScreen />);
    expect(await screen.findByText(/This world has no GM/)).toBeTruthy();
  });

  it('lets the GM give themselves the final say and cap alignment', async () => {
    gmLobby('u-host');
    await render(<WorldSettingsScreen />);
    expect(await screen.findByText(/You are the GM/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('The GM rules'));
    expect(jest.mocked(gameApi).gmSetRules).toHaveBeenCalledWith('w1', {
      finalSay: true,
      alignmentCap: null,
      yearsPerRound: null,
    });
    await fireEvent.press(screen.getByLabelText('Capped at ±5'));
    expect(jest.mocked(gameApi).gmSetRules).toHaveBeenLastCalledWith('w1', {
      finalSay: false,
      alignmentCap: 5,
      yearsPerRound: null,
    });
  });

  it('lets the GM change the years per round', async () => {
    gmLobby('u-host');
    await render(<WorldSettingsScreen />);
    const saveYears = await screen.findByRole('button', { name: 'Save years' });
    expect(saveYears).toBeDisabled(); // nothing changed yet
    await fireEvent.changeText(screen.getByLabelText('Second Age'), '250');
    await fireEvent.press(saveYears);
    expect(jest.mocked(gameApi).gmSetRules).toHaveBeenCalledWith('w1', {
      finalSay: false,
      alignmentCap: null,
      yearsPerRound: [500, 250, 5],
    });
  });

  it('shows everyone else the GM’s rules, read-only', async () => {
    mockUser = 'u-bob';
    gmLobby('u-host', { gm_final_say: true, alignment_cap: 3, years_per_round: [300, 50, 2] });
    await render(<WorldSettingsScreen />);
    expect(await screen.findByText(/u-host is the GM/)).toBeTruthy();
    expect(screen.getByLabelText('The GM rules').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByText('300 / 50 / 2 years in the three ages (set by the GM).')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('No limit'));
    expect(jest.mocked(gameApi).gmSetRules).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Second Age')).toBeNull();
  });
});
