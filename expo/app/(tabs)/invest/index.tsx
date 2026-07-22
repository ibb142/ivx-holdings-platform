import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Share,
  useWindowDimensions,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useScreenFocusState } from '@/hooks/useScreenFocusState';
import {
  Building2,
  DollarSign,
  Users,
  ChevronRight,
  Plus,
  X,
  Info,
  Handshake,
  Clock,
  Percent,
  Shield,
  Lock,
  TrendingUp,
  CheckCircle2,
  FileText,
  Eye,
  Star,
  Scale,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrency } from '@/lib/formatters';
const IPX_HOLDING_NAME = 'IVX HOLDINGS LLC';
const ipxFeeConfigs = [
  { id: 'fee-1', name: 'Transaction Fee', description: 'Applied to all buy/sell transactions', feeType: 'transaction', percentage: 2.5, isActive: true },
  { id: 'fee-2', name: 'Listing Fee', description: 'One-time fee when property is listed', feeType: 'listing', percentage: 3.0, isActive: true },
  { id: 'fee-3', name: 'Management Fee', description: 'Annual management and administration fee', feeType: 'management', percentage: 1.5, isActive: true },
] as const;
const ipxProfitStats = {
  totalProfit: 0, profitThisMonth: 0, profitLastMonth: 0, growthPercent: 0, totalTransactions: 0,
  profitByType: { transaction: 0, listing: 0, management: 0, performance: 0, verification: 0 },
};
import { useIPX } from '@/lib/ipx-context';
import { useTranslation } from '@/lib/i18n-context';
import { useJVRealtime } from '@/lib/jv-realtime';
import { filterValidPhotos, usePublishedJVDeals, triggerManualJVRefresh } from '@/lib/parse-deal';
import type { ParsedJVDeal } from '@/lib/parse-deal';
import { getFallbackPhotosForDeal, sanitizeDealPhotosForDeal } from '@/constants/deal-photos';
import QuickBuyModal from '@/components/QuickBuyModal';
import CanonicalInvestmentReelCard, {
  parsedDealToReelData,
  type CanonicalReelData,
} from '@/components/CanonicalInvestmentReelCard';
import { CANONICAL_MIN_INVESTMENT } from '@/lib/published-deal-card-model';



