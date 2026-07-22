/**
 * InstagramProjectCard — Video-Enabled Project Card with Instagram-Style Engagement
 *
 * Wraps TrustDealCard with:
 * - Video hero section (auto-play muted, tap to expand)
 * - Engagement bar (like, comment, share, save)
 * - Fetches engagement data from project_engagement view
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  ChevronRight,
  MapPin,
  Maximize2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { formatCurrencyCompact, formatCurrencyWithDecimals } from '@/lib/formatters';
import { buildOwnershipSnapshot } from '@/lib/ownership-math';
import type { ParsedJVDeal } from '@/lib/parse-deal';
import {
  type ProjectEngagement,
  type ProjectVideo,
  type ProjectMedia,
  getProjectEngagement,
  toggleProjectLike,
  toggleProjectSave,
  trackProjectShare,
  fetchProjectMedia,
  trackVideoView,
  trackInvestClick,
} from '@/lib/project-engagement';
import ProjectEngagementBar from './ProjectEngagementBar';
import ProjectCommentsSheet from './ProjectCommentsSheet';
import ProjectShareSheet from './ProjectShareSheet';
import SafeVideo from './SafeVideo';
import {
  fetchProjectComments,
  addProjectComment,
  deleteProjectComment,
  type ProjectComment,
} from '@/lib/project-engagement';

const GOLD = '#FFD700';
const GOLD_DIM = '#C9A800';
const SURFACE_ELEVATED = '#181818';
const ACCENT_GREEN = '#00C48C';

interface InstagramProjectCardProps {
  deal: ParsedJVDeal;
  userId?: string | null;
  onInvestNow: (deal: ParsedJVDeal) => void;
  onViewDetails: (deal: ParsedJVDeal) => void;
  galleryWidth?: number;
  showVideo?: boolean;
  compact?: boolean;
  light?: boolean;
}

function extractLocation(deal: ParsedJVDeal): string {
  if (deal.city && deal.state) return `${deal.city}, ${deal.state}`;
  if (deal.propertyAddress) {
    const parts = deal.propertyAddress.split(',').map(s => s.trim());
    return parts.length >= 2 ? `${parts[parts.length - 2]}, ${parts[parts.length - 1]}` : deal.propertyAddress;
  }
  return '';
}

const InstagramProjectCard = memo(function InstagramProjectCard({
  deal,
  userId,
  onInvestNow,
  onViewDetails,
  galleryWidth = 340,
  showVideo = true,
  compact = false,
  light = false,
}: InstagramProjectCardProps) {
  // Video state
  const [videos, setVideos] = useState<ProjectVideo[]>([]);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [shouldPlayVideo, setShouldPlayVideo] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(true);
  const [videoProgress, setVideoProgress] = useState(0);
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false);
  const [watchedSeconds, setWatchedSeconds] = useState(0);

  // Engagement state
  const [engagement, setEngagement] = useState<ProjectEngagement>({
    like_count: 0, comment_count: 0, share_count: 0, save_count: 0,
    user_liked: false, user_saved: false,
  });
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // Sheet visibility
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const location = useMemo(() => extractLocation(deal), [deal]);
  const minInvestment = deal.trustMarket?.minInvestment || 50;
  const ownershipSnapshot = useMemo(() => buildOwnershipSnapshot(minInvestment, deal.propertyValue || deal.totalInvestment || 0), [minInvestment, deal.propertyValue, deal.totalInvestment]);

  // Fetch engagement data
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const eng = await getProjectEngagement(deal.id, userId);
        if (!cancelled) setEngagement(eng);
      } catch {}
    };
    void fetchData();
    return () => { cancelled = true; };
  }, [deal.id, userId]);

  // Fetch video data
  useEffect(() => {
    if (!showVideo) return;
    let cancelled = false;
    const fetchVideos = async () => {
      try {
        const { videos: vidList } = await fetchProjectMedia(deal.id);
        if (!cancelled) setVideos(vidList);
      } catch {}
    };
    void fetchVideos();
    return () => { cancelled = true; };
  }, [deal.id, showVideo]);

  // Fade in
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fadeAnim]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleLike = useCallback(async (projectId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await toggleProjectLike(projectId, userId);
      setEngagement(prev => ({
        ...prev,
        like_count: result.likeCount,
        user_liked: result.liked,
      }));
    } catch {}
  }, [userId]);

  const handleSave = useCallback(async (projectId: string) => {
    if (!userId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await toggleProjectSave(projectId, userId);
      setEngagement(prev => ({
        ...prev,
        save_count: result.saveCount,
        user_saved: result.saved,
      }));
    } catch {}
  }, [userId]);

  const handleComment = useCallback(async (projectId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCommentsLoading(true);
    setShowComments(true);
    try {
      const { comments: cmts, total } = await fetchProjectComments(projectId, 20, 0);
      setComments(cmts);
      setCommentsTotal(total);
    } catch {} finally {
      setCommentsLoading(false);
    }
  }, []);

  const handleShare = useCallback((projectId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowShare(true);
  }, []);

  const handleAddComment = useCallback(async (projectId: string, body: string, parentId?: string) => {
    try {
      await addProjectComment(projectId, body, userId, undefined, parentId);
      const { comments: cmts, total } = await fetchProjectComments(projectId, 20, 0);
      setComments(cmts);
      setCommentsTotal(total);
      setEngagement(prev => ({ ...prev, comment_count: total }));
    } catch {}
  }, [userId]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    try {
      await deleteProjectComment(commentId);
      const { comments: cmts, total } = await fetchProjectComments(deal.id, 20, 0);
      setComments(cmts);
      setCommentsTotal(total);
      setEngagement(prev => ({ ...prev, comment_count: total }));
    } catch {}
  }, [deal.id]);

  const handleShareTrack = useCallback(async (projectId: string, shareType: string) => {
    try {
      const result = await trackProjectShare(projectId, shareType as any, userId);
      setEngagement(prev => ({ ...prev, share_count: result.shareCount }));
    } catch {}
  }, [userId]);

  const handleInvestNow = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    void trackInvestClick(deal.id);
    onInvestNow(deal);
  }, [deal, onInvestNow]);

  const handleVideoPlaybackStatus = useCallback((status: { isPlaying: boolean; durationMillis: number; positionMillis: number }) => {
    setIsVideoPlaying(status.isPlaying);
    if (status.durationMillis && status.positionMillis) {
      setVideoProgress(status.positionMillis / status.durationMillis);
      if (status.isPlaying) {
        setWatchedSeconds(prev => {
          const newVal = prev + 0.5;
          if (newVal >= 5 && prev < 5) {
            void trackVideoView(deal.id, newVal);
          }
          return newVal;
        });
      }
    }
  }, [deal.id]);

  const togglePlayPause = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShouldPlayVideo(prev => !prev);
  }, []);

  const toggleMute = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsVideoMuted(prev => !prev);
  }, []);

  const hasVideo = videos.length > 0 && showVideo;
  const activeVideo = hasVideo ? videos[activeVideoIndex] : null;
  const shareUrl = `https://ivxholding.com/invest/${deal.id}`;

  return (
    <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
      {/* ── Video Hero ─────────────────────────────────────────────────── */}
      {hasVideo && activeVideo && (
        <View style={[styles.videoContainer, { height: compact ? 200 : 260 }]}>
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={togglePlayPause}
            style={styles.videoTouchArea}
          >
            <SafeVideo
              uri={activeVideo.video_url}
              posterUri={activeVideo.thumbnail_url ?? null}
              style={[styles.video, { height: compact ? 200 : 260 }]}
              resizeMode={ResizeMode.COVER}
              shouldPlay={shouldPlayVideo}
              isMuted={isVideoMuted}
              isLooping
              onPlaybackStatusUpdate={handleVideoPlaybackStatus}
              testID={`instagram-card-video-${deal.id}`}
            />
          </TouchableOpacity>

          {/* Video overlay controls */}
          <View style={styles.videoOverlay}>
            {/* Progress bar */}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${videoProgress * 100}%` }]} />
            </View>

            {/* Controls row */}
            <View style={styles.videoControlsRow}>
              <TouchableOpacity onPress={togglePlayPause} style={styles.videoControlBtn}>
                {isVideoPlaying ? (
                  <Pause size={18} color="#fff" />
                ) : (
                  <Play size={18} color="#fff" />
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={toggleMute} style={styles.videoControlBtn}>
                {isVideoMuted ? (
                  <VolumeX size={18} color="#fff" />
                ) : (
                  <Volume2 size={18} color="#fff" />
                )}
              </TouchableOpacity>

              <View style={styles.videoControlSpacer} />

              {/* Video dots */}
              {videos.length > 1 && (
                <View style={styles.videoDotsRow}>
                  {videos.map((_, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.videoDot,
                        idx === activeVideoIndex && styles.videoDotActive,
                      ]}
                    />
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={styles.videoControlBtn}
                onPress={() => {
                  setActiveVideoIndex((prev) => (prev + 1) % videos.length);
                  setVideoProgress(0);
                }}
              >
                <ChevronRight size={18} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Badges */}
            <View style={styles.videoBadges}>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
              {activeVideo.duration_sec > 0 && (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationText}>
                    {Math.floor(activeVideo.duration_sec / 60)}:{String(Math.floor(activeVideo.duration_sec % 60)).padStart(2, '0')}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Center play button */}
          {!isVideoPlaying && (
            <TouchableOpacity
              style={styles.centerPlayBtn}
              onPress={togglePlayPause}
              activeOpacity={0.8}
            >
              <View style={styles.centerPlayCircle}>
                <Play size={28} color="#000" fill="#000" />
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Engagement Bar ─────────────────────────────────────────────── */}
      <ProjectEngagementBar
        projectId={deal.id}
        likeCount={engagement.like_count}
        commentCount={engagement.comment_count}
        shareCount={engagement.share_count}
        saveCount={engagement.save_count}
        isLiked={engagement.user_liked}
        isSaved={engagement.user_saved}
        onLikePress={handleLike}
        onCommentPress={handleComment}
        onSharePress={handleShare}
        onSavePress={handleSave}
        compact={compact}
        light={light}
      />

      {/* ── Deal Info ──────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.dealInfoSection}
        onPress={() => onViewDetails(deal)}
        activeOpacity={0.85}
      >
        {/* Location + Title */}
        <View style={styles.dealHeader}>
          <Text style={styles.dealTitle} numberOfLines={2}>
            {deal.title || deal.projectName}
          </Text>
          {location ? (
            <View style={styles.locationRow}>
              <MapPin size={12} color={Colors.textTertiary} />
              <Text style={styles.locationText}>{location}</Text>
            </View>
          ) : null}
        </View>

        {/* Key Metrics */}
        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {formatCurrencyCompact(deal.totalInvestment || 0)}
            </Text>
            <Text style={styles.metricLabel}>Investment</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}>
            <Text style={[styles.metricValue, styles.metricHighlight]}>
              {deal.expectedROI != null && Number.isFinite(Number(deal.expectedROI)) ? `${deal.expectedROI}%` : 'N/A'}
            </Text>
            <Text style={styles.metricLabel}>Target ROI</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {formatCurrencyWithDecimals(minInvestment)}
            </Text>
            <Text style={styles.metricLabel}>Min Investment</Text>
          </View>
        </View>

        {/* Ownership hint */}
        <Text style={styles.ownershipHint}>{ownershipSnapshot.ownershipText}</Text>
      </TouchableOpacity>

      {/* ── CTA Buttons ────────────────────────────────────────────────── */}
      <View style={styles.ctaRow}>
        <TouchableOpacity
          style={styles.detailsBtn}
          onPress={() => onViewDetails(deal)}
          activeOpacity={0.85}
          testID={`view-details-${deal.id}`}
        >
          <Text style={styles.detailsBtnText}>View Details</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.investBtn}
          onPress={handleInvestNow}
          activeOpacity={0.85}
          testID={`invest-now-${deal.id}`}
        >
          <Text style={styles.investBtnText}>Invest Now</Text>
        </TouchableOpacity>
      </View>

      {/* ── Shets ──────────────────────────────────────────────────────── */}
      <ProjectCommentsSheet
        projectId={deal.id}
        visible={showComments}
        onClose={() => setShowComments(false)}
        comments={comments}
        isLoading={commentsLoading}
        onAddComment={handleAddComment}
        onDeleteComment={handleDeleteComment}
        totalComments={commentsTotal}
      />

      <ProjectShareSheet
        projectId={deal.id}
        projectTitle={deal.title || deal.projectName || ''}
        projectUrl={shareUrl}
        visible={showShare}
        onClose={() => setShowShare(false)}
        onShareTrack={handleShareTrack}
      />
    </Animated.View>
  );
});

export default InstagramProjectCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0D0D0D',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 16,
  },
  // ── Video ──────────────────────────────────────────────────────────
  videoContainer: {
    position: 'relative',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  videoTouchArea: {
    width: '100%',
    height: '100%',
  },
  video: {
    width: '100%',
    backgroundColor: '#000',
  },
  videoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 8,
  },
  progressBar: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginHorizontal: 0,
  },
  progressFill: {
    height: 3,
    backgroundColor: GOLD,
  },
  videoControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  videoControlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoControlSpacer: {
    flex: 1,
  },
  videoDotsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  videoDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  videoDotActive: {
    backgroundColor: '#fff',
    width: 16,
  },
  videoBadges: {
    position: 'absolute',
    top: -220,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,200,100,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,100,0.4)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACCENT_GREEN,
  },
  liveBadgeText: {
    color: ACCENT_GREEN,
    fontSize: 9,
    fontWeight: '900' as const,
    letterSpacing: 1.5,
  },
  durationBadge: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  durationText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700' as const,
  },
  centerPlayBtn: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPlayCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  // ── Deal Info ───────────────────────────────────────────────────────
  dealInfoSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dealHeader: {
    marginBottom: 10,
  },
  dealTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#222',
  },
  metric: {
    flex: 1,
    alignItems: 'center',
  },
  metricValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800' as const,
    marginBottom: 2,
  },
  metricHighlight: {
    color: ACCENT_GREEN,
  },
  metricLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  metricDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#222',
  },
  ownershipHint: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 2,
  },
  // ── CTA ─────────────────────────────────────────────────────────────
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  investBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: GOLD,
  },
  investBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '800' as const,
  },
  detailsBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#333',
    backgroundColor: '#141414',
  },
  detailsBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
