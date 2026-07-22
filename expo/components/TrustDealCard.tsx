import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import {
  Shield,
  MapPin,
  CheckCircle2,
  FileText,
  Lock,
  HardHat,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { formatCurrencyCompact, formatCurrencyWithDecimals } from '@/lib/formatters';
import { buildOwnershipSnapshot } from '@/lib/ownership-math';
import type { ParsedJVDeal, DealTrustInfo } from '@/lib/parse-deal';
import { resolveDealPhotos } from '@/lib/parse-deal';

interface TrustDealCardProps {
  deal: ParsedJVDeal;
  onInvestNow: (deal: ParsedJVDeal) => void;
  onViewDetails: (deal: ParsedJVDeal) => void;
  galleryWidth?: number;
}

function extractLocationFromDeal(deal: ParsedJVDeal): string {
  if (deal.city && deal.state) return `${deal.city}, ${deal.state}`;
  if (deal.propertyAddress) {
    const parts = deal.propertyAddress.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
    }
    return deal.propertyAddress;
  }
  return '';
}

function getDefaultTrustInfo(deal: ParsedJVDeal): DealTrustInfo {
  const projName = deal.projectName || '';
  const isLLC = projName.toUpperCase().includes('LLC');
  const ownershipBasis = deal.propertyValue || deal.totalInvestment || 0;
  const minInvestment = 50;
  const fractionalSharePrice = Math.max(minInvestment, 1);
  const ownershipSnapshot = buildOwnershipSnapshot(minInvestment, ownershipBasis);

  return {
    llcName: isLLC ? projName : (projName ? `${projName} LLC` : 'IVX Holdings LLC'),
    builderName: projName.includes('ONE STOP') ? 'One Stop Development' : (projName || 'IVX Development'),
    minInvestment,
    timelineMin: 0,
    timelineMax: 0,
    timelineUnit: 'months' as const,
    legalStructure: 'LLC Joint Venture',
    insuranceCoverage: true,
    titleVerified: true,
    permitStatus: 'approved' as const,
    escrowProtected: true,
    thirdPartyAudit: false,
    fractionalSharePrice,
    priceChange1h: 10,
    priceChange2h: 18,
    ownershipLabel: ownershipSnapshot.ownershipText,
    investorProtections: [
      'LLC-backed investment structure',
      'Title insurance verified',
      'Escrow-protected funds',
    ],
    riskFactors: [],
    keyMilestones: [],
    documents: [],
  };
}

function formatTimelineString(trust: DealTrustInfo): string {
  const min = trust.timelineMin || 0;
  const max = trust.timelineMax || 0;
  const unit = trust.timelineUnit === 'years' ? 'yr' : 'mo';
  if (min > 0 && max > 0) {
    return `${min}–${max} ${unit}`;
  }
  if (max > 0) return `${max} ${unit}`;
  if (min > 0) return `${min} ${unit}`;
  return '';
}

function formatMarketValue(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  if (safeValue <= 0) {
    return '$0';
  }
  const compact = formatCurrencyCompact(safeValue);
  return compact.startsWith('$') ? compact : `$${compact}`;
}

