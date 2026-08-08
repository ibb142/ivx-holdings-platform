/**
 * ViewportTracker — reusable FlatList viewport integration for the media lifecycle.
 *
 * Combines onViewableItemsChanged, scroll-velocity detection, and scope focus
 * lifecycle into a single helper. The child FlatList is cloned and given the
 * required callbacks, while the parent retains full control over its data.
 */
import React, { useCallback, useRef } from 'react';
import { FlatList, type FlatListProps, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAppForeground } from '@/hooks/useAppForeground';
import { mediaLifecycleController } from '../controller';
import { useMediaLifecycleViewport } from '../hooks';
import type { MediaScope, MediaType } from '../types';

interface ViewportTrackerProps<ItemT> extends Omit<FlatListProps<ItemT>, 'onViewableItemsChanged' | 'viewabilityConfig'> {
  scope: MediaScope;
  module: string;
  flatListRef?: React.Ref<FlatList<ItemT>>;
  /** Called with the item and its index; should return a stable media id. */
  extractMediaId?: (item: ItemT, index: number) => string | null;
  extractMediaType?: (item: ItemT, index: number) => MediaType;
  extractSourceUrl?: (item: ItemT, index: number) => string | null;
  extractThumbnailUrl?: (item: ItemT, index: number) => string | null;
  extractFullResolutionUrl?: (item: ItemT, index: number) => string | null;
  extractContainerId?: (item: ItemT, index: number) => string | null;
  /** Viewability percent threshold for the primary item. */
  viewabilityPercentThreshold?: number;
  /** Existing onScroll callback to preserve. */
  onScrollOriginal?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Existing onViewableItemsChanged callback to preserve. */
  onViewableItemsChanged?: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
}

export const ViewportTracker = React.memo(function ViewportTracker<ItemT>(props: ViewportTrackerProps<ItemT>) {
  const {
    scope,
    module,
    flatListRef,
    extractMediaId,
    extractMediaType,
    extractSourceUrl,
    extractThumbnailUrl,
    extractFullResolutionUrl,
    extractContainerId,
    viewabilityPercentThreshold = 70,
    onScrollOriginal,
    onViewableItemsChanged: originalOnViewableItemsChanged,
    ...flatListProps
  } = props;

  const { registerAll, handleViewableItemsChanged, handleScroll } = useMediaLifecycleViewport({
    scope,
    module,
    keyExtractor: (item, index) => extractMediaId?.(item as ItemT, index) ?? `${scope}:${index}`,
    getMediaType: (item, index) => extractMediaType?.(item as ItemT, index) ?? 'image',
    getSourceUrl: (item, index) => extractSourceUrl?.(item as ItemT, index) ?? null,
    getThumbnailUrl: (item, index) => extractThumbnailUrl?.(item as ItemT, index) ?? null,
    getFullResolutionUrl: (item, index) => extractFullResolutionUrl?.(item as ItemT, index) ?? null,
    getContainerId: (item, index) => extractContainerId?.(item as ItemT, index) ?? null,
  });

  const itemsRef = useRef<readonly ItemT[]>(flatListProps.data ?? []);
  itemsRef.current = flatListProps.data ?? [];

  const registerOnDataChange = useCallback(() => {
    registerAll(itemsRef.current as unknown[]);
  }, [registerAll]);

  // Register items whenever the data changes.
  React.useEffect(() => {
    registerOnDataChange();
  }, [registerOnDataChange]);

  useFocusEffect(
    React.useCallback(() => {
      mediaLifecycleController.resumeScope(scope);
      return () => {
        mediaLifecycleController.suspendScope(scope);
      };
    }, [scope]),
  );

  const isAppForeground = useAppForeground();
  React.useEffect(() => {
    if (!isAppForeground) {
      mediaLifecycleController.releaseScope(scope);
    } else {
      mediaLifecycleController.resumeScope(scope);
    }
  }, [isAppForeground, scope]);

  const combinedOnViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      handleViewableItemsChanged({ viewableItems: info.viewableItems });
      originalOnViewableItemsChanged?.(info);
    },
    [handleViewableItemsChanged, originalOnViewableItemsChanged],
  );

  const combinedOnScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleScroll(event);
      onScrollOriginal?.(event);
    },
    [handleScroll, onScrollOriginal],
  );

  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: viewabilityPercentThreshold }).current;

  return (
    <FlatList
      ref={flatListRef}
      {...flatListProps}
      onViewableItemsChanged={combinedOnViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onScroll={combinedOnScroll}
    />
  );
}) as <ItemT>(props: ViewportTrackerProps<ItemT>) => React.ReactElement;
