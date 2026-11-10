import { fireEvent, render, screen } from '@testing-library/react-native';

import { GamePanel } from '@/components/game-panel';
import * as gameApi from '@/game/api';
import type { GameEvent } from '@/game/project';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import type { God } from '@/lib/database.types';

// The fixture is a real server-played game in round 2: the first god in turn order has played,
// the second ran out of time, and it's the third god's turn.
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (fn: () => void) => useEffect(fn, [fn]) };
});
jest.mock('@/game/api');
const DEADLINE = new Date(fixture.state.turn_deadline);
const hoursBefore = (h: number) => new Date(DEADLINE.getTime() - h * 3_600_000);
let mockNow = hoursBefore(5);
jest.mock('@/game/hooks', () => ({
  ...jest.requireActual('@/game/hooks'),
  useNow: () => mockNow,
}));

const api = jest.mocked(gameApi);

const god = (id: string, user_id: string, name: string, color: string, sigil: string): God => ({
  id,
  world_id: 'w',
  user_id,
  name,
  spheres: ['Light'],
  personality: '',
  color,
  sigil,
  created_at: '',
  updated_at: '',
});
const gods = [
  god('aaaaaaaa-0000-0000-0000-000000000001', 'u-a', 'Solara', '#E3B05B', '☀'),
  god('bbbbbbbb-0000-0000-0000-000000000002', 'u-b', 'Umbra', '#7C3AED', '☾'),
  god('cccccccc-0000-0000-0000-000000000003', 'u-c', 'Thalassa', '#0D9488', '⚓'),
];
const PLAYERS: Record<string, string> = { 'u-a': 'Lavelle', 'u-b': 'Bob', 'u-c': 'Carol' };
const byId = (godId: string) => gods.find((g) => g.id === godId)!;
const order = fixture.state.turn_order.map(byId);
const [first, second, active] = order;
const members = ['u-a', 'u-b', 'u-c'].map((user_id, i) => ({
  world_id: 'w',
  user_id,
  role: i === 0 ? ('host' as const) : ('player' as const),
  is_gm: false,
  joined_at: '',
  profiles: { display_name: ['Lavelle', 'Bob', 'Carol'][i] },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockNow = hoursBefore(5);
  api.loadGameEvents.mockResolvedValue(fixture.events as GameEvent[]);
  api.subscribeToGameEvents.mockReturnValue(() => {});
  api.endTurn.mockResolvedValue();
  api.skipTimedOutTurn.mockResolvedValue();
});

const renderPanel = (myId: string) =>
  render(<GamePanel worldId="w" gods={gods} members={members} myId={myId} />);

describe('GamePanel', () => {
  it('shows the round, age and year', async () => {
    await renderPanel('u-a');
    expect(await screen.findByText('Round 2 · First Age · Year 500')).toBeTruthy();
  });

  it('shows turn order with power and who has played', async () => {
    await renderPanel('u-a');
    await screen.findByText('Round 2 · First Age · Year 500');
    for (const [godId, p] of Object.entries(fixture.powers)) {
      const name = gods.find((g) => g.id === godId)!.name;
      expect(screen.getByLabelText(`${name} has ${p.power} power`)).toBeTruthy();
    }
    expect(screen.getByText(`Done · ${PLAYERS[first.user_id]}`)).toBeTruthy();
    expect(screen.getByText(`Ran out of time · ${PLAYERS[second.user_id]}`)).toBeTruthy();
    expect(screen.getByText(`Taking their turn · ${PLAYERS[active.user_id]}`)).toBeTruthy();
  });

  it('lets the active player end their turn or pass', async () => {
    await renderPanel(active.user_id);
    expect(await screen.findByText('Your turn')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'End turn' }));
    expect(api.endTurn).toHaveBeenCalledWith('w', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Pass' }));
    expect(api.endTurn).toHaveBeenCalledWith('w', true);
  });

  it('shows everyone else who they are waiting for, with the time left', async () => {
    await renderPanel(first.user_id);
    expect(
      await screen.findByText(
        `Waiting for ${active.name} (${PLAYERS[active.user_id]}) · Ends in 5h`,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'End turn' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
  });

  it("lets anyone skip a turn once it's out of time", async () => {
    mockNow = hoursBefore(-1);
    await renderPanel(first.user_id);
    await fireEvent.press(
      await screen.findByRole('button', { name: `Skip ${active.name}'s turn` }),
    );
    expect(api.skipTimedOutTurn).toHaveBeenCalledWith('w');
  });

  it('shows server errors', async () => {
    api.endTurn.mockRejectedValueOnce(new Error("It isn't your turn"));
    await renderPanel(active.user_id);
    await fireEvent.press(await screen.findByRole('button', { name: 'End turn' }));
    expect(await screen.findByText("It isn't your turn")).toBeTruthy();
  });
});
