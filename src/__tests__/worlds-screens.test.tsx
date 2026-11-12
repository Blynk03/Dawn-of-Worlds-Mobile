import { fireEvent, render, screen } from '@testing-library/react-native';

import GodScreen from '@/app/(app)/world/[id]/god';
import WorldScreen from '@/app/(app)/world/[id]/index';
import NewWorldScreen from '@/app/(app)/world/new';
import WorldsScreen from '@/app/(app)/(tabs)/index';
import JoinScreen from '@/app/join/[code]';
import type { God, World } from '@/lib/database.types';
import * as api from '@/worlds/api';
import { takePendingInvite } from '@/worlds/invite';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
let mockAuth = { status: 'signedIn', session: { user: { id: 'me' } } };

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
    Redirect: ({ href }: { href: string }) => {
      const { Text } = jest.requireActual('react-native');
      return <Text>{`redirect:${href}`}</Text>;
    },
    Stack: { Screen: () => null },
  };
});
jest.mock('@/auth/auth-provider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/worlds/api');
jest.mock('@/worlds/invite', () => ({
  ...jest.requireActual('@/worlds/invite'),
  takePendingInvite: jest.fn(() => null),
  savePendingInvite: jest.fn(),
}));
jest.mock('@/worlds/share', () => ({ shareInvite: jest.fn(() => Promise.resolve('shared')) }));
jest.mock('@/components/active-world', () => ({
  ActiveWorld: () => {
    const { View } = jest.requireActual('react-native');
    return <View testID="active-world" />;
  },
}));
jest.mock('@/components/hex-map', () => jest.requireActual('../../test/hex-map-mock'));

const mockApi = jest.mocked(api);

const world = (overrides: Partial<World> = {}): World => ({
  id: 'w1',
  name: 'Aerth',
  ruleset_id: 'classic',
  status: 'lobby',
  invite_code: 'ABC234',
  turn_time_limit_hours: null,
  reminder_hours: 24,
  objection_hours: 12,
  created_by: 'me',
  created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:00Z',
  ...overrides,
});
const god = (overrides: Partial<God>): God => ({
  id: 'g',
  world_id: 'w1',
  user_id: 'me',
  name: 'Solara',
  spheres: ['Light'],
  personality: '',
  color: '#E3B05B',
  sigil: '☀',
  created_at: '',
  departed_at: null,
  updated_at: '',
  ...overrides,
});
const member = (user_id: string, role: 'host' | 'player' = 'player', name = user_id) => ({
  world_id: 'w1',
  user_id,
  role,
  is_gm: false,
  joined_at: '',
  profiles: { display_name: name },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockAuth = { status: 'signedIn', session: { user: { id: 'me' } } };
  mockApi.subscribeToWorld.mockReturnValue(() => {});
});

