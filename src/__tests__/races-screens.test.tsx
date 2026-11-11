import { render, screen } from '@testing-library/react-native';

import AtlasScreen from '@/app/(app)/world/[id]/atlas';
import { HexDetails } from '@/components/hex-details';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, projectWorld } from '@/game/project';
import type { God } from '@/lib/database.types';
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

// The real server-played game: the Dwarves (good) on (4,4), and their city Karak on (5,4).
const events = fixture.events as GameEvent[];
const view = projectWorld(events);
const creatorId = view.races[0].godId!;
const god = (id: string, name: string): God => ({
  id,
  world_id: 'w1',
  user_id: `u-${name}`,
  name,
  spheres: ['Earth'],
  personality: '',
  color: '#B45309',
  sigil: '⛰',
  created_at: '',
  updated_at: '',
});
const gods = [god(creatorId, 'Solara')];

beforeEach(() => {
  jest.clearAllMocks();
  game.loadGameEvents.mockResolvedValue(events);
  game.subscribeToGameEvents.mockReturnValue(() => {});
  worlds.subscribeToWorld.mockReturnValue(() => {});
  worlds.getLobby.mockResolvedValue({
    world: {
      id: 'w1',
      name: 'Aerth',
      ruleset_id: 'classic',
      status: 'active',
      invite_code: 'ABC234',
      turn_time_limit_hours: null,
      reminder_hours: 24,
      created_by: 'u-Solara',
      created_at: '',
      updated_at: '',
    },
    members: [],
    gods,
    map: null,
  });
});

describe('Atlas (DOW-34/35)', () => {
  it('has a card for each race with its sect and cities', async () => {
    await render(<AtlasScreen />);
    expect(await screen.findByText('Dwarves')).toBeTruthy();
    expect(screen.getByText(/Good · created by Solara in the First Age, round 2/)).toBeTruthy();
    expect(screen.getByText('Stout folk of the deep halls')).toBeTruthy();
    expect(screen.getByText('Appearance: Short and bearded')).toBeTruthy();
    expect(screen.getByText('Homeland: hex 4, 4')).toBeTruthy();
    expect(screen.getByText('Sects: Faithful of Solara')).toBeTruthy();
    expect(screen.getByText('1 city')).toBeTruthy();
    expect(screen.getByLabelText('City of Karak')).toBeTruthy();
    expect(screen.getByText('“A hall is carved into the hill”')).toBeTruthy();
  });

  it('explains how to start when there are no races', async () => {
    game.loadGameEvents.mockResolvedValue(
      events.filter(
        (e) =>
          !['createRace', 'commandRace'].includes((e.payload as { power?: string }).power ?? ''),
      ),
    );
    await render(<AtlasScreen />);
    expect(await screen.findByText('No races yet')).toBeTruthy();
  });
});

describe('Hex details for settled hexes', () => {
  const map = view.map!;

  it("shows a race's homeland and how it got there", async () => {
    await render(
      <HexDetails hex={{ x: 4, y: 4 }} map={map} view={view} gods={gods} onClose={() => {}} />,
    );
    expect(screen.getByText('Homeland of the Dwarves')).toBeTruthy();
    expect(screen.getByText(/Create Race: Dwarves/)).toBeTruthy();
  });

  it('shows a city, its race and its founding', async () => {
    await render(
      <HexDetails hex={{ x: 5, y: 4 }} map={map} view={view} gods={gods} onClose={() => {}} />,
    );
    expect(screen.getByText('City of Karak')).toBeTruthy();
    expect(screen.getByText(/built by the Dwarves/)).toBeTruthy();
    expect(screen.getByText(/Command Race: founded Karak/)).toBeTruthy();
  });
});