export default function InvestScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { fractionalShares } = useIPX();
  const { t } = useTranslation();
  const isScreenFocused = useScreenFocusState(true);
  useJVRealtime('invest-jv-deals');
  const publishedJV = usePublishedJVDeals({ refetchIntervalMs: isScreenFocused ? 1000 * 90 : false });
  const [refreshing, setRefreshing] = useState(false);
  const [galleryWidth, setGalleryWidth] = useState<number>(width - 42);
  const [showFeeInfo, setShowFeeInfo] = useState(false);
  const [quickBuyVisible, setQuickBuyVisible] = useState(false);
  const [quickBuyDeal, setQuickBuyDeal] = useState<{
    id: string;
    title: string;
    projectName: string;
    totalInvestment: number;
    expectedROI: number;
    photo?: string;
    propertyAddress?: string;
    type?: string;
    minInvestment?: number;
    propertyMarketValue?: number;
    salePrice?: number;
    fractionalSharePrice?: number;
    timelineMin?: number;
    timelineMax?: number;
    priceChange1h?: number;
    priceChange2h?: number;
  } | null>(null);

  const openQuickBuy = useCallback((deal: any) => {
    let photos = sanitizeDealPhotosForDeal(deal, filterValidPhotos(deal.photos));
    if (photos.length === 0) {
      photos = getFallbackPhotosForDeal(deal);
    }
    const marketVal = typeof deal.property_market_value === 'number' ? deal.property_market_value
      : typeof deal.propertyMarketValue === 'number' ? deal.propertyMarketValue
      : typeof deal.market_value === 'number' ? deal.market_value
      : undefined;
    const trustMarket = deal.trustMarket as {
      minInvestment?: number;
      salePrice?: number;
      explicitSalePrice?: number;
      fractionalSharePrice?: number;
      timelineMin?: number;
      timelineMax?: number;
      priceChange1h?: number;
      priceChange2h?: number;
    } | undefined;
    setQuickBuyDeal({
      id: deal.id,
      title: deal.title,
      projectName: deal.projectName,
      totalInvestment: deal.totalInvestment,
      expectedROI: deal.expectedROI,
      photo: photos.length > 0 ? photos[0] : undefined,
      propertyAddress: deal.propertyAddress,
      type: deal.type,
      minInvestment: trustMarket?.minInvestment ? Math.max(trustMarket.minInvestment, 1) : CANONICAL_MIN_INVESTMENT,
      propertyMarketValue: marketVal,
      salePrice: trustMarket?.explicitSalePrice,
      fractionalSharePrice: trustMarket?.fractionalSharePrice,
      timelineMin: trustMarket?.timelineMin,
      timelineMax: trustMarket?.timelineMax,
      priceChange1h: trustMarket?.priceChange1h,
      priceChange2h: trustMarket?.priceChange2h,
    });
    setQuickBuyVisible(true);
  }, []);

  const publishedDealsData = {
    data: { deals: publishedJV.deals },
    isLoading: publishedJV.isLoading,
    refetch: publishedJV.refetch,
  };

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const _isXs = width < 340;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      triggerManualJVRefresh();
      await publishedJV.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [publishedJV]);

  const transactionFee = ipxFeeConfigs.find(f => f.feeType === 'transaction');

  const opportunitiesCount = publishedDealsData.data?.deals.length ?? 0;

  const renderOpportunities = () => (
    <View style={styles.liveJvSection}>
      <View style={styles.liveJvHeader}>
        <View style={styles.liveJvTitleRow}>
          <Handshake size={20} color={Colors.gold} />
          <Text style={styles.liveJvSectionTitle}>Investment Opportunities</Text>
        </View>
        {opportunitiesCount > 0 && (
          <View style={styles.liveJvBadge}>
            <Animated.View style={[styles.liveJvPulse, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.liveJvBadgeText}>{opportunitiesCount} LIVE</Text>
          </View>
        )}
      </View>
      <Text style={styles.liveJvSubtitle}>Published joint ventures with photos — open for fractional investment now.</Text>

      {publishedDealsData.isLoading && opportunitiesCount === 0 ? (
        <View style={styles.jvLoadingWrap}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.jvLoadingText}>Loading investment opportunities…</Text>
        </View>
      ) : opportunitiesCount === 0 ? (
        <View style={styles.oppEmptyCard}>
          <Building2 size={28} color={Colors.textTertiary} />
          <Text style={styles.oppEmptyTitle}>No opportunities live right now</Text>
          <Text style={styles.oppEmptyBody}>New joint-venture deals appear here the moment they’re published. Pull down to refresh.</Text>
          <TouchableOpacity style={styles.oppEmptyBtn} onPress={onRefresh} activeOpacity={0.85}>
            <Text style={styles.oppEmptyBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {publishedDealsData.data?.deals.map((deal) => {
            const reelData = parsedDealToReelData(deal as ParsedJVDeal);
            return (
              <View
                key={deal.id}
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  if (w > 0 && w !== galleryWidth) setGalleryWidth(w);
                }}
              >
                <CanonicalInvestmentReelCard
                  data={reelData}
                  mode="feed"
                  isActive={false}
                  shouldMountVideo={false}
                  isMuted={true}
                  feedHeight={Math.min(galleryWidth, 520)}
                  onToggleMute={() => {}}
                  onLike={() => {}}
                  onComment={() => {}}
                  onSave={() => {}}
                  onShare={async (d: CanonicalReelData) => {
                    try { await Share.share({ message: `${d.title} — ${d.dealUrl}` }); } catch {}
                  }}
                  onOpenDeal={(d) => {
                    router.push(`/jv-invest?jvId=${d.dealId}` as any);
                  }}
                  onInvest={() => {
                    openQuickBuy(deal);
                  }}
                  testIDPrefix="invest-reel"
                />
              </View>
            );
          })}

          <TouchableOpacity
            style={styles.liveJvAllBtn}
            onPress={() => router.push('/jv-agreement' as any)}
            activeOpacity={0.85}
          >
            <Scale size={16} color={Colors.primary} />
            <Text style={styles.liveJvAllBtnText}>View All JV Agreements</Text>
            <ChevronRight size={16} color={Colors.primary} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t('propertyInvestment')}</Text>
              <Text style={styles.headerSubtitle}>{t('fractionalOwnership')}</Text>
            </View>
            <TouchableOpacity
              style={styles.submitButton}
              onPress={() => router.push('/invest/submit-property' as any)}
            >
              <Plus size={14} color={Colors.black} />
              <Text style={styles.submitButtonText}>{t('submitLabel')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: Colors.primary + '20' }]}>
                <Building2 size={18} color={Colors.primary} />
              </View>
              <Text style={styles.statValue}>{fractionalShares.length}</Text>
              <Text style={styles.statLabel}>{t('properties')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: Colors.success + '20' }]}>
                <DollarSign size={18} color={Colors.success} />
              </View>
              <Text style={styles.statValue}>{formatCurrency(ipxProfitStats.totalProfit, true)}</Text>
              <Text style={styles.statLabel}>{t('totalVolume')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: Colors.info + '20' }]}>
                <Users size={18} color={Colors.info} />
              </View>
              <Text style={styles.statValue}>{ipxProfitStats.totalTransactions}</Text>
              <Text style={styles.statLabel}>{t('investors')}</Text>
            </View>
          </View>
        </View>

        {renderOpportunities()}

        <TouchableOpacity
          style={styles.profitToolsCard}
          onPress={() => router.push('/invest/profit-tools' as any)}
          activeOpacity={0.9}
        >
          <View style={styles.profitToolsInner}>
            <View style={styles.profitToolsLeft}>
              <View style={styles.profitToolsIconRow}>
                <View style={[styles.profitToolsMiniIcon, { backgroundColor: Colors.success + '20' }]}>
                  <Shield size={14} color={Colors.success} />
                </View>
                <View style={[styles.profitToolsMiniIcon, { backgroundColor: Colors.gold + '20' }]}>
                  <TrendingUp size={14} color={Colors.gold} />
                </View>
                <View style={[styles.profitToolsMiniIcon, { backgroundColor: Colors.info + '20' }]}>
                  <Star size={14} color={Colors.info} />
                </View>
              </View>
              <Text style={styles.profitToolsTitle}>10 Profit Tools</Text>
              <Text style={styles.profitToolsSubtitle}>For lenders & investors</Text>
            </View>
            <View style={styles.profitToolsRight}>
              <Text style={styles.profitToolsReturn}>Up to 22%</Text>
              <Text style={styles.profitToolsReturnLabel}>Annual Returns</Text>
              <View style={styles.profitToolsCta}>
                <Text style={styles.profitToolsCtaText}>Explore</Text>
                <ChevronRight size={14} color={Colors.black} />
              </View>
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.feeInfoCard}
          onPress={() => setShowFeeInfo(true)}
          activeOpacity={0.8}
        >
          <View style={styles.feeInfoLeft}>
            <View style={styles.ipxBadge}>
              <Text style={styles.ipxBadgeText}>IVXHOLDINGS</Text>
            </View>
            <View>
              <Text style={styles.feeInfoTitle}>{IPX_HOLDING_NAME}</Text>
              <Text style={styles.feeInfoSubtitle}>
                {transactionFee?.percentage}% {t('feeOnTransactions')}
              </Text>
            </View>
          </View>
          <Info size={20} color={Colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.debtAcquisitionCard}
          onPress={() => router.push('/invest/debt-acquisition' as any)}
          activeOpacity={0.9}
        >
          <View style={styles.debtAcquisitionGradient}>
            <View style={styles.debtAcquisitionHeader}>
              <View style={styles.debtAcquisitionIconContainer}>
                <Shield size={28} color={Colors.success} />
              </View>
              <View style={styles.debtAcquisitionBadge}>
                <Lock size={10} color={Colors.white} />
                <Text style={styles.debtAcquisitionBadgeText}>{t('firstLien')}</Text>
              </View>
            </View>
            <Text style={styles.debtAcquisitionTitle}>{t('tokenizedMortgage')}</Text>
            <Text style={styles.debtAcquisitionSubtitle}>
              {t('tokenizedMortgageDesc')}
            </Text>
            <View style={styles.debtAcquisitionTerms}>
              <View style={styles.debtAcquisitionTermItem}>
                <DollarSign size={14} color={Colors.primary} />
                <Text style={styles.debtAcquisitionTermText}>85% LTV</Text>
              </View>
              <View style={styles.debtAcquisitionTermItem}>
                <Lock size={14} color={Colors.success} />
                <Text style={styles.debtAcquisitionTermText}>{t('firstLien')}</Text>
              </View>
              <View style={styles.debtAcquisitionTermItem}>
                <TrendingUp size={14} color={Colors.success} />
                <Text style={styles.debtAcquisitionTermText}>~10% {t('yield')}</Text>
              </View>
            </View>
            <View style={styles.debtAcquisitionCta}>
              <Text style={styles.debtAcquisitionCtaText}>{t('viewProperties')}</Text>
              <ChevronRight size={18} color={Colors.white} />
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.landPartnerCard}
          onPress={() => router.push('/invest/land-partner' as any)}
          activeOpacity={0.9}
        >
          <View style={styles.landPartnerGradient}>
            <View style={styles.landPartnerHeader}>
              <View style={styles.landPartnerIconContainer}>
                <Handshake size={28} color={Colors.primary} />
              </View>
              <View style={styles.landPartnerBadge}>
                <Text style={styles.landPartnerBadgeText}>{t('newLabel')}</Text>
              </View>
            </View>
            <Text style={styles.landPartnerTitle}>{t('landPartnership')}</Text>
            <Text style={styles.landPartnerSubtitle}>
              {t('landPartnershipDesc')}
            </Text>
            <View style={styles.landPartnerTerms}>
              <View style={styles.landPartnerTermItem}>
                <DollarSign size={14} color={Colors.success} />
                <Text style={styles.landPartnerTermText}>{t('cashPercent60')}</Text>
              </View>
              <View style={styles.landPartnerTermItem}>
                <Percent size={14} color={Colors.primary} />
                <Text style={styles.landPartnerTermText}>{t('profitPercent30')}</Text>
              </View>
              <View style={styles.landPartnerTermItem}>
                <Clock size={14} color={Colors.info} />
                <Text style={styles.landPartnerTermText}>{t('months30')}</Text>
              </View>
            </View>
            <View style={styles.landPartnerCta}>
              <Text style={styles.landPartnerCtaText}>{t('submitYourLand')}</Text>
              <ChevronRight size={18} color={Colors.black} />
            </View>
          </View>
        </TouchableOpacity>

        <View style={styles.ownerGuaranteeCard}>
          <View style={styles.guaranteeHeader}>
            <View style={styles.guaranteeIconContainer}>
              <Shield size={24} color={Colors.success} />
            </View>
            <View style={styles.guaranteeMeta}>
              <Text style={styles.guaranteeTitle}>{t('ownerProtection')}</Text>
              <Text style={styles.guaranteeSubtitle}>{t('ownerProtectionDesc')}</Text>
            </View>
          </View>
          <View style={styles.guaranteeList}>
            {[
              { icon: <FileText size={16} color={Colors.teal} />, text: t('guaranteeTitleLien') },
              { icon: <CheckCircle2 size={16} color={Colors.success} />, text: t('guaranteeEquity') },
              { icon: <Eye size={16} color={Colors.info} />, text: t('guaranteeIdentity') },
              { icon: <DollarSign size={16} color={Colors.primary} />, text: t('guaranteeRental') },
            ].map((item, i) => (
              <View key={i} style={styles.guaranteeItem}>
                {item.icon}
                <Text style={styles.guaranteeItemText}>{item.text}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={styles.guaranteeCta}
            onPress={() => router.push('/trust-center' as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.guaranteeCtaText}>{t('viewBillOfRights')}</Text>
            <ChevronRight size={16} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      <Modal
        visible={showFeeInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFeeInfo(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFeeInfo(false)}
        >
          <View style={styles.feeModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{IPX_HOLDING_NAME} {t('ipxFees')}</Text>
              <TouchableOpacity onPress={() => setShowFeeInfo(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.feeModalDesc}>
              {t('ipxFeesDesc')}
            </Text>

            {ipxFeeConfigs.filter(f => f.isActive).map((fee) => (
              <View key={fee.id} style={styles.feeItem}>
                <View style={styles.feeItemHeader}>
                  <Text style={styles.feeItemName}>{fee.name}</Text>
                  <Text style={styles.feeItemPercent}>{fee.percentage}%</Text>
                </View>
                <Text style={styles.feeItemDesc}>{fee.description}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <QuickBuyModal
        visible={quickBuyVisible}
        onClose={() => setQuickBuyVisible(false)}
        deal={quickBuyDeal}
        onNavigateToFullInvest={(dealId) => {
          router.push({ pathname: '/jv-invest', params: { jvId: dealId } } as any);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerCard: {
    margin: 20,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  headerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexShrink: 0,
  },
  submitButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  statLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.surfaceBorder,
  },
  feeInfoCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  feeInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  ipxBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ipxBadgeText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  feeInfoTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  feeInfoSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  profitToolsCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.info + '30',
    overflow: 'hidden',
  },
  profitToolsInner: {
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profitToolsLeft: {
    flex: 1,
  },
  profitToolsIconRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  profitToolsMiniIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profitToolsTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '900' as const,
    letterSpacing: -0.3,
  },
  profitToolsSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 3,
  },
  profitToolsRight: {
    alignItems: 'center',
    gap: 4,
  },
  profitToolsReturn: {
    color: Colors.primary,
    fontSize: 22,
    fontWeight: '900' as const,
  },
  profitToolsReturnLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '500' as const,
  },
  profitToolsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 6,
  },
  profitToolsCtaText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  debtAcquisitionCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 18,
    overflow: 'hidden',
  },
  debtAcquisitionGradient: {
    backgroundColor: Colors.backgroundSecondary,
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  debtAcquisitionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  debtAcquisitionIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.success + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  debtAcquisitionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '30',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  debtAcquisitionBadgeText: {
    color: Colors.success,
    fontSize: 10,
    fontWeight: '800' as const,
  },
  debtAcquisitionTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    marginBottom: 6,
  },
  debtAcquisitionSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  debtAcquisitionTerms: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  debtAcquisitionTermItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  debtAcquisitionTermText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  debtAcquisitionCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.success,
    borderRadius: 12,
    paddingVertical: 12,
  },
  debtAcquisitionCtaText: {
    color: Colors.white,
    fontWeight: '700' as const,
    fontSize: 15,
  },
  landPartnerCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 18,
    overflow: 'hidden',
  },
  landPartnerGradient: {
    backgroundColor: Colors.backgroundSecondary,
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  landPartnerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  landPartnerIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landPartnerBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  landPartnerBadgeText: {
    color: Colors.black,
    fontSize: 10,
    fontWeight: '800' as const,
  },
  landPartnerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    marginBottom: 6,
  },
  landPartnerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  landPartnerTerms: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  landPartnerTermItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  landPartnerTermText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  landPartnerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  landPartnerCtaText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 15,
  },
  bottomPadding: {
    height: 120,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  feeModalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
  },
  feeModalDesc: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  feeItem: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  feeItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  feeItemName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  feeItemPercent: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  feeItemDesc: {
    color: Colors.textTertiary,
    fontSize: 13,
    lineHeight: 18,
  },
  ownerGuaranteeCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  guaranteeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  guaranteeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.success + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guaranteeMeta: {
    flex: 1,
  },
  guaranteeTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  guaranteeSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  guaranteeList: {
    gap: 12,
    marginBottom: 16,
  },
  guaranteeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  guaranteeItemText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  guaranteeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  guaranteeCtaText: {
    color: Colors.primary,
    fontWeight: '600' as const,
    fontSize: 14,
  },
  jvLoadingWrap: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 10,
    marginHorizontal: 20,
  },
  jvLoadingText: {
    color: Colors.textTertiary,
    fontSize: 13,
  },
  liveJvSection: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  oppEmptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  oppEmptyTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
    marginTop: 4,
  },
  oppEmptyBody: {
    color: Colors.textTertiary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center' as const,
  },
  oppEmptyBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 9,
  },
  oppEmptyBtnText: {
    color: Colors.black,
    fontWeight: '800' as const,
    fontSize: 13,
  },
  liveJvHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  liveJvTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveJvSectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
  },
  liveJvBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.success + '20',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveJvPulse: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.success,
  },
  liveJvGallery: {
    position: 'relative' as const,
    height: 200,
    overflow: 'hidden',
    width: '100%',
  },
  liveJvGalleryScroll: {
    height: 200,
    width: '100%',
  },
  liveJvPhotoDots: {
    position: 'absolute' as const,
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  liveJvPhotoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.overlay,
  },
  liveJvPhotoDotActive: {
    width: 18,
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  liveJvPhotoCount: {
    position: 'absolute' as const,
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.overlay,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  liveJvPhotoCountText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  liveJvLiveBadgeOverlay: {
    position: 'absolute' as const,
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.success + '20',
    borderWidth: 1,
    borderColor: Colors.success + '40',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveJvLiveDotAnim: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  liveJvLiveBadgeOverlayText: {
    color: Colors.success,
    fontSize: 9,
    fontWeight: '900' as const,
    letterSpacing: 1.5,
  },
  liveJvNoPhoto: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.backgroundSecondary,
    gap: 6,
  },
  liveJvNoPhotoText: {
    color: Colors.textTertiary,
    fontSize: 12,
  },
  liveJvPoolRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  liveJvPoolOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  liveJvPoolIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveJvPoolTextWrap: {
    flex: 1,
  },
  liveJvPoolTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  liveJvPoolDesc: {
    color: Colors.textTertiary,
    fontSize: 10,
  },
  liveJvBadgeText: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  liveJvSubtitle: {
    color: Colors.textTertiary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  liveJvCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
    marginBottom: 14,
  },
  liveJvImage: {
    height: 200,
    backgroundColor: Colors.backgroundSecondary,
  },
  liveJvContent: {
    padding: 16,
  },
  liveJvTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  liveJvTypeBadge: {
    backgroundColor: Colors.gold + '15',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveJvTypeText: {
    color: Colors.gold,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  liveJvRoiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '15',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveJvRoiText: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  liveJvTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800' as const,
    marginBottom: 3,
  },
  liveJvProject: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginBottom: 8,
  },
  liveJvLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  liveJvLocation: {
    color: Colors.textTertiary,
    fontSize: 12,
    flex: 1,
  },
  liveJvMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  liveJvMetric: {
    flex: 1,
    alignItems: 'center',
  },
  liveJvMetricValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  liveJvMetricLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    marginTop: 3,
  },
  liveJvMetricDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder,
  },
  liveJvActions: {
    flexDirection: 'row',
    gap: 10,
  },
  liveJvViewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.backgroundSecondary,
  },
  liveJvViewBtnText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  liveJvInvestBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  liveJvInvestBtnText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  liveJvQuickBuyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  liveJvQuickBuyBtnText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  liveJvAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    borderStyle: 'dashed',
    marginTop: 4,
  },
  liveJvAllBtnText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
