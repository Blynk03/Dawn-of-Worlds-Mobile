import {
  formatInviteCode,
  inviteLink,
  inviteMessage,
  isValidInviteCode,
  normalizeInviteCode,
  savePendingInvite,
  takePendingInvite,
} from '../invite';

describe('invite codes', () => {
  it('normalizes loosely typed codes', () => {
    expect(normalizeInviteCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeInviteCode('ab c2 34')).toBe('ABC234');
  });

  it('validates the 6-character alphabet without look-alikes', () => {
    expect(isValidInviteCode('abc-234')).toBe(true);
    expect(isValidInviteCode('ABC23')).toBe(false);
    expect(isValidInviteCode('ABC2340')).toBe(false);
    expect(isValidInviteCode('ABO234')).toBe(false); // O is excluded
    expect(isValidInviteCode('AB1234')).toBe(false); // 1 is excluded
  });

  it('formats for reading aloud', () => {
    expect(formatInviteCode('abc234')).toBe('ABC-234');
  });

  it('builds a web link and a share message', () => {
    expect(inviteLink('abc-234')).toBe(
      'https://blynk03.github.io/Dawn-of-Worlds-Mobile/join/ABC234',
    );
    const message = inviteMessage('Aerth', 'ABC234');
    expect(message).toContain('"Aerth"');
    expect(message).toContain('ABC-234');
    expect(message).toContain('/join/ABC234');
  });
});

describe('pending invite', () => {
  // On devices, localStorage comes from expo-sqlite's polyfill; tests use an in-memory one.
  beforeAll(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
  });
  beforeEach(() => localStorage.clear());

  it('remembers a code once', () => {
    savePendingInvite('abc-234');
    expect(takePendingInvite()).toBe('ABC234');
    expect(takePendingInvite()).toBeNull();
  });

  it('ignores invalid saved values', () => {
    localStorage.setItem('dow.pendingInvite', 'nonsense');
    expect(takePendingInvite()).toBeNull();
  });
});
