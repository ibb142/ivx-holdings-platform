/**
 * InvestmentCard — the ONE canonical compact investment card for IVX.
 *
 * Used by:
 *   • Main/Home feed (InvestorFirstFeed) for deal blocks
 *   • Search results
 *   • Saved deals
 *   • Portfolio deal previews
 *
 * Visual design (owner-approved):
 *   Compact card with horizontal image carousel (up to 8 photos)
 *   Image counter pill (top-right)
 *   Status badge (top-left)
 *   Property title + location
 *   Investment summary panel (Sale Price, Total Investment, ROI, Timeline)
 *   Timeline summary (duration, current stage, completion %)
 *   Minimum investment / ownership row
 *   Category chips (Tokenized / JV Deal / Buyer)
 *   Developer name
 *   Collapsible Details section
 *   Action row: Like, Comment, Save, Share
 *   CTA buttons: View Deal + Invest Now
 *   NO full-screen reel layout — always a card in a scroll feed
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  ScrollView,
  useWindowDimensions,
  LayoutAnimation,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import {
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  MapPin,
  TrendingUp,
  Hexagon,
  Users,
  Home as HomeIcon,
  ChevronRight,
  ImageOff,
  HardHat,
  Clock,
  DollarSign,
  PieChart,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Circle,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCount, compactCurrency } from '@/lib/reel-formatters';
import { formatCurrencyWithDecimals } from '@/lib/formatters';
import {
  type TimelineSummary,
  type TimelineStage,
  type TimelineStageStatus,
  getTimelineStatusColor,
  formatTimelineDate,
} from '@/lib/timeline-stages';

export interface InvestmentCardData {
  dealId: string;
  title: string;
  location: string | null;
  photos: string[];
  roi: number | null;
  minimumInvestment: number | null;
  status: string;
  category: string | null;
  dealUrl: string | null;
  likeCount: number;
  commentCount: number;
  saveCount: number;
  shareCount: number;
  isLiked: boolean;
  isSaved: boolean;
  // ── Restored old-card investment details ──
  salePrice: number | null;
  totalInvestment: number | null;
  timelineMin: number | null;
  timelineMax: number | null;
  timelineUnit: 'months' | 'years' | null;
  minimumOwnershipPercent: number | null;
  fractionalStartAmount: number | null;
  developerName: string | null;
  developerLogo: string | null;
  investmentDetails: string | null;
  timelineSummary: TimelineSummary | null;
}

export interface InvestmentCardProps {
  data: InvestmentCardData;
  onOpenDeal: (data: InvestmentCardData) => void;
  onInvest: (data: InvestmentCardData) => void;
  onLike: (data: InvestmentCardData) => void;
  onComment: (data: InvestmentCardData) => void;
  onSave: (data: InvestmentCardData) => void;
  onShare: (data: InvestmentCardData) => void;
  testIDPrefix?: string;
}

interface CategoryChip {
  id: string;
  label: string;
  icon: React.ReactNode;
  tint: string;
}

function useCategoryChips(dealType: string | null | undefined): CategoryChip[] {
  const t = (dealType ?? '').toLowerCase();

  // Tokenized is COMING SOON — not legally/technically production-ready
  const tokenized: CategoryChip = {
    id: 'tokenized',
    label: 'Tokenized',
    icon: <Hexagon size={13} color={Colors.textTertiary} />,
    tint: Colors.textTertiary,
  };
  const jv: CategoryChip = {
    id: 'jv',
    label: 'JV Deal',
    icon: <Users size={13} color={Colors.blue} />,
    tint: Colors.blue,
  };
  const buyer: CategoryChip = {
    id: 'buyer',
    label: 'Buyer',
    icon: <HomeIcon size={13} color={Colors.green} />,
    tint: Colors.green,
  };

  // Only show badges relevant to the deal type
  // Tokenized shows as greyed-out (COMING SOON) on all deals
  switch (t) {
    case 'jv':
    case 'equity_split':
    case 'hybrid':
      return [jv, tokenized, buyer];
    case 'development':
    case 'new_construction':
    case 'rehab_construction':
      return [jv, buyer, tokenized];
    case 'profit_sharing':
      return [buyer, tokenized, jv];
    default:
      return [jv, buyer, tokenized];
  }
}

/** Safe display helper — never show null/undefined/NaN. */
function safeText(value: string | null | undefined, fallback = 'Not available'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const str = String(value).trim();
  if (str === '' || str === 'null' || str === 'undefined' || str === 'NaN') return fallback;
  return str;
}

