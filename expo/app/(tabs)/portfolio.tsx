import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import { useRouter } from 'expo-router';
import { TrendingUp, TrendingDown, Wallet, Building2, ChevronRight, PiggyBank, Percent, Globe, DollarSign, Activity, Tag, ShoppingCart } from 'lucide-react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import Colors from '@/constants/colors';
import { getResponsiveSize, isCompactScreen, isExtraSmallScreen } from '@/lib/responsive';
import { useAuth } from '@/lib/auth-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWallet } from '@/lib/wallet-context';
import { formatCurrencyWithDecimals } from '@/lib/formatters';
import IPXHoldingCard from '@/components/IPXHoldingCard';
import { useIPX } from '@/lib/ipx-context';
import { useEarn } from '@/lib/earn-context';
import { useTranslation } from '@/lib/i18n-context';
import { useAnalytics } from '@/lib/analytics-context';
import { useGlobalMarkets } from '@/lib/global-markets';
import type { ResaleListing } from '@/lib/investment-service';
import { formatNumber } from '@/lib/formatters';

const CHART_HEIGHT = 120;

type TabType = 'holdings' | 'ipx';

function MacroContextWidget({ router }: { router: ReturnType<typeof useRouter> }) {
  const { indices, commodities, forex, marketSentiment } = useGlobalMarkets(7000);
  const sentimentColor = marketSentiment === 'bullish' ? Colors.positive : marketSentiment === 'bearish' ? Colors.negative : Colors.warning;
  const sp500 = indices.find(i => i.symbol === 'S&P 500');
  const gold = commodities.find(c => c.symbol === 'XAU');
  const oil = commodities.find(c => c.symbol === 'WTI');
  const usd_jpy = forex.find(f => f.symbol === 'USD/JPY');

  const signals = [
    sp500 && { label: 'S&P 500', detail: `${sp500.changePercent >= 0 ? '+' : ''}${sp500.changePercent.toFixed(2)}%`, impact: sp500.changePercent >= 0 ? 'positive' : 'negative', desc: 'Equity momentum' },
    gold && { label: 'Gold', detail: `${gold.changePercent24h >= 0 ? '+' : ''}${gold.changePercent24h.toFixed(2)}%`, impact: gold.changePercent24h >= 0 ? 'neutral' : 'positive', desc: 'Safe haven demand' },
    oil && { label: 'WTI Oil', detail: `${oil.changePercent24h >= 0 ? '+' : ''}${oil.changePercent24h.toFixed(2)}%`, impact: oil.changePercent24h <= 2 ? 'positive' : 'negative', desc: 'Construction cost signal' },
    usd_jpy && { label: 'USD/JPY', detail: usd_jpy.rate.toFixed(2), impact: 'neutral', desc: 'Global risk appetite' },
  ].filter(Boolean) as { label: string; detail: string; impact: string; desc: string }[];

  return (
    <TouchableOpacity
      style={macroStyles.wrap}
      onPress={() => router.push('/global-intelligence' as any)}
      activeOpacity={0.85}
    >
      <View style={macroStyles.header}>
        <Globe size={14} color={Colors.primary} />
        <Text style={macroStyles.headerTitle}>Macro Market Context</Text>
        <View style={[macroStyles.sentBadge, { backgroundColor: sentimentColor + '20' }]}>
          <Activity size={10} color={sentimentColor} />
          <Text style={[macroStyles.sentText, { color: sentimentColor }]}>
            {marketSentiment.toUpperCase()}
          </Text>
        </View>
        <ChevronRight size={14} color={Colors.primary} />
      </View>
      <Text style={macroStyles.subtext}>
        Global macro signals affecting your real estate portfolio value
      </Text>
      <View style={macroStyles.signals}>
        {signals.map((s, i) => {
          const c = s.impact === 'positive' ? Colors.positive : s.impact === 'negative' ? Colors.negative : Colors.warning;
          return (
            <View key={i} style={macroStyles.signal}>
              <View style={[macroStyles.signalDot, { backgroundColor: c }]} />
              <View style={macroStyles.signalLeft}>
                <Text style={macroStyles.signalLabel}>{s.label}</Text>
                <Text style={macroStyles.signalDesc}>{s.desc}</Text>
              </View>
              <Text style={[macroStyles.signalDetail, { color: c }]}>{s.detail}</Text>
            </View>
          );
        })}
      </View>
      <View style={macroStyles.footer}>
        <DollarSign size={11} color={Colors.textTertiary} />
        <Text style={macroStyles.footerText}>
          IVXHOLDINGS properties are priced against 47 live macro signals
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const macroStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 6,
  },
  headerTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  sentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  sentText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  subtext: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginBottom: 12,
    lineHeight: 16,
  },
  signals: {
    gap: 8,
    marginBottom: 12,
  },
  signal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  signalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  signalLeft: { flex: 1 },
  signalLabel: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  signalDesc: {
    color: Colors.textTertiary,
    fontSize: 10,
  },
  signalDetail: {
    fontSize: 13,
    fontWeight: '800' as const,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary + '10',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  footerText: {
    color: Colors.textSecondary,
    fontSize: 10,
    flex: 1,
    lineHeight: 15,
  },
});

