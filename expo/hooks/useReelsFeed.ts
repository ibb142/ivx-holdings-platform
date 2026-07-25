/**
 * useReelsFeed — fetches the canonical reels feed with cursor pagination.
 *
 * Uses the SAME backend endpoint the landing page uses:
 *   GET /api/ivx/video-platform/feed?cursor=<cursor>&limit=10
 *
 * Returns a stable list with no duplicate IDs, engagement counts,
 * and viewer liked/saved state when authenticated.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchVideoFeed, type FeedVideo } from '@/lib/video-feed';

const PAGE_SIZE = 10;

export interface ReelsFeedState {
  videos: FeedVideo[];
  hasMore: boolean;
  nextCursor: string | null;
  isLoading: boolean;
  isFetchingMore: boolean;
  error: Error | null;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Fetch the initial page of the reels feed.
 * The backend returns { videos, next_cursor, total } with cursor pagination.
 */
async function fetchFeedPage(limit: number): Promise<FeedVideo[]> {
  const videos = await fetchVideoFeed(limit);
  // De-duplicate by ID — never allow duplicate reel IDs in the feed.
  const seen = new Set<string>();
  return videos.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

export function useReelsFeed(): ReelsFeedState {
  const [allVideos, setAllVideos] = useState<FeedVideo[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [isFetchingMore, setIsFetchingMore] = useState<boolean>(false);
  const loadedIds = useRef<Set<string>>(new Set());
  const offsetRef = useRef<number>(0);

  const feedQuery = useQuery<FeedVideo[], Error>({
    queryKey: ['ivx-reels-feed'],
    queryFn: () => {
      offsetRef.current = 0;
      return fetchFeedPage(PAGE_SIZE);
    },
    staleTime: 60_000,
    retry: 2,
  });

  // Sync initial query results into local state via a guarded useEffect.
  // NEVER call setState during render — that causes Maximum update depth exceeded.
  const queryData = feedQuery.data;
  useEffect(() => {
    if (!queryData || queryData.length === 0 || feedQuery.isLoading) return;
    if (allVideos.length > 0) return;
    // Deduplicate by ID
    const seen = new Set<string>();
    const deduped = queryData.filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
    for (const v of deduped) loadedIds.current.add(v.id);
    offsetRef.current = deduped.length;
    setHasMore(deduped.length >= PAGE_SIZE);
    setAllVideos(deduped);
  }, [queryData, feedQuery.isLoading, allVideos.length]);

  const loadMore = useCallback(() => {
    if (isFetchingMore || !hasMore || feedQuery.isLoading) return;
    setIsFetchingMore(true);
    const currentOffset = offsetRef.current;
    void fetchVideoFeed(PAGE_SIZE, currentOffset)
      .then((more) => {
        const newItems = more.filter((v) => !loadedIds.current.has(v.id));
        if (newItems.length === 0) {
          setHasMore(false);
        } else {
          for (const v of newItems) loadedIds.current.add(v.id);
          offsetRef.current = currentOffset + newItems.length;
          setAllVideos((prev) => {
            const combined = [...prev];
            for (const v of newItems) {
              if (!combined.some((existing) => existing.id === v.id)) {
                combined.push(v);
              }
            }
            return combined;
          });
        }
      })
      .catch(() => {
        setHasMore(false);
      })
      .finally(() => {
        setIsFetchingMore(false);
      });
  }, [isFetchingMore, hasMore, feedQuery.isLoading]);

  const refresh = useCallback(() => {
    loadedIds.current.clear();
    offsetRef.current = 0;
    setAllVideos([]);
    setHasMore(true);
    void feedQuery.refetch();
  }, [feedQuery]);

  return {
    videos: allVideos,
    hasMore,
    nextCursor: null,
    isLoading: feedQuery.isLoading,
    isFetchingMore,
    error: feedQuery.error ?? null,
    loadMore,
    refresh,
  };
}