describe('Worlds home (DOW-24)', () => {
  it('lists worlds, worlds needing you first, with what they need', async () => {
    mockApi.listMyWorlds.mockResolvedValue([
      {
        ...world({ id: 'a', name: 'Waiting World', updated_at: '2026-11-03T05:00:00Z' }),
        world_members: [{ user_id: 'me', role: 'player', is_gm: false }],
        gods: [{ id: 'g1', user_id: 'me', name: 'Solara', color: '#E3B05B', sigil: '☀' }],
        world_state: null,
      },
      {
        ...world({ id: 'b', name: 'Needs God' }),
        world_members: [{ user_id: 'me', role: 'player', is_gm: false }],
        gods: [],
        world_state: null,
      },
    ]);
    await render(<WorldsScreen />);
    const first = await screen.findByText('Needs God');
    expect(screen.getByText('Lobby · 1 player · Create your god')).toBeTruthy();
    expect(screen.getByText('Lobby · 1 player · Waiting for players')).toBeTruthy();
    const names = screen.getAllByText(/World|God$/).map((n) => n.props.children);
    expect(names.indexOf('Needs God')).toBeLessThan(names.indexOf('Waiting World'));
    await fireEvent.press(screen.getByRole('button', { name: 'Open Needs God' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/world/b');
    expect(first).toBeTruthy();
  });

  it('shows an empty state', async () => {
    mockApi.listMyWorlds.mockResolvedValue([]);
    await render(<WorldsScreen />);
    expect(await screen.findByText('No worlds yet')).toBeTruthy();
  });

  it('joins with a code', async () => {
    mockApi.listMyWorlds.mockResolvedValue([]);
    mockApi.joinWorld.mockResolvedValue('w9');
    await render(<WorldsScreen />);
    expect(screen.getByRole('button', { name: 'Join world' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Join with an invite code'), 'abc-234');
    await fireEvent.press(screen.getByRole('button', { name: 'Join world' }));
    expect(mockApi.joinWorld).toHaveBeenCalledWith('abc-234');
    expect(mockRouter.push).toHaveBeenCalledWith('/world/w9');
  });

  it('shows why joining failed', async () => {
    mockApi.listMyWorlds.mockResolvedValue([]);
    mockApi.joinWorld.mockRejectedValue(new Error('That world has already started'));
    await render(<WorldsScreen />);
    await fireEvent.changeText(screen.getByLabelText('Join with an invite code'), 'ABC234');
    await fireEvent.press(screen.getByRole('button', { name: 'Join world' }));
    expect(await screen.findByText('That world has already started')).toBeTruthy();
  });

  it('continues an invite opened before signing in', async () => {
    mockApi.listMyWorlds.mockResolvedValue([]);
    jest.mocked(takePendingInvite).mockReturnValueOnce('ABC234');
    await render(<WorldsScreen />);
    expect(mockRouter.push).toHaveBeenCalledWith('/join/ABC234');
  });
});

describe('New world (DOW-22)', () => {
  it('creates a world and opens its lobby', async () => {
    mockApi.createWorld.mockResolvedValue(world({ id: 'new1' }));
    await render(<NewWorldScreen />);
    expect(screen.getByRole('button', { name: 'Create world' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('World name'), 'Aerth');
    await fireEvent(screen.getByLabelText("I'm the game master"), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('24 hours'));
    await fireEvent.press(screen.getByRole('button', { name: 'Create world' }));
    expect(mockApi.createWorld).toHaveBeenCalledWith('Aerth', true, 24);
    expect(mockRouter.replace).toHaveBeenCalledWith('/world/new1');
  });
});

describe('World lobby (DOW-22)', () => {
  beforeEach(() => {
    mockParams = { id: 'w1' };
  });

  it('shows the invite code and who still needs a god', async () => {
    mockApi.getLobby.mockResolvedValue({
      world: world(),
      members: [member('me', 'host', 'Lavelle'), member('bob', 'player', 'Bob')],
      gods: [god({ user_id: 'me' })],
      map: null,
    });
    await render(<WorldScreen />);
    expect(await screen.findByText('ABC-234')).toBeTruthy();
    expect(screen.getByText('No god yet')).toBeTruthy();
    expect(screen.getByText('Waiting for Bob to create a god.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start the First Age' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit your god' })).toBeTruthy();
  });

  it('lets the host start once everyone has a god', async () => {
    mockApi.getLobby.mockResolvedValue({
      world: world(),
      members: [member('me', 'host'), member('bob')],
      gods: [
        god({ user_id: 'me' }),
        god({ id: 'g2', user_id: 'bob', name: 'Umbra', color: '#2563EB' }),
      ],
      map: null,
    });
    mockApi.startWorld.mockResolvedValue();
    await render(<WorldScreen />);
    const start = await screen.findByRole('button', { name: 'Start the First Age' });
    expect(start).toBeEnabled();
    await fireEvent.press(start);
    expect(mockApi.startWorld).toHaveBeenCalledWith('w1');
  });

  it('asks the host to confirm before removing a player', async () => {
    mockApi.getLobby.mockResolvedValue({
      world: world(),
      members: [member('me', 'host'), member('bob')],
      gods: [],
      map: null,
    });
    mockApi.removeMember.mockResolvedValue();
    await render(<WorldScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove' }));
    expect(mockApi.removeMember).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Tap to confirm' }));
    expect(mockApi.removeMember).toHaveBeenCalledWith('w1', 'bob');
  });

  it("doesn't show host controls to players", async () => {
    mockApi.getLobby.mockResolvedValue({
      world: world({ created_by: 'bob' }),
      members: [member('bob', 'host'), member('me')],
      gods: [],
      map: null,
    });
    await render(<WorldScreen />);
    expect(await screen.findByRole('button', { name: 'Create your god' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start the First Age' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('World screen once the game has started', () => {
  it('shows the game instead of the lobby', async () => {
    mockParams = { id: 'w1' };
    mockApi.getLobby.mockResolvedValue({
      world: world({ status: 'active' }),
      members: [member('me', 'host'), member('bob')],
      gods: [
        god({ user_id: 'me' }),
        god({ id: 'g2', user_id: 'bob', name: 'Umbra', color: '#2563EB' }),
      ],
      map: null,
    });
    await render(<WorldScreen />);
    expect(await screen.findByTestId('active-world')).toBeTruthy();
    expect(screen.queryByText(/Players \(/)).toBeNull();
    expect(screen.queryByText('Invite friends')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start the First Age' })).toBeNull();
  });
});

describe('God editor (DOW-23)', () => {
  beforeEach(() => {
    mockParams = { id: 'w1' };
  });

  it('creates a god, with taken colors unavailable', async () => {
    mockApi.getLobby.mockResolvedValue({
      world: world(),
      members: [member('me'), member('bob')],
      gods: [god({ id: 'g2', user_id: 'bob', name: 'Umbra', color: '#2563EB' })],
      map: null,
    });
    mockApi.createGod.mockResolvedValue(god({}));
    await render(<GodScreen />);
    await screen.findByLabelText('Name');

    expect(screen.getByLabelText('Azure (taken)')).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Create god' }));
    expect(mockApi.createGod).not.toHaveBeenCalled();
    expect(screen.getByText('Your god needs a name.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Name'), 'Solara');
    await fireEvent.press(screen.getByLabelText('Light'));
    await fireEvent.press(screen.getByLabelText('Fire'));
    await fireEvent.press(screen.getByLabelText('Gold'));
    await fireEvent.press(screen.getByLabelText('Sun'));
    await fireEvent.press(screen.getByRole('button', { name: 'Create god' }));

    expect(mockApi.createGod).toHaveBeenCalledWith('w1', {
      name: 'Solara',
      spheres: ['Light', 'Fire'],
      personality: '',
      color: '#E3B05B',
      sigil: '☀',
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('limits spheres to 3', async () => {
    mockApi.getLobby.mockResolvedValue({
      world: world(),
      members: [member('me')],
      gods: [],
      map: null,
    });
    await render(<GodScreen />);
    await screen.findByLabelText('Name');
    for (const s of ['War', 'Sea', 'Sky']) await fireEvent.press(screen.getByLabelText(s));
    expect(screen.getByLabelText('Fire')).toBeDisabled();
    expect(screen.getByText('Spheres of influence (3/3)')).toBeTruthy();
  });

  it('after the start, only saves name and personality', async () => {
    mockApi.getLobby.mockResolvedValue({
      world: world({ status: 'active' }),
      members: [member('me')],
      gods: [god({ id: 'mine', user_id: 'me' })],
      map: null,
    });
    mockApi.updateGod.mockResolvedValue(god({}));
    await render(<GodScreen />);
    expect(await screen.findByText(/spheres, color and sigil are locked/)).toBeTruthy();
    expect(screen.getByLabelText('Gold')).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Solara the Bright');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(mockApi.updateGod).toHaveBeenCalledWith('mine', {
      name: 'Solara the Bright',
      personality: '',
    });
  });
});

describe('Invite links (DOW-22)', () => {
  it('joins and opens the world when signed in', async () => {
    mockParams = { code: 'ABC234' };
    mockApi.joinWorld.mockResolvedValue('w1');
    await render(<JoinScreen />);
    expect(mockApi.joinWorld).toHaveBeenCalledWith('ABC234');
    expect(mockRouter.replace).toHaveBeenCalledWith('/world/w1');
  });

  it('remembers the code and asks to sign in when signed out', async () => {
    mockParams = { code: 'ABC234' };
    mockAuth = { status: 'signedOut', session: null as never };
    const { savePendingInvite } = jest.requireMock('@/worlds/invite');
    await render(<JoinScreen />);
    expect(savePendingInvite).toHaveBeenCalledWith('ABC234');
    expect(screen.getByText('redirect:/sign-in')).toBeTruthy();
    expect(mockApi.joinWorld).not.toHaveBeenCalled();
  });

  it('explains an invalid code', async () => {
    mockParams = { code: 'nope' };
    await render(<JoinScreen />);
    expect(screen.getByText(`"nope" isn't a valid invite code.`)).toBeTruthy();
  });
});