function MyResaleListingsWidget({ router }: { router: ReturnType<typeof useRouter> }) {
  const { isAuthenticated } = useAuth();
  const myListingsQuery = useQuery({
    queryKey: ['resale-listings', 'mine-portfolio'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('resale_listings')
        .select('*')
        .eq('seller_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) return [];
      return (data || []) as ResaleListing[];
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 30,
  });

  const listings = myListingsQuery.data ?? [];
  if (listings.length === 0) return null;

  return (
    <TouchableOpacity
      style={resaleStyles.wrap}
      onPress={() => router.push('/resale-marketplace' as any)}
      activeOpacity={0.85}
    >
      <View style={resaleStyles.header}>
        <Tag size={14} color={Colors.primary} />
        <Text style={resaleStyles.headerTitle}>Your Resale Listings</Text>
        <View style={resaleStyles.countBadge}>
          <Text style={resaleStyles.countText}>{listings.length}</Text>
        </View>
        <ChevronRight size={14} color={Colors.primary} />
      </View>
      {listings.map((listing: ResaleListing) => (
        <View key={listing.id} style={resaleStyles.row}>
          <ShoppingCart size={13} color={Colors.textTertiary} />
          <View style={resaleStyles.rowInfo}>
            <Text style={resaleStyles.rowName} numberOfLines={1}>{listing.property_name}</Text>
            <Text style={resaleStyles.rowMeta}>
              {formatNumber(listing.shares)} shares @ {formatCurrencyWithDecimals(listing.ask_price_per_share)}
            </Text>
          </View>
          <Text style={resaleStyles.rowTotal}>{formatCurrencyWithDecimals(listing.total_ask)}</Text>
        </View>
      ))}
    </TouchableOpacity>
  );
}

const resaleStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 8,
  },
  headerTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  countBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countText: {
    color: Colors.black,
    fontSize: 10,
    fontWeight: '800' as const,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  rowMeta: {
    color: Colors.textTertiary,
    fontSize: 10,
    marginTop: 1,
  },
  rowTotal: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700' as const,
  },
});

const generatePortfolioHistory = (baseValue: number) => {
  const history = [];
  let value = baseValue * 0.85;
  const step = (baseValue - value) / 30;
  for (let i = 30; i >= 0; i--) {
    const dayOffset = Math.sin(i * 0.5) * (baseValue * 0.02);
    value = value + step + dayOffset;
    value = Math.max(baseValue * 0.75, value);
    history.push({ value });
  }
  return history;
};

