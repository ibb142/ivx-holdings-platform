/**
 * Instagram-style property video card — Android/Expo mirror of the iOS
 * `DealVideoCard.swift` and the landing-page home feed card.
 *
 * Header row with IVX avatar, autoplaying muted looping video, action rail
 * (like / comment / share / save), real engagement counts, caption, deal chips
 * with a gold "View Deal" / "Invest Now" CTA.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, Alert, AppState, Platform, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { ResizeMode } from 'expo-av';
import { useRouter } from 'expo-router';
import SafeVideo from './SafeVideo';
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  Volume2,
  VolumeX,
  MoreHorizontal,
  Hexagon,
  Users,
  Home,
  Play,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { toggleProjectLike, trackProjectShare } from '@/lib/project-engagement';
import { toggleVideoSave, reportVideo, getViewerId, buildVideoShareUrl } from '@/lib/video-platform';
import type { FeedVideo } from '@/lib/video-feed';

const MEDIA_HEIGHT = 230;

function compactCurrency(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `$${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}K`;
  }
  return `$${Math.round(value)}`;
}

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function Chip({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={[styles.chipValue, { color: tint }]}>{value}</Text>
    </View>
  );
}

type InvestmentOption = { id: string; label: string; icon: React.ReactNode; tint: string };

function useInvestmentOptions(dealType: string | null | undefined): InvestmentOption[] {
  const t = (dealType ?? '').toLowerCase();
  const tokenized: InvestmentOption = { id: 'tokenized', label: 'Tokenized', icon: <Hexagon size={16} color={Colors.primary} />, tint: Colors.primary };
  const jvDeals: InvestmentOption = { id: 'jvDeals', label: 'JV Deal', icon: <Users size={16} color={Colors.blue} />, tint: Colors.blue };
  const buyers: InvestmentOption = { id: 'buyers', label: 'Buyer', icon: <Home size={16} color={Colors.green} />, tint: Colors.green };
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
      return [jvDeals, tokenized, buyers];
  }
}

function OptionIcon({ option }: { option: InvestmentOption }) {
  return (
    <View style={styles.optionIcon}>
      <View style={[styles.optionIconCircle, { borderColor: option.tint + '66' }]}>
        {option.icon}
      </View>
      <Text style={styles.optionIconLabel}>{option.label}</Text>
    </View>
  );
}

export default function DealVideoCard({ video }: { video: FeedVideo }) {
  const router = useRouter();
  const { height: screenHeight } = useWindowDimensions();
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [liked, setLiked] = useState<boolean>(false);
  const [likeCount, setLikeCount] = useState<number>(video.like_count ?? 0);
  const [saved, setSaved] = useState<boolean>(false);
  const [saveCount, setSaveCount] = useState<number>(video.save_count ?? 0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [isInViewport, setIsInViewport] = useState<boolean>(false);
  const [appState, setAppState] = useState<string>('active');
  const viewRef = useRef<View>(null);

  React.useEffect(() => {
    void getViewerId().then(setViewerId);
  }, []);

  // Pause video when app goes to background — prevents ExoPlayer resource leak.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: string) => {
      setAppState(nextState);
    });
    return () => subscription.remove();
  }, []);

  // Viewability detection — only play when the card is at least 60% visible.
  // This prevents multiple simultaneous players from crashing Android.
  useEffect(() => {
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
  }, [appState, screenHeight]);

  const shouldPlay = isInViewport && appState === 'active';

  const deal = video.deal ?? null;
  // On Android, prefer progressive MP4 over HLS to avoid expo-av crashes.
  const isAndroid = typeof Platform !== 'undefined' && Platform.OS === 'android';
  const playbackUri = (() => {
    if (isAndroid) {
      if (video.video_url && !video.video_url.toLowerCase().endsWith('.m3u8')) return video.video_url;
      if (video.hls_url && !video.hls_url.toLowerCase().endsWith('.m3u8')) return video.hls_url;
      return video.video_url ?? video.hls_url ?? null;
    }
    return video.hls_url ?? video.video_url ?? null;
  })();
  const posterUri = video.poster_url ?? video.thumbnail_url ?? video.preview_blur_url ?? undefined;
  const investmentOptions = useInvestmentOptions(deal?.deal_type);

  const toggleMute = useCallback(() => setIsMuted(prev => !prev), []);

  const handleLike = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount(prev => prev + (nextLiked ? 1 : -1));
    try {
      const result = await toggleProjectLike(video.id, null);
      setLiked(result.liked);
      setLikeCount(result.likeCount);
    } catch {
      setLiked(liked);
      setLikeCount(video.like_count ?? 0);
    }
  }, [liked, video.id, video.like_count]);

  const handleSave = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextSaved = !saved;
    setSaved(nextSaved);
    setSaveCount(prev => prev + (nextSaved ? 1 : -1));
    try {
      const result = await toggleVideoSave(video.id, viewerId);
      setSaved(result.saved);
      setSaveCount(result.saveCount);
    } catch {
      setSaved(saved);
      setSaveCount(video.save_count ?? 0);
    }
  }, [saved, video.id, video.save_count, viewerId]);

  const handleComment = useCallback(() => {
    router.push({ pathname: '/videos', params: { type: 'reel', focus: video.id } } as any);
  }, [router, video.id]);

  const handleShare = useCallback(async () => {
    const url = buildVideoShareUrl(video.id);
    const message = `${video.title ?? 'IVX Property'} — ${url}`;
    try {
      await Share.share({ message });
      void trackProjectShare(video.id, 'social', null);
    } catch {}
  }, [video.id, video.title]);

  const handleReport = useCallback(() => {
    Alert.prompt('Report this video', 'Reason:', async (reason) => {
      if (!reason) return;
      const result = await reportVideo(video.id, reason, viewerId);
      Alert.alert(result.ok ? 'Report submitted' : 'Report failed');
    });
  }, [video.id, viewerId]);

  const handleViewDeal = useCallback(() => {
    if (deal?.id) {
      router.push({ pathname: '/jv-invest', params: { jvId: deal.id } } as any);
    }
  }, [deal, router]);

  const handleInvestNow = useCallback(() => {
    if (deal?.id) {
      router.push({ pathname: '/jv-invest', params: { jvId: deal.id } } as any);
    }
  }, [deal, router]);

  return (
    <View ref={viewRef} style={styles.card} testID={`deal-video-card-${video.id}`}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>IVX</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.accountName}>ivxholdings</Text>
          <Text style={styles.propertyName} numberOfLines={1}>
            {deal?.title ?? video.title ?? 'IVX Holdings'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleReport} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MoreHorizontal size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Media — uses SafeVideo for Android crash protection */}
      <TouchableOpacity activeOpacity={1} onPress={toggleMute} style={styles.media}>
        {shouldPlay ? (
          <SafeVideo
            uri={playbackUri}
            posterUri={posterUri}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            shouldPlay={shouldPlay}
            isMuted={isMuted}
            isLooping
            testID={`deal-video-player-${video.id}`}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.surfaceElevated }]}>
            {posterUri ? (
              <React.Fragment>
                <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                <View style={styles.playOverlay}>
                  <View style={styles.playCircle}>
                    <Play size={20} color={Colors.black} fill={Colors.black} />
                  </View>
                </View>
              </React.Fragment>
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.surfaceElevated }]} />
            )}
          </View>
        )}
        <TouchableOpacity style={styles.muteBtn} onPress={toggleMute} testID={`deal-video-mute-${video.id}`}>
          {isMuted ? <VolumeX size={14} color={Colors.white} /> : <Volume2 size={14} color={Colors.white} />}
        </TouchableOpacity>
      </TouchableOpacity>

      {/* Action rail */}
      <View style={styles.actionRail}>
        <TouchableOpacity onPress={handleLike} testID={`deal-video-like-${video.id}`}>
          <Heart
            size={24}
            color={liked ? Colors.error : Colors.white}
            fill={liked ? Colors.error : 'transparent'}
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleComment} testID={`deal-video-comment-${video.id}`}>
          <MessageCircle size={24} color={Colors.white} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShare} testID={`deal-video-share-${video.id}`}>
          <Send size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={styles.railSpacer} />
        <TouchableOpacity onPress={handleSave} testID={`deal-video-save-${video.id}`}>
          <Bookmark
            size={24}
            color={saved ? Colors.primary : Colors.white}
            fill={saved ? Colors.primary : 'transparent'}
          />
        </TouchableOpacity>
      </View>

      {/* Likes line */}
      <Text style={styles.likesLine}>
        {formatCount(likeCount)} like{likeCount === 1 ? '' : 's'}
      </Text>

      {/* Caption */}
      <Text style={styles.caption} numberOfLines={2}>
        <Text style={styles.captionBold}>ivxholdings </Text>
        {video.title ?? 'Property tour'}
      </Text>

      {/* Deal chips + CTAs */}
      {deal ? (
        <View style={styles.dealSection}>
          <View style={styles.chipsRow}>
            {deal.expected_roi ? <Chip label="ROI" value={`${deal.expected_roi}%`} tint={Colors.green} /> : null}
            {deal.price && deal.price > 0 ? <Chip label="Value" value={compactCurrency(deal.price)} tint={Colors.primary} /> : null}
            {deal.min_investment && deal.min_investment > 0 ? (
              <Chip label="Min" value={compactCurrency(deal.min_investment)} tint={Colors.text} />
            ) : null}
          </View>
          <View style={styles.optionsRow}>
            {investmentOptions.map((option) => (
              <OptionIcon key={option.id} option={option} />
            ))}
          </View>
          <View style={styles.ctaRow}>
            <TouchableOpacity
              style={styles.viewDealBtn}
              onPress={handleViewDeal}
              activeOpacity={0.85}
              testID={`deal-video-view-${video.id}`}
            >
              <Text style={styles.viewDealText}>View Deal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.investNowBtn}
              onPress={handleInvestNow}
              activeOpacity={0.85}
              testID={`deal-video-invest-${video.id}`}
            >
              <Text style={styles.investNowText}>Invest Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ height: 12 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden' as const,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.primary + '66',
  },
  avatarText: {
    color: Colors.black,
    fontSize: 10,
    fontWeight: '900' as const,
  },
  headerText: {
    flex: 1,
  },
  accountName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  propertyName: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
  media: {
    height: MEDIA_HEIGHT,
    backgroundColor: Colors.background,
  },
  muteBtn: {
    position: 'absolute' as const,
    right: 10,
    bottom: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  railSpacer: {
    flex: 1,
  },
  likesLine: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  caption: {
    color: Colors.text,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingTop: 3,
  },
  captionBold: {
    fontWeight: '700' as const,
  },
  dealSection: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  chipLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
  },
  chipValue: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  optionIcon: {
    alignItems: 'center',
    gap: 3,
  },
  optionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  optionIconLabel: {
    color: Colors.text,
    fontSize: 9,
    fontWeight: '600' as const,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  viewDealBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  viewDealText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  investNowBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
  },
  investNowText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.overlay,
  },
  playCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
