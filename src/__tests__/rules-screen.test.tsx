import { render, screen, within } from '@testing-library/react-native';

import RulesScreen from '@/app/(app)/world/[id]/rules';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import type { GameEvent } from '@/game/project';
import type { God, World } from '@/lib/database.types';
import * as worldsApi from '@/worlds/api';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({ id: 'w1' }),
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
    Stack: { Screen: () => null },
  };
});
jest.mock('@/game/api');
jest.mock('@/worlds/api');

const game = jest.mocked(gameApi);
const worlds = jest.mocked(worldsApi);
const events = fixture.events as GameEvent[];

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
  created_by: 'u-a',
  created_at: '',
  updated_at: '',
};
const god = (id: string): God => ({
  id,
  world_id: 'w1',
  user_id: `u-${id}`,
  name: id,
  spheres: [],
  personality: '',
  color: '#B45309',
  sigil: '⛰',
  created_at: '',
  departed_at: null,
  updated_at: '',
});
const member = (user_id: string, is_gm = false) => ({
  world_id: 'w1',
  user_id,
  role: 'player' as const,
  is_gm,
  joined_at: '',
  profiles: { display_name: user_id === 'u-gm' ? 'Gwen' : user_id },
});

function lobby(extra: Partial<World> = {}, gm = false) {
  worlds.getLobby.mockResolvedValue({
    world: { ...world, ...extra },
    members: [member('u-a'), member('u-b'), ...(gm ? [member('u-gm', true)] : [])],
    gods: [god('a'), god('b'), god('c')],
    map: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  game.loadGameEvents.mockResolvedValue(events);
  game.subscribeToGameEvents.mockReturnValue(() => {});
  worlds.subscribeToWorld.mockReturnValue(() => {});
  lobby();
});

describe('How to play (DOW-78)', () => {
  it('walks through a turn', async () => {
    await render(<RulesScreen />);
    expect(await screen.findByText('On your turn')).toBeTruthy();
    expect(screen.getByText(/It’s the First Age, round \d+ of it\./)).toBeTruthy();
    expect(screen.getByText(/2d6 power at the start of each round/)).toBeTruthy();
    expect(screen.getByText(/Tap Act and choose a power\./)).toBeTruthy();
    expect(screen.queryByText(/GM, goes first/)).toBeNull();
  });

  it('lists the powers at this age’s prices, with every age’s', async () => {
    await render(<RulesScreen />);
    expect(await screen.findByText('Powers in the First Age')).toBeTruthy();
    const race = screen.getByLabelText('Create Race: 22');
    expect(within(race).getByText('(22 / 6 / 15)')).toBeTruthy();
    expect(screen.getByLabelText('Shape Land: 3')).toBeTruthy();
    // Command Race and Command City need presence.
    expect(screen.getAllByText(/needs your order or avatar among them/)).toHaveLength(2);
    expect(screen.getAllByText(/coming to the app soon/)).toHaveLength(2); // Event, Catastrophe
  });

  it('uses this world’s settings', async () => {
    lobby({
      objection_hours: 6,
      reaction_hours: 0,
      alignment_cap: 3,
      years_per_round: [300, 50, 2],
      turn_time_limit_hours: 24,
    });
    await render(<RulesScreen />);
    expect(await screen.findByText(/a turn lasts up to 24 hours/)).toBeTruthy();
    expect(screen.getByText(/The GM has capped alignment at ±3\./)).toBeTruthy();
    expect(screen.getByText(/battles are rolled as soon as they’re declared/)).toBeTruthy();
    expect(screen.getByText('300 / 50 / 2 years')).toBeTruthy();
    expect(screen.getByText('6 hours')).toBeTruthy();
    expect(screen.getByText(/2 yes votes of 3/)).toBeTruthy();
    expect(screen.queryByText('The GM')).toBeNull();
  });

  it('explains the defaults: a battle window, objections, no cap', async () => {
    await render(<RulesScreen />);
    expect(await screen.findByText('12 hours to respond')).toBeTruthy();
    expect(screen.getByText(/There’s no limit\./)).toBeTruthy();
    expect(screen.getByText('500 / 100 / 5 years')).toBeTruthy();
  });

  it('says when objections are off', async () => {
    lobby({ objection_hours: 0 });
    await render(<RulesScreen />);
    expect(await screen.findByText('Objections are turned off in this world.')).toBeTruthy();
  });

  it('explains the GM, if there is one', async () => {
    lobby({ gm_final_say: true }, true);
    await render(<RulesScreen />);
    expect(await screen.findByText('The GM')).toBeTruthy();
    expect(screen.getByText(/Gwen’s god, as GM, goes first/)).toBeTruthy();
    expect(screen.getByText(/Gwen, as GM, can settle it at any time\./)).toBeTruthy();
    expect(
      screen.getByText('They have the final say on objections and disputed battle bonuses.'),
    ).toBeTruthy();
  });
});
