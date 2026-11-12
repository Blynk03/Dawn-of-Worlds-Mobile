import { fireEvent, render, screen } from '@testing-library/react-native';

import { FeedCard } from '@/components/feed-card';
import { TableVotes } from '@/components/table-votes';
import * as gameApi from '@/game/api';
import fixture from '@/game/__tests__/fixtures/server-game.json';
import { type GameEvent, type GameView, projectWorld, type ProposalView } from '@/game/project';
import type { God } from '@/lib/database.types';

jest.mock('@/game/api');
const api = jest.mocked(gameApi);

// The real server-played game (its newest action, a hill, was objected to and undone).
const base = projectWorld(fixture.events as GameEvent[]);
const [g1, g2, g3] = base.turnOrder;
const god = (id: string, name: string): God => ({
  id,
  world_id: 'w1',
  user_id: `u-${name}`,
  name,
  spheres: [],
  personality: '',
  color: '#E3B05B',
  sigil: '✶',
  created_at: '',
  departed_at: null,
  updated_at: '',
});
const gods = [god(g1, 'Solara'), god(g2, 'Umbra'), god(g3, 'Verdant')];
const now = new Date('2026-11-04T01:00:00Z');

const ageVote = (votes: Record<string, string>): ProposalView => ({
  id: 'p-age',
  kind: 'advanceAge',
  godId: g2,
  targetSeq: null,
  age: 2,
  solo: false,
  reason: '',
  closesAt: null,
  status: 'open',
  votes,
  coin: null,
  seq: 999,
  at: '',
});

function show(view: Partial<GameView>, myGodId: string | null = g1) {
  const onChanged = jest.fn();
  return render(
    <TableVotes
      worldId="w1"
      view={{ ...base, proposals: [], ...view }}
      gods={gods}
      myGodId={myGodId}
      now={now}
      onChanged={onChanged}
    />,
  ).then(() => onChanged);
}

beforeEach(() => {
  api.proposeNextAge.mockResolvedValue('open');
  api.castVote.mockResolvedValue('open');
  api.closeVote.mockResolvedValue('kept');
  api.objectToAction.mockResolvedValue('p-new');
});

