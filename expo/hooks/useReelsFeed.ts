import { useCallback, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ivxQueryKeys, shouldRetryIVXRequest } from '@/lib/query-contract';
import { fetchVideoFeedPage, type FeedVideo } from '@/lib/video-feed';

const PAGE_SIZE = 10;

export interface ReelsFeedState {
  videos: FeedVideo[];
  hasMore: boolean;
  nextCursor: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isFetchingMore: boolean;
  error: Error | null;
  loadMore: () => void;
  refresh: () => void;
}

/** Removes duplicate media IDs while preserving the server's canonical order. */
export function deduplicateReels(videos: FeedVideo[]): FeedVideo[] {
  const ids = new Set<string>();
  return videos.filter((video) => {
    if (ids.has(video.id)) return false;
    ids.add(video.id);
    return true;
  });
}

/**
 * Canonical Reels pagination source for the Expo app.
 * Cached pages remain rendered during refetch; loading is exposed only when no
 * page is available. Cursor values are supplied exclusively by the backend.
 */
export function useReelsFeed(): ReelsFeedState {
  const feedQuery = useInfiniteQuery({
    queryKey: ivxQueryKeys.reels('all'),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchVideoFeedPage(PAGE_SIZE, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 60_000,
    retry: shouldRetryIVXRequest,
  });

  const videos = useMemo<FeedVideo[]>(() => {
    return deduplicateReels(feedQuery.data?.pages.flatMap((page) => page.videos) ?? []);
  }, [feedQuery.data]);

  const loadMore = useCallback((): void => {
    if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
      void feedQuery.fetchNextPage();
    }
  }, [feedQuery]);

  const refresh = useCallback((): void => {
    void feedQuery.refetch();
  }, [feedQuery]);

  const lastPage = feedQuery.data?.pages.at(-1);
  return {
    videos,
    hasMore: feedQuery.hasNextPage ?? false,
    nextCursor: lastPage?.nextCursor ?? null,
    isLoading: feedQuery.isLoading,
    isRefreshing: feedQuery.isRefetching && !feedQuery.isFetchingNextPage,
    isFetchingMore: feedQuery.isFetchingNextPage,
    error: feedQuery.error ?? null,
    loadMore,
    refresh,
  };
}
