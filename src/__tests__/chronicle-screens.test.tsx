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
const karakAction = actions.find((a) => a.power === 'commandRace')!;
const raceAction = actions.find((a) => a.power === 'createRace')!;
/** Where an action's card is in the feed (newest first). */
const feedIndex = (seq: number) => [...actions].reverse().findIndex((a) => a.seq === seq);
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
  reminder_hours: 24,
  objection_hours: 12,
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
    const text = (i: number) => cards()[i].props.children.join('');
    // DOW-53: the newest action was objected to and undone; it stays in the feed, marked.
    expect(text(0)).toContain('Shape Land: Hills');
    expect(screen.getByText(/objected:.*That hill is in my sea/)).toBeTruthy();
    expect(screen.getByText('Undone by vote (2 to 0); its cost was refunded.')).toBeTruthy();
    expect(text(1)).toContain('Command Race: Host of Karak took Underhold');
    // DOW-55: the battle, die by die.
    expect(
      screen.getByText(/Won against Pale Guard: 5 \+ 4 \+ 1 = 10 vs 2 \+ 2 \+ 1 = 5/),
    ).toBeTruthy();
    expect(screen.getByText('Underhold lies in ruins.')).toBeTruthy();
    expect(text(feedIndex(karakAction.seq))).toContain('founded Karak');
    expect(text(feedIndex(raceAction.seq))).toContain('Create Race: Dwarves');
    expect(feedIndex(karakAction.seq)).toBeLessThan(feedIndex(raceAction.seq));
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
    await fireEvent.press(screen.getAllByLabelText('Show on the map')[feedIndex(karakAction.seq)]);
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
    await fireEvent.press(screen.getAllByLabelText('😂 0')[feedIndex(karakAction.seq)]);
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
    // Every card but Karak's has no comments yet, so has a "Comment" button.
    const withoutComments = [...actions].reverse().filter((a) => a.seq !== karakAction.seq);
    const commentButtons = screen.getAllByRole('button', { name: 'Comment' });
    await fireEvent.press(
      commentButtons[withoutComments.findIndex((a) => a.seq === raceAction.seq)],
    );
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

describe('Ages and undone actions in the chronicle (DOW-52/53)', () => {
  // A Second Age begins after the fixture, and a god acts in it.
  const last = events[events.length - 1];
  const action = events.find((e) => e.type === 'action_taken')!;
  const later: GameEvent[] = [
    {
      ...last,
      seq: last.seq + 1,
      type: 'age_advanced',
      god_id: null,
      payload: { age: 2, name: 'Second Age', years_per_round: 100, round: 9 },
    },
    {
      ...action,
      seq: last.seq + 2,
      age: 2,
      round: 9,
      payload: { ...(action.payload as object), choice: 'desert', description: 'Dry times' },
    },
  ];

  it('marks where a new age begins, in the feed and the History Chart', async () => {
    game.loadGameEvents.mockResolvedValue([...events, ...later]);
    await render(<ChronicleScreen />);
    expect(await screen.findAllByText('The Second Age begins')).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText('History'));
    expect(screen.getAllByText('The Second Age begins')).toHaveLength(1);
    // The undone hill stays in the chart, marked.
    expect(screen.getAllByText(/Shape Land: Hills \(undone\)/).length).toBeGreaterThan(0);
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
    // With Karak, its subrace, advancement, order, avatar, wall, army, march and battle.
    expect(screen.getByText('13 entries')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Karak (city)'));
    // Founded, purified, built a wall, raised the Host, which marched and took Underhold.
    expect(screen.getByText('6 entries')).toBeTruthy();
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
    await fireEvent.press(screen.getAllByLabelText('Show hex 4, 4 on the map')[0]);
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