describe('The next age (DOW-52)', () => {
  it('waits out the first five rounds', async () => {
    await show({ round: 3, ageStartedRound: 1 });
    expect(
      screen.getByText(/Round 3 of the First Age\. An age lasts at least 5 rounds/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Propose/ })).toBeNull();
  });

  it('lets a god propose it from the fifth round', async () => {
    const changed = await show({ round: 7, ageStartedRound: 3 });
    expect(
      screen.getByText(/Round 5 of the First Age\. A majority of the gods can end it/),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Propose the Second Age' }));
    expect(api.proposeNextAge).toHaveBeenCalledWith('w1');
    expect(changed).toHaveBeenCalled();
  });

  it('lets any god begin it after ten rounds', async () => {
    await show({ round: 10, ageStartedRound: 1 });
    await fireEvent.press(screen.getByRole('button', { name: 'Begin the Second Age' }));
    expect(api.proposeNextAge).toHaveBeenCalledWith('w1');
  });

  it('shows an open vote and takes yours', async () => {
    await show({ round: 5, ageStartedRound: 1, proposals: [ageVote({ [g2]: 'yes' })] });
    expect(screen.getByText(/Umbra proposes moving on to the Second Age/)).toBeTruthy();
    expect(screen.getByText(/Yes 1 · No 0 of 3\. It needs 2 yes votes/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Yes, move on'));
    expect(api.castVote).toHaveBeenCalledWith('w1', 'p-age', 'yes');
  });

  it('shows your vote, and none for onlookers', async () => {
    await show({ round: 5, ageStartedRound: 1, proposals: [ageVote({ [g1]: 'no' })] });
    expect(screen.getByLabelText('Not yet').props.accessibilityState).toMatchObject({
      checked: true,
    });
    await show({ round: 5, ageStartedRound: 1, proposals: [ageVote({})] }, null);
    expect(screen.queryByLabelText('Yes, move on')).toBeNull();
  });

  it('says when the next age is agreed, and when this is the last', async () => {
    await show({ round: 6, ageStartedRound: 1, agePending: true });
    expect(screen.getByText(/the Second Age begins when this round ends/)).toBeTruthy();
    await show({ age: 3, round: 30, ageStartedRound: 12 });
    expect(screen.getByText(/This is the last age/)).toBeTruthy();
  });
});

describe('Objections (DOW-53)', () => {
  const attack = base.actions.find((a) => a.intent === 'attack')!;
  const objection: ProposalView = {
    ...ageVote({ [g2]: 'undo', [g3]: 'keep' }),
    id: 'p-obj',
    kind: 'objection',
    targetSeq: attack.seq,
    age: null,
    reason: 'Underhold was under my protection',
    closesAt: '2026-11-04T05:00:00Z',
  };

  it('shows an objection and its votes, and takes yours', async () => {
    await show({ proposals: [objection] });
    expect(
      screen.getByText(/objects to .*’s Command Race: Host of Karak took Underhold/),
    ).toBeTruthy();
    expect(screen.getByText('“Underhold was under my protection”')).toBeTruthy();
    expect(screen.getByText(/Keep 1 · Undo 1 · Coin 0 of 3 · Closes in 4h/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Flip a coin'));
    expect(api.castVote).toHaveBeenCalledWith('w1', 'p-obj', 'coin');
  });

  it('closes a vote whose time is up', async () => {
    const changed = await show({
      proposals: [{ ...objection, closesAt: '2026-11-04T00:30:00Z' }],
    });
    expect(api.closeVote).toHaveBeenCalledWith('w1', 'p-obj');
    expect(changed).toHaveBeenCalled();
  });

  it('shows errors from the server', async () => {
    api.castVote.mockRejectedValueOnce(new Error('That vote is over'));
    await show({ proposals: [objection] });
    await fireEvent.press(screen.getByLabelText('Keep it'));
    expect(await screen.findByText('That vote is over')).toBeTruthy();
  });
});

describe('Objecting from the feed (DOW-53)', () => {
  const attack = base.actions.find((a) => a.intent === 'attack')!;
  const someoneElse = gods.find((g) => g.id !== attack.godId)!;
  const feed = (props: { myId: string; hours?: number; view?: GameView }) =>
    render(
      <FeedCard
        worldId="w1"
        action={attack}
        view={props.view ?? base}
        gods={gods}
        members={[]}
        myId={props.myId}
        comments={[]}
        reactions={[]}
        now={now}
        objectionHours={props.hours ?? 12}
        onChanged={jest.fn()}
        onOpenEntity={jest.fn()}
        onOpenHex={jest.fn()}
      />,
    );

  it('lets another god object, with a reason', async () => {
    await feed({ myId: someoneElse.user_id });
    await fireEvent.press(screen.getByRole('button', { name: 'Object (closes in 11h)' }));
    await fireEvent.changeText(screen.getByLabelText('Why do you object?'), 'Too soon');
    await fireEvent.press(screen.getByRole('button', { name: 'Object' }));
    expect(api.objectToAction).toHaveBeenCalledWith('w1', attack.seq, 'Too soon');
  });

  it('not for your own action, once the window has closed, or when objections are off', async () => {
    const actor = gods.find((g) => g.id === attack.godId)!;
    await feed({ myId: actor.user_id });
    expect(screen.queryByRole('button', { name: /^Object/ })).toBeNull();
    await feed({ myId: someoneElse.user_id, hours: 0 });
    expect(screen.queryByRole('button', { name: /^Object/ })).toBeNull();
    await feed({ myId: someoneElse.user_id, hours: 1 });
    expect(screen.queryByRole('button', { name: /^Object/ })).toBeNull();
  });

  it('shows an open or settled objection instead', async () => {
    const objection: ProposalView = {
      ...ageVote({ [g2]: 'undo' }),
      kind: 'objection',
      targetSeq: attack.seq,
      reason: 'Too soon',
    };
    await feed({ myId: someoneElse.user_id, view: { ...base, proposals: [objection] } });
    expect(screen.getByText('The gods are voting: vote on the world screen.')).toBeTruthy();
    await feed({
      myId: someoneElse.user_id,
      view: { ...base, proposals: [{ ...objection, status: 'kept', coin: 1 }] },
    });
    expect(screen.getByText('Kept on a coin flip.')).toBeTruthy();
  });

  it('marks an action undone because it built on another', async () => {
    const hill = base.actions[base.actions.length - 1];
    const undone = { ...attack, retconned: true, undoneBecauseOf: hill.seq };
    await render(
      <FeedCard
        worldId="w1"
        action={undone}
        view={base}
        gods={gods}
        members={[]}
        myId="u-x"
        comments={[]}
        reactions={[]}
        now={now}
        objectionHours={12}
        onChanged={jest.fn()}
        onOpenEntity={jest.fn()}
        onOpenHex={jest.fn()}
      />,
    );
    expect(
      screen.getByText(/Undone along with “Hills”, which it built on; its cost was refunded\./),
    ).toBeTruthy();
  });
});
