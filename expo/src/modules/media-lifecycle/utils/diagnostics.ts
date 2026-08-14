/**
 * Development-only diagnostics for the IVX media lifecycle.
 *
 * Events are recorded in the Zustand store but logging is suppressed in
 * production to avoid noise and sensitive data exposure.
 */
import { useMediaLifecycleStore } from '../store';
import type { MediaLifecycleState, MediaPlayerState, MediaScope, MediaType } from '../types';

const MAX_EVENTS = 500;

export function recordLifecycleEvent(
  mediaId: string,
  scope: MediaScope,
  mediaType: MediaType,
  event: string,
  details?: {
    visibilityPercent?: number;
    lifecycleState?: MediaLifecycleState;
    playerState?: MediaPlayerState;
    downloadState?: 'none' | 'queued' | 'loading' | 'loaded' | 'error' | 'cancelled';
    cacheState?: 'none' | 'memory' | 'disk' | 'network';
    error?: string;
    latencyMs?: number;
  },
): void {
  const store = useMediaLifecycleStore.getState();
  const entry = {
    mediaId,
    scope,
    mediaType,
    event,
    timestamp: Date.now(),
    ...details,
  };
  store.recordEvent(entry);

  const isDev = typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : false;
  if (isDev) {
    // Keep console traffic low to avoid Metro flooding.
    const events = store.events;
    if (events.length > MAX_EVENTS) {
      store.events = events.slice(-MAX_EVENTS);
    }
  }
}

export function getMediaLifecycleEvents() {
  return useMediaLifecycleStore.getState().events.slice(-50);
}
