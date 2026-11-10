import { fireEvent, render, screen } from '@testing-library/react-native';

import ActScreen from '@/app/(app)/world/[id]/act';
import LandmassScreen from '@/app/(app)/world/[id]/landmass';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, projectWorld } from '@/game/project';
import type { God, World, WorldMapRow } from '@/lib/database.types';
import * as worldsApi from '@/worlds/api';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockAuthUser = 'u-active';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: 'w1' }),
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
    Stack: { Screen: () => null },
  };
});
jest.mock('@/auth/auth-provider', () => ({
  useAuth: () => ({ session: { user: { id: mockAuthUser } } }),
}));
jest.mock('@/components/hex-map', () => jest.requireActual('../../test/hex-map-mock'));
jest.mock('@/game/api');
jest.mock('@/worlds/api');

const game = jest.mocked(gameApi);
const worlds = jest.mocked(worldsApi);

// The real server-played game (round 2, First Age): its active god belongs to "u-active".
const view = projectWorld(fixture.events as GameEvent[]);
const activeGodId = view.activeGodId!;
const activePower = view.powers[activeGodId].power;

const world = (o: Partial<World> = {}): World => ({
  id: 'w1',
  name: 'Aerth',
  ruleset_id: 'classic',
  status: 'active',
  invite_code: 'ABC234',
  turn_time_limit_hours: null,
  created_by: 'u-active',
  created_at: '',
  updated_at: '',
  ...o,
});
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
const member = (user_id: string, role: 'host' | 'player') => ({
  world_id: 'w1',
  user_id,
  role,
  is_gm: false,
  joined_at: '',
  profiles: { display_name: user_id },
});
const otherGods = fixture.state.turn_order.filter((g) => g !== activeGodId);
const lobbyGods = [
  god(activeGodId, 'u-active', 'Solara'),
  god(otherGods[0], 'u-2', 'Umbra'),
  god(otherGods[1], 'u-3', 'Thalassa'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthUser = 'u-active';
  game.loadGameEvents.mockResolvedValue(fixture.events as GameEvent[]);
  game.subscribeToGameEvents.mockReturnValue(() => {});
  game.takeAction.mockResolvedValue();
  worlds.subscribeToWorld.mockReturnValue(() => {});
  worlds.getLobby.mockResolvedValue({
    world: world(),
    members: [member('u-active', 'host'), member('u-2', 'player'), member('u-3', 'player')],
    gods: lobbyGods,
    map: null,
  });
});

