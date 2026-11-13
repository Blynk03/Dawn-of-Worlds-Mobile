import { fireEvent, render, screen } from '@testing-library/react-native';

import ActScreen from '@/app/(app)/world/[id]/act';
import LandmassScreen from '@/app/(app)/world/[id]/landmass';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, projectWorld } from '@/game/project';
import type { God, World, WorldMapRow } from '@/lib/database.types';
import * as worldsApi from '@/worlds/api';

import { withAvatar, withOrder, withoutRaces } from '../../test/fixture-helpers';

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
  objection_hours: 12,
  reaction_hours: 12,
  gm_final_say: false,
  alignment_cap: null,
  years_per_round: null,
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
  departed_at: null,
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
    for (const name of ['Shape Land', 'Shape Climate', 'Create Race', 'Create Order']) {
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
    // Found a city, Create Subrace, Advance and Create Order all need a race.
    expect(screen.getAllByText('No races yet: create one first')).toHaveLength(4);
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
    // DOW-38: the active god needs an order among the Dwarves to command them.
    game.loadGameEvents.mockResolvedValue(withOrder(eventsWithPower(30), activeGodId, dwarves.id));
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

describe('Orders (DOW-44, DOW-38, DOW-39)', () => {
  const [dwarves, deep] = view.races;
  const hammers = view.orders.find((o) => o.name === 'Hammers of the Deep')!;
  const mine = hammers.godId === activeGodId;

  beforeEach(() => {
    game.loadGameEvents.mockResolvedValue(eventsWithPower(30));
    game.createOrder.mockResolvedValue();
    game.commandOrder.mockResolvedValue();
  });

  it('creates an order of knights within a race', async () => {
    await render(<ActScreen />);
    await openPower('Create Order');
    await fireEvent.press(screen.getByLabelText('Deep Dwarves'));
    await fireEvent.changeText(screen.getByLabelText('Order name'), 'The Pale Watch');
    await fireEvent.press(screen.getByLabelText('Knights'));
    await fireEvent.changeText(screen.getByLabelText('What is it for?'), 'Guard the deep roads');
    expect(screen.getByText('The Pale Watch among the Deep Dwarves')).toBeTruthy();
    expect(screen.getByText("Costs 8. You'll have 22 power left.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create the order' }));
    expect(game.createOrder).toHaveBeenCalledWith(
      'w1',
      deep.id,
      'The Pale Watch',
      'knights',
      'Guard the deep roads',
    );
  });

  it("commands an order, charging extra for someone else's", async () => {
    await render(<ActScreen />);
    await openPower('Command Order');
    const extra = mine ? 0 : 5; // the Hammers are knights, not a sect
    await fireEvent.press(
      screen.getByLabelText(new RegExp(`^Hammers of the Deep \\(Dwarves\\) · ${4 + extra}`)),
    );
    expect(
      screen.getByText(`Costs ${4 + extra}. You'll have ${26 - extra} power left.`),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What do they do?'), 'Ride out');
    await fireEvent.press(screen.getByRole('button', { name: 'Command Hammers of the Deep' }));
    expect(game.commandOrder).toHaveBeenCalledWith('w1', hammers.id, 'Ride out');
  });

  it('only lets you command races where you have an order or avatar', async () => {
    // The active god gets an order among the Deep Dwarves only.
    game.loadGameEvents.mockResolvedValue(withOrder(eventsWithPower(30), activeGodId, deep.id));
    await render(<ActScreen />);
    await openPower('Found a city');
    const present = view.orders.some((o) => o.godId === activeGodId && o.raceId === dwarves.id);
    expect(screen.getByLabelText('Deep Dwarves').props.accessibilityState).toMatchObject({
      checked: true,
    });
    if (!present) {
      expect(
        screen.getByLabelText('Dwarves · no order or avatar here').props.accessibilityState,
      ).toMatchObject({ disabled: true });
    }
  });

  it('says why you can’t found a city without presence anywhere', async () => {
    const events = withoutRaces(fixture.events as GameEvent[]);
    // One race, made by someone else, so the active god has no presence in it.
    const someoneElse = view.turnOrder.find((g) => g !== activeGodId)!;
    const created = (fixture.events as GameEvent[]).find(
      (e) => (e.payload as { power?: string }).power === 'createRace',
    )!;
    const last = events[events.length - 1];
    events.push({
      ...created,
      seq: last.seq + 1,
      god_id: someoneElse,
      round: last.round,
      age: last.age,
    });
    game.loadGameEvents.mockResolvedValue(
      eventsWithPower(30, events).map((e) =>
        e.god_id === activeGodId && (e.payload as { order?: unknown }).order
          ? { ...e, god_id: someoneElse }
          : e,
      ),
    );
    await render(<ActScreen />);
    await screen.findByText(/has 30 power\./);
    expect(screen.getByRole('button', { name: 'Found a city' })).toBeDisabled();
    expect(screen.getByText('You need an order or avatar among a race first')).toBeTruthy();
  });
});

describe('Avatars (DOW-45)', () => {
  const [dwarves] = view.races;
  const karak = view.cities[0];

  beforeEach(() => {
    game.loadGameEvents.mockResolvedValue(
      withAvatar(eventsWithPower(30), activeGodId, null, 'Aelin'),
    );
    game.createAvatar.mockResolvedValue();
    game.commandAvatar.mockResolvedValue();
  });

  it('creates an avatar anywhere on the map', async () => {
    await render(<ActScreen />);
    await openPower('Create Avatar');
    await fireEvent.changeText(screen.getByLabelText('Avatar name'), 'Morwen');
    await fireEvent.press(screen.getByLabelText('Dragon'));
    await fireEvent.changeText(screen.getByLabelText('Who are they?'), 'Eldest of wyrms');
    await fireEvent.press(screen.getByLabelText('Dwarves'));
    await fireEvent.press(screen.getByLabelText('hex 0,0')); // even at sea
    expect(screen.getByText('Morwen appears at hex 0, 0')).toBeTruthy();
    expect(screen.getByText("Costs 10. You'll have 20 power left.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create the avatar' }));
    expect(game.createAvatar).toHaveBeenCalledWith('w1', {
      name: 'Morwen',
      avatarType: 'Dragon',
      description: 'Eldest of wyrms',
      raceId: dwarves.id,
      hex: { x: 0, y: 0 },
    });
  });

  it('commands an avatar to a mortal deed for 2', async () => {
    await render(<ActScreen />);
    await openPower('Command Avatar');
    await fireEvent.press(screen.getByLabelText('Aelin'));
    await fireEvent.press(screen.getByLabelText('A mortal deed'));
    expect(screen.getByText("Costs 2. You'll have 28 power left.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What does Aelin do?'), 'Slays the wyrm');
    await fireEvent.press(screen.getByRole('button', { name: 'Command Aelin' }));
    expect(game.commandAvatar).toHaveBeenCalledWith('w1', 'avatar-Aelin', {
      intent: 'deed',
      description: 'Slays the wyrm',
    });
  });

  it('founds a city through the avatar, without needing an order there, for 2', async () => {
    await render(<ActScreen />);
    await openPower('Command Avatar');
    await fireEvent.press(screen.getByLabelText('Aelin'));
    await fireEvent.press(screen.getByLabelText('Found a city'));
    expect(screen.getByLabelText('Dwarves').props.accessibilityState).toMatchObject({
      disabled: false,
    });
    await fireEvent.press(screen.getByLabelText('hex 5,5'));
    await fireEvent.changeText(screen.getByLabelText('City name'), 'Aelinford');
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Aelin builds a ford');
    expect(screen.getByText("Costs 2. You'll have 28 power left.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Found the city' }));
    expect(game.commandAvatar).toHaveBeenCalledWith('w1', 'avatar-Aelin', {
      intent: 'foundCity',
      race: dwarves.id,
      name: 'Aelinford',
      x: 5,
      y: 5,
      description: 'Aelin builds a ford',
    });
  });

  it('purifies a city through the avatar (cities only)', async () => {
    await render(<ActScreen />);
    await openPower('Command Avatar');
    await fireEvent.press(screen.getByLabelText('Aelin'));
    await fireEvent.press(screen.getByLabelText('Purify a city'));
    expect(screen.queryByLabelText('Region')).toBeNull();
    await fireEvent.press(screen.getByLabelText(/^Karak · Noble/));
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Aelin blesses Karak');
    await fireEvent.press(screen.getByRole('button', { name: 'Purify Karak' }));
    expect(game.commandAvatar).toHaveBeenCalledWith('w1', 'avatar-Aelin', {
      intent: 'purifyCity',
      city: karak.id,
      description: 'Aelin blesses Karak',
    });
  });

  it('greys out avatars that already acted this turn, and resurrection when none is slain', async () => {
    const events = withAvatar(eventsWithPower(30), activeGodId, null, 'Aelin');
    const last = events[events.length - 1];
    events.push({
      ...last,
      seq: last.seq + 1,
      payload: {
        power: 'commandAvatar',
        intent: 'deed',
        cost: 2,
        hexes: [[1, 1]],
        choice: 'Aelin',
        description: 'Already busy',
        power_after: 28,
        avatar: { id: 'avatar-Aelin', name: 'Aelin' },
      },
    });
    game.loadGameEvents.mockResolvedValue(events);
    await render(<ActScreen />);
    await screen.findByText(/has 28 power\./);
    expect(screen.getByRole('button', { name: 'Command Avatar' })).toBeDisabled();
    expect(screen.getByText('Your avatars have all acted (or are slain)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resurrect Avatar' })).toBeDisabled();
    expect(screen.getByText('None of your avatars is slain')).toBeTruthy();
  });
});

describe('Cities and armies (DOW-48/54/55/41)', () => {
  const [dwarves] = view.races;
  const karak = view.cities.find((c) => c.name === 'Karak')!;
  const host = view.armies.find((a) => a.name === 'Host of Karak')!;
  // The active god gets an order among the Dwarves, so they can command Karak and its army.
  const present = () => withOrder(eventsWithPower(40), activeGodId, dwarves.id);

  beforeEach(() => {
    game.loadGameEvents.mockResolvedValue(present());
    game.commandCity.mockResolvedValue();
    game.marchArmy.mockResolvedValue();
    game.declareAttack.mockResolvedValue('pending');
    game.commandAvatar.mockResolvedValue();
  });

  it('offers the new powers, priced for the age', async () => {
    await render(<ActScreen />);
    await screen.findByText(/has 40 power\./);
    expect(screen.getByText('Cities and armies')).toBeTruthy();
    for (const name of ['Command City', 'March an army', 'Attack']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
  });

  it('builds a wall in a city', async () => {
    await render(<ActScreen />);
    await openPower('Command City');
    // Underhold lies in ruins, so only Karak can be commanded.
    expect(screen.queryByLabelText('Underhold')).toBeNull();
    await fireEvent.press(screen.getByLabelText('hex 5,4')); // tap Karak on the map
    await fireEvent.press(screen.getByLabelText('Wall'));
    await fireEvent.changeText(screen.getByLabelText('What is it called?'), 'The Outer Ring');
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Stone on stone');
    expect(screen.getByText('Karak builds The Outer Ring')).toBeTruthy();
    expect(screen.getByText("Costs 6. You'll have 34 power left.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Build it' }));
    expect(game.commandCity).toHaveBeenCalledWith('w1', karak.id, {
      action: 'build',
      name: 'The Outer Ring',
      structure_type: 'wall',
      description: 'Stone on stone',
    });
  });

  it('raises one army per city each turn, two through an avatar', async () => {
    const events = present();
    const last = events[events.length - 1];
    events.push({
      ...last,
      seq: last.seq + 1,
      god_id: activeGodId,
      payload: {
        power: 'commandCity',
        intent: 'raiseArmy',
        cost: 6,
        hexes: [[5, 4]],
        choice: 'Second Host',
        description: 'More',
        power_after: 34,
        target: { kind: 'city', id: karak.id, key: karak.id, name: 'Karak' },
        army: {
          id: 'army-2',
          name: 'Second Host',
          race_id: dwarves.id,
          city_id: karak.id,
          hex: [5, 4],
        },
      },
    });
    game.loadGameEvents.mockResolvedValue(withAvatar(events, activeGodId, null, 'Aelin'));
    await render(<ActScreen />);
    await openPower('Command City');
    await fireEvent.press(screen.getByLabelText('Karak'));
    await fireEvent.press(screen.getByLabelText('Raise an army'));
    expect(screen.getByText('Karak has already raised an army this turn.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose another power' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Command Avatar' }));
    await fireEvent.press(screen.getByLabelText('Aelin'));
    await fireEvent.press(screen.getByLabelText('Command a city'));
    await fireEvent.press(screen.getByLabelText('Karak'));
    await fireEvent.press(screen.getByLabelText('Raise an army'));
    expect(screen.queryByText(/already raised/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Army name'), 'Aelin’s Riders');
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'They follow her');
    expect(screen.getByText("Costs 2. You'll have 32 power left.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Raise the army' }));
    expect(game.commandAvatar).toHaveBeenCalledWith('w1', 'avatar-Aelin', {
      intent: 'commandCity',
      city: karak.id,
      action: 'raiseArmy',
      name: 'Aelin’s Riders',
      description: 'They follow her',
    });
  });

  it('marches an army over land', async () => {
    await render(<ActScreen />);
    await openPower('March an army');
    await fireEvent.press(screen.getByLabelText('Host of Karak · 7, 4'));
    await fireEvent.press(screen.getByLabelText('hex 0,0'));
    expect(screen.getByText('Armies march on land; choose a land hex.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('hex 5,5'));
    expect(screen.getByText('Host of Karak marches to hex 5, 5')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Home again');
    await fireEvent.press(screen.getByRole('button', { name: 'March Host of Karak' }));
    expect(game.marchArmy).toHaveBeenCalledWith('w1', host.id, { x: 5, y: 5 }, 'Home again');
  });

  it('declares an attack on a city with chosen bonuses, and can utterly destroy it', async () => {
    // Without the fixture's own pending battle, so the Host is free to march.
    const BATTLE = new Set(['battle_declared', 'bonus_proposed']);
    game.loadGameEvents.mockResolvedValue(present().filter((e) => !BATTLE.has(e.type)));
    await render(<ActScreen />);
    await openPower('Attack');
    await fireEvent.press(screen.getByLabelText('Host of Karak · 7, 4'));
    await fireEvent.press(screen.getByLabelText('hex 5,4')); // Karak
    // Suggested: the Dwarves' Steel on both sides, and Karak's Iron Wall for the defenders.
    await fireEvent.press(screen.getAllByLabelText('+1 Steel')[0]);
    await fireEvent.press(screen.getByLabelText('+1 The Iron Wall'));
    await fireEvent.changeText(
      screen.getByLabelText('Another bonus for the attackers'),
      'Siege engines',
    );
    await fireEvent.press(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(screen.getByText('Host of Karak: 2d6 + 2')).toBeTruthy();
    // The Host was raised in Karak, but it is the attacker: nobody is left to defend.
    expect(screen.getByText(/Karak has no army to defend it/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Utterly destroy them · up to +8 power'));
    expect(screen.getByText("Costs 16. You'll have 24 power left.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('What happens?'), 'Brother against brother');
    // DOW-56: the other gods get the world's reaction window to respond.
    expect(screen.getByText(/gives the other gods 12 hours to respond/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Declare war on Karak' }));
    expect(game.declareAttack).toHaveBeenCalledWith('w1', {
      armyId: host.id,
      target: { kind: 'city', id: karak.id },
      attackerModifiers: ['Steel', 'Siege engines'],
      defenderModifiers: ['The Iron Wall'],
      utterlyDestroy: true,
      description: 'Brother against brother',
    });
  });

  it('won’t send an army already marching to battle (DOW-56)', async () => {
    await render(<ActScreen />);
    await openPower('Attack');
    expect(screen.getByLabelText('Host of Karak · marching to battle')).toBeDisabled();
  });

  it('needs an army you can command, and a city', async () => {
    game.loadGameEvents.mockResolvedValue(withoutRaces(eventsWithPower(40)));
    await render(<ActScreen />);
    await screen.findByText(/has 40 power\./);
    expect(screen.getByRole('button', { name: 'Attack' })).toBeDisabled();
    expect(
      screen.getAllByText('No army you can command: raise one with Command City'),
    ).toHaveLength(2);
    expect(screen.getByText('No standing cities yet')).toBeTruthy();
  });
});
