/**
 * IVX Reels — full-screen vertical video feed matching ivxholding.com exactly.
 *
 * Same backend the landing page uses:
 *   feed      → GET /api/ivx/video-platform/feed
 *   like      → POST /api/projects/:id/like
 *   save      → POST /api/projects/:id/save
 *   share     → POST /api/projects/:id/share
 *   follow    → POST /api/ivx/video-platform/follow
 *   report    → POST /api/ivx/video-platform/videos/:id/report
 *   comments  → GET/POST /api/projects/:id/comments
 *
 * Player lifecycle (Instagram-style):
 *   • Only ONE reel plays at a time (the active/index item)
 *   • Max 3 players mounted (active ± 1) — all others unmounted
 *   • Pauses on app background, screen unfocus, network disconnect
 *   • 80% viewability threshold to prevent overlap during fast scroll
 *   • Per-item error boundary so one bad video never crashes the feed
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Alert,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { RefreshControl } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';

import Colors from '@/constants/colors';
import { fetchVideoFeed, type FeedVideo } from '@/lib/video-feed';
import {
  toggleVideoFollow,
  reportVideo,
  getViewerId,
  buildVideoShareUrl,
} from '@/lib/video-platform';
import ProjectCommentsSheet from '@/components/ProjectCommentsSheet';
import ProjectShareSheet from '@/components/ProjectShareSheet';
import CanonicalInvestmentReelCard, {
  feedVideoToReelData,
  type CanonicalReelData,
} from '@/components/CanonicalInvestmentReelCard';
import { useReelPlayback } from '@/hooks/useReelPlayback';
import { useReelEngagement, type EngagementState } from '@/hooks/useReelEngagement';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import {
  fetchProjectComments,
  addProjectComment,
  deleteProjectComment,
  type ProjectComment,
} from '@/lib/project-engagement';
import { supabase } from '@/lib/supabase';

const GOLD = Colors.primary;

type ReelChannel = 'all' | 'investment' | 'buyer' | 'seller';

const CHANNELS: { id: ReelChannel; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'investment', label: 'Investments' },
  { id: 'buyer', label: 'Buyers' },
  { id: 'seller', label: 'Sellers' },
];

export default function VideosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const params = useLocalSearchParams<{ type?: string }>();
  void params;
  const [muted, setMuted] = useState<boolean>(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ReelChannel>('all');

  const [commentsVideo, setCommentsVideo] = useState<FeedVideo | null>(null);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [commentsTotal, setCommentsTotal] = useState<number>(0);
  const [commentsLoading, setCommentsLoading] = useState<boolean>(false);
  const [shareVideo, setShareVideo] = useState<FeedVideo | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Progressive loading: fetch first page of 10, then load more on scroll
  const [allVideos, setAllVideos] = useState<FeedVideo[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [isFetchingMore, setIsFetchingMore] = useState<boolean>(false);
  const loadedIds = useRef<Set<string>>(new Set());
  const offsetRef = useRef<number>(0);
  const PAGE_SIZE = 10;

  const feedQuery = useQuery({
    queryKey: ['ivx-video-feed'],
    queryFn: () => {
      offsetRef.current = 0;
      return fetchVideoFeed(PAGE_SIZE, 0);
    },
    staleTime: 60_000,
    retry: 2,
  });

  // Sync initial query results into local state via guarded effect
  const queryData = feedQuery.data;
  useEffect(() => {
    if (!queryData || queryData.length === 0 || feedQuery.isLoading) return;
    const seen = new Set<string>();
    const deduped = queryData.filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
    loadedIds.current = new Set(deduped.map((v) => v.id));
    offsetRef.current = deduped.length;
    setHasMore(deduped.length >= PAGE_SIZE);
    setAllVideos(deduped);
  }, [queryData, feedQuery.isLoading]);

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
            // Deduplicate by ID in the combined array
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
      .catch(() => setHasMore(false))
      .finally(() => setIsFetchingMore(false));
  }, [isFetchingMore, hasMore, feedQuery.isLoading]);

  const filteredVideos = useMemo(() => {
    if (channel === 'all') return allVideos;
    if (channel === 'investment') return allVideos.filter(v => v.deal && v.video_type !== 'reel');
    if (channel === 'buyer') {
      return allVideos.filter(
        v =>
          (v.deal?.deal_type ?? '').toLowerCase().includes('buy') ||
          v.title?.toLowerCase().includes('buy') ||
          v.title?.toLowerCase().includes('buyer')
      );
    }
    if (channel === 'seller') {
      return allVideos.filter(
        v =>
          (v.deal?.deal_type ?? '').toLowerCase().includes('sell') ||
          v.title?.toLowerCase().includes('sell') ||
          v.title?.toLowerCase().includes('seller')
      );
    }
    return allVideos;
  }, [allVideos, channel]);

  const counts = useMemo(() => {
    const all = allVideos.length;
    const investment = allVideos.filter(v => v.deal && v.video_type !== 'reel').length;
    const buyer = allVideos.filter(
      v =>
        (v.deal?.deal_type ?? '').toLowerCase().includes('buy') ||
        v.title?.toLowerCase().includes('buy') ||
        v.title?.toLowerCase().includes('buyer')
    ).length;
    const seller = allVideos.filter(
      v =>
        (v.deal?.deal_type ?? '').toLowerCase().includes('sell') ||
        v.title?.toLowerCase().includes('sell') ||
        v.title?.toLowerCase().includes('seller')
    ).length;
    return { all, investment, buyer, seller };
  }, [allVideos]);

  // Playback lifecycle hooks
  const playback = useReelPlayback();
  const engagement = useReelEngagement();
  // Destructure stable callbacks to avoid effect dependency loops
  const { initEngagements, handleView } = engagement;

  useEffect(() => {
    let cancelled = false;
    void getViewerId().then((id) => {
      if (!cancelled) setViewerId(id);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session?.user?.id) setUserId(data.session.user.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Initialize engagement state when videos load
  // Use allVideos.length as dependency, not the engagement object itself
  useEffect(() => {
    if (allVideos.length === 0) return;
    initEngagements(allVideos);
  }, [allVideos, initEngagements]);

  // Track view events when active reel changes
  // Use playback.activeIndex and filteredVideos as deps, not engagement
  useEffect(() => {
    const activeVideo = filteredVideos[playback.activeIndex];
    if (!activeVideo) return;
    handleView(activeVideo);
  }, [playback.activeIndex, filteredVideos, handleView]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleLike = useCallback((video: FeedVideo) => {
    engagement.handleLike(video, userId);
  }, [engagement, userId]);

  const handleDoubleTapLike = useCallback((video: FeedVideo) => {
    engagement.handleDoubleTapLike(video, userId);
  }, [engagement, userId]);

  const handleComment = useCallback(async (video: FeedVideo) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCommentsLoading(true);
    setCommentsVideo(video);
    try {
      const { comments: cmts, total } = await fetchProjectComments(video.id, 20, 0);
      setComments(cmts);
      setCommentsTotal(total);
    } catch {} finally {
      setCommentsLoading(false);
    }
  }, []);

  const handleAddComment = useCallback(async (projectId: string, body: string, parentId?: string) => {
    try {
      await addProjectComment(projectId, body, userId, undefined, parentId);
      const { comments: cmts, total } = await fetchProjectComments(projectId, 20, 0);
      setComments(cmts);
      setCommentsTotal(total);
    } catch {}
  }, [userId]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    if (!commentsVideo) return;
    try {
      await deleteProjectComment(commentId);
      const { comments: cmts, total } = await fetchProjectComments(commentsVideo.id, 20, 0);
      setComments(cmts);
      setCommentsTotal(total);
    } catch {}
  }, [commentsVideo]);

  const handleShare = useCallback((video: FeedVideo) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShareVideo(video);
  }, []);

  const handleShareTrack = useCallback(async (projectId: string, shareType: string) => {
    engagement.handleShare(
      { id: projectId } as FeedVideo,
      userId,
      shareType,
    );
  }, [engagement, userId]);

  const handleSave = useCallback((video: FeedVideo) => {
    engagement.handleSave(video, viewerId);
  }, [engagement, viewerId]);

  const handleFollow = useCallback(async (video: FeedVideo) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const creatorId = video.creator_id ?? 'ivx-owner';
    try {
      const result = await toggleVideoFollow(creatorId, viewerId);
      showToast(result.following ? 'Following creator' : 'Unfollowed');
    } catch {}
  }, [viewerId, showToast]);

  const handleReport = useCallback((video: FeedVideo) => {
    if (Platform.OS === 'web') {
      const reason = window.prompt('Report this video — reason:');
      if (!reason) return;
      void reportVideo(video.id, reason, viewerId).then(() => showToast('Report submitted to moderation')).catch(() => showToast('Report failed'));
      return;
    }
    Alert.prompt('Report this video', 'Reason:', async (reason) => {
      if (!reason) return;
      try {
        await reportVideo(video.id, reason, viewerId);
        showToast('Report submitted to moderation');
      } catch {
        showToast('Report failed');
      }
    });
  }, [viewerId, showToast]);

  const handleViewDeal = useCallback((video: FeedVideo) => {
    if (video.deal?.url) {
      router.push(video.deal.url as any);
    } else if (video.deal?.id) {
      router.push({ pathname: '/jv-invest', params: { jvId: video.deal.id } } as any);
    }
  }, [router]);

  const handleInvestNow = useCallback((video: FeedVideo) => {
    if (video.deal?.id) {
      router.push({ pathname: '/jv-invest', params: { jvId: video.deal.id } } as any);
    }
  }, [router]);

  // Keep a ref to the latest engagements so getEngagement can read
  // current state without being a dependency of renderItem (which
  // would cause all FeedItems to re-render on every like/save).
  const engagementsRef = useRef(engagement.engagements);
  engagementsRef.current = engagement.engagements;

  // Stable getter: reads from ref so the callback identity never changes.
  // FeedItem receives the engagement value at render time; when a like
  // updates the ref, only the affected FeedItem re-renders (via its own
  // engagement prop diff), not the entire FlatList.
  const getEngagement = useCallback(
    (videoId: string, fallback: FeedVideo): EngagementState => {
      return engagementsRef.current[videoId] ?? {
        likeCount: fallback.like_count ?? 0,
        commentCount: fallback.comment_count ?? 0,
        shareCount: fallback.share_count ?? 0,
        saveCount: fallback.save_count ?? 0,
        liked: false,
        saved: false,
        following: false,
      };
    },
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: FeedVideo; index: number }) => {
      const reelData = feedVideoToReelData(item);
      const eng = getEngagement(item.id, item);
      const mergedData: CanonicalReelData = {
        ...reelData,
        isLiked: eng.liked,
        isSaved: eng.saved,
        likeCount: eng.likeCount,
        saveCount: eng.saveCount,
        shareCount: eng.shareCount,
        commentCount: eng.commentCount,
      };
      return (
        <CanonicalInvestmentReelCard
          data={mergedData}
          mode="reel"
          isActive={playback.shouldPlay(index)}
          shouldMountVideo={playback.shouldMount(index, filteredVideos.length)}
          isMuted={muted}
          feedHeight={windowHeight}
          onToggleMute={() => setMuted(m => !m)}
          onLike={(d) => handleLike(item)}
          onComment={(d) => handleComment(item)}
          onSave={(d) => handleSave(item)}
          onShare={(d) => handleShare(item)}
          onOpenDeal={(d) => handleViewDeal(item)}
          onInvest={(d) => handleInvestNow(item)}
        />
      );
    },
    [playback, filteredVideos.length, windowHeight, muted, getEngagement, handleLike, handleComment, handleShare, handleSave, handleViewDeal, handleInvestNow]
  );

  const itemHeight = windowHeight;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top filter chips — matches the owner-approved reels screenshot */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topRow}>
          <View style={styles.tabs}>
            {CHANNELS.map((ch) => (
              <TouchableOpacity
                key={ch.id}
                style={[styles.tab, channel === ch.id && styles.tabActive]}
                onPress={() => setChannel(ch.id)}
                testID={`reels-channel-${ch.id}`}
                activeOpacity={0.85}
              >
                <Text style={[styles.tabText, channel === ch.id && styles.tabTextActive]}>
                  {ch.label} {counts[ch.id]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} testID="reels-close">
            <X size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {feedQuery.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      ) : filteredVideos.length === 0 ? (
        <View style={styles.loading}>
          <Text style={styles.emptyText}>No videos available</Text>
        </View>
      ) : (
        <ModuleErrorBoundary moduleName="Reels">
        <FlatList
          data={filteredVideos}
          keyExtractor={(v) => v.id}
          renderItem={renderItem}
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={itemHeight}
          snapToAlignment="start"
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={playback.handleViewableItemsChanged}
          viewabilityConfig={playback.viewabilityConfig}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          removeClippedSubviews
          getItemLayout={(_data, index) => ({ length: itemHeight, offset: itemHeight * index, index })}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingMore ? (
              <View style={{ height: windowHeight, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color={GOLD} />
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={feedQuery.isRefetching}
              onRefresh={() => {
                loadedIds.current = new Set();
                offsetRef.current = 0;
                setHasMore(true);
                void feedQuery.refetch();
              }}
              tintColor={GOLD}
            />
          }
          contentContainerStyle={{ paddingTop: 0 }}
        />
        </ModuleErrorBoundary>
      )}

      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {commentsVideo && (
        <ProjectCommentsSheet
          visible={commentsVideo !== null}
          projectId={commentsVideo.id}
          comments={comments}
          totalComments={commentsTotal}
          isLoading={commentsLoading}
          onClose={() => setCommentsVideo(null)}
          onAddComment={handleAddComment}
          onDeleteComment={handleDeleteComment}
        />
      )}

      {shareVideo && (
        <ProjectShareSheet
          visible={shareVideo !== null}
          projectId={shareVideo.id}
          projectTitle={shareVideo.title ?? 'IVX Property'}
          projectUrl={buildVideoShareUrl(shareVideo.id)}
          onClose={() => setShareVideo(null)}
          onShareTrack={handleShareTrack}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tab: {
    flexShrink: 0,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  tabActive: {
    backgroundColor: GOLD,
  },
  tabText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700' as const,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  tabTextActive: {
    color: '#000',
    textShadowColor: 'transparent',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 15,
  },
  toast: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  toastText: {
    backgroundColor: 'rgba(20,20,20,0.92)',
    color: '#fff',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    fontSize: 13,
    fontWeight: '600',
  },
});
