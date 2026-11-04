import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { loadGameEvents, subscribeToGameEvents } from './api';
import { applyEvent, EMPTY_GAME, type GameView, projectWorld } from './project';

/**
 * The live game view for a world: loads the log when the screen is focused, then applies new
 * events as they arrive. Realtime can miss events (e.g. while the app was in the background), so
 * a refresh fetches anything after the last applied seq.
 */
export function useGame(worldId: string, enabled: boolean) {
  const [view, setView] = useState<GameView>(EMPTY_GAME);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Latest seq for refresh() without re-creating it on every event.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const refresh = useCallback(() => {
    if (!enabled) return;
    loadGameEvents(worldId, viewRef.current.lastSeq).then(
      (events) => {
        setView((current) => projectWorld(events, current));
        setError(null);
        setLoaded(true);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      },
    );
  }, [worldId, enabled]);

  useFocusEffect(refresh);

  useEffect(() => {
    if (!enabled) return;
    return subscribeToGameEvents(worldId, (event) => {
      setView((current) => {
        // A gap means we missed something: fetch the missing events instead of guessing.
        if (event.seq > current.lastSeq + 1) {
          refresh();
          return current;
        }
        return applyEvent(current, event);
      });
    });
  }, [worldId, enabled, refresh]);

  return { view, error, loaded, refresh };
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