describe('Shape the world (DOW-26/31/32)', () => {
  it('shapes land: pick terrain, tap hexes, see the cost, describe it, confirm', async () => {
    await render(<ActScreen />);
    expect(await screen.findByText(`Solara has ${activePower} power.`)).toBeTruthy();
    expect(screen.getByText(/3 power per hex in this age/)).toBeTruthy();

    const confirm = () => screen.getByRole('button', { name: 'Shape the land' });
    expect(confirm()).toBeDisabled();

    await fireEvent.press(screen.getByLabelText('Hills'));
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    await fireEvent.press(screen.getByLabelText('hex 2,0'));
    expect(screen.getByText('2 hexes → Hills · costs 6')).toBeTruthy();
    expect(screen.getByText(`You'll have ${activePower - 6} power left.`)).toBeTruthy();
    expect(confirm()).toBeDisabled(); // still needs a description

    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Rolling hills rise');
    await fireEvent.press(confirm());
    expect(game.takeAction).toHaveBeenCalledWith(
      'w1',
      'shapeLand',
      [
        [1, 0],
        [2, 0],
      ],
      'hills',
      'Rolling hills rise',
    );
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('tapping a chosen hex again unchooses it', async () => {
    await render(<ActScreen />);
    await screen.findByText(/power per hex/);
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    expect(screen.getByText('selected none')).toBeTruthy();
  });

  it('shapes climate at its own price', async () => {
    await render(<ActScreen />);
    await screen.findByText(/power per hex/);
    await fireEvent.press(screen.getByLabelText('Shape Climate'));
    expect(screen.getByText(/2 power per hex in this age/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Snow'));
    await fireEvent.press(screen.getByLabelText('hex 3,0'));
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Snowfall');
    await fireEvent.press(screen.getByRole('button', { name: 'Shape the climate' }));
    expect(game.takeAction).toHaveBeenCalledWith(
      'w1',
      'shapeClimate',
      [[3, 0]],
      'snow',
      'Snowfall',
    );
  });

  it("won't let you spend more than you have", async () => {
    // One more logged action leaves the active god with 4 power.
    const last = fixture.events[fixture.events.length - 1];
    game.loadGameEvents.mockResolvedValue([
      ...(fixture.events as GameEvent[]),
      {
        ...last,
        seq: last.seq + 1,
        type: 'action_taken',
        god_id: activeGodId,
        payload: {
          power: 'shapeLand',
          cost: 3,
          hexes: [[9, 7]],
          choice: 'hills',
          description: 'x',
          power_after: 4,
        },
      },
    ]);
    await render(<ActScreen />);
    expect(await screen.findByText('Solara has 4 power.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    await fireEvent.press(screen.getByLabelText('hex 2,0'));
    expect(screen.getByText('That costs 6 power; you have 4.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Too much');
    expect(screen.getByRole('button', { name: 'Shape the land' })).toBeDisabled();
  });

  it('shows server errors and stays on the screen', async () => {
    game.takeAction.mockRejectedValueOnce(new Error("It isn't your turn"));
    await render(<ActScreen />);
    await screen.findByText(/power per hex/);
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Peaks');
    await fireEvent.press(screen.getByRole('button', { name: 'Shape the land' }));
    expect(await screen.findByText("It isn't your turn")).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("tells other players it isn't their turn", async () => {
    mockAuthUser = 'u-2';
    await render(<ActScreen />);
    expect(await screen.findByText("It isn't your turn right now.")).toBeTruthy();
  });
});

describe('Starting landmass (DOW-30)', () => {
  const saved: WorldMapRow = {
    world_id: 'w1',
    width: 24,
    height: 18,
    terrain: Array.from({ length: 24 * 18 }, () => 'ocean'),
    climate: Array.from({ length: 24 * 18 }, () => 'none'),
    updated_at: '',
  };

  beforeEach(() => {
    worlds.getLobby.mockResolvedValue({
      world: world({ status: 'lobby' }),
      members: [member('u-active', 'host'), member('u-2', 'player')],
      gods: [],
      map: saved,
    });
    worlds.setInitialMap.mockResolvedValue();
  });

  it('lets the host paint land and save', async () => {
    await render(<LandmassScreen />);
    expect(await screen.findByText('map 24x18')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('hex 2,0'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save landmass' }));
    const [worldId, width, height, terrain] = worlds.setInitialMap.mock.calls[0];
    expect([worldId, width, height]).toEqual(['w1', 24, 18]);
    expect(terrain).toHaveLength(24 * 18);
    expect(terrain[2]).toBe('grassland');
    expect(terrain[1]).toBe('ocean');
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('paints ocean too', async () => {
    await render(<LandmassScreen />);
    await screen.findByText('map 24x18');
    await fireEvent.press(screen.getByLabelText('hex 2,0'));
    await fireEvent.press(screen.getByLabelText('Ocean'));
    await fireEvent.press(screen.getByLabelText('hex 2,0'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save landmass' }));
    expect(worlds.setInitialMap.mock.calls[0][3][2]).toBe('ocean');
  });

  it('can switch map size, which makes a new random landmass', async () => {
    await render(<LandmassScreen />);
    await screen.findByText('map 24x18');
    await fireEvent.press(screen.getByLabelText('Large (44×32)'));
    expect(screen.getByText('map 44x32')).toBeTruthy();
    expect(screen.getByText(/\d+% land/)).toBeTruthy();
  });

  it('is only for the host', async () => {
    mockAuthUser = 'u-2';
    await render(<LandmassScreen />);
    expect(await screen.findByText(/Only the host can shape the starting landmass/)).toBeTruthy();
  });
});
