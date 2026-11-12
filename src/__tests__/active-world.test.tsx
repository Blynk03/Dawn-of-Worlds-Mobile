import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActiveWorld } from '@/components/active-world';
import * as socialApi from '@/chronicle/social';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, projectWorld } from '@/game/project';
import type { God } from '@/lib/database.types';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
  };
});
jest.mock('@/components/hex-map', () => jest.requireActual('../../test/hex-map-mock'));
jest.mock('@/game/api');
jest.mock('@/chronicle/social', () => ({
  ...jest.requireActual('@/chronicle/social'),
  loadUnreadCounts: jest.fn(),
}));
const game = jest.mocked(gameApi);
const social = jest.mocked(socialApi);

// The real server-played game: a map, the Dwarves and Karak, and it's someone's turn.
const view = projectWorld(fixture.events as GameEvent[]);
const god = (id: string, user_id: string, name: string): God => ({
  id,
  world_id: 'w1',
  user_id,
  name,
  spheres: ['Light'],
  personality: '',
  color: '#E3B05B',
  sigil: '☀',
  created_at: '',
  updated_at: '',
});
const gods = fixture.state.turn_order.map((id, i) =>
  god(id, id === view.activeGodId ? 'u-active' : `u-${i}`, `God ${i}`),
);
const members = gods.map((g) => ({
  world_id: 'w1',
  user_id: g.user_id,
  role: 'player' as const,
  is_gm: false,
  joined_at: '',
  profiles: { display_name: g.user_id },
}));

beforeEach(() => {
  jest.clearAllMocks();
  game.loadGameEvents.mockResolvedValue(fixture.events as GameEvent[]);
  game.subscribeToGameEvents.mockReturnValue(() => {});
  social.loadUnreadCounts.mockResolvedValue({});
});

describe('A world in play', () => {
  it('takes the active player from the turn panel to Shape the world', async () => {
    await render(<ActiveWorld worldId="w1" gods={gods} members={members} myId="u-active" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Shape the world' }));
    expect(mockPush).toHaveBeenCalledWith('/world/w1/act');
  });

  it('shows the map with its races and cities, and opens the Atlas', async () => {
    await render(<ActiveWorld worldId="w1" gods={gods} members={members} myId="u-0" />);
    expect(await screen.findByText('marker race Dwarves at 44')).toBeTruthy();
    expect(screen.getByText('marker city Karak at 45')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Atlas · 2 races, 2 cities' }));
    expect(mockPush).toHaveBeenCalledWith('/world/w1/atlas');
  });

  it('shows unread news on the Chronicle button and opens it', async () => {
    social.loadUnreadCounts.mockResolvedValue({ w1: 2, other: 5 });
    await render(<ActiveWorld worldId="w1" gods={gods} members={members} myId="u-0" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Chronicle · 2 new' }));
    expect(mockPush).toHaveBeenCalledWith('/world/w1/chronicle');
  });

  it('opens at a place when a chronicle link points to one', async () => {
    await render(
      <ActiveWorld worldId="w1" gods={gods} members={members} myId="u-0" focusHex="4,4" />,
    );
    expect(await screen.findByText('Homeland of the Dwarves')).toBeTruthy();
  });
});
