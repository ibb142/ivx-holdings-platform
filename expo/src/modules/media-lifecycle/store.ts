/**
 * Zustand store for the IVX Global Media Lifecycle system.
 *
 * Holds the canonical registry of every tracked media item and exposes
 * imperative actions used by the controller. React components subscribe to
 * this store via `useMediaLifecycleItem` and friends.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  MediaBufferState,
  MediaCacheState,
  MediaDownloadState,
  MediaLifecycleItem,
  MediaLifecycleState,
  MediaLifecycleTelemetryEvent,
  MediaPlayerState,
  MediaScope,
  MediaType,
} from './types';

export interface MediaLifecycleStateValue {
  items: Record<string, MediaLifecycleItem>;
  events: MediaLifecycleTelemetryEvent[];
  activeVideoId: string | null;
  lastScopeFocus: Record<MediaScope, boolean>;
}

interface MediaLifecycleActions {
  registerMedia: (item: MediaLifecycleItem) => void;
  unregisterMedia: (mediaId: string) => void;
  setVisibility: (mediaId: string, percent: number) => void;
  setLifecycle: (mediaId: string, state: MediaLifecycleState) => void;
  setDownload: (mediaId: string, state: MediaDownloadState) => void;
  setCache: (mediaId: string, state: MediaCacheState) => void;
  setPlayer: (mediaId: string, state: MediaPlayerState) => void;
  setBuffer: (mediaId: string, state: MediaBufferState) => void;
  setActive: (mediaId: string, active: boolean) => void;
  setError: (mediaId: string, error: string | null) => void;
  setPrefetched: (mediaId: string, prefetched: boolean) => void;
  incrementRetry: (mediaId: string) => void;
  setFirstFrame: (mediaId: string) => void;
  setLoadStarted: (mediaId: string) => void;
  setActiveVideo: (mediaId: string | null) => void;
  setScopeFocus: (scope: MediaScope, focused: boolean) => void;
  recordEvent: (event: MediaLifecycleTelemetryEvent) => void;
  clearReleased: () => void;
  bumpGeneration: (mediaId: string) => void;
  markAborted: (mediaId: string, aborted: boolean) => void;
}

export type MediaLifecycleStore = MediaLifecycleStateValue & MediaLifecycleActions;

function createDefaultItem(mediaId: string, scope: MediaScope, module: string, mediaType: MediaType): MediaLifecycleItem {
  return {
    mediaId,
    scope,
    module,
    mediaType,
    sourceUrl: null,
    thumbnailUrl: null,
    fullResolutionUrl: null,
    visibilityPercent: 0,
    lifecycleState: 'idle',
    downloadState: 'none',
    cacheState: 'none',
    playerState: 'none',
    bufferState: 'none',
    isActive: false,
    isPrefetched: false,
    lastVisibleAt: 0,
    lastActivatedAt: 0,
    loadStartedAt: 0,
    firstFrameAt: 0,
    error: null,
    retryCount: 0,
    mountGeneration: 0,
    aborted: false,
  };
}

export const useMediaLifecycleStore = create<MediaLifecycleStore>()(
  devtools(
    (set, get) => ({
      items: {},
      events: [],
      activeVideoId: null,
      lastScopeFocus: {
        reels: true,
        home: true,
        profile: true,
        search: true,
        chat: true,
        inbox: true,
        other: true,
      },

      registerMedia: (item) => {
        set((state) => ({
          items: {
            ...state.items,
            [item.mediaId]: { ...(state.items[item.mediaId] ?? createDefaultItem(item.mediaId, item.scope, item.module, item.mediaType)), ...item },
          },
        }));
      },

      unregisterMedia: (mediaId) => {
        set((state) => {
          const next = { ...state.items };
          delete next[mediaId];
          return { items: next };
        });
      },

      setVisibility: (mediaId, percent) => {
        const now = Date.now();
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          const isVisible = percent > 0;
          return {
            items: {
              ...state.items,
              [mediaId]: {
                ...existing,
                visibilityPercent: percent,
                lastVisibleAt: isVisible ? now : existing.lastVisibleAt,
                lifecycleState: percent > 0 ? (existing.lifecycleState === 'released' ? 'visible' : existing.lifecycleState) : existing.lifecycleState,
              },
            },
          };
        });
      },

      setLifecycle: (mediaId, lifecycleState) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, lifecycleState } },
          };
        });
      },

      setDownload: (mediaId, downloadState) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, downloadState } },
          };
        });
      },

      setCache: (mediaId, cacheState) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, cacheState } },
          };
        });
      },

      setPlayer: (mediaId, playerState) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, playerState } },
          };
        });
      },

      setBuffer: (mediaId, bufferState) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, bufferState } },
          };
        });
      },

      setActive: (mediaId, active) => {
        const now = Date.now();
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: {
              ...state.items,
              [mediaId]: {
                ...existing,
                isActive: active,
                lastActivatedAt: active ? now : existing.lastActivatedAt,
              },
            },
          };
        });
      },

      setError: (mediaId, error) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, error, lifecycleState: error ? 'error' : existing.lifecycleState } },
          };
        });
      },

      setPrefetched: (mediaId, prefetched) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, isPrefetched: prefetched } },
          };
        });
      },

      incrementRetry: (mediaId) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, retryCount: existing.retryCount + 1 } },
          };
        });
      },

      setFirstFrame: (mediaId) => {
        const now = Date.now();
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, firstFrameAt: now, bufferState: 'ready' } },
          };
        });
      },

      setLoadStarted: (mediaId) => {
        const now = Date.now();
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, loadStartedAt: now, downloadState: 'loading' } },
          };
        });
      },

      setActiveVideo: (mediaId) => {
        set({ activeVideoId: mediaId });
      },

      setScopeFocus: (scope, focused) => {
        set((state) => ({
          lastScopeFocus: { ...state.lastScopeFocus, [scope]: focused },
        }));
      },

      recordEvent: (event) => {
        set((state) => ({
          events: [...state.events.slice(-499), event],
        }));
      },

      clearReleased: () => {
        set((state) => {
          const next: Record<string, MediaLifecycleItem> = {};
          for (const [id, item] of Object.entries(state.items)) {
            if (item.lifecycleState !== 'released') next[id] = item;
          }
          return { items: next };
        });
      },

      bumpGeneration: (mediaId) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, mountGeneration: existing.mountGeneration + 1 } },
          };
        });
      },

      markAborted: (mediaId, aborted) => {
        set((state) => {
          const existing = state.items[mediaId];
          if (!existing) return state;
          return {
            items: { ...state.items, [mediaId]: { ...existing, aborted } },
          };
        });
      },
    }),
    { name: 'media-lifecycle-store', enabled: typeof __DEV__ !== 'undefined' ? __DEV__ : false },
  ),
);
