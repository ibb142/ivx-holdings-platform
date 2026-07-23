/**
 * CanonicalInvestmentReelCard — the ONE shared reel card for IVX.
 *
 * Used by:
 *   • Main/Home feed (mode="feed")
 *   • Reels module (mode="reel")
 *   • Landing page (mode="feed")
 *
 * Visual design (owner-approved):
 *   Full-bleed vertical media (video or image)
 *   Investment + Active badges (top-left)
 *   Property title + location (bottom-left, over gradient)
 *   ROI / Min Investment / Min Ownership metrics
 *   Tokenized / JV Deal / Buyer category options
 *   Right-side action rail: Like, Comment, Save, Share, Audio
 *   View Deal + Invest Now CTAs (bottom)
 *
 * Data sources:
 *   Accepts a unified `CanonicalReelData` props object that can be
 *   mapped from FeedVideo, HomeFeedDeal, PublishedDealCardModel, or
 *   ParsedJVDeal — all via the adapter functions in this file.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Alert,
  AppState,
  Platform,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Volume2,
  VolumeX,
  Play,
  Hexagon,
  Users,
  Home,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import SafeVideo from '@/components/SafeVideo';
import ReelVideoPlayer from '@/components/ReelVideoPlayer';
import { formatCount, compactCurrency } from '@/lib/reel-formatters';
import { toggleProjectLike, trackProjectShare } from '@/lib/project-engagement';
import { toggleVideoSave, getViewerId, buildVideoShareUrl } from '@/lib/video-platform';

// ─── Types ─────────────────────────────────────────────────────────────

export type ReelMode = 'reel' | 'feed';
export type ReelMediaType = 'video' | 'image';

export interface CanonicalReelData {
  /** Unique identifier for this reel item (video ID or deal ID). */
  reelId: string;
  /** Linked JV deal ID (used for View Deal / Invest Now navigation). */
  dealId: string | null;
  /** Property ID if different from dealId. */
  propertyId: string | null;
  /** Investment ID if different from dealId. */
  investmentId: string | null;
  /** URL slug for deep linking. */
  slug: string | null;
  /** Display title (property name or video title). */
  title: string;
  /** Subtitle / tour label. */
  subtitle: string;
  /** Location string (city, state). */
  location: string | null;
  /** Primary media URL (video or image). */
  mediaUrl: string | null;
  /** Media type — video or image. */
  mediaType: ReelMediaType;
  /** HLS adaptive stream URL (preferred for video). */
  hlsUrl: string | null;
  /** Poster/thumbnail URL for video. */
  posterUrl: string | null;
  /** Blurred placeholder URL for instant first paint. */
  previewBlurUrl: string | null;
  /** Expected ROI percentage. */
  roi: number | null;
  /** Minimum investment amount in dollars. */
  minimumInvestment: number | null;
  /** Minimum ownership percentage. */
  minimumOwnership: string | null;
  /** Deal status (published, active, etc.). */
  status: string;
  /** Deal category (jv, development, etc.). */
  category: string | null;
  /** Like count. */
  likeCount: number;
  /** Comment count. */
  commentCount: number;
  /** Save count. */
  saveCount: number;
  /** Share count. */
  shareCount: number;
  /** Whether the current user has liked this reel. */
  isLiked: boolean;
  /** Whether the current user has saved this reel. */
  isSaved: boolean;
  /** Whether audio is enabled (video only). */
  audioEnabled: boolean;
  /** Creator ID for follow tracking. */
  creatorId: string | null;
  /** Full deal URL for deep-link navigation. */
  dealUrl: string | null;
}

