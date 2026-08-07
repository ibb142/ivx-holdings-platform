/**
 * React hooks for the IVX Global Media Lifecycle system.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewToken } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAppForeground } from '@/hooks/useAppForeground';
import { mediaLifecycleController } from './controller';
import { useMediaLifecycleStore } from './store';
import type { MediaScope, MediaType } from './types';
import { recordLifecycleEvent } from './utils/diagnostics';

export function useMediaLifecycleItem(mediaId: string) {
  return useMediaLifecycleStore((state) => state.items[mediaId]);
}

export function useMediaLifecycleActiveVideo() {
  return useMediaLifecycleStore((state) => state.activeVideoId);
}

export function useMediaLifecycleScopeFocused(scope: MediaScope) {
  return useMediaLifecycleStore((state) => state.lastScopeFocus[scope] ?? true);
}

export function useMediaLifecycleDiagnostics() {
  return useMediaLifecycleStore((state) => ({
    totalItems: Object.keys(state.items).length,
    activeItems: Object.values(state.items).filter((i) => i.isActive).length,
    visibleItems: Object.values(state.items).filter((i) => i.visibilityPercent > 0).length,
    prefetchingItems: Object.values(state.items).filter((i) => i.lifecycleState === 'prefetching').length,
    errorItems: Object.values(state.items).filter((i) => i.lifecycleState === 'error').length,
    releasedItems: Object.values(state.items).filter((i) => i.lifecycleState === 'released').length,
    activeVideoId: state.activeVideoId,
  }));
}

export interface UseMediaLifecycleViewportOptions {
  scope: MediaScope;
  /** Extract a stable media ID from the list item. If omitted, index is used. */
  keyExtractor?: (item: unknown, index: number) => string;
  /** Return the media type for the item at this index. */
  getMediaType?: (item: unknown, index: number) => MediaType;
  /** Return the primary source URL for the item. */
  getSourceUrl?: (item: unknown, index: number) => string | null;
  /** Return a thumbnail URL for the item. */
  getThumbnailUrl?: (item: unknown, index: number) => string | null;
  /** Return a full-resolution URL for the item. */
  getFullResolutionUrl?: (item: unknown, index: number) => string | null;
  /** Return the post/message ID for grouping. */
  getContainerId?: (item: unknown, index: number) => string | null;
  module?: string;
}

export function useMediaLifecycleViewport(options: UseMediaLifecycleViewportOptions) {
  const {
    scope,
    keyExtractor,
    getMediaType = () => 'image',
    getSourceUrl = () => null,
    getThumbnailUrl = () => null,
    getFullResolutionUrl = () => null,
    getContainerId = () => null,
    module = 'default',
  } = options;

  const registerAll = useCallback(
    (items: unknown[]) => {
      items.forEach((item, index) => {
        const mediaId = keyExtractor?.(item, index) ?? `${scope}:${index}`;
        mediaLifecycleController.registerMedia(
          mediaId,
          scope,
          module,
          getMediaType(item, index),
          getSourceUrl(item, index),
          getThumbnailUrl(item, index),
          getFullResolutionUrl(item, index),
          getContainerId(item, index),
          getContainerId(item, index),
        );
      });
    },
    [scope, module, keyExtractor, getMediaType, getSourceUrl, getThumbnailUrl, getFullResolutionUrl, getContainerId],
  );

  const handleViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[] }) => {
      const viewportItems = info.viewableItems.map((vt) => ({
        index: vt.index ?? 0,
        item: vt.item,
        isViewable: vt.isViewable,
        percentVisible: vt.percent ?? 0,
      }));
      mediaLifecycleController.processViewport(scope, viewportItems);
    },
    [scope],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      mediaLifecycleController.updateScroll(offset);
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      mediaLifecycleController.resumeScope(scope);
      return () => {
        mediaLifecycleController.suspendScope(scope);
      };
    }, [scope]),
  );

  const isAppForeground = useAppForeground();
  useEffect(() => {
    if (!isAppForeground) {
      mediaLifecycleController.releaseScope(scope);
      recordLifecycleEvent(scope, scope, 'unknown', 'app_background_released');
    } else {
      mediaLifecycleController.resumeScope(scope);
    }
  }, [isAppForeground, scope]);

  return useMemo(
    () => ({
      registerAll,
      handleViewableItemsChanged,
      handleScroll,
    }),
    [registerAll, handleViewableItemsChanged, handleScroll],
  );
}

