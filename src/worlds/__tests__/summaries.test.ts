import { friendlyError } from '../errors';
import {
  canStart,
  playersWithoutGods,
  sortWorldsForHome,
  worldAction,
  worldStatusLabel,
} from '../summaries';

const me = 'me';
const member = (user_id: string, role: 'host' | 'player' = 'player', is_gm = false) => ({
  user_id,
  role,
  is_gm,
});
const god = (user_id: string) => ({ user_id });

function world(
  status: 'lobby' | 'active' | 'finished',
  members: ReturnType<typeof member>[],
  gods: ReturnType<typeof god>[],
  updated_at = '2026-11-03T00:00:00Z',
) {
  return { status, updated_at, world_members: members, gods };
}

describe('start conditions', () => {
  it('needs at least 2 gods and a god for every non-GM player', () => {
    const members = [member(me, 'host'), member('bob')];
    expect(canStart(members, [god(me)])).toBe(false);
    expect(canStart(members, [god(me), god('bob')])).toBe(true);
    expect(canStart([...members, member('carol')], [god(me), god('bob')])).toBe(false);
  });

  it('lets a GM run the world without a god', () => {
    const members = [member(me, 'host', true), member('bob'), member('carol')];
    expect(playersWithoutGods(members, [god('bob'), god('carol')])).toEqual([]);
    expect(canStart(members, [god('bob'), god('carol')])).toBe(true);
  });
});

describe('worldAction', () => {
  it('asks you to create a god first', () => {
    expect(worldAction(world('lobby', [member(me)], []), me)).toBe('createGod');
  });
  it('tells the host when the game can start', () => {
    const w = world('lobby', [member(me, 'host'), member('bob')], [god(me), god('bob')]);
    expect(worldAction(w, me)).toBe('startGame');
    expect(worldAction(w, 'bob')).toBe('waitingForPlayers');
  });
  it('reports active and finished worlds', () => {
    expect(worldAction(world('active', [member(me)], [god(me)]), me)).toBe('playing');
    expect(worldAction(world('finished', [member(me)], [god(me)]), me)).toBe('finished');
  });
});

describe('your turn', () => {
  const active = (activeGodOwner: string) => ({
    status: 'active' as const,
    updated_at: '2026-11-01T00:00:00Z',
    world_members: [member(me), member('bob')],
    gods: [
      { id: 'g-me', user_id: me },
      { id: 'g-bob', user_id: 'bob' },
    ],
    world_state: {
      round: 3,
      turn_order: activeGodOwner === me ? ['g-me', 'g-bob'] : ['g-bob', 'g-me'],
      active_position: 1,
    },
  });

  it('detects when the active god is yours', () => {
    expect(worldAction(active(me), me)).toBe('yourTurn');
    expect(worldAction(active('bob'), me)).toBe('playing');
    expect(worldStatusLabel(active(me), me)).toBe('Your turn · Round 3');
    expect(worldStatusLabel(active('bob'), me)).toBe('In play · Round 3 · 2 players');
  });

  it('puts your turn above everything else', () => {
    const needGod = { ...world('lobby', [member(me)], [], '2026-11-09T00:00:00Z'), id: 'god' };
    const mine = { ...active(me), id: 'turn' };
    expect(sortWorldsForHome([needGod, mine], me).map((w) => w.id)).toEqual(['turn', 'god']);
  });
});

describe('sortWorldsForHome', () => {
  it('puts worlds that need you first, newest first within a group', () => {
    const waiting = {
      ...world('lobby', [member(me), member('h', 'host')], [god(me)]),
      id: 'waiting',
    };
    const needGodOld = { ...world('lobby', [member(me)], [], '2026-11-01T00:00:00Z'), id: 'old' };
    const needGodNew = { ...world('lobby', [member(me)], [], '2026-11-02T00:00:00Z'), id: 'new' };
    const playing = { ...world('active', [member(me)], [god(me)]), id: 'playing' };
    const finished = { ...world('finished', [member(me)], [god(me)]), id: 'finished' };
    const sorted = sortWorldsForHome([finished, waiting, playing, needGodOld, needGodNew], me);
    expect(sorted.map((w) => w.id)).toEqual(['new', 'old', 'playing', 'waiting', 'finished']);
  });
});

describe('worldStatusLabel', () => {
  it('describes the world for the home screen', () => {
    expect(worldStatusLabel(world('lobby', [member(me)], []), me)).toBe(
      'Lobby · 1 player · Create your god',
    );
    expect(worldStatusLabel(world('active', [member(me), member('b')], []), me)).toBe(
      'In play · 2 players',
    );
  });
});

describe('friendlyError', () => {
  it('translates constraint names', () => {
    expect(
      friendlyError({
        message: 'duplicate key value violates unique constraint "gods_world_id_color_key"',
      }),
    ).toBe('Another god already uses that color.');
  });
  it('passes through messages from our own database functions', () => {
    expect(friendlyError({ message: 'That world has already started' })).toBe(
      'That world has already started',
    );
  });
  it('handles network failures', () => {
    expect(friendlyError(new TypeError('Network request failed'))).toMatch(/connection/);
  });
});