export interface CanonicalInvestmentReelCardProps {
  data: CanonicalReelData;
  mode: ReelMode;
  /** Whether this card is the active/visible item (reel mode only). */
  isActive: boolean;
  /** Whether to mount the video player (reel mode — active ± 1 only). */
  shouldMountVideo: boolean;
  /** Whether audio is muted globally (reel mode). */
  isMuted: boolean;
  /** Card height for feed mode (default: 520). */
  feedHeight: number;
  /** Callbacks. */
  onOpenDeal: (data: CanonicalReelData) => void;
  onInvest: (data: CanonicalReelData) => void;
  onLike: (data: CanonicalReelData) => void;
  onComment: (data: CanonicalReelData) => void;
  onSave: (data: CanonicalReelData) => void;
  onShare: (data: CanonicalReelData) => void;
  onToggleMute: () => void;
  /** Test ID prefix. */
  testIDPrefix?: string;
}

// ─── Investment options ────────────────────────────────────────────────

interface InvestmentOption {
  id: string;
  label: string;
  icon: React.ReactNode;
  tint: string;
}

function useInvestmentOptions(dealType: string | null | undefined): InvestmentOption[] {
  const t = (dealType ?? '').toLowerCase();
  const tokenized: InvestmentOption = {
    id: 'tokenized',
    label: 'Tokenized',
    icon: <Hexagon size={16} color={Colors.primary} />,
    tint: Colors.primary,
  };
  const jvDeals: InvestmentOption = {
    id: 'jvDeals',
    label: 'JV Deal',
    icon: <Users size={16} color={Colors.blue} />,
    tint: Colors.blue,
  };
  const buyers: InvestmentOption = {
    id: 'buyers',
    label: 'Buyer',
    icon: <Home size={16} color={Colors.green} />,
    tint: Colors.green,
  };
  switch (t) {
    case 'jv':
    case 'equity_split':
    case 'hybrid':
      return [tokenized, jvDeals, buyers];
    case 'development':
    case 'new_construction':
    case 'rehab_construction':
      return [jvDeals, tokenized, buyers];
    case 'profit_sharing':
      return [tokenized, buyers, jvDeals];
    default:
      return [tokenized, jvDeals, buyers];
  }
}

// ─── Component ─────────────────────────────────────────────────────────