export function useMediaLifecycleList(
  scope: MediaScope,
  items: unknown[],
  options: Omit<UseMediaLifecycleViewportOptions, 'scope' | 'items'>,
) {
  const keyExtractor = options.keyExtractor;
  const getMediaType = options.getMediaType ?? (() => 'image' as const);
  const getSourceUrl = options.getSourceUrl ?? (() => null);
  const getThumbnailUrl = options.getThumbnailUrl ?? (() => null);
  const getFullResolutionUrl = options.getFullResolutionUrl ?? (() => null);
  const getContainerId = options.getContainerId ?? (() => null);
  const module = options.module ?? 'default';

  const registerAll = useCallback(
    (list: unknown[]) => {
      list.forEach((item, index) => {
        const mediaId = keyExtractor?.(item, index) ?? `${scope}:${index}`;
        mediaLifecycleController.registerMedia(
          mediaId,
          scope,
          module,
          getMediaType(item, index),
          getSourceUrl(item, index),
          getThumbnailUrl(item, index),
          getFullResolutionUrl(item, index),
          getContainerId(item, index),
          getContainerId(item, index),
        );
      });
    },
    [scope, module, keyExtractor, getMediaType, getSourceUrl, getThumbnailUrl, getFullResolutionUrl, getContainerId],
  );

  useEffect(() => {
    registerAll(items);
  }, [items, registerAll]);

  useFocusEffect(
    useCallback(() => {
      mediaLifecycleController.resumeScope(scope);
      return () => {
        mediaLifecycleController.suspendScope(scope);
      };
    }, [scope]),
  );

  const isAppForeground = useAppForeground();
  useEffect(() => {
    if (!isAppForeground) {
      mediaLifecycleController.releaseScope(scope);
      recordLifecycleEvent(scope, scope, 'unknown', 'app_background_released');
    } else {
      mediaLifecycleController.resumeScope(scope);
    }
  }, [isAppForeground, scope]);

  const handleViewableItemsChanged = useCallback(
    (info: { viewableItems: Array<{ index: number | null; item: unknown; isViewable: boolean; percent?: number }> }) => {
      const viewportItems = info.viewableItems.map((vt) => ({
        index: vt.index ?? 0,
        item: vt.item,
        isViewable: vt.isViewable,
        percentVisible: vt.percent ?? 0,
      }));
      mediaLifecycleController.processViewport(scope, viewportItems);
    },
    [scope],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      mediaLifecycleController.updateScroll(offset);
    },
    [],
  );

  return useMemo(
    () => ({
      handleViewableItemsChanged,
      handleScroll,
    }),
    [handleViewableItemsChanged, handleScroll],
  );
}

export function useMediaLifecycleRegister(
  mediaId: string,
  scope: MediaScope,
  module: string,
  mediaType: MediaType,
  sourceUrl: string | null,
  thumbnailUrl: string | null,
  fullResolutionUrl?: string | null,
  postId?: string | null,
  messageId?: string | null,
) {
  const registeredRef = useRef(false);

  useEffect(() => {
    if (registeredRef.current) {
      mediaLifecycleController.bumpGeneration(mediaId);
    }
    mediaLifecycleController.registerMedia(
      mediaId,
      scope,
      module,
      mediaType,
      sourceUrl,
      thumbnailUrl,
      fullResolutionUrl,
      postId,
      messageId,
    );
    registeredRef.current = true;
    return () => {
      // Do not unregister immediately on every recycle; the controller will
      // release far-off items. Unregister only on true unmount handled by
      // the viewport registry.
    };
  }, [mediaId, scope, module, mediaType, sourceUrl, thumbnailUrl, fullResolutionUrl, postId, messageId]);
}

export function useMediaLifecycleIsActive(mediaId: string): boolean {
  return useMediaLifecycleStore((state) => state.items[mediaId]?.isActive ?? false);
}

export function useMediaLifecycleShouldPlay(mediaId: string): boolean {
  return useMediaLifecycleStore(
    (state) => state.items[mediaId]?.isActive === true && state.items[mediaId]?.lifecycleState === 'active',
  );
}

export function useMediaLifecycleShouldMountPlayer(mediaId: string): boolean {
  return useMediaLifecycleStore((state) => {
    const item = state.items[mediaId];
    if (!item) return false;
    return item.lifecycleState !== 'released' && item.playerState !== 'none' && item.playerState !== 'released';
  });
}

export function useMediaLifecycleShouldLoadFullImage(mediaId: string): boolean {
  return useMediaLifecycleStore((state) => {
    const item = state.items[mediaId];
    if (!item) return false;
    return item.visibilityPercent > 0;
  });
}

export { mediaLifecycleController } from './controller';
