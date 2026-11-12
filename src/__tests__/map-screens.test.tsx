import { fireEvent, render, screen } from '@testing-library/react-native';

import ActScreen from '@/app/(app)/world/[id]/act';
import LandmassScreen from '@/app/(app)/world/[id]/landmass';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, projectWorld } from '@/game/project';
import type { God, World, WorldMapRow } from '@/lib/database.types';
import * as worldsApi from '@/worlds/api';

import { withoutRaces } from '../../test/fixture-helpers';

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

const world = (o: Partial<World> = {}): World => ({
  id: 'w1',
  name: 'Aerth',
  ruleset_id: 'classic',
  status: 'active',
  invite_code: 'ABC234',
  turn_time_limit_hours: null,
  reminder_hours: 24,
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

/** The fixture's events plus one more logged action that leaves the active god with `power`. */
function eventsWithPower(power: number, events = fixture.events as GameEvent[]): GameEvent[] {
  const last = events[events.length - 1];
  return [
    ...events,
    {
      ...last,
      seq: last.seq + 1,
      type: 'action_taken',
      god_id: activeGodId,
      payload: {
        power: 'shapeClimate',
        cost: 0,
        hexes: [[9, 7]],
        choice: 'none',
        description: 'x',
        power_after: power,
      },
    },
  ];
}

async function openPower(name: string) {
  await screen.findByText(/has \d+ power\./);
  await fireEvent.press(screen.getByRole('button', { name }));
}

describe('Choosing a power (DOW-26)', () => {
  it('groups powers by category with this age’s cost', async () => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(100));
    await render(<ActScreen />);
    expect(await screen.findByText('Solara has 100 power.')).toBeTruthy();
    expect(screen.getByText('Land')).toBeTruthy();
    expect(screen.getByText('Races')).toBeTruthy();
    expect(screen.getByText('3 / hex')).toBeTruthy(); // Shape Land, First Age
    expect(screen.getByText('22')).toBeTruthy(); // Create Race
    for (const name of ['Shape Land', 'Shape Climate', 'Create Race', 'Found a city']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
  });

  it('greys out powers you can’t afford and says why', async () => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(4));
    await render(<ActScreen />);
    await screen.findByText('Solara has 4 power.');
    expect(screen.getByRole('button', { name: 'Shape Land' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create Race' })).toBeDisabled();
    expect(screen.getByText('Needs 22 power')).toBeTruthy();
    expect(screen.getAllByText('Needs 8 power')).toHaveLength(2); // Found a city, Advance
  });

  it('can’t found a city before there are races', async () => {
    const noRaces = withoutRaces(fixture.events as GameEvent[]);
    game.loadGameEvents.mockResolvedValue(eventsWithPower(100, noRaces));
    await render(<ActScreen />);
    await screen.findByText('Solara has 100 power.');
    expect(screen.getByRole('button', { name: 'Found a city' })).toBeDisabled();
    // Found a city, Create Subrace and Advance all need a race.
    expect(screen.getAllByText('No races yet: create one first')).toHaveLength(3);
  });

  it('can go back and choose another power', async () => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(100));
    await render(<ActScreen />);
    await openPower('Shape Land');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose another power' }));
    expect(screen.getByRole('button', { name: 'Create Race' })).toBeTruthy();
  });

  it("tells other players it isn't their turn", async () => {
    mockAuthUser = 'u-2';
    await render(<ActScreen />);
    expect(await screen.findByText("It isn't your turn right now.")).toBeTruthy();
  });
});

