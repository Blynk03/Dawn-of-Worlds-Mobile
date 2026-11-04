import { subscribeToWorld } from '../api';

/**
 * Mimics @supabase/realtime-js: `channel(name)` returns the existing channel when the name is
 * already in use, and adding listeners after `subscribe()` throws. That combination crashed the
 * app when the god editor opened on top of the lobby (both subscribe to the same world).
 */
jest.mock('@/lib/supabase', () => {
  const channels = new Map<string, { subscribed: boolean }>();
  const makeChannel = (name: string) => {
    const state = channels.get(name) ?? { subscribed: false };
    channels.set(name, state);
    const channel = {
      name,
      on: () => {
        if (state.subscribed) {
          throw new Error(
            `cannot add \`postgres_changes\` callbacks for ${name} after \`subscribe()\`.`,
          );
        }
        return channel;
      },
      subscribe: () => {
        state.subscribed = true;
        return channel;
      },
    };
    return channel;
  };
  return {
    supabase: {
      channel: jest.fn((name: string) => makeChannel(name)),
      removeChannel: jest.fn(),
      __channels: channels,
    },
  };
});

const { supabase } = jest.requireMock('@/lib/supabase');

describe('subscribeToWorld', () => {
  it('lets two screens watch the same world at once (lobby + god editor)', () => {
    const unsubscribeLobby = subscribeToWorld('w1', jest.fn());
    expect(() => subscribeToWorld('w1', jest.fn())).not.toThrow();
    const names = supabase.channel.mock.calls.map((c: [string]) => c[0]);
    expect(new Set(names).size).toBe(names.length);
    unsubscribeLobby();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('never throws, even if live updates fail', () => {
    supabase.channel.mockImplementationOnce(() => {
      throw new Error('realtime unavailable');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const unsubscribe = subscribeToWorld('w2', jest.fn());
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
