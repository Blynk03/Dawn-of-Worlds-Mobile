// After a new version of the web app is published, a browser tab that was already open still has
// the old code, which asks for screen files that no longer exist ("Loading module … failed").
// Reloading the page fetches the new version.

const STALE_PATTERNS = [
  /Loading module .* failed/i,
  /Loading chunk .* failed/i,
  /ChunkLoadError/,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

/** Whether an error means this tab is running an older version of the web app. */
export function isStaleBundleError(error: { name?: string; message?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.name ?? ''} ${error.message ?? ''}`;
  return STALE_PATTERNS.some((p) => p.test(text));
}

const KEY = 'dow-reloaded-for-update';

type Env = {
  reload: () => void;
  storage: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
  } | null;
  now: number;
};

/**
 * Reloads the page once to pick up the new version. Returns false (and doesn't reload) if it
 * already did so in the last minute, so a real outage can't cause a reload loop.
 */
export function reloadForUpdate(env: Env): boolean {
  try {
    const last = env.storage?.getItem(KEY);
    if (last && env.now - Number(last) < 60_000) return false;
    env.storage?.setItem(KEY, String(env.now));
  } catch {
    // Storage can be unavailable (private browsing); reload anyway.
  }
  env.reload();
  return true;
}
