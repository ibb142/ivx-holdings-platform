/**
 * Investor-first home feed — renders the CANONICAL block sequence from
 * GET /api/ivx/video-platform/home-feed (same source of truth as the landing
 * page and iOS app):
 *
 *   Deal 1 (InvestmentCard) → Deal 2 (InvestmentCard) → Deal 3 (InvestmentCard)
 *   → 1 Featured Project Video (poster-only preview) → repeat.
 *
 * Deal blocks render as compact InvestmentCard (carousel + metrics + CTAs).
 * Video blocks render without a native player; tapping opens the Reels route.
 * No deal is ever rendered as a reel — explicit display_type mapping.
 */
import React, { Component, useCallback, useMemo, type ReactNode } from 'react';
import { Image, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Landmark, Sparkles, TrendingUp } from 'lucide-react-native';
import Colors from '@/constants/colors';
import InvestmentCard, { type InvestmentCardData } from '@/components/InvestmentCard';
import { fetchHomeFeed, type HomeFeedBlock, type HomeFeedDeal } from '@/lib/home-feed';
import type { JVAgreement } from '@/types/jv';
import { trackProjectShare } from '@/lib/project-engagement';
import { toggleVideoLike, toggleVideoSave, getViewerId } from '@/lib/video-platform';
import { resolveDealPhotos } from '@/lib/parse-deal';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

/** Per-card error boundary so one bad card never crashes the home feed */
class CardBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error) { console.warn('[InvestorFirstFeed] Card crashed:', err.message); }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>Content temporarily unavailable</Text>
        </View>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

/** Map a HomeFeedDeal + local JV deal to InvestmentCardData */
function homeFeedDealToInvestmentCard(
  deal: HomeFeedDeal,
  local: JVAgreement | undefined,
): InvestmentCardData {
  let photos: string[] = [];
  if (local) {
    photos = resolveDealPhotos({
      id: local.id,
      title: local.title,
      projectName: local.projectName,
      photos: local.photos,
      publishedAt: local.publishedAt,
      created_at: (local as unknown as Record<string, unknown>).created_at as string | undefined,
      updatedAt: local.updatedAt,
      updated_at: (local as unknown as Record<string, unknown>).updated_at as string | undefined});
  }
  if (photos.length === 0 && deal.photo_url) {
    photos = [deal.photo_url];
  }

  return {
    dealId: deal.id,
    title: deal.name ?? 'IVX Investment',
    location: deal.city ?? null,
    photos,
    roi: deal.expected_roi ? parseFloat(deal.expected_roi) : (local?.expectedROI ?? null),
    minimumInvestment: deal.min_investment ?? (local?.poolTiers?.[0]?.minInvestment ?? null),
    status: deal.status ?? 'published',
    category: deal.deal_type ?? (local?.type ?? null),
    dealUrl: deal.url ?? null,
    likeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    isLiked: false,
    isSaved: false,
    salePrice: null,
    totalInvestment: null,
    timelineMin: null,
    timelineMax: null,
    timelineUnit: null,
    minimumOwnershipPercent: null,
    fractionalStartAmount: null,
    developerName: null,
    developerLogo: null,
    investmentDetails: null,
    timelineSummary: null};
}

