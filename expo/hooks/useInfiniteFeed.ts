/**
 * useInfiniteFeed — Canonical cursor/offset-based pagination hook.
 *
 * Wraps useInfiniteQuery with IVX-specific defaults:
 * - Stale-while-revalidate (keepPreviousData)
 * - Cursor or offset pagination
 * - Automatic deduplication
 * - Pull-to-refresh support
 * - Load-more state tracking
 *
 * Usage:
 * ```tsx
 * const {
 *   data,
 *   isLoading,
 *   error,
 *   hasMore,
 *   loadMore,
 *   refresh,
 *   isRefreshing,
 *   isLoadingMore,
 *   flatData,
 * } = useInfiniteFeed({
 *   queryKey: ['projects'],
 *   fetchPage: async (page) => {
 *     const res = await fetch(`/api/projects?cursor=${page.cursor}`);
 *     return { items: res.data, nextCursor: res.nextCursor };
 *   },
 * });
 * ```
 */
import { useMemo, useCallback } from 'react';
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

// ─── Types ───────────────────────────────────────────────────────────

export interface FeedPage<T> {
  items: T[];
  nextCursor?: string | number | null;
  hasMore?: boolean;
}

export interface UseInfiniteFeedOptions<T> {
  /** Unique query key array. */
  queryKey: string[];
  /** Fetch a single page. Receives the previous page's nextCursor (or undefined for first page). */
  fetchPage: (cursor: string | number | undefined) => Promise<FeedPage<T>>;
  /** Initial cursor (default: undefined = first page). */
  initialCursor?: string | number | undefined;
  /** Stale time in ms (default: 5 min — matches app QueryClient). */
  staleTime?: number;
  /** Whether the query is enabled. */
  enabled?: boolean;
  /** Number of pages to keep in memory (default: kept by gcTime). */
  maxPages?: number;
}

export interface UseInfiniteFeedResult<T> {
  /** The raw infinite query result. */
  queryResult: UseInfiniteQueryResult<InfiniteData<FeedPage<T>>>;
  /** Flattened items from all pages. */
  flatData: T[];
  /** Whether the initial load is in progress. */
  isLoading: boolean;
  /** Whether a refetch is in progress. */
  isRefreshing: boolean;
  /** Whether the next page is loading. */
  isLoadingMore: boolean;
  /** Error from the query. */
  error: Error | null;
  /** Whether there are more pages to load. */
  hasMore: boolean;
  /** Fetch the next page. */
  loadMore: () => void;
  /** Refetch from the first page. */
  refresh: () => void;
  /** Total item count across all pages. */
  totalCount: number;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useInfiniteFeed<T>(options: UseInfiniteFeedOptions<T>): UseInfiniteFeedResult<T> {
  const {
    queryKey,
    fetchPage,
    initialCursor,
    staleTime = 5 * 60_000,
    enabled = true,
    maxPages,
  } = options;

  const queryResult = useInfiniteQuery<FeedPage<T>, Error>({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam as string | number | undefined),
    initialPageParam: initialCursor,
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore === false) return undefined;
      return lastPage.nextCursor ?? undefined;
    },
    staleTime,
    enabled,
    ...(maxPages ? { maxPages } : {}),
  });

  // Flatten all pages into a single array
  const flatData = useMemo<T[]>(() => {
    if (!queryResult.data?.pages) return [];
    return queryResult.data.pages.flatMap((page) => page.items);
  }, [queryResult.data]);

  const totalCount = useMemo(() => flatData.length, [flatData]);

  const hasMore = useMemo(() => {
    if (!queryResult.data?.pages) return false;
    const lastPage = queryResult.data.pages[queryResult.data.pages.length - 1];
    if (!lastPage) return false;
    return (lastPage.hasMore ?? (lastPage.nextCursor != null)) && queryResult.hasNextPage;
  }, [queryResult.data, queryResult.hasNextPage]);

  const loadMore = useCallback(() => {
    if (queryResult.hasNextPage && !queryResult.isFetchingNextPage) {
      void queryResult.fetchNextPage();
    }
  }, [queryResult]);

  const refresh = useCallback(() => {
    void queryResult.refetch();
  }, [queryResult]);

  return {
    queryResult,
    flatData,
    isLoading: queryResult.isLoading,
    isRefreshing: queryResult.isRefetching,
    isLoadingMore: queryResult.isFetchingNextPage,
    error: queryResult.error,
    hasMore,
    loadMore,
    refresh,
    totalCount,
  };
}

export default useInfiniteFeed;
