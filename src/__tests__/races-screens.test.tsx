import { render, screen } from '@testing-library/react-native';

import AtlasScreen from '@/app/(app)/world/[id]/atlas';
import { HexDetails } from '@/components/hex-details';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, projectWorld } from '@/game/project';
import type { God } from '@/lib/database.types';
import * as worldsApi from '@/worlds/api';

import { withoutRaces } from '../../test/fixture-helpers';

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
  departed_at: null,
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
      objection_hours: 12,
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
    expect(
      screen.getByText(/Good \(\+1\) · created by Solara in the First Age, round 2/),
    ).toBeTruthy();
    expect(screen.getByText('Stout folk of the deep halls')).toBeTruthy();
    expect(screen.getByText('Appearance: Short and bearded')).toBeTruthy();
    expect(screen.getByText('Homeland: hex 4, 4')).toBeTruthy();
    // Each race's creator has a sect in it; the Dwarves also have an order of knights.
    for (const sect of view.orders.filter((o) => o.orderType === 'religious')) {
      expect(screen.getAllByLabelText(`Order ${sect.name}`).length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText('Order Hammers of the Deep')).toBeTruthy();
    expect(screen.getByText(/· Knights · Solara’s/)).toBeTruthy();
    expect(screen.getByText('Guard the mountain gates')).toBeTruthy();
    expect(screen.getAllByText('1 city')).toHaveLength(2); // Karak; the Deep Dwarves' Underhold
    expect(screen.getByLabelText('City of Karak')).toBeTruthy();
    expect(screen.getByText('“A hall is carved into the hill”')).toBeTruthy();
    // DOW-48/41: what Karak built and raised, and the ruins of Underhold.
    expect(screen.getByText('Built: The Iron Wall (wall)')).toBeTruthy();
    expect(screen.getByLabelText('Army Host of Karak')).toBeTruthy();
    expect(screen.getByText(/· at hex 7, 4/)).toBeTruthy();
    expect(screen.getByText(/· scattered/)).toBeTruthy(); // the Pale Guard
    expect(screen.getByText(/Underhold.*\(in ruins\)/)).toBeTruthy();
  });

  it('explains how to start when there are no races', async () => {
    game.loadGameEvents.mockResolvedValue(withoutRaces(events));
    await render(<AtlasScreen />);
    expect(await screen.findByText('No races yet')).toBeTruthy();
  });
});

describe('Atlas: subraces, alignment and advancements (DOW-43/46/47)', () => {
  it('shows lineage both ways', async () => {
    await render(<AtlasScreen />);
    expect(await screen.findByText('Deep Dwarves')).toBeTruthy();
    expect(screen.getByText('A subrace of the Dwarves')).toBeTruthy();
    expect(screen.getByText('Subraces: Deep Dwarves')).toBeTruthy();
    expect(screen.getByText(/Evil \(-1\) · created by Solara/)).toBeTruthy();
  });

  it('shows alignment on the Saintly … Vile scale and who is greatest at what', async () => {
    await render(<AtlasScreen />);
    // Karak was founded Good (+1), then purified.
    expect(await screen.findByText(/Hex 5, 4 · Noble \(\+2\) · founded at/)).toBeTruthy();
    expect(screen.getByText('Greatest in the world at Steel')).toBeTruthy();
  });
});

describe('Atlas: avatars (DOW-45)', () => {
  it('lists avatars with what they are, whose they are and where they walk', async () => {
    await render(<AtlasScreen />);
    const durin = await screen.findByLabelText('Avatar Durin');
    expect(durin).toBeTruthy();
    expect(screen.getByText('Dwarf king · Solara’s · among the Dwarves')).toBeTruthy();
    expect(screen.getByText('The deathless king')).toBeTruthy();
  });
});

describe('Hex details for settled hexes', () => {
  const map = view.map!;

  it("shows a race's homeland and how it got there", async () => {
    await render(
      <HexDetails hex={{ x: 4, y: 4 }} map={map} view={view} gods={gods} onClose={() => {}} />,
    );
    expect(screen.getByText('Homeland of the Dwarves')).toBeTruthy();
    expect(screen.getByText(/· Good \(\+1\)/)).toBeTruthy();
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

  it('shows ruins, the army standing there and the battle (DOW-41/48/55)', async () => {
    await render(
      <HexDetails hex={{ x: 7, y: 4 }} map={map} view={view} gods={gods} onClose={() => {}} />,
    );
    expect(screen.getByText('Ruins of Underhold')).toBeTruthy();
    expect(screen.getByText('⚑ Host of Karak')).toBeTruthy();
    expect(screen.getByText(/raised in Karak/)).toBeTruthy();
    expect(screen.getByText(/Command Race: Host of Karak took Underhold/)).toBeTruthy();
  });

  it("shows a region's alignment once it has changed (DOW-46)", async () => {
    await render(
      <HexDetails hex={{ x: 2, y: 2 }} map={map} view={view} gods={gods} onClose={() => {}} />,
    );
    expect(screen.getByText('Blighted land')).toBeTruthy();
    expect(screen.getByText(/Corrupt Region: the region at 2, 2, now Blighted/)).toBeTruthy();
  });

  it('says nothing about alignment for untouched land', async () => {
    await render(
      <HexDetails hex={{ x: 1, y: 1 }} map={map} view={view} gods={gods} onClose={() => {}} />,
    );
    expect(screen.queryByText(/^(Hallowed|Blessed|Blighted|Cursed) land$/)).toBeNull();
  });
});