export default function PortfolioScreen() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('holdings');
  const [refreshing, setRefreshing] = useState(false);

  const { isAuthenticated } = useAuth();
  const walletContext = useWallet();
  const walletBalance = walletContext?.available ?? 0;
  const totalInvestedBackend = walletContext?.invested ?? 0;
  const refreshWallet = walletContext?.refreshWallet ?? (() => undefined);

  const portfolioQuery = useQuery({
    queryKey: ['portfolio', 'holdings'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('holdings').select('*').eq('user_id', user.id);
      return { holdings: data || [] };
    },
    staleTime: 1000 * 60 * 2,
    enabled: isAuthenticated,
  });

  const ipxContext = useIPX();
  const ipxHoldings = ipxContext?.holdings ?? [];
  const getTotalIPXValue = ipxContext?.getTotalIPXValue ?? 0;
  const getTotalIPXPnL = ipxContext?.getTotalIPXPnL ?? 0;
  const getTotalIPXPnLPercent = ipxContext?.getTotalIPXPnLPercent ?? 0;
  const earnContext = useEarn();
  const earnBalance = earnContext?.totalBalance ?? 0;
  const apyRate = earnContext?.apyRate ?? 0.10;
  const { t } = useTranslation();
  const { trackScreen: _trackScreen } = useAnalytics();

  const screenSize = getResponsiveSize(width);
  const isCompact = isCompactScreen(screenSize);
  const isXs = isExtraSmallScreen(screenSize);
  const CHART_WIDTH = width - (isXs ? 60 : 80);

  const responsiveStyles = useMemo(() => ({
    headerTitle: isXs ? 24 : isCompact ? 26 : 28,
    portfolioValue: isXs ? 24 : isCompact ? 28 : 36,
    portfolioLabel: isXs ? 12 : 14,
    pnlText: isXs ? 12 : 14,
    changeBadgePadding: isXs ? 6 : isCompact ? 8 : 10,
    changeText: isXs ? 11 : 13,
    walletValue: isXs ? 15 : isCompact ? 16 : 18,
    walletLabel: isXs ? 10 : 12,
    tabText: isXs ? 11 : 13,
    txIconSize: isXs ? 28 : isCompact ? 32 : 40,

    cardPadding: isXs ? 14 : isCompact ? 16 : 20,
    cardMargin: isXs ? 12 : 20,
  }), [isCompact, isXs]);

  const totalPortfolioValue = totalInvestedBackend + getTotalIPXValue;
  const totalUnrealizedPnL = getTotalIPXPnL;
  const totalInvested = totalInvestedBackend +
    ipxHoldings.reduce((sum, h) => sum + h.totalInvested, 0);
  const totalUnrealizedPnLPercent = totalInvested > 0 ? ((totalPortfolioValue - totalInvested) / totalInvested) * 100 : 0;

  const isPositive = totalUnrealizedPnL >= 0;

  const portfolioHistory = useMemo(() => generatePortfolioHistory(totalPortfolioValue || 40000), [totalPortfolioValue]);

  const chartPath = useMemo(() => {
    if (portfolioHistory.length < 2) return '';

    const values = portfolioHistory.map(d => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const points = portfolioHistory.map((point, index) => {
      const x = (index / (portfolioHistory.length - 1)) * CHART_WIDTH;
      const y = CHART_HEIGHT - ((point.value - min) / range) * CHART_HEIGHT;
      return { x, y };
    });

    const path = points.reduce((acc, point, i) => {
      if (i === 0) return `M ${point.x} ${point.y}`;
      const prev = points[i - 1];
      if (!prev) return acc;
      const cpX = (prev.x + point.x) / 2;
      return `${acc} Q ${cpX} ${prev.y} ${point.x} ${point.y}`;
    }, '');

    return path;
  }, [portfolioHistory, CHART_WIDTH]);

  const gradientPath = useMemo(() => {
    if (!chartPath) return '';
    const lastX = CHART_WIDTH;
    return `${chartPath} L ${lastX} ${CHART_HEIGHT} L 0 ${CHART_HEIGHT} Z`;
  }, [chartPath, CHART_WIDTH]);

  const onRefresh = () => {
    setRefreshing(true);
    refreshWallet();
    void portfolioQuery.refetch()
      .finally(() => setRefreshing(false));
  };



  return (
    <View style={styles.container}>
      <ModuleErrorBoundary moduleName="Portfolio">
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={[styles.header, { paddingHorizontal: responsiveStyles.cardMargin }]}>
          <Text style={[styles.headerTitle, { fontSize: responsiveStyles.headerTitle }]}>{t('portfolio')}</Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.scrollView}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          <View style={[styles.portfolioCard, { marginHorizontal: responsiveStyles.cardMargin, padding: responsiveStyles.cardPadding }]}>
            <View style={styles.portfolioHeader}>
              <Text style={[styles.portfolioLabel, { fontSize: responsiveStyles.portfolioLabel }]}>{t('totalPortfolioValue')}</Text>
              <View style={[
                styles.changeBadge,
                {
                  backgroundColor: isPositive ? Colors.success + '20' : Colors.error + '20',
                  paddingHorizontal: responsiveStyles.changeBadgePadding,
                }
              ]}>
                {isPositive ? (
                  <TrendingUp size={isXs ? 12 : 14} color={Colors.success} />
                ) : (
                  <TrendingDown size={isXs ? 12 : 14} color={Colors.error} />
                )}
                <Text style={[styles.changeText, { fontSize: responsiveStyles.changeText, color: isPositive ? Colors.success : Colors.error }]}>
                  {isPositive ? '+' : ''}{totalUnrealizedPnLPercent.toFixed(2)}%
                </Text>
              </View>
            </View>

            <Text style={[styles.portfolioValue, { fontSize: responsiveStyles.portfolioValue }]}>
              {formatCurrencyWithDecimals(totalPortfolioValue)}
            </Text>

            <Text style={[styles.pnlText, { fontSize: responsiveStyles.pnlText, color: isPositive ? Colors.success : Colors.error }]}>
              {isPositive ? '+' : ''}{formatCurrencyWithDecimals(Math.abs(totalUnrealizedPnL))} {t('allTime').toLowerCase()}
            </Text>

            <View style={styles.chartContainer}>
              <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
                <Defs>
                  <LinearGradient id="portfolioGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <Stop offset="0%" stopColor={isPositive ? Colors.success : Colors.error} stopOpacity={0.3} />
                    <Stop offset="100%" stopColor={isPositive ? Colors.success : Colors.error} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                {gradientPath && <Path d={gradientPath} fill="url(#portfolioGradient)" />}
                {chartPath && (
                  <Path
                    d={chartPath}
                    fill="none"
                    stroke={isPositive ? Colors.success : Colors.error}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                )}
              </Svg>
            </View>
          </View>

          {ipxHoldings.length > 0 && (
            <View style={[styles.ipxSummaryCard, { marginHorizontal: responsiveStyles.cardMargin }]}>
              <View style={styles.ipxSummaryLeft}>
                <View style={styles.ipxIconContainer}>
                  <Building2 size={20} color={Colors.primary} />
                </View>
                <View>
                  <Text style={styles.ipxSummaryLabel}>{t('ipxHoldings')}</Text>
                  <Text style={styles.ipxSummaryValue}>{formatCurrencyWithDecimals(getTotalIPXValue)}</Text>
                </View>
              </View>
              <View style={[
                styles.ipxPnlBadge,
                { backgroundColor: getTotalIPXPnL >= 0 ? Colors.success + '20' : Colors.error + '20' }
              ]}>
                <Text style={[
                  styles.ipxPnlText,
                  { color: getTotalIPXPnL >= 0 ? Colors.success : Colors.error }
                ]}>
                  {getTotalIPXPnL >= 0 ? '+' : ''}{getTotalIPXPnLPercent.toFixed(1)}%
                </Text>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.walletCard, { marginHorizontal: responsiveStyles.cardMargin, padding: isXs ? 10 : isCompact ? 12 : 16 }]}
            onPress={() => router.push('/wallet' as any)}
            activeOpacity={0.7}
          >
            <View style={styles.walletLeft}>
              <Wallet size={isXs ? 18 : isCompact ? 20 : 24} color={Colors.primary} />
              <View>
                <Text style={[styles.walletLabel, { fontSize: responsiveStyles.walletLabel }]}>{t('availableBalance')}</Text>
                <Text style={[styles.walletValue, { fontSize: responsiveStyles.walletValue }]}>
                  {formatCurrencyWithDecimals(walletBalance)}
                </Text>
              </View>
            </View>
            <View style={styles.walletRight}>
              <Text style={styles.manageFundsText}>{t('manage')}</Text>
              <ChevronRight size={18} color={Colors.primary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.earnCard, { marginHorizontal: responsiveStyles.cardMargin, padding: isXs ? 10 : isCompact ? 12 : 16 }]}
            onPress={() => router.push('/ipx-earn' as any)}
            activeOpacity={0.7}
          >
            <View style={styles.walletLeft}>
              <PiggyBank size={isXs ? 18 : isCompact ? 20 : 24} color={Colors.primary} />
              <View>
                <View style={styles.earnLabelRow}>
                  <Text style={[styles.walletLabel, { fontSize: responsiveStyles.walletLabel }]}>{t('ipxEarn')}</Text>
                  <View style={styles.earnApyBadge}>
                    <Percent size={8} color={Colors.black} />
                    <Text style={styles.earnApyBadgeText}>{`${Math.round(apyRate * 100)}% APY`}</Text>
                  </View>
                </View>
                <Text style={[styles.walletValue, { fontSize: responsiveStyles.walletValue }]}>
                  {formatCurrencyWithDecimals(earnBalance)}
                </Text>
              </View>
            </View>
            <View style={styles.walletRight}>
              <Text style={styles.manageFundsText}>{earnBalance > 0 ? t('viewLabel') : t('startLabel')}</Text>
              <ChevronRight size={18} color={Colors.primary} />
            </View>
          </TouchableOpacity>

          <View style={[styles.tabsContainer, { marginHorizontal: responsiveStyles.cardMargin }]}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'holdings' && styles.tabActive]}
              onPress={() => setActiveTab('holdings')}
            >
              <Text style={[styles.tabText, { fontSize: responsiveStyles.tabText }, activeTab === 'holdings' && styles.tabTextActive]}>
                {t('holdings')} ({ipxHoldings.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'ipx' && styles.tabActive]}
              onPress={() => setActiveTab('ipx')}
            >
              <Text style={[styles.tabText, { fontSize: responsiveStyles.tabText }, activeTab === 'ipx' && styles.tabTextActive]}>
                IVXHOLDINGS ({ipxHoldings.length})
              </Text>
            </TouchableOpacity>

          </View>

          {activeTab === 'holdings' ? (
            <View style={[styles.holdingsSection, { paddingHorizontal: responsiveStyles.cardMargin }]}>
              {ipxHoldings.length === 0 ? (
                <View style={styles.emptyState}>
                  <Building2 size={48} color={Colors.textTertiary} />
                  <Text style={styles.emptyStateText}>{t('noHoldings')}</Text>
                  <Text style={styles.emptyStateSubtext}>{t('startInvesting')}</Text>
                  <TouchableOpacity
                    style={styles.emptyStateCta}
                    onPress={() => router.push('/(tabs)/market' as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.emptyStateCtaText}>Browse Properties</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                ipxHoldings.map(holding => (
                  <IPXHoldingCard key={holding.id} holding={holding} />
                ))
              )}
            </View>
          ) : (
            <View style={[styles.holdingsSection, { paddingHorizontal: responsiveStyles.cardMargin }]}>
              {ipxHoldings.length === 0 ? (
                <View style={styles.emptyState}>
                  <Building2 size={48} color={Colors.textTertiary} />
                  <Text style={styles.emptyStateText}>{t('noIpxHoldings')}</Text>
                  <Text style={styles.emptyStateSubtext}>{t('investInShares')}</Text>
                </View>
              ) : (
                ipxHoldings.map(holding => (
                  <IPXHoldingCard key={holding.id} holding={holding} />
                ))
              )}
            </View>
          )}

          <MyResaleListingsWidget router={router} />

          <MacroContextWidget router={router} />

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>
      </ModuleErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingVertical: 12,
  },
  headerTitle: {
    fontWeight: '800' as const,
    color: Colors.text,
  },
  portfolioCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  portfolioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  portfolioLabel: {
    color: Colors.textSecondary,
    fontWeight: '500' as const,
    flexShrink: 1,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 20,
    paddingVertical: 4,
  },
  changeText: {
    fontWeight: '700' as const,
  },
  portfolioValue: {
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  pnlText: {
    fontWeight: '600' as const,
    marginBottom: 16,
  },
  chartContainer: {
    alignItems: 'center',
    marginTop: 8,
  },
  ipxSummaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  ipxSummaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  ipxIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ipxSummaryLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500' as const,
    flexShrink: 1,
  },
  ipxSummaryValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  ipxPnlBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ipxPnlText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  walletCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  earnCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  earnLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  earnApyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  earnApyBadgeText: {
    color: Colors.black,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  walletLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  walletLabel: {
    color: Colors.textSecondary,
    fontWeight: '500' as const,
    flexShrink: 1,
  },
  walletValue: {
    color: Colors.text,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  walletRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  manageFundsText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600' as const,
    flexShrink: 1,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
  tabTextActive: {
    color: Colors.black,
  },
  holdingsSection: {
    gap: 10,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyStateText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  emptyStateSubtext: {
    color: Colors.textTertiary,
    fontSize: 14,
  },
  emptyStateCta: {
    marginTop: 12,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyStateCtaText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  bottomPadding: {
    height: 120,
  },
  scrollView: {
    backgroundColor: Colors.background,
  },
});
