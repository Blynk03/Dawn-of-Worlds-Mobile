import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { loadSocial, loadUnreadCounts, type Social, subscribeToSocial } from './social';

const EMPTY: Social = { comments: [], reactions: [] };

/** Live comments and reactions for a world's feed. */
export function useSocial(worldId: string) {
  const [social, setSocial] = useState<Social>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadSocial(worldId).then(
      (next) => {
        setSocial(next);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [worldId]);

  useFocusEffect(refresh);
  useEffect(() => subscribeToSocial(worldId, refresh), [worldId, refresh]);

  return { ...social, error, refresh };
}

/** Unread counts per world, refreshed whenever the screen comes into focus. */
export function useUnreadCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useFocusEffect(
    useCallback(() => {
      // A missing count isn't worth an error message; the badge just doesn't show.
      loadUnreadCounts().then(setCounts, () => {});
    }, []),
  );
  return counts;
}
