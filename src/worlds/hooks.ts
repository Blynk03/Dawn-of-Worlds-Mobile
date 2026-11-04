import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getLobby, listMyWorlds, type Lobby, subscribeToWorld, type WorldSummary } from './api';

type Loadable<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

/** Loads data when the screen comes into focus, with a manual refresh. */
function useFocusedLoad<T>(load: () => Promise<T>): Loadable<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const request = ++latest.current;
    setLoading(true);
    load().then(
      (result) => {
        if (request !== latest.current) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (request !== latest.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
  }, [load]);

  useFocusEffect(refresh);
  return { data, error, loading, refresh };
}

export function useMyWorlds(): Loadable<WorldSummary[]> {
  return useFocusedLoad(listMyWorlds);
}

/** A world's lobby, kept up to date live as friends join and create gods. */
export function useLobby(worldId: string): Loadable<Lobby | null> {
  const load = useCallback(() => getLobby(worldId), [worldId]);
  const lobby = useFocusedLoad(load);
  const { refresh } = lobby;
  useEffect(() => subscribeToWorld(worldId, refresh), [worldId, refresh]);
  return lobby;
}
