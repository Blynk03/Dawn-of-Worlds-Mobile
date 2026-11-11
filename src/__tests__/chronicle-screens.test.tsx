import { fireEvent, render, screen, within } from '@testing-library/react-native';

import ChronicleTab from '@/app/(app)/(tabs)/chronicle';
import ChronicleScreen from '@/app/(app)/world/[id]/chronicle';
import * as social from '@/chronicle/social';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, projectWorld } from '@/game/project';
import type { CommentRow, God, World } from '@/lib/database.types';
import * as worldsApi from '@/worlds/api';

const mockRouter = { push: jest.fn(), dismissTo: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = { id: 'w1' };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
    Stack: { Screen: () => null },
  };
});
jest.mock('@/auth/auth-provider', () => ({
  useAuth: () => ({ session: { user: { id: 'u-me' } } }),
}));
jest.mock('@/game/api');
jest.mock('@/worlds/api');
jest.mock('@/chronicle/social', () => {
  const actual = jest.requireActual('@/chronicle/social');
  return {
    ...actual,
    loadSocial: jest.fn(),
    addComment: jest.fn(),
    deleteComment: jest.fn(),
    toggleReaction: jest.fn(),
    markWorldRead: jest.fn(),
    loadUnreadCounts: jest.fn(),
    subscribeToSocial: jest.fn(() => () => {}),
  };
});

const game = jest.mocked(gameApi);
const worlds = jest.mocked(worldsApi);
const api = jest.mocked(social);

// The real server-played game: land and climate shaped, then the Dwarves are created and found
// Karak (the newest action).
const events = fixture.events as GameEvent[];
const view = projectWorld(events);
const actions = view.actions;
const karakAction = actions[actions.length - 1];
const raceAction = actions[actions.length - 2];
const dwarves = view.races[0];
const karak = view.cities[0];

const god = (id: string, user_id: string, name: string): God => ({
  id,
  world_id: 'w1',
  user_id,
  name,
  spheres: ['Earth'],
  personality: '',
  color: '#B45309',
  sigil: '⛰',
  created_at: '',
  updated_at: '',
});
const gods = fixture.state.turn_order.map((id, i) =>
  god(id, id === dwarves.godId ? 'u-me' : `u-${i}`, id === dwarves.godId ? 'Solara' : `God ${i}`),
);
const member = (user_id: string, name: string) => ({
  world_id: 'w1',
  user_id,
  role: 'player' as const,
  is_gm: false,
  joined_at: '',
  profiles: { display_name: name },
});
const world = (o: Partial<World> = {}): World => ({
  id: 'w1',
  name: 'Aerth',
  ruleset_id: 'classic',
  status: 'active',
  invite_code: 'ABC234',
  turn_time_limit_hours: null,
  created_by: 'u-me',
  created_at: '',
  updated_at: '',
  ...o,
});
const comment = (
  id: string,
  user: string,
  body: string,
  parent: string | null = null,
): CommentRow => ({
  id,
  world_id: 'w1',
  event_seq: karakAction.seq,
  parent_id: parent,
  user_id: user,
  body,
  created_at: new Date().toISOString(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'w1' };
  game.loadGameEvents.mockResolvedValue(events);
  game.subscribeToGameEvents.mockReturnValue(() => {});
  worlds.subscribeToWorld.mockReturnValue(() => {});
  worlds.getLobby.mockResolvedValue({
    world: world(),
    members: [member('u-me', 'Lavelle'), member('u-bob', 'Bob')],
    gods,
    map: null,
  });
  api.loadSocial.mockResolvedValue({
    comments: [comment('c1', 'u-bob', 'A fine hall'), comment('c2', 'u-me', 'Thanks!', 'c1')],
    reactions: [
      { world_id: 'w1', event_seq: karakAction.seq, user_id: 'u-me', emoji: '🔥', created_at: '' },
      { world_id: 'w1', event_seq: karakAction.seq, user_id: 'u-bob', emoji: '🔥', created_at: '' },
    ],
  });
  api.addComment.mockResolvedValue();
  api.deleteComment.mockResolvedValue();
  api.toggleReaction.mockResolvedValue();
  api.markWorldRead.mockResolvedValue();
});

const cards = () => screen.getAllByText(/^(Solara|God \d) · /);