const TrustDealCard = memo(function TrustDealCard({
  deal,
  onInvestNow,
  onViewDetails,
  galleryWidth = 300,
}: TrustDealCardProps) {
  const trust = useMemo(() => {
    if (deal.trustInfo) {
      return deal.trustInfo;
    }
    if (deal.trustMarket) {
      const ownershipSnapshot = buildOwnershipSnapshot(deal.trustMarket.minInvestment, deal.trustMarket.salePrice);
      return {
        ...getDefaultTrustInfo(deal),
        minInvestment: deal.trustMarket.minInvestment,
        salePrice: deal.trustMarket.explicitSalePrice,
        fractionalSharePrice: deal.trustMarket.fractionalSharePrice,
        timelineMin: deal.trustMarket.timelineMin ?? 0,
        timelineMax: deal.trustMarket.timelineMax ?? 0,
        timelineUnit: deal.trustMarket.timelineUnit ?? 'months',
        priceChange1h: deal.trustMarket.priceChange1h,
        priceChange2h: deal.trustMarket.priceChange2h,
        ownershipLabel: deal.trustMarket.ownershipLabel ?? ownershipSnapshot.ownershipText,
      };
    }
    return getDefaultTrustInfo(deal);
  }, [deal]);
  const [activePhotoIndex, setActivePhotoIndex] = useState<number>(0);

  const photos = useMemo(() => {
    return resolveDealPhotos({
      id: deal.id,
      title: deal.title,
      projectName: deal.projectName,
      photos: deal.photos,
      publishedAt: deal.publishedAt,
      created_at: deal.created_at,
      updatedAt: typeof deal.updatedAt === 'string' ? deal.updatedAt : undefined,
      updated_at: typeof deal.updated_at === 'string' ? deal.updated_at : undefined,
    });
  }, [deal.created_at, deal.id, deal.photos, deal.projectName, deal.publishedAt, deal.title, deal.updatedAt, deal.updated_at]);

  useEffect(() => {
    if (photos.length === 0 && activePhotoIndex !== 0) {
      setActivePhotoIndex(0);
      return;
    }
    if (activePhotoIndex >= photos.length && photos.length > 0) {
      setActivePhotoIndex(photos.length - 1);
    }
  }, [activePhotoIndex, photos.length]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const rawIndex = Math.round(offsetX / galleryWidth);
    const safeIndex = photos.length > 0
      ? Math.max(0, Math.min(rawIndex, photos.length - 1))
      : 0;
    setActivePhotoIndex(safeIndex);
  }, [galleryWidth, photos.length]);

  const location = useMemo(() => extractLocationFromDeal(deal), [deal]);
  const timeline = useMemo(() => formatTimelineString(trust), [trust]);
  const explicitSalePrice = useMemo(() => {
    const trustMarketExplicitSalePrice = Number(deal.trustMarket?.explicitSalePrice ?? 0);
    if (trustMarketExplicitSalePrice > 0) {
      return trustMarketExplicitSalePrice;
    }
    const topLevelSalePrice = Number(deal.salePrice ?? 0);
    if (topLevelSalePrice > 0) {
      return topLevelSalePrice;
    }
    const trustSalePrice = Number(trust.salePrice ?? 0);
    if (trustSalePrice > 0) {
      return trustSalePrice;
    }
    return 0;
  }, [deal.salePrice, deal.trustMarket?.explicitSalePrice, trust.salePrice]);
  const salePrice = useMemo(() => {
    const trustMarketSalePrice = Number(deal.trustMarket?.salePrice ?? 0);
    if (trustMarketSalePrice > 0) {
      return trustMarketSalePrice;
    }
    const propertyValue = Number(deal.propertyValue ?? 0);
    if (propertyValue > 0) {
      return propertyValue;
    }
    const totalInvestment = Number(deal.totalInvestment ?? 0);
    if (totalInvestment > 0) {
      return totalInvestment;
    }
    return 0;
  }, [deal.propertyValue, deal.totalInvestment, deal.trustMarket?.salePrice]);
  const minInvestment = deal.trustMarket?.minInvestment || trust.minInvestment || 50;
  const ownershipSnapshot = useMemo(() => buildOwnershipSnapshot(minInvestment, salePrice), [minInvestment, salePrice]);
  const shareEntryPrice = useMemo(() => {
    const raw = Number(deal.trustMarket?.fractionalSharePrice ?? trust.fractionalSharePrice ?? minInvestment);
    return Math.max(raw, 1);
  }, [deal.trustMarket?.fractionalSharePrice, minInvestment, trust.fractionalSharePrice]);
  const ownershipText = useMemo(() => {
    if (deal.trustMarket?.ownershipLabel) return deal.trustMarket.ownershipLabel;
    if (trust.ownershipLabel) return trust.ownershipLabel;
    return ownershipSnapshot.ownershipText;
  }, [deal.trustMarket?.ownershipLabel, ownershipSnapshot.ownershipText, trust.ownershipLabel]);
  const salePriceLabel = useMemo(() => formatMarketValue(explicitSalePrice), [explicitSalePrice]);
  const investmentAmountLabel = useMemo(() => formatMarketValue(Number(deal.totalInvestment ?? 0)), [deal.totalInvestment]);
  const minOwnershipLabel = useMemo(() => `${ownershipSnapshot.ownershipPercent.toFixed(4)}% min`, [ownershipSnapshot.ownershipPercent]);
  const showEntryPill = useMemo(() => Math.abs(shareEntryPrice - minInvestment) > 0.009, [shareEntryPrice, minInvestment]);
  const marketPills = useMemo(() => {
    const pills: Array<{ key: string; label: string; value: string }> = [
      {
        key: 'fractional',
        label: 'Fractional',
        value: `from ${formatCurrencyWithDecimals(minInvestment)}`,
      },
    ];

    if (showEntryPill) {
      pills.push({
        key: 'entry',
        label: 'Entry',
        value: formatCurrencyWithDecimals(shareEntryPrice),
      });
    }

    pills.push({
      key: 'ownership',
      label: 'Ownership',
      value: minOwnershipLabel,
    });

    return pills;
  }, [minInvestment, minOwnershipLabel, shareEntryPrice, showEntryPill]);

  const verifiedCount = useMemo(() => {
    let count = 0;
    if (trust.titleVerified) count++;
    if (trust.insuranceCoverage) count++;
    if (trust.escrowProtected) count++;
    if (trust.permitStatus === 'approved') count++;
    if (trust.thirdPartyAudit) count++;
    return count;
  }, [trust]);

  const handleInvest = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onInvestNow(deal);
  }, [deal, onInvestNow]);

  const handleDetails = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onViewDetails(deal);
  }, [deal, onViewDetails]);

  return (
    <View style={styles.card} testID={`trust-deal-${deal.id}`}>
      {photos.length > 0 && (
        <View style={styles.imageSection}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.imageScroll}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            {photos.map((uri, idx) => (
              <Image
                key={`trust-photo-${deal.id}-${idx}`}
                source={{ uri }}
                style={[styles.image, { width: galleryWidth }]}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
          {photos.length > 1 && (
            <>
              <View style={styles.photoDots}>
                {photos.map((_, idx) => (
                  <View key={idx} style={[styles.photoDot, idx === activePhotoIndex && styles.photoDotActive]} />
                ))}
              </View>
              <View style={styles.photoCounter}>
                <Text style={styles.photoCounterText}>{Math.min(activePhotoIndex + 1, photos.length)}/{photos.length}</Text>
              </View>
            </>
          )}
          <View style={styles.liveBadgeOverlay}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
          {verifiedCount >= 3 && (
            <View style={styles.verifiedBadgeOverlay}>
              <Shield size={10} color="#00C48C" />
              <Text style={styles.verifiedBadgeText}>VERIFIED</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.dealTitle}>{deal.title || deal.projectName}</Text>
            {location ? (
              <View style={styles.locationRow}>
                <MapPin size={12} color={Colors.textTertiary} />
                <Text style={styles.locationText}>{location}</Text>
              </View>
            ) : null}
          </View>
          {explicitSalePrice > 0 ? (
            <View style={styles.salePriceChip} testID={`trust-sale-price-${deal.id}`}>
              <Text style={styles.salePriceChipLabel}>Sale Price</Text>
              <Text style={styles.salePriceChipValue}>{salePriceLabel}</Text>
              <Text style={styles.salePriceChipSubtext}>{minOwnershipLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.divider} />

        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{investmentAmountLabel}</Text>
            <Text style={styles.metricLabel}>Investment</Text>
          </View>
          <View style={styles.metricSeparator} />
          <View style={styles.metric}>
            <Text style={[styles.metricValue, styles.metricValueHighlight]}>{deal.expectedROI}%</Text>
            <Text style={styles.metricLabel}>ROI</Text>
          </View>
          <View style={styles.metricSeparator} />
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{timeline}</Text>
            <Text style={styles.metricLabel}>Timeline</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.marketStrip}>
          {marketPills.map((pill) => (
            <View key={pill.key} style={styles.marketStatPill}>
              <Text style={styles.marketStatLabel}>{pill.label}</Text>
              <Text style={styles.marketStatValue}>{pill.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.ownershipHint}>{ownershipText}</Text>

        <View style={styles.trustRow}>
          <View style={styles.trustItem}>
            <HardHat size={13} color={Colors.primary} />
            <Text style={styles.trustText} numberOfLines={1}>
              Developed by <Text style={styles.trustBold}>{trust.llcName || 'ONE STOP DEVELOPMENT LLC'}</Text>
            </Text>
          </View>
        </View>

        <View style={styles.trustIndicators}>
          {trust.titleVerified && (
            <View style={styles.trustBadge}>
              <CheckCircle2 size={10} color="#00C48C" />
              <Text style={styles.trustBadgeText}>Title Verified</Text>
            </View>
          )}
          {trust.insuranceCoverage && (
            <View style={styles.trustBadge}>
              <Shield size={10} color="#4A90D9" />
              <Text style={styles.trustBadgeText}>Insured</Text>
            </View>
          )}
          {trust.escrowProtected && (
            <View style={styles.trustBadge}>
              <Lock size={10} color={Colors.primary} />
              <Text style={styles.trustBadgeText}>Escrow</Text>
            </View>
          )}
          {trust.permitStatus === 'approved' && (
            <View style={styles.trustBadge}>
              <FileText size={10} color="#00C48C" />
              <Text style={styles.trustBadgeText}>Permitted</Text>
            </View>
          )}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.detailsBtn}
            onPress={handleDetails}
            activeOpacity={0.85}
            testID={`trust-details-${deal.id}`}
          >
            <Text style={styles.detailsBtnText}>Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.investBtn}
            onPress={handleInvest}
            activeOpacity={0.85}
            testID={`trust-invest-${deal.id}`}
          >
            <Text style={styles.investBtnText}>Invest Now</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.minInvestWrap}>
          <Text style={styles.minInvestText}>
            Fractional starts at <Text style={styles.minInvestBold}>{formatCurrencyWithDecimals(minInvestment)}</Text>
            {' · '}
            <Text style={styles.minInvestBold}>{ownershipText}</Text>
          </Text>
        </View>
      </View>
    </View>
  );
});

export default TrustDealCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
    marginBottom: 16,
  },
  imageSection: {
    position: 'relative' as const,
    height: 200,
    overflow: 'hidden',
    width: '100%',
  },
  imageScroll: {
    height: 200,
    width: '100%',
  },
  image: {
    height: 200,
    backgroundColor: Colors.backgroundSecondary,
  },
  photoDots: {
    position: 'absolute' as const,
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  photoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  photoDotActive: {
    width: 18,
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  photoCounter: {
    position: 'absolute' as const,
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  photoCounterText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  liveBadgeOverlay: {
    position: 'absolute' as const,
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,196,140,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(0,196,140,0.4)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00C48C',
  },
  liveBadgeText: {
    color: '#00C48C',
    fontSize: 9,
    fontWeight: '900' as const,
    letterSpacing: 1.5,
  },
  verifiedBadgeOverlay: {
    position: 'absolute' as const,
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,196,140,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0,196,140,0.3)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  verifiedBadgeText: {
    color: '#00C48C',
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  content: {
    padding: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  dealTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '900' as const,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  salePriceChip: {
    flexShrink: 1,
    maxWidth: 130,
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.24)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  salePriceChipLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  salePriceChipValue: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '900' as const,
    marginTop: 4,
  },
  salePriceChipSubtext: {
    color: '#00C48C',
    fontSize: 11,
    fontWeight: '700' as const,
    marginTop: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  locationText: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 14,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metric: {
    flex: 1,
    alignItems: 'center',
  },
  metricValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '900' as const,
    letterSpacing: -0.3,
  },
  metricValueHighlight: {
    color: Colors.text,
  },
  metricLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 3,
  },
  metricSeparator: {
    width: 1,
    height: 32,
    backgroundColor: Colors.surfaceBorder,
  },
  marketStrip: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  marketStatPill: {
    flex: 1,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  marketStatLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  marketStatValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  ownershipHint: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  trustText: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  trustBold: {
    color: Colors.text,
    fontWeight: '700' as const,
  },
  trustIndicators: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  trustBadgeText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  investBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  investBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '900' as const,
  },
  detailsBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.backgroundSecondary,
  },
  detailsBtnText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  minInvestWrap: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  minInvestText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center' as const,
  },
  minInvestBold: {
    color: Colors.text,
    fontWeight: '800' as const,
  },
});