describe('Shape Land and Shape Climate (DOW-31/32)', () => {
  beforeEach(() => game.loadGameEvents.mockResolvedValue(eventsWithPower(50)));

  it('shapes land: pick terrain, tap hexes, see the cost, describe it, confirm', async () => {
    await render(<ActScreen />);
    await openPower('Shape Land');
    expect(screen.getByText(/3 power per hex in the First Age/)).toBeTruthy();

    const confirm = () => screen.getByRole('button', { name: 'Shape the land' });
    expect(confirm()).toBeDisabled();

    await fireEvent.press(screen.getByLabelText('Hills'));
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    await fireEvent.press(screen.getByLabelText('hex 2,0'));
    expect(screen.getByText('2 hexes → Hills')).toBeTruthy();
    expect(screen.getByText("Costs 6. You'll have 44 power left.")).toBeTruthy();
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
    await openPower('Shape Land');
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    expect(screen.getByText('selected none')).toBeTruthy();
  });

  it('shapes climate at its own price', async () => {
    await render(<ActScreen />);
    await openPower('Shape Climate');
    expect(screen.getByText(/2 power per hex in the First Age/)).toBeTruthy();
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
    game.loadGameEvents.mockResolvedValue(eventsWithPower(4));
    await render(<ActScreen />);
    await openPower('Shape Land');
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    await fireEvent.press(screen.getByLabelText('hex 2,0'));
    expect(screen.getByText('That costs 6 power; you have 4.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Too much');
    expect(screen.getByRole('button', { name: 'Shape the land' })).toBeDisabled();
  });

  it('shows server errors and stays on the screen', async () => {
    game.takeAction.mockRejectedValueOnce(new Error("It isn't your turn"));
    await render(<ActScreen />);
    await openPower('Shape Land');
    await fireEvent.press(screen.getByLabelText('hex 1,0'));
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Peaks');
    await fireEvent.press(screen.getByRole('button', { name: 'Shape the land' }));
    expect(await screen.findByText("It isn't your turn")).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('Create Race (DOW-34)', () => {
  beforeEach(() => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(30));
    game.createRace.mockResolvedValue('new-race');
  });

  it('names the race, sets its alignment and homeland, and creates it', async () => {
    await render(<ActScreen />);
    await openPower('Create Race');
    expect(screen.getByText('marker race Dwarves at 44')).toBeTruthy(); // existing races show
    const confirm = () => screen.getByRole('button', { name: 'Create the race' });
    expect(confirm()).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Race name'), 'Elves');
    await fireEvent.changeText(
      screen.getByLabelText('What are they like?'),
      'Children of the woods',
    );
    await fireEvent.changeText(screen.getByLabelText('Appearance (optional)'), 'Tall and fair');
    await fireEvent.press(screen.getByLabelText('Evil'));
    expect(confirm()).toBeDisabled(); // still needs a homeland

    await fireEvent.press(screen.getByLabelText('hex 2,3'));
    expect(screen.getByText('Homeland: hex 2, 3 (Grassland)')).toBeTruthy();
    expect(screen.getByText("Costs 22. You'll have 8 power left.")).toBeTruthy();
    await fireEvent.press(confirm());
    expect(game.createRace).toHaveBeenCalledWith('w1', {
      name: 'Elves',
      description: 'Children of the woods',
      appearance: 'Tall and fair',
      alignment: -1,
      hex: { x: 2, y: 3 },
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('only settles empty land', async () => {
    await render(<ActScreen />);
    await openPower('Create Race');
    await fireEvent.press(screen.getByLabelText('hex 0,0')); // ocean border
    expect(screen.getByText('That hex is water; choose land.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('hex 4,4')); // the Dwarves' homeland
    expect(screen.getByText('Someone already lives there.')).toBeTruthy();
    expect(screen.getByText('selected none')).toBeTruthy();
  });
});

describe('Found a city (DOW-35)', () => {
  const dwarves = view.races[0];

  beforeEach(() => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(30));
    game.foundCity.mockResolvedValue('new-city');
  });

  it("highlights the race's land and founds a city there", async () => {
    await render(<ActScreen />);
    await openPower('Found a city');
    // On or next to the homeland (4,4) and Karak (5,4); never on Karak itself.
    const candidates = screen.getByText(/^candidates /).props.children as string;
    const list = candidates.replace('candidates ', '').split(',').map(Number);
    expect(list).toEqual(expect.arrayContaining([44, 35, 55]));
    expect(list).not.toContain(45);
    expect(list).not.toContain(46); // the Deep Dwarves live there

    await fireEvent.press(screen.getByLabelText('hex 5,5'));
    await fireEvent.changeText(screen.getByLabelText('City name'), 'Irondeep');
    expect(screen.getByText('Irondeep on hex 5, 5')).toBeTruthy();
    expect(screen.getByText("Costs 8. You'll have 22 power left.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Miners follow a vein east');
    await fireEvent.press(screen.getByRole('button', { name: 'Found the city' }));
    expect(game.foundCity).toHaveBeenCalledWith(
      'w1',
      dwarves.id,
      'Irondeep',
      { x: 5, y: 5 },
      'Miners follow a vein east',
    );
  });

  it("won't found a city away from the race's land", async () => {
    await render(<ActScreen />);
    await openPower('Found a city');
    await fireEvent.press(screen.getByLabelText('hex 1,1'));
    expect(screen.getByText(/Choose a highlighted hex/)).toBeTruthy();
    expect(screen.getByText('selected none')).toBeTruthy();
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

describe('Create Subrace (DOW-43)', () => {
  const [dwarves] = view.races;

  beforeEach(() => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(30));
    game.createSubrace.mockResolvedValue('new-subrace');
  });

  it("starts next to the parent race's land, with its own name and nature", async () => {
    await render(<ActScreen />);
    await openPower('Create Subrace');
    expect(screen.getByText(/12 power in the First Age/)).toBeTruthy();
    expect(screen.getByLabelText('Dwarves').props.accessibilityState).toMatchObject({
      checked: true,
    });
    await fireEvent.press(screen.getByLabelText('hex 8,6'));
    expect(
      screen.getByText('Choose a highlighted hex, next to the parent race’s land.'),
    ).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('hex 3,4'));
    await fireEvent.changeText(screen.getByLabelText('Race name'), 'Hill Dwarves');
    await fireEvent.changeText(
      screen.getByLabelText('What are they like?'),
      'Shepherds of the slopes',
    );
    await fireEvent.press(screen.getByLabelText('Good'));
    expect(screen.getByText("Costs 12. You'll have 18 power left.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create the subrace' }));
    expect(game.createSubrace).toHaveBeenCalledWith('w1', dwarves.id, {
      name: 'Hill Dwarves',
      description: 'Shepherds of the slopes',
      appearance: '',
      alignment: 1,
      hex: { x: 3, y: 4 },
    });
  });
});

describe('Advance (DOW-47)', () => {
  const [dwarves] = view.races;
  const karak = view.cities[0];

  beforeEach(() => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(30));
    game.advance.mockResolvedValue();
  });

  it('makes a civilization the greatest in the world at something', async () => {
    await render(<ActScreen />);
    await openPower('Advance');
    await fireEvent.press(screen.getByLabelText('Dwarves'));
    // Steel is taken (by the Dwarves themselves).
    expect(screen.getByLabelText('Steel · Dwarves').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByLabelText('Writing'));
    expect(screen.getByText('Dwarves becomes the greatest in the world at Writing.')).toBeTruthy();
    expect(screen.getByText("Costs 10. You'll have 20 power left.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Runes on every stone');
    await fireEvent.press(screen.getByRole('button', { name: 'Advance Dwarves' }));
    expect(game.advance).toHaveBeenCalledWith('w1', dwarves.id, 'Writing', 'Runes on every stone');
  });

  it('advances a city for its own price, picked on the map', async () => {
    await render(<ActScreen />);
    await openPower('Advance');
    await fireEvent.press(screen.getByLabelText('City'));
    await fireEvent.press(screen.getByLabelText('hex 5,4'));
    await fireEvent.press(screen.getByLabelText('Something else'));
    await fireEvent.changeText(screen.getByLabelText('Field of knowledge'), 'Brewing');
    expect(screen.getByText("Costs 8. You'll have 22 power left.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'The finest ale');
    await fireEvent.press(screen.getByRole('button', { name: 'Advance Karak' }));
    expect(game.advance).toHaveBeenCalledWith('w1', karak.id, 'Brewing', 'The finest ale');
  });

  it("won't let two be the greatest at the same thing", async () => {
    await render(<ActScreen />);
    await openPower('Advance');
    await fireEvent.press(screen.getByLabelText('Dwarves'));
    await fireEvent.press(screen.getByLabelText('Something else'));
    await fireEvent.changeText(screen.getByLabelText('Field of knowledge'), ' steel ');
    expect(screen.getByText('Dwarves is already the greatest in the world at that.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Rivals');
    expect(screen.getByRole('button', { name: 'Advance Dwarves' })).toBeDisabled();
  });
});

describe('Purify and Corrupt (DOW-46, DOW-40)', () => {
  const [dwarves] = view.races;
  const karak = view.cities[0];

  beforeEach(() => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(30));
    game.changeAlignment.mockResolvedValue(3);
  });

  it('purifies a city one step up the scale', async () => {
    await render(<ActScreen />);
    await openPower('Purify');
    await fireEvent.press(screen.getByLabelText('City'));
    await fireEvent.press(screen.getByLabelText(/^Karak · Noble \(\+2\)/));
    expect(screen.getByText('Karak: Noble (+2) → Virtuous (+3)')).toBeTruthy();
    expect(screen.getByText("Costs 4. You'll have 26 power left.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'A temple rises');
    await fireEvent.press(screen.getByRole('button', { name: 'Purify Karak' }));
    expect(game.changeAlignment).toHaveBeenCalledWith(
      'w1',
      { kind: 'city', id: karak.id },
      1,
      'A temple rises',
    );
  });

  it('corrupts a region tapped on the map', async () => {
    await render(<ActScreen />);
    await openPower('Corrupt');
    await fireEvent.press(screen.getByLabelText('Region'));
    await fireEvent.press(screen.getByLabelText('hex 2,2'));
    expect(screen.getByText('the region at hex 2, 2: Blighted → Cursed (-2)')).toBeTruthy();
    expect(screen.getByText("Costs 3. You'll have 27 power left.")).toBeTruthy(); // priced like a city
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'The rot spreads');
    await fireEvent.press(screen.getByRole('button', { name: 'Corrupt the region at hex 2, 2' }));
    expect(game.changeAlignment).toHaveBeenCalledWith(
      'w1',
      { kind: 'region', hex: { x: 2, y: 2 } },
      -1,
      'The rot spreads',
    );
  });

  it('only once per target per turn', async () => {
    // Earlier this turn, the active god purified the Dwarves.
    const events = eventsWithPower(30);
    const last = events[events.length - 1];
    events.push({
      ...last,
      seq: last.seq + 1,
      payload: {
        power: 'purifyCivilization',
        cost: 5,
        hexes: [[4, 4]],
        choice: 'Dwarves',
        description: 'Blessed',
        power_after: 30,
        target: { kind: 'race', id: dwarves.id, key: dwarves.id, name: 'Dwarves' },
        alignment: { delta: 1, after: 2 },
      },
    });
    game.loadGameEvents.mockResolvedValue(events);
    await render(<ActScreen />);
    await openPower('Corrupt');
    const chip = screen.getByLabelText('Dwarves · Noble (+2) · done this turn');
    expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText('hex 4,4'));
    expect(screen.getByText('You’ve already changed Dwarves’s alignment this turn.')).toBeTruthy();
    // Other targets are still fine.
    expect(
      screen.getByLabelText('Deep Dwarves · Evil (-1)').props.accessibilityState,
    ).toMatchObject({
      disabled: false,
    });
  });
});