function safeNumber(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0;
}

const MAX_IMAGES = 8;
const CAROUSEL_HEIGHT = 240;

const InvestmentCard = memo(function InvestmentCard({
  data,
  onOpenDeal,
  onInvest,
  onLike,
  onComment,
  onSave,
  onShare,
  testIDPrefix = 'investment-card',
}: InvestmentCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.min(screenWidth - 32, 520);

  const photos = useMemo(
    () => (data.photos && data.photos.length > 0 ? data.photos.slice(0, MAX_IMAGES) : []),
    [data.photos],
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [liked, setLiked] = useState(data.isLiked);
  const [likeCount, setLikeCount] = useState(data.likeCount);
  const [saved, setSaved] = useState(data.isSaved);
  const [saveCount, setSaveCount] = useState(data.saveCount);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const categoryChips = useCategoryChips(data.category);
  const isActiveStatus = (data.status ?? 'published') === 'published';

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { x: number }; layoutMeasurement: { width: number } } }) => {
    const x = event.nativeEvent.contentOffset.x;
    const w = event.nativeEvent.layoutMeasurement.width;
    if (w > 0) {
      const idx = Math.round(x / w);
      if (idx >= 0 && idx < photos.length && idx !== activeIndex) {
        setActiveIndex(idx);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  }, [photos.length, activeIndex]);

  const handleLike = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !liked;
    setLiked(next);
    setLikeCount((p: number) => p + (next ? 1 : -1));
    onLike(data);
  }, [liked, onLike, data]);

  const handleSave = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !saved;
    setSaved(next);
    setSaveCount((p: number) => p + (next ? 1 : -1));
    onSave(data);
  }, [saved, onSave, data]);

  const handleShare = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onShare(data);
  }, [onShare, data]);

  const handleComment = useCallback(() => {
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

  const toggleDetails = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'android') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setDetailsExpanded(prev => !prev);
  }, []);

  // ── Investment summary values ──
  const salePriceLabel = safeNumber(data.salePrice)
    ? compactCurrency(data.salePrice!)
    : 'Not available';

  const totalInvestmentLabel = safeNumber(data.totalInvestment)
    ? compactCurrency(data.totalInvestment!)
    : 'Not available';

  const roiLabel = safeNumber(data.roi)
    ? `${data.roi}%`
    : 'Not available';

  const timelineLabel = useMemo(() => {
    if (data.timelineSummary && data.timelineSummary.estimatedTotalDuration) {
      return data.timelineSummary.estimatedTotalDuration;
    }
    const min = data.timelineMin;
    const max = data.timelineMax;
    const unit = data.timelineUnit === 'years' ? 'yr' : 'mo';
    if (min && min > 0 && max && max > 0) {
      return `${min}\u2013${max} ${unit}`;
    }
    if (max && max > 0) return `${max} ${unit}`;
    if (min && min > 0) return `${min} ${unit}`;
    return 'Timeline pending verification';
  }, [data.timelineMin, data.timelineMax, data.timelineUnit, data.timelineSummary]);

  const minInvestmentLabel = safeNumber(data.minimumInvestment)
    ? `From ${formatCurrencyWithDecimals(data.minimumInvestment!)}`
    : 'Not available';

  const minOwnershipLabel = safeNumber(data.minimumOwnershipPercent)
    ? `${data.minimumOwnershipPercent!.toFixed(4)}%`
    : 'Not available';

  const developerLabel = safeText(data.developerName, 'Not available');

  const summaryItems = useMemo(() => [
    { icon: <DollarSign size={12} color={Colors.primary} />, label: 'SALE PRICE', value: salePriceLabel },
    { icon: <PieChart size={12} color={Colors.blue} />, label: 'TOTAL INVESTMENT', value: totalInvestmentLabel },
    { icon: <TrendingUp size={12} color={Colors.success} />, label: 'TARGET ROI', value: roiLabel },
    { icon: <Clock size={12} color={Colors.warning} />, label: 'TIMELINE', value: timelineLabel },
  ], [salePriceLabel, totalInvestmentLabel, roiLabel, timelineLabel]);

  return (
    <View
      style={[styles.container, { width: cardWidth }]}
      testID={`${testIDPrefix}-${data.dealId}`}
    >
      {/* 1. Image Carousel */}
      <View style={styles.carouselContainer}>
        {photos.length > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            decelerationRate="fast"
            bounces={false}
            style={styles.carousel}
          >
            {photos.map((uri: string, i: number) => (
              <View key={i} style={[styles.imageFrame, { width: cardWidth }]}>
                <Image
                  source={{ uri }}
                  style={styles.image}
                  contentFit="cover"
                  transition={150}
                  testID={`${testIDPrefix}-img-${i}`}
                />
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={[styles.noImage, { width: cardWidth }]}>
            <ImageOff size={28} color={Colors.textTertiary} />
            <Text style={styles.noImageText}>No photos available</Text>
          </View>
        )}

        {/* 2. Status badge */}
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: isActiveStatus ? Colors.success : Colors.warning }]} />
          <Text style={styles.statusText}>{isActiveStatus ? 'ACTIVE' : 'PENDING'}</Text>
        </View>

        {/* Image counter */}
        {photos.length > 1 && (
          <View style={styles.counterPill}>
            <Text style={styles.counterText}>
              {activeIndex + 1}/{photos.length}
            </Text>
          </View>
        )}

        {/* Pagination dots */}
        {photos.length > 1 && (
          <View style={styles.dotsRow}>
            {photos.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === activeIndex && styles.dotActive]}
              />
            ))}
          </View>
        )}
      </View>

      {/* Card body */}
      <View style={styles.body}>
        {/* 3. Title + 4. Location */}
        <Text style={styles.title} numberOfLines={1} testID={`${testIDPrefix}-title-${data.dealId}`}>
          {data.title}
        </Text>
        {data.location ? (
          <View style={styles.locationRow}>
            <MapPin size={13} color={Colors.textSecondary} />
            <Text style={styles.locationText} numberOfLines={1}>{data.location}</Text>
          </View>
        ) : null}

        {/* 5. Main financial summary panel */}
        <View style={styles.summaryPanel} testID={`${testIDPrefix}-summary-${data.dealId}`}>
          {summaryItems.map((item, idx) => (
            <View
              key={item.label}
              style={[
                styles.summaryItem,
                idx < summaryItems.length - 1 && styles.summaryItemBorder,
              ]}
            >
              <View style={styles.summaryIconRow}>
                {item.icon}
                <Text style={styles.summaryLabel}>{item.label}</Text>
              </View>
              <Text style={styles.summaryValue} testID={`${testIDPrefix}-${item.label.replace(/\s/g, '-').toLowerCase()}-${data.dealId}`}>
                {item.value}
              </Text>
            </View>
          ))}
        </View>

        {/* 6. Timeline summary */}
        {data.timelineSummary && (
          <View style={styles.timelineSummaryBox} testID={`${testIDPrefix}-timeline-summary-${data.dealId}`}>
            <View style={styles.timelineSummaryHeader}>
              <Clock size={13} color={Colors.warning} />
              <Text style={styles.timelineSummaryTitle}>Project Timeline</Text>
            </View>
            <View style={styles.timelineSummaryRow}>
              <View style={styles.timelineSummaryItem}>
                <Text style={styles.timelineSummaryLabel}>Current Stage</Text>
                <Text style={styles.timelineSummaryValue} testID={`${testIDPrefix}-current-stage-${data.dealId}`}>
                  {safeText(data.timelineSummary.currentStage, 'Pending')}
                </Text>
              </View>
              <View style={styles.timelineSummaryItem}>
                <Text style={styles.timelineSummaryLabel}>Progress</Text>
                <Text style={styles.timelineSummaryValue} testID={`${testIDPrefix}-progress-${data.dealId}`}>
                  {data.timelineSummary.completionPercentage}%
                </Text>
              </View>
              <View style={styles.timelineSummaryItem}>
                <Text style={styles.timelineSummaryLabel}>Est. Completion</Text>
                <Text style={styles.timelineSummaryValue}>
                  {data.timelineSummary.estimatedCompletionDate
                    ? formatTimelineDate(data.timelineSummary.estimatedCompletionDate)
                    : 'Not available'}
                </Text>
              </View>
            </View>
            {/* Progress bar */}
            <View style={styles.progressBarContainer} testID={`${testIDPrefix}-progress-bar-${data.dealId}`}>
              <View style={[styles.progressBarFill, { width: `${Math.min(100, Math.max(0, data.timelineSummary.completionPercentage))}%` }]} />
            </View>
          </View>
        )}

        {/* 7. Minimum investment / ownership */}
        <View style={styles.minInvestRow} testID={`${testIDPrefix}-min-invest-${data.dealId}`}>
          <View style={styles.minInvestItem}>
            <Text style={styles.minInvestLabel}>MINIMUM INVESTMENT</Text>
            <Text style={styles.minInvestValue}>{minInvestmentLabel}</Text>
          </View>
          <View style={styles.minInvestDivider} />
          <View style={styles.minInvestItem}>
            <Text style={styles.minInvestLabel}>MINIMUM OWNERSHIP</Text>
            <Text style={styles.minInvestValue} testID={`${testIDPrefix}-min-ownership-${data.dealId}`}>{minOwnershipLabel}</Text>
          </View>
        </View>

        {/* 8. Categories */}
        <View style={styles.chipsRow}>
          {categoryChips.map((chip) => (
            <View key={chip.id} style={[styles.chip, { borderColor: `${chip.tint}44` }]}>
              {chip.icon}
              <Text style={[styles.chipLabel, { color: chip.tint }]}>{chip.label}</Text>
            </View>
          ))}
        </View>

        {/* 9. Developer */}
        <View style={styles.developerRow} testID={`${testIDPrefix}-developer-${data.dealId}`}>
          <HardHat size={13} color={Colors.primary} />
          <Text style={styles.developerText} numberOfLines={1}>
            Developed by <Text style={styles.developerBold}>{developerLabel}</Text>
          </Text>
        </View>

        {/* 10. Details button */}
        <TouchableOpacity
          style={styles.detailsBtn}
          onPress={toggleDetails}
          activeOpacity={0.85}
          testID={`${testIDPrefix}-details-${data.dealId}`}
        >
          <Text style={styles.detailsBtnText}>Details</Text>
          <ChevronDown
            size={16}
            color={Colors.textSecondary}
            style={detailsExpanded ? styles.chevronRotated : undefined}
          />
        </TouchableOpacity>

        {/* Collapsible details section */}
        {detailsExpanded && (
          <View style={styles.detailsSection} testID={`${testIDPrefix}-details-section-${data.dealId}`}>
            {data.investmentDetails ? (
              <Text style={styles.detailsText}>{data.investmentDetails}</Text>
            ) : (
              <Text style={styles.detailsText}>Project overview, investment structure, use of funds, and disclosures are available on the deal detail page.</Text>
            )}

            {/* Investment structure summary */}
            <View style={styles.detailsSubSection}>
              <Text style={styles.detailsSubTitle}>Investment Structure</Text>
              <Text style={styles.detailsRow}>• Minimum investment: {minInvestmentLabel}</Text>
              <Text style={styles.detailsRow}>• Minimum ownership: {minOwnershipLabel}</Text>
              <Text style={styles.detailsRow}>• Target ROI: {roiLabel} (projected, not guaranteed)</Text>
              <Text style={styles.detailsRow}>• Timeline: {timelineLabel}</Text>
            </View>

            {/* Risk disclosure */}
            <View style={styles.detailsSubSection}>
              <Text style={styles.detailsSubTitle}>Risk Disclosure</Text>
              <Text style={styles.detailsRisk}>All investments involve risk. Past performance is not indicative of future results. Target ROI is a projection based on underwriting assumptions and may change based on project performance, market conditions, and execution. Not FDIC insured. May lose value.</Text>
            </View>

            {/* Full timeline stages */}
            {data.timelineSummary && data.timelineSummary.stages.length > 0 && (
              <View style={styles.stagesContainer} testID={`${testIDPrefix}-stages-${data.dealId}`}>
                <Text style={styles.stagesTitle}>Timeline Stages</Text>
                {data.timelineSummary.stages.map((stage: TimelineStage, idx: number) => (
                  <View key={stage.id} style={styles.stageRow}>
                    <View style={styles.stageIconCol}>
                      {stage.status === 'COMPLETE' ? (
                        <CheckCircle2 size={16} color={getTimelineStatusColor('COMPLETE')} />
                      ) : stage.status === 'ACTIVE' ? (
                        <AlertCircle size={16} color={getTimelineStatusColor('ACTIVE')} />
                      ) : stage.status === 'DELAYED' ? (
                        <AlertCircle size={16} color={getTimelineStatusColor('DELAYED')} />
                      ) : (
                        <Circle size={16} color={getTimelineStatusColor('UPCOMING')} />
                      )}
                      {idx < data.timelineSummary!.stages.length - 1 && (
                        <View style={styles.stageConnector} />
                      )}
                    </View>
                    <View style={styles.stageContent}>
                      <Text style={styles.stageName}>{stage.name}</Text>
                      <View style={styles.stageStatusRow}>
                        <View style={[styles.stageStatusBadge, { backgroundColor: getTimelineStatusColor(stage.status) + '22' }]}>
                          <Text style={[styles.stageStatusText, { color: getTimelineStatusColor(stage.status) }]}>
                            {stage.status}
                          </Text>
                        </View>
                        {stage.percentComplete > 0 && stage.status !== 'COMPLETE' && (
                          <Text style={styles.stagePercent}>{stage.percentComplete}%</Text>
                        )}
                      </View>
                      <Text style={stage.startDate ? styles.stageDate : styles.stageDatePending}>
                        Start: {formatTimelineDate(stage.startDate)}
                      </Text>
                      <Text style={stage.estimatedCompletionDate ? styles.stageDate : styles.stageDatePending}>
                        Est. Completion: {formatTimelineDate(stage.estimatedCompletionDate)}
                      </Text>
                      {stage.actualCompletionDate && (
                        <Text style={styles.stageDateActual}>
                          Completed: {formatTimelineDate(stage.actualCompletionDate)}
                        </Text>
                      )}
                      {stage.note && (
                        <Text style={styles.stageNote}>{stage.note}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* 11. View Deal + 12. Invest Now */}
        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={styles.viewDealBtn}
            onPress={handleViewDeal}
            activeOpacity={0.85}
            testID={`${testIDPrefix}-view-deal-${data.dealId}`}
          >
            <Text style={styles.viewDealText}>View Deal</Text>
            <ChevronRight size={16} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.investNowBtn}
            onPress={handleInvestNow}
            activeOpacity={0.85}
            testID={`${testIDPrefix}-invest-${data.dealId}`}
          >
            <Text style={styles.investNowText}>Invest Now</Text>
          </TouchableOpacity>
        </View>

        {/* 13. Like / Comment / Save / Share */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleLike}
            testID={`${testIDPrefix}-like-${data.dealId}`}
          >
            <Heart
              size={20}
              color={liked ? Colors.error : Colors.textSecondary}
              fill={liked ? Colors.error : 'transparent'}
            />
            <Text style={styles.actionCount}>{formatCount(likeCount)}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleComment}
            testID={`${testIDPrefix}-comment-${data.dealId}`}
          >
            <MessageCircle size={20} color={Colors.textSecondary} />
            <Text style={styles.actionCount}>{formatCount(data.commentCount)}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleSave}
            testID={`${testIDPrefix}-save-${data.dealId}`}
          >
            <Bookmark
              size={20}
              color={saved ? Colors.primary : Colors.textSecondary}
              fill={saved ? Colors.primary : 'transparent'}
            />
            <Text style={styles.actionCount}>{formatCount(saveCount)}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleShare}
            testID={`${testIDPrefix}-share-${data.dealId}`}
          >
            <Share2 size={20} color={Colors.textSecondary} />
            <Text style={styles.actionCount}>{formatCount(data.shareCount)}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

export default InvestmentCard;

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  carouselContainer: {
    position: 'relative',
    height: CAROUSEL_HEIGHT,
    backgroundColor: '#0a0a0a',
  },
  carousel: {
    flex: 1,
  },
  imageFrame: {
    height: CAROUSEL_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  noImage: {
    height: CAROUSEL_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  noImageText: {
    color: Colors.textTertiary,
    fontSize: 13,
  },
  statusBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  counterPill: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  counterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600' as const,
  },
  dotsRow: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: {
    width: 18,
    backgroundColor: Colors.primary,
  },
  body: {
    padding: 14,
  },
  title: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  locationText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  // ── Investment summary panel ──
  summaryPanel: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  summaryItemBorder: {
    borderRightWidth: 1,
    borderRightColor: Colors.surfaceBorder,
  },
  summaryIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: 4,
  },
  summaryLabel: {
    color: Colors.textTertiary,
    fontSize: 8,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  summaryValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  // ── Timeline summary ──
  timelineSummaryBox: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  timelineSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  timelineSummaryTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  timelineSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timelineSummaryItem: {
    flex: 1,
  },
  timelineSummaryLabel: {
    color: Colors.textTertiary,
    fontSize: 9,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  timelineSummaryValue: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  // ── Minimum investment row ──
  minInvestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  minInvestItem: {
    flex: 1,
    alignItems: 'center',
  },
  minInvestDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder,
  },
  minInvestLabel: {
    color: Colors.textTertiary,
    fontSize: 9,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  minInvestValue: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  // ── Category chips ──
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  // ── Developer ──
  developerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  developerText: {
    color: Colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  developerBold: {
    color: Colors.text,
    fontWeight: '700' as const,
  },
  // ── Details button ──
  detailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: Colors.backgroundSecondary,
  },
  detailsBtnText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  chevronRotated: {
    transform: [{ rotate: '180deg' }],
  },
  // ── Details section ──
  detailsSection: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  detailsText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  // ── Details sub-sections ──
  detailsSubSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 12,
    marginBottom: 12,
  },
  detailsSubTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 6,
  },
  detailsRow: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  detailsRisk: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    fontStyle: 'italic' as const,
  },
  // ── Timeline stages ──
  stagesContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 12,
  },
  stagesTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 10,
  },
  stageRow: {
    flexDirection: 'row',
    minHeight: 60,
  },
  stageIconCol: {
    alignItems: 'center',
    marginRight: 12,
    width: 20,
  },
  stageConnector: {
    position: 'absolute',
    top: 20,
    bottom: -4,
    left: 8,
    width: 1.5,
    backgroundColor: Colors.surfaceBorder,
  },
  stageContent: {
    flex: 1,
    paddingBottom: 16,
  },
  stageName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
    marginBottom: 4,
  },
  stageStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  stageStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  stageStatusText: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
  },
  stagePercent: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  stageDate: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  stageDatePending: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
    fontStyle: 'italic' as const,
  },
  stageDateActual: {
    color: Colors.success,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600' as const,
  },
  stageNote: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic' as const,
  },
  // ── CTA buttons ──
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  viewDealBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
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
    paddingVertical: 12,
  },
  investNowText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '800' as const,
  },
  // ── Action row ──
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  actionCount: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
});