describe('Activity feed (DOW-37)', () => {
  it('shows actions newest first, with who, what and when', async () => {
    await render(<ChronicleScreen />);
    expect(await screen.findByText('Solara · Command Race: founded Karak')).toBeTruthy();
    expect(cards()).toHaveLength(actions.length);
    expect(cards()[0].props.children.join('')).toContain('founded Karak');
    expect(cards()[1].props.children.join('')).toContain('Create Race: Dwarves');
    expect(
      screen.getAllByText(
        new RegExp(`First Age · Round ${karakAction.round} · Year ${karakAction.year}`),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('A hall is carved into the hill')).toBeTruthy();
  });

  it('marks the world read when you open it', async () => {
    await render(<ChronicleScreen />);
    await screen.findByText('Solara · Command Race: founded Karak');
    expect(api.markWorldRead).toHaveBeenCalledWith('w1');
  });

  it('links to the Atlas and to the place on the map', async () => {
    await render(<ChronicleScreen />);
    await fireEvent.press((await screen.findAllByLabelText('Open Karak in the Atlas'))[0]);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/world/[id]/atlas',
      params: { id: 'w1', entity: karak.id },
    });
    await fireEvent.press(screen.getAllByLabelText('Show on the map')[0]);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({
      pathname: '/world/[id]',
      params: { id: 'w1', hex: '5,4' },
    });
  });

  it('counts reactions, marks yours, and toggles them', async () => {
    await render(<ChronicleScreen />);
    const fire = await screen.findByLabelText('🔥 2');
    expect(fire.props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(fire);
    expect(api.toggleReaction).toHaveBeenCalledWith('w1', karakAction.seq, '🔥');
    expect(api.loadSocial).toHaveBeenCalledTimes(2); // refreshed after reacting
    await fireEvent.press(screen.getAllByLabelText('😂 0')[0]);
    expect(api.toggleReaction).toHaveBeenCalledWith('w1', karakAction.seq, '😂');
  });

  it('shows threaded comments and lets you reply', async () => {
    await render(<ChronicleScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '2 comments' }));
    expect(screen.getByText('A fine hall')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Thanks!')).toBeTruthy();

    await fireEvent.press(screen.getAllByRole('button', { name: 'Reply' })[0]);
    expect(screen.getByText('Replying to Bob')).toBeTruthy();
    const post = screen.getByRole('button', { name: 'Post' });
    expect(post).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Your reply'), 'Agreed');
    await fireEvent.press(post);
    expect(api.addComment).toHaveBeenCalledWith('w1', karakAction.seq, 'Agreed', 'c1');
  });

  it('comments on an action and deletes your own comments', async () => {
    await render(<ChronicleScreen />);
    await screen.findByText('Solara · Command Race: founded Karak');
    // The Create Race card has no comments yet.
    const commentButtons = screen.getAllByRole('button', { name: 'Comment' });
    await fireEvent.press(commentButtons[0]);
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Welcome, dwarves');
    await fireEvent.press(screen.getByRole('button', { name: 'Post' }));
    expect(api.addComment).toHaveBeenCalledWith('w1', raceAction.seq, 'Welcome, dwarves', null);

    await fireEvent.press(screen.getByRole('button', { name: '2 comments' }));
    // Only your own comment can be deleted.
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteComment).toHaveBeenCalledWith('c2');
  });

  it('shows server errors on the card', async () => {
    api.toggleReaction.mockRejectedValueOnce(new Error("You're not in this world"));
    await render(<ChronicleScreen />);
    await fireEvent.press(await screen.findByLabelText('🔥 2'));
    expect(await screen.findByText("You're not in this world")).toBeTruthy();
  });

  it('says when nothing has happened yet', async () => {
    game.loadGameEvents.mockResolvedValue(events.filter((e) => e.type !== 'action_taken'));
    await render(<ChronicleScreen />);
    expect(await screen.findByText('Nothing has happened yet')).toBeTruthy();
  });
});

describe('History Chart (DOW-36)', () => {
  beforeEach(() => {
    mockParams = { id: 'w1', tab: 'history' };
  });

  it('has a row for every action, oldest first', async () => {
    await render(<ChronicleScreen />);
    expect(await screen.findByText(`${actions.length} entries`)).toBeTruthy();
    const rows = screen.getAllByText(/^First Age · Round \d+ · Year \d+$/);
    expect(rows).toHaveLength(actions.length);
    expect(rows[0].props.children.join('')).toContain(`Round ${actions[0].round}`);
  });

  it('filters by race or city, god and age', async () => {
    await render(<ChronicleScreen />);
    await screen.findByText(`${actions.length} entries`);
    await fireEvent.press(screen.getByLabelText('Dwarves'));
    expect(screen.getByText('2 entries')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Karak (city)'));
    expect(screen.getByText('1 entry')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Everything'));

    const solaraActions = actions.filter((a) => a.godId === dwarves.godId).length;
    await fireEvent.press(screen.getByLabelText('Solara'));
    expect(
      screen.getByText(`${solaraActions} ${solaraActions === 1 ? 'entry' : 'entries'}`),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('All gods'));
    await fireEvent.press(screen.getByLabelText('First Age'));
    expect(screen.getByText(`${actions.length} entries`)).toBeTruthy();
  });

  it('links names to the Atlas and places to the map', async () => {
    await render(<ChronicleScreen />);
    await screen.findByText(`${actions.length} entries`);
    await fireEvent.press(screen.getByLabelText('Dwarves'));
    await fireEvent.press(screen.getAllByLabelText('Open Dwarves in the Atlas')[0]);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/world/[id]/atlas',
      params: { id: 'w1', entity: dwarves.id },
    });
    await fireEvent.press(screen.getByLabelText('Show hex 4, 4 on the map'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({
      pathname: '/world/[id]',
      params: { id: 'w1', hex: '4,4' },
    });
  });

  it('switches back to the feed', async () => {
    await render(<ChronicleScreen />);
    await fireEvent.press(await screen.findByLabelText('Feed'));
    expect(screen.getByText('Solara · Command Race: founded Karak')).toBeTruthy();
  });
});

describe('Chronicle tab', () => {
  it("lists games in play, unread first, and opens a world's chronicle", async () => {
    const summary = (id: string, name: string, status: World['status']) => ({
      ...world({ id, name, status }),
      world_members: [],
      gods: [],
      world_state: null,
    });
    worlds.listMyWorlds.mockResolvedValue([
      summary('w1', 'Aerth', 'active'),
      summary('w2', 'Mythra', 'active'),
      summary('w3', 'Lobbyland', 'lobby'),
    ] as never);
    api.loadUnreadCounts.mockResolvedValue({ w2: 3 });
    await render(<ChronicleTab />);
    const mythra = await screen.findByLabelText('Open the chronicle of Mythra');
    expect(within(mythra).getByText('3 new')).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
    expect(screen.queryByText('Lobbyland')).toBeNull();
    const order = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);
    expect(order.indexOf('Open the chronicle of Mythra')).toBeLessThan(
      order.indexOf('Open the chronicle of Aerth'),
    );
    await fireEvent.press(mythra);
    expect(mockRouter.push).toHaveBeenCalledWith('/world/w2/chronicle');
  });
});