export default function InvestorFirstFeed({ jvDeals, jvDealsLoading, isXs, cardWidth, openQuickBuy }: {
  jvDeals: JVAgreement[];
  jvDealsLoading: boolean;
  isXs: boolean;
  cardWidth: number;
  openQuickBuy: (deal: JVAgreement) => void;
}) {
  const router = useRouter();
  const padH = isXs ? 16 : 20;

  const homeFeedQuery = useQuery({
    queryKey: ['ivx-home-feed'],
    queryFn: () => fetchHomeFeed(60),
    retry: 1,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false});

  const localById = useMemo(() => {
    const map = new Map<string, JVAgreement>();
    for (const d of jvDeals) if (d?.id) map.set(String(d.id), d);
    return map;
  }, [jvDeals]);

  /** Canonical blocks from the backend; local-only fallback keeps the page alive offline. */
  const blocks = useMemo<HomeFeedBlock[]>(() => {
    const remote = homeFeedQuery.data?.blocks ?? [];
    if (remote.length > 0) return remote;
    return jvDeals.map((d, i) => ({
      position: i,
      type: 'deal' as const,
      display_type: 'investment_card' as const,
      deal: {
        id: String(d.id),
        name: d.projectName || d.title || null,
        city: d.propertyAddress ?? null,
        phase: null,
        status: d.status ?? null,
        deal_type: d.type ?? null,
        investment_amount: d.totalInvestment ?? null,
        expected_roi: d.expectedROI != null ? String(d.expectedROI) : null,
        min_investment: d.poolTiers?.[0]?.minInvestment ?? null,
        progress_percent: null,
        photo_url: null,
        url: `https://ivxholding.com/?deal=${d.id}#deals`,
        is_featured: false,
        priority: 0,
        display_order: null,
        created_at: d.createdAt ?? null}}));
  }, [homeFeedQuery.data?.blocks, jvDeals]);

  const goToDeal = useCallback((dealId: string) => {
    router.push({ pathname: '/jv-invest', params: { jvId: dealId } } as any);
  }, [router]);

  // InvestmentCard callbacks
  const handleCardLike = useCallback(async (data: InvestmentCardData) => {
    const viewerId = await getViewerId().catch(() => null);
    void toggleVideoLike(`deal-${data.dealId}`, viewerId).catch(() => {});
  }, []);

  const handleCardSave = useCallback(async (data: InvestmentCardData) => {
    const viewerId = await getViewerId().catch(() => null);
    void toggleVideoSave(`deal-${data.dealId}`, viewerId).catch(() => {});
  }, []);

  const handleCardShare = useCallback(async (data: InvestmentCardData) => {
    const url = data.dealUrl ?? `https://ivxholding.com/invest/${data.dealId}`;
    try {
      await Share.share({ message: `${data.title} — ${url}` });
      void trackProjectShare(data.dealId, 'social', null);
    } catch {}
  }, []);

  const handleCardComment = useCallback((data: InvestmentCardData) => {
    router.push({ pathname: '/videos', params: { type: 'reel', focus: `deal-${data.dealId}` } } as any);
  }, [router]);

  const isLoading = (homeFeedQuery.isLoading && jvDealsLoading) || (homeFeedQuery.isLoading && blocks.length === 0);

  return (
    <View style={styles.section}>
      <View style={[styles.header, { paddingHorizontal: padH }]}>
        <View style={styles.titleRow}>
          <Sparkles size={isXs ? 16 : 18} color={Colors.primary} />
          <Text style={[styles.title, { fontSize: isXs ? 16 : 18 }]}>Featured Deals</Text>
        </View>
        <View style={styles.liveBadge}>
          <TrendingUp size={11} color={Colors.success} />
          <Text style={styles.liveBadgeText}>Investor First</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={[styles.loadingBox, { marginHorizontal: padH }]}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Syncing live deals...</Text>
        </View>
      ) : blocks.length === 0 ? (
        <View style={styles.emptyBox}>
          <Landmark size={32} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No deals available yet</Text>
          <Text style={styles.emptySubtitle}>Check back soon for new opportunities</Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: padH, gap: 14, alignItems: 'center' }}>
          {blocks.map((block) => {
            // Home must never initialize expo-av/ExoPlayer. On affected Samsung
            // devices, mounting the native player while the Home route starts can
            // terminate the activity before a React error boundary can paint.
            // Render a poster-only preview and initialize video only in /videos.
            if (block.type === 'video') {
              const poster = block.video.poster_url ?? block.video.thumbnail_url ?? block.video.cover_url ?? null;
              const title = block.video.title ?? block.video.deal?.title ?? 'IVX Project Update';
              return (
                <CardBoundary key={`video-${block.video.id}`}>
                  <TouchableOpacity
                    style={styles.videoPreview}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Open project video: ${title}`}
                    testID={`home-video-preview-${block.video.id}`}
                    onPress={() => router.push({ pathname: '/videos', params: { type: 'reel', focus: block.video.id } } as any)}
                  >
                    {poster ? <Image source={{ uri: poster }} style={styles.videoPoster} resizeMode="cover" /> : null}
                    <View style={styles.videoOverlay}>
                      <View style={styles.playButton}><Text style={styles.playIcon}>▶</Text></View>
                      <Text style={styles.videoTitle} numberOfLines={2}>{title}</Text>
                      <Text style={styles.videoHint}>Tap to open Project Reels</Text>
                    </View>
                  </TouchableOpacity>
                </CardBoundary>
              );
            }

            // DEAL block → InvestmentCard (compact card, NOT a reel)
            const local = localById.get(block.deal.id);
            const cardData = homeFeedDealToInvestmentCard(block.deal, local);
            return (
              <CardBoundary key={`deal-${block.deal.id}`}>
                <InvestmentCard
                  data={cardData}
                  onOpenDeal={(d) => goToDeal(d.dealId)}
                  onInvest={(d) => {
                    if (local) {
                      openQuickBuy(local);
                    } else {
                      goToDeal(d.dealId);
                    }
                  }}
                  onLike={handleCardLike}
                  onComment={handleCardComment}
                  onSave={handleCardSave}
                  onShare={handleCardShare}
                  testIDPrefix="home-card"
                />
              </CardBoundary>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14},
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  title: {
    fontWeight: '700' as const,
    color: Colors.text},
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8},
  liveBadgeText: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: '700' as const},
  loadingBox: {
    height: 200,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 10},
  emptyBox: {
    paddingVertical: 32,
    alignItems: 'center'},
  emptyTitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    marginTop: 10},
  emptySubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 4},
  videoPreview: {
    width: '100%',
    minHeight: 220,
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  videoPoster: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%'},
  videoOverlay: {
    minHeight: 220,
    justifyContent: 'flex-end',
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.48)'},
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    marginBottom: 12},
  playIcon: {
    color: '#000000',
    fontSize: 18,
    marginLeft: 2},
  videoTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800' as const},
  videoHint: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 4}});
