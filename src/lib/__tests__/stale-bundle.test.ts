import { isStaleBundleError, reloadForUpdate } from '../stale-bundle';

describe('isStaleBundleError', () => {
  it('recognises a screen file missing after an update', () => {
    for (const message of [
      'Loading module https://blynk03.github.io/Dawn-of-Worlds-Mobile/_expo/static/js/web/chronicle-3139.js failed.',
      'Loading chunk 42 failed.',
      'Failed to fetch dynamically imported module: https://x/y.js',
      'Importing a module script failed.',
    ]) {
      expect(isStaleBundleError(new Error(message))).toBe(true);
    }
    expect(isStaleBundleError({ name: 'ChunkLoadError', message: '' })).toBe(true);
  });

  it('leaves other errors alone', () => {
    expect(isStaleBundleError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleBundleError(null)).toBe(false);
  });
});

describe('reloadForUpdate', () => {
  const store = () => {
    const data: Record<string, string> = {};
    return {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
    };
  };

  it('reloads once, not again within a minute', () => {
    const reload = jest.fn();
    const storage = store();
    expect(reloadForUpdate({ reload, storage, now: 1_000_000 })).toBe(true);
    expect(reloadForUpdate({ reload, storage, now: 1_030_000 })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForUpdate({ reload, storage, now: 1_070_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('reloads even without storage', () => {
    const reload = jest.fn();
    expect(reloadForUpdate({ reload, storage: null, now: 1 })).toBe(true);
    expect(reload).toHaveBeenCalled();
  });
});
