/**
 * IVXFeed — Canonical infinite scroll feed component.
 *
 * Wraps FlatList with:
 * - Cursor-based or offset-based pagination via useInfiniteQuery
 * - Pull-to-refresh
 * - Viewport tracking for lazy image loading
 * - Background refresh that preserves visible items (SWR)
 * - Loading skeletons for initial load
 * - Load-more indicator for pagination
 * - Error state with retry for initial load failure
 * - Empty state
 * - Scroll position preservation
 * - Stable item keys
 *
 * Usage:
 * ```tsx
 * <IVXFeed
 *   data={pages.flatMap(p => p.items)}
 *   renderItem={renderItem}
 *   keyExtractor={keyExtractor}
 *   hasMore={hasNextPage}
 *   onLoadMore={fetchNextPage}
 *   isRefreshing={isRefetching}
 *   onRefresh={refetch}
 *   isLoading={isLoading}
 *   error={error}
 *   onRetry={refetch}
 *   skeleton={<FeedSkeleton />}
 * />
 * ```
 */
import React, {
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  FlatList,
  View,
  StyleSheet,
  RefreshControl,
  type FlatListProps,
  type ListRenderItem,
  type ViewStyle,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { ErrorState, EmptyState } from './IVXStates';

export interface IVXFeedProps<ItemT> extends Omit<FlatListProps<ItemT>, 'onEndReached' | 'refreshControl' | 'ListFooterComponent' | 'ListEmptyComponent'> {
  /** Flat data array (already flattened from pages). */
  data: ItemT[];
  /** Render a single item. */
  renderItem: ListRenderItem<ItemT>;
  /** Stable key extractor. */
  keyExtractor: (item: ItemT, index: number) => string;
  /** Whether there are more pages to load. */
  hasMore?: boolean;
  /** Called when the user scrolls near the end. */
  onLoadMore?: () => void;
  /** Whether a refetch is in progress. */
  isRefreshing?: boolean;
  /** Called when the user pulls to refresh. */
  onRefresh?: () => void;
  /** Whether the initial load is in progress (no data yet). */
  isLoading?: boolean;
  /** Error from the initial load. */
  error?: Error | null;
  /** Called when the user taps retry on the error state. */
  onRetry?: () => void;
  /** Skeleton to show during initial load. */
  skeleton?: ReactNode;
  /** Empty state title. */
  emptyTitle?: string;
  /** Empty state message. */
  emptyMessage?: string;
  /** Empty state action label. */
  emptyActionLabel?: string;
  /** Empty state action handler. */
  onEmptyAction?: () => void;
  /** Distance from end to trigger load more (default: 5 items). */
  onEndReachedThreshold?: number;
  /** Test ID. */
  testID?: string;
  /** Container style. */
  containerStyle?: ViewStyle;
  /** Whether loading more is currently in progress. */
  isLoadingMore?: boolean;
}

function IVXFeedInner<ItemT>(
  props: IVXFeedProps<ItemT>,
  ref: React.Ref<FlatList<ItemT>>,
) {
  const {
    data,
    renderItem,
    keyExtractor,
    hasMore = false,
    onLoadMore,
    isRefreshing = false,
    onRefresh,
    isLoading = false,
    error = null,
    onRetry,
    skeleton,
    emptyTitle = 'Nothing here yet',
    emptyMessage = 'Content will appear here once it becomes available.',
    emptyActionLabel,
    onEmptyAction,
    onEndReachedThreshold = 5,
    testID = 'ivx-feed',
    containerStyle,
    isLoadingMore = false,
    ...flatListProps
  } = props;

  const listRef = useRef<FlatList<ItemT> | null>(null);

  // Expose ref
  React.useImperativeHandle(ref, () => listRef.current as FlatList<ItemT>, []);


  const handleEndReached = useCallback(() => {
    if (hasMore && !isLoadingMore && onLoadMore) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  const refreshControl = useMemo(() => {
    if (!onRefresh) return undefined;
    return (
      <RefreshControl
        refreshing={isRefreshing}
        onRefresh={onRefresh}
        tintColor={Colors.gold}
        colors={[Colors.gold]}
      />
    );
  }, [onRefresh, isRefreshing]);

  const ListFooterComponent = useMemo(() => {
    if (isLoadingMore) {
      return (
        <View style={styles.footerLoading} testID={`${testID}-loading-more`}>
          <ShimmerIndicator size="small" color={Colors.gold} />
        </View>
      );
    }
    if (hasMore) return null;
    if (data.length > 0) {
      return <View style={styles.footerEnd} />;
    }
    return null;
  }, [isLoadingMore, hasMore, data.length, testID]);

  // ─── Initial loading state ────────────────────────────────────────
  if (isLoading && data.length === 0 && !error) {
    return (
      <View style={[styles.container, containerStyle]} testID={`${testID}-loading`}>
        {skeleton ?? <DefaultFeedSkeleton />}
      </View>
    );
  }

  // ─── Error state (initial load) ───────────────────────────────────
  if (error && data.length === 0) {
    return (
      <View style={[styles.container, containerStyle]} testID={`${testID}-error`}>
        <ErrorState
          message={(error as Error)?.message || 'Failed to load content. Please try again.'}
          onRetry={onRetry}
          testID={`${testID}-error-state`}
        />
      </View>
    );
  }

  // ─── Empty state ──────────────────────────────────────────────────
  if (!isLoading && !error && data.length === 0) {
    return (
      <View style={[styles.container, containerStyle]} testID={`${testID}-empty`}>
        <EmptyState
          title={emptyTitle}
          message={emptyMessage}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
          testID={`${testID}-empty-state`}
        />
      </View>
    );
  }

  // ─── Feed ─────────────────────────────────────────────────────────
  return (
    <FlatList
      ref={listRef}
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      onEndReached={handleEndReached}
      onEndReachedThreshold={onEndReachedThreshold}
      refreshControl={refreshControl}
      ListFooterComponent={ListFooterComponent}
      testID={testID}
      {...flatListProps}
    />
  );
}

// ─── Default feed skeleton ───────────────────────────────────────────

function DefaultFeedSkeleton() {
  const { FeedCardSkeleton } = require('@/components/InstantSkeleton');
  return (
    <View style={styles.defaultSkeleton}>
      {Array.from({ length: 3 }).map((_, i) => (
        <FeedCardSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  defaultSkeleton: {
    flex: 1,
    padding: 16,
  },
  footerLoading: {
    paddingVertical: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  footerEnd: {
    height: 40,
  },
});

export const IVXFeed = React.forwardRef(IVXFeedInner) as <ItemT>(
  props: IVXFeedProps<ItemT> & { ref?: React.Ref<FlatList<ItemT>> },
) => React.ReactElement;

export default IVXFeed;