const CanonicalInvestmentReelCard = memo(function CanonicalInvestmentReelCard({
  data,
  mode,
  isActive,
  shouldMountVideo,
  isMuted,
  feedHeight = 520,
  onOpenDeal,
  onInvest,
  onLike,
  onComment,
  onSave,
  onShare,
  onToggleMute,
  testIDPrefix = 'reel-card',
}: CanonicalInvestmentReelCardProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [paused, setPaused] = useState<boolean>(false);
  const [showHeart, setShowHeart] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [liked, setLiked] = useState<boolean>(data.isLiked);
  const [likeCount, setLikeCount] = useState<number>(data.likeCount);
  const [saved, setSaved] = useState<boolean>(data.isSaved);
  const [saveCount, setSaveCount] = useState<number>(data.saveCount);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [appState, setAppState] = useState<string>('active');
  const [isInViewport, setIsInViewport] = useState<boolean>(false);
  const lastTapRef = useRef<number>(0);
  const viewRef = useRef<View>(null);
  // Stable progress handler — avoids creating a new arrow function on
  // every render, which would cause ReelVideoPlayer/SafeVideo to
  // re-render ~10x/second during playback.
  const handleProgress = useCallback((p: number) => {
    setProgress(p);
  }, []);

  const isReel = mode === 'reel';
  const cardHeight = isReel ? screenHeight : feedHeight;

  // Fetch viewer ID for engagement tracking
  useEffect(() => {
    let cancelled = false;
    void getViewerId().then((id) => {
      if (!cancelled) setViewerId(id);
    });
    return () => { cancelled = true; };
  }, []);

  // Pause video when app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: string) => {
      setAppState(nextState);
    });
    return () => subscription.remove();
  }, []);

  // Viewability detection for feed mode
  useEffect(() => {
    if (isReel) return; // reel mode uses isActive from parent
    const interval = setInterval(() => {
      if (!viewRef.current || appState !== 'active') {
        setIsInViewport(false);
        return;
      }
      viewRef.current.measure((_x, _y, w, h, pageX, pageY) => {
        if (!h || h <= 0) return;
        const visibleTop = Math.max(pageY, 0);
        const visibleBottom = Math.min(pageY + h, screenHeight);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const visibilityRatio = visibleHeight / h;
        setIsInViewport(visibilityRatio >= 0.6);
      });
    }, 500);
    return () => clearInterval(interval);
  }, [appState, screenHeight, isReel]);

  const shouldPlay = isReel
    ? isActive && !paused && appState === 'active'
    : isInViewport && appState === 'active' && !paused;

  const investmentOptions = useInvestmentOptions(data.category);
  const isActiveStatus = (data.status ?? 'published') === 'published';
  const hasDeal = data.dealId !== null;

  // Sync local state when props change
  useEffect(() => {
    setLiked(data.isLiked);
    setLikeCount(data.likeCount);
  }, [data.isLiked, data.likeCount]);

  useEffect(() => {
    setSaved(data.isSaved);
    setSaveCount(data.saveCount);
  }, [data.isSaved, data.saveCount]);

  const handleTap = useCallback(() => {
    if (data.mediaType !== 'video') return;
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      lastTapRef.current = 0;
      setShowHeart(true);
      setTimeout(() => setShowHeart(false), 800);
      handleDoubleTapLike();
    } else {
      lastTapRef.current = now;
      setTimeout(() => {
        if (lastTapRef.current === now) {
          setPaused((p) => !p);
        }
      }, 330);
    }
  }, []);

  const handleDoubleTapLike = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!liked) {
      setLiked(true);
      setLikeCount((prev) => prev + 1);
    }
    onLike(data);
  }, [liked, onLike, data]);

  const handleLikePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((prev) => prev + (nextLiked ? 1 : -1));
    onLike(data);
  }, [liked, onLike, data]);

  const handleSavePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextSaved = !saved;
    setSaved(nextSaved);
    setSaveCount((prev) => prev + (nextSaved ? 1 : -1));
    onSave(data);
  }, [saved, onSave, data]);

  const handleSharePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onShare(data);
  }, [onShare, data]);

  const handleCommentPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onComment(data);
  }, [onComment, data]);

  const handleViewDeal = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onOpenDeal(data);
  }, [onOpenDeal, data]);

  const handleInvestNow = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onInvest(data);
  }, [onInvest, data]);

  // Rail position: account for safe area in reel mode, fixed offset in feed mode
  const railBottom = isReel ? insets.bottom + 96 : 96;
  const infoBottom = isReel ? insets.bottom + 26 : 26;

  const renderMedia = () => {
    if (data.mediaType === 'video' && data.mediaUrl) {
      if (isReel) {
        // Reel mode: use ReelVideoPlayer with mount/unmount lifecycle
        if (shouldMountVideo) {
          return (
            <ReelVideoPlayer
              videoId={data.reelId}
              uri={data.mediaUrl}
              hlsUri={data.hlsUrl}
              posterUri={data.posterUrl}
              previewBlurUri={data.previewBlurUrl}
              shouldPlay={shouldPlay}
              isMuted={isMuted}
              onProgress={handleProgress}
              testID={`${testIDPrefix}-player-${data.reelId}`}
            />
          );
        }
        // Unmounted: show poster to preserve scroll position
        return (
          <View style={StyleSheet.absoluteFill}>
            {data.posterUrl ? (
              <Image
                source={{ uri: data.posterUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={150}
              />
            ) : data.previewBlurUrl ? (
              <Image
                source={{ uri: data.previewBlurUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={20}
                transition={100}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111' }]} />
            )}
          </View>
        );
      }
      // Feed mode: use SafeVideo with viewability-based playback
      return (
        <SafeVideo
          uri={data.mediaUrl}
          posterUri={data.posterUrl ?? undefined}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          shouldPlay={shouldPlay}
          isMuted={isMuted}
          isLooping
          testID={`${testIDPrefix}-video-${data.reelId}`}
        />
      );
    }
    // Image media
    if (data.mediaUrl) {
      return (
        <Image
          source={{ uri: data.mediaUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
        />
      );
    }
    // Fallback: dark background
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111' }]} />;
  };

  return (
    <View
      ref={viewRef}
      style={[styles.container, { height: cardHeight }]}
      testID={`${testIDPrefix}-${data.reelId}`}
    >
      {/* Full-bleed media */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={handleTap}
        testID={`${testIDPrefix}-touch-${data.reelId}`}
      >
        {renderMedia()}
      </TouchableOpacity>

      {/* Progress bar (video only) */}
      {data.mediaType === 'video' && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      )}

      {/* Center play button when paused (video only) */}
      {!shouldPlay && data.mediaType === 'video' && (
        <View pointerEvents="none" style={styles.centerPlay}>
          <View style={styles.centerPlayCircle}>
            <Play size={30} color="#000" fill="#000" />
          </View>
        </View>
      )}

      {/* Double-tap heart burst */}
      {showHeart && (
        <View pointerEvents="none" style={styles.burstHeart}>
          <Heart size={96} color={Colors.error} fill={Colors.error} />
        </View>
      )}

      {/* Right action rail — Instagram-style outline icons with counts */}
      <View style={[styles.rail, { bottom: railBottom }]}>
        <TouchableOpacity
          style={styles.railBtn}
          onPress={handleLikePress}
          testID={`${testIDPrefix}-like-${data.reelId}`}
          activeOpacity={0.8}
        >
          <View style={styles.railIconCircle}>
            <Heart
              size={isReel ? 28 : 24}
              color={liked ? Colors.error : '#fff'}
              strokeWidth={1.5}
            />
          </View>
          <Text style={styles.railCount}>{formatCount(likeCount)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          onPress={handleCommentPress}
          testID={`${testIDPrefix}-comment-${data.reelId}`}
          activeOpacity={0.8}
        >
          <View style={styles.railIconCircle}>
            <MessageCircle size={isReel ? 28 : 24} color="#fff" strokeWidth={1.5} />
          </View>
          <Text style={styles.railCount}>{formatCount(data.commentCount)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          onPress={handleSavePress}
          testID={`${testIDPrefix}-save-${data.reelId}`}
          activeOpacity={0.8}
        >
          <View style={styles.railIconCircle}>
            <Bookmark
              size={isReel ? 28 : 24}
              color={saved ? Colors.primary : '#fff'}
              strokeWidth={1.5}
            />
          </View>
          <Text style={styles.railCount}>{formatCount(saveCount)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          onPress={handleSharePress}
          testID={`${testIDPrefix}-share-${data.reelId}`}
          activeOpacity={0.8}
        >
          <View style={styles.railIconCircle}>
            <Share2 size={isReel ? 28 : 24} color="#fff" strokeWidth={1.5} />
          </View>
          <Text style={styles.railCount}>{formatCount(data.shareCount)}</Text>
        </TouchableOpacity>

        {data.mediaType === 'video' && (
          <TouchableOpacity
            style={styles.railBtn}
            onPress={onToggleMute}
            testID={`${testIDPrefix}-mute-${data.reelId}`}
            activeOpacity={0.8}
          >
            <View style={styles.railIconCircle}>
              {isMuted ? <VolumeX size={24} color="#fff" strokeWidth={1.5} /> : <Volume2 size={24} color="#fff" strokeWidth={1.5} />}
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Full-bleed transparent bottom scrim — Instagram style, no boxy card */}
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.72)']}
        locations={[0, 0.45, 1]}
        style={styles.bottomScrim}
      />

      {/* Bottom info + CTAs — fully transparent background over the scrim */}
      <View pointerEvents="box-none" style={[styles.info, { bottom: infoBottom }]}>
        {/* Badges */}
        <View style={styles.badgeRow}>
          {hasDeal && <Text style={styles.badgeInvestment}>INVESTMENT</Text>}
          {isActiveStatus && <Text style={styles.badgeActive}>ACTIVE</Text>}
        </View>

        {/* Title */}
        <Text style={styles.infoTitle} numberOfLines={1}>
          {data.title}
        </Text>
        {data.subtitle ? (
          <Text style={styles.infoSubtitle} numberOfLines={1}>
            {data.subtitle}
          </Text>
        ) : null}
        {data.location ? (
          <Text style={styles.infoLocation} numberOfLines={1}>
            {data.location}
          </Text>
        ) : null}

        {/* Metrics */}
        <View style={styles.metricRow}>
          {data.roi != null && data.roi > 0 ? (
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{data.roi}%</Text>
              <Text style={styles.metricLabel}>TARGET ROI</Text>
            </View>
          ) : null}
          {data.minimumInvestment != null && data.minimumInvestment > 0 ? (
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{compactCurrency(data.minimumInvestment)}</Text>
              <Text style={styles.metricLabel}>MIN INVEST</Text>
            </View>
          ) : null}
          {data.minimumOwnership ? (
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{data.minimumOwnership}</Text>
              <Text style={styles.metricLabel}>MIN OWNERSHIP</Text>
            </View>
          ) : null}
        </View>

        {/* Investment category options */}
        <View style={styles.optionsRow}>
          {investmentOptions.map((option) => (
            <View key={option.id} style={styles.optionIcon}>
              <View style={[styles.optionIconCircle, { borderColor: `${option.tint}66` }]}>
                {option.icon}
              </View>
              <Text style={styles.optionIconLabel}>{option.label}</Text>
            </View>
          ))}
        </View>

        {/* CTAs */}
        <View style={styles.ctaRow}>
          {hasDeal && (
            <TouchableOpacity
              style={styles.viewDealBtn}
              onPress={handleViewDeal}
              activeOpacity={0.85}
              testID={`${testIDPrefix}-view-deal-${data.reelId}`}
            >
              <Text style={styles.viewDealText}>View Deal</Text>
            </TouchableOpacity>
          )}
          {hasDeal && (
            <TouchableOpacity
              style={styles.investNowBtn}
              onPress={handleInvestNow}
              activeOpacity={0.85}
              testID={`${testIDPrefix}-invest-${data.reelId}`}
            >
              <Text style={styles.investNowText}>Invest Now</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});

export default CanonicalInvestmentReelCard;

// ─── Adapter functions ─────────────────────────────────────────────────

import type { FeedVideo } from '@/lib/video-feed';
import type { HomeFeedDeal } from '@/lib/video-feed';
import type { ParsedJVDeal } from '@/lib/parse-deal';
import type { PublishedDealCardModel } from '@/lib/published-deal-card-model';
import { resolveDealPhotos } from '@/lib/parse-deal';
import { buildOwnershipSnapshot } from '@/lib/ownership-math';
import { formatCurrencyCompact } from '@/lib/formatters';

/**
 * Map a FeedVideo (from the video platform API) to CanonicalReelData.
 */
export function feedVideoToReelData(video: FeedVideo): CanonicalReelData {
  const deal = video.deal ?? null;
  const mediaType: ReelMediaType = video.video_url ? 'video' : 'image';
  const minOwnership = deal?.price && deal?.min_investment
    ? `${((deal.min_investment / deal.price) * 100).toFixed(4)}%`
    : null;

  // Parse title: "Property Name — Tour Label" or "Property Name — City, State"
  const rawTitle = video.title ?? deal?.title ?? 'IVX Holdings';
  const locationMatch = rawTitle.match(/(.+?)\s*[—–]\s*([^,]+,\s*[A-Z]{2})/);
  let title = rawTitle;
  let subtitle = 'Property Tour';
  let location: string | null = null;

  if (locationMatch) {
    title = locationMatch[1].trim();
    location = locationMatch[2].trim();
  } else {
    const tourMatch = rawTitle.match(/(.+?)\s*[—–]\s*(.+)/);
    if (tourMatch) {
      title = tourMatch[1].trim();
      const tour = tourMatch[2].trim();
      const isLocation = /,\s*[A-Z]{2}/.test(tour);
      location = isLocation ? tour : null;
      subtitle = isLocation ? 'Property Tour' : tour;
    }
  }

  return {
    reelId: video.id,
    dealId: deal?.id ?? null,
    propertyId: video.property_id ?? video.project_id ?? null,
    investmentId: deal?.id ?? null,
    slug: null,
    title: deal?.title ?? title,
    subtitle,
    location,
    mediaUrl: video.video_url,
    mediaType,
    hlsUrl: video.hls_url,
    posterUrl: video.poster_url ?? video.thumbnail_url,
    previewBlurUrl: video.preview_blur_url,
    roi: deal?.expected_roi ? parseFloat(deal.expected_roi) : null,
    minimumInvestment: deal?.min_investment ?? null,
    minimumOwnership: minOwnership,
    status: video.status ?? 'published',
    category: deal?.deal_type ?? null,
    likeCount: video.like_count ?? 0,
    commentCount: video.comment_count ?? 0,
    saveCount: video.save_count ?? 0,
    shareCount: video.share_count ?? 0,
    isLiked: false,
    isSaved: false,
    audioEnabled: true,
    creatorId: video.creator_id ?? null,
    dealUrl: deal?.url ?? null,
  };
}

/**
 * Map a HomeFeedDeal (from the home feed API) to CanonicalReelData.
 */
export function homeFeedDealToReelData(deal: HomeFeedDeal): CanonicalReelData {
  return {
    reelId: `deal-${deal.id}`,
    dealId: deal.id,
    propertyId: null,
    investmentId: deal.id,
    slug: null,
    title: deal.name ?? 'IVX Investment',
    subtitle: deal.phase ?? 'Investment Opportunity',
    location: deal.city ?? null,
    mediaUrl: deal.photo_url,
    mediaType: deal.photo_url ? 'image' : 'video',
    hlsUrl: null,
    posterUrl: deal.photo_url,
    previewBlurUrl: null,
    roi: deal.expected_roi ? parseFloat(deal.expected_roi) : null,
    minimumInvestment: deal.min_investment ?? null,
    minimumOwnership: null,
    status: deal.status ?? 'published',
    category: deal.deal_type ?? null,
    likeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    isLiked: false,
    isSaved: false,
    audioEnabled: false,
    creatorId: null,
    dealUrl: deal.url ?? null,
  };
}

/**
 * Map a ParsedJVDeal (from Supabase JV deals) to CanonicalReelData.
 */
export function parsedDealToReelData(deal: ParsedJVDeal): CanonicalReelData {
  const photos = resolveDealPhotos({
    id: deal.id,
    title: deal.title,
    projectName: deal.projectName,
    photos: deal.photos,
    publishedAt: deal.publishedAt,
    created_at: deal.created_at,
    updatedAt: typeof deal.updatedAt === 'string' ? deal.updatedAt : null,
    updated_at: typeof deal.updated_at === 'string' ? deal.updated_at : null,
  });

  const location = deal.city && deal.state
    ? `${deal.city}, ${deal.state}`
    : deal.propertyAddress ?? null;

  const minInvestment = deal.trustMarket?.minInvestment ?? 50;
  const salePrice = deal.trustMarket?.salePrice ?? deal.propertyValue ?? deal.totalInvestment ?? 0;
  const ownershipSnapshot = buildOwnershipSnapshot(minInvestment, salePrice);
  const minOwnership = `${ownershipSnapshot.ownershipPercent.toFixed(4)}%`;

  return {
    reelId: `deal-${deal.id}`,
    dealId: deal.id,
    propertyId: null,
    investmentId: deal.id,
    slug: null,
    title: deal.title || deal.projectName || 'IVX Investment',
    subtitle: 'Investment Opportunity',
    location,
    mediaUrl: photos[0] ?? null,
    mediaType: photos[0] ? 'image' : 'video',
    hlsUrl: null,
    posterUrl: photos[0] ?? null,
    previewBlurUrl: null,
    roi: deal.expectedROI ?? null,
    minimumInvestment: minInvestment,
    minimumOwnership: minOwnership,
    status: deal.status ?? 'published',
    category: deal.type ?? null,
    likeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    isLiked: false,
    isSaved: false,
    audioEnabled: false,
    creatorId: null,
    dealUrl: `https://ivxholding.com/invest/${deal.id}`,
  };
}

/**
 * Map a PublishedDealCardModel (canonical published deals) to CanonicalReelData.
 */
export function publishedCardToReelData(
  card: PublishedDealCardModel,
  resolvedPhotos: string[],
): CanonicalReelData {
  const location = card.city && card.state
    ? `${card.city}, ${card.state}`
    : card.addressShort ?? card.addressFull ?? null;

  return {
    reelId: `published-${card.id}`,
    dealId: card.id,
    propertyId: null,
    investmentId: card.id,
    slug: null,
    title: card.title || card.projectName || 'IVX Investment',
    subtitle: 'Investment Opportunity',
    location,
    mediaUrl: resolvedPhotos[0] ?? (card.photos && card.photos.length > 0 ? card.photos[0] : null) ?? null,
    mediaType: 'image' as const,
    hlsUrl: null,
    posterUrl: resolvedPhotos[0] ?? (card.photos && card.photos.length > 0 ? card.photos[0] : null) ?? null,
    previewBlurUrl: null,
    roi: card.expectedROI ?? null,
    minimumInvestment: card.minInvestment ?? null,
    minimumOwnership: card.ownershipText ?? null,
    status: card.status ?? 'published',
    category: card.dealType ?? null,
    likeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    isLiked: false,
    isSaved: false,
    audioEnabled: false,
    creatorId: null,
    dealUrl: `https://ivxholding.com/invest/${card.id}`,
  };
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: '100%' as const,
    backgroundColor: '#000',
    overflow: 'hidden' as const,
  },
  progressBar: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    zIndex: 21,
  },
  progressFill: {
    height: '100%' as const,
    backgroundColor: Colors.primary,
  },
  centerPlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 25,
  },
  centerPlayCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  burstHeart: {
    position: 'absolute' as const,
    top: '50%' as const,
    left: '50%' as const,
    marginLeft: -48,
    marginTop: -48,
    zIndex: 26,
  },
  rail: {
    position: 'absolute' as const,
    right: 10,
    zIndex: 20,
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: 16,
  },
  railBtn: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  railIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  railCount: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700' as const,
    marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  info: {
    position: 'absolute' as const,
    left: 14,
    right: 84,
    zIndex: 20,
  },
  bottomScrim: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    height: 340,
    zIndex: 10,
  },
  badgeRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginBottom: 8,
  },
  badgeInvestment: {
    backgroundColor: Colors.primary,
    borderRadius: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    color: '#000',
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    overflow: 'hidden' as const,
  },
  badgeActive: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    overflow: 'hidden' as const,
  },
  infoTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800' as const,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  infoSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontWeight: '600' as const,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  infoLocation: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  metricRow: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 8,
    flexWrap: 'wrap' as const,
  },
  metric: {
    alignItems: 'center' as const,
  },
  metricValue: {
    color: Colors.primary,
    fontSize: 20,
    fontWeight: '800' as const,
  },
  metricLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 10,
    fontWeight: '600' as const,
    marginTop: 4,
    textTransform: 'uppercase' as const,
  },
  optionsRow: {
    flexDirection: 'row' as const,
    gap: 14,
    marginTop: 10,
  },
  optionIcon: {
    alignItems: 'center' as const,
  },
  optionIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  optionIconLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600' as const,
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  ctaRow: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 14,
  },
  viewDealBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewDealText: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  investNowBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center' as const,
  },
  investNowText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800' as const,
  },
});
