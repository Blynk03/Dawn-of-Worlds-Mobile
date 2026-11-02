import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const subscribe = () => () => {};

/**
 * Web needs to render 'light' during static rendering and switch to the real scheme once
 * hydrated on the client, otherwise server and client markup won't match.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const colorScheme = useRNColorScheme();
  return hasHydrated ? colorScheme : 'light';
}
