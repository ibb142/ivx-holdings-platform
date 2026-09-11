import { useCallback, useContext, useSyncExternalStore } from 'react';
import { NavigationContext } from '@react-navigation/native';

// Providers outside a screen remain active; retained stack screens pause work on blur.
export function useScreenActivity(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback((notify: () => void) => {
    if (!navigation) return () => {};
    const focus = navigation.addListener('focus', notify);
    const blur = navigation.addListener('blur', notify);
    return () => { focus(); blur(); };
  }, [navigation]);
  const snapshot = useCallback(() => navigation?.isFocused() ?? true, [navigation]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
