import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  RefreshControl} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Globe,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  BarChart3,
  Zap,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Minus} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { ErrorState } from '@/components/ivx';
import {
  useGlobalMarkets,
  formatPrice,
  formatMarketCap,
  MONEY_FLOW_NODES,
  ECONOMIC_INDICATORS,
  ForexRate,
  GlobalIndex,
  CryptoAsset,
  Commodity} from '@/lib/global-markets';

type TabType = 'overview' | 'forex' | 'indices' | 'crypto' | 'commodities' | 'flow';

const TAB_LIST: { key: TabType; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'forex', label: 'Forex' },
  { key: 'indices', label: 'Indices' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'commodities', label: 'Commodities' },
  { key: 'flow', label: 'Money Flow' },
];

function ChangeTag({ value, size = 12 }: { value: number; size?: number }) {
  const color = value > 0 ? Colors.positive : value < 0 ? Colors.negative : Colors.textSecondary;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <View style={[styles.changeTag, { backgroundColor: color + '20' }]}>
      <Icon size={size - 1} color={color} />
      <Text style={[styles.changeTagText, { color, fontSize: size }]}>
        {Math.abs(value).toFixed(2)}%
      </Text>
    </View>
  );
}

function ForexRow({ item, index }: { item: ForexRate; index: number }) {
  const flashAnim = useRef(new Animated.Value(0)).current;
  const prevRate = useRef(item.rate);

  useEffect(() => {
    if (prevRate.current !== item.rate) {
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 150, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 0, duration: 400, useNativeDriver: false }),
      ]).start();
      prevRate.current = item.rate;
    }
  }, [item.rate, flashAnim]);

  const bgColor = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', item.changePercent24h >= 0 ? Colors.positive + '20' : Colors.negative + '20']});

  const priceColor = item.changePercent24h >= 0 ? Colors.positive : item.changePercent24h < 0 ? Colors.negative : Colors.text;

  return (
    <Animated.View style={[styles.dataRow, { backgroundColor: bgColor }, index % 2 === 0 && styles.dataRowAlt]}>
      <View style={styles.dataRowLeft}>
        <Text style={styles.dataRowFlag}>{item.flag}</Text>
        <View>
          <Text style={styles.dataRowSymbol}>{item.symbol}</Text>
          <Text style={styles.dataRowSub}>{item.base} → {item.quote}</Text>
        </View>
      </View>
      <View style={styles.dataRowRight}>
        <Text style={[styles.dataRowPrice, { color: priceColor }]}>
          {item.rate < 10 ? item.rate.toFixed(4) : item.rate.toFixed(2)}
        </Text>
        <ChangeTag value={item.changePercent24h} />
      </View>
    </Animated.View>
  );
}

function IndexRow({ item, index }: { item: GlobalIndex; index: number }) {
  return (
    <View style={[styles.dataRow, index % 2 === 0 && styles.dataRowAlt]}>
      <View style={styles.dataRowLeft}>
        <Text style={styles.dataRowFlag}>{item.flag}</Text>
        <View>
          <Text style={styles.dataRowSymbol}>{item.symbol}</Text>
          <Text style={styles.dataRowSub}>{item.country} · {item.region}</Text>
        </View>
      </View>
      <View style={styles.dataRowRight}>
        <Text style={styles.dataRowPrice}>
          {item.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>
        <ChangeTag value={item.changePercent} />
      </View>
    </View>
  );
}

function CryptoRow({ item, index }: { item: CryptoAsset; index: number }) {
  return (
    <View style={[styles.dataRow, index % 2 === 0 && styles.dataRowAlt]}>
      <View style={styles.dataRowLeft}>
        <View style={[styles.cryptoDot, { backgroundColor: item.color }]} />
        <View>
          <Text style={styles.dataRowSymbol}>{item.symbol}</Text>
          <Text style={styles.dataRowSub}>{item.name} · {formatMarketCap(item.marketCap)}</Text>
        </View>
      </View>
      <View style={styles.dataRowRight}>
        <Text style={styles.dataRowPrice}>{formatPrice(item.price)}</Text>
        <ChangeTag value={item.changePercent24h} />
      </View>
    </View>
  );
}

function CommodityRow({ item, index }: { item: Commodity; index: number }) {
  return (
    <View style={[styles.dataRow, index % 2 === 0 && styles.dataRowAlt]}>
      <View style={styles.dataRowLeft}>
        <View style={[styles.cryptoDot, { backgroundColor: item.color }]} />
        <View>
          <Text style={styles.dataRowSymbol}>{item.symbol}</Text>
          <Text style={styles.dataRowSub}>{item.name} · {item.unit}</Text>
        </View>
      </View>
      <View style={styles.dataRowRight}>
        <Text style={styles.dataRowPrice}>
          {`${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: item.price >= 100 ? 2 : 3 }).format(item.price)}`}
        </Text>
        <ChangeTag value={item.changePercent24h} />
      </View>
    </View>
  );
}

export default function GlobalIntelligenceScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const _dimensions = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const { forex, indices, crypto, commodities, lastUpdated, marketSentiment, globalStats } = useGlobalMarkets(3500);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [fadeAnim, pulseAnim]);

  const sentimentColor = marketSentiment === 'bullish' ? Colors.positive : marketSentiment === 'bearish' ? Colors.negative : Colors.warning;
  const sentimentLabel = marketSentiment === 'bullish' ? '🐂 BULL MARKET' : marketSentiment === 'bearish' ? '🐻 BEAR MARKET' : '⚖️ NEUTRAL';

  const gainers = useMemo(() => indices.filter(i => i.changePercent > 0).length, [indices]);
  const losers = useMemo(() => indices.filter(i => i.changePercent < 0).length, [indices]);

  const handleRefresh = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  };

  const tabBar = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabContent}>
      {TAB_LIST.map(tab => (
        <TouchableOpacity
          key={tab.key}
          style={[styles.tab, activeTab === tab.key && styles.tabActive]}
          onPress={() => { setActiveTab(tab.key); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Global Intelligence</Text>
          </View>
          <View style={[styles.sentimentBadge, { backgroundColor: sentimentColor + '20', borderColor: sentimentColor + '40' }]}>
            <Animated.View style={[styles.liveDot, { backgroundColor: sentimentColor, transform: [{ scale: pulseAnim }] }]} />
            <Text style={[styles.sentimentText, { color: sentimentColor }]}>{sentimentLabel}</Text>
          </View>
        </View>

        {tabBar}

        <Animated.ScrollView
          style={{ opacity: fadeAnim }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
          contentContainerStyle={styles.scrollContent}
        >
          {activeTab === 'overview' && (
            <>
              <View style={styles.statsGrid}>
                {[
                  { label: 'Daily Forex Volume', value: globalStats.totalForexVolume, icon: <DollarSign size={14} color="#4A90D9" />, color: '#4A90D9' },
                  { label: 'Crypto Market Cap', value: globalStats.globalCryptoMarketCap, icon: <Activity size={14} color="#F7931A" />, color: '#F7931A' },
                  { label: 'Real Estate / Day', value: globalStats.dailyRealEstateTransactions, icon: <BarChart3 size={14} color={Colors.primary} />, color: Colors.primary },
                  { label: 'Total Global AUM', value: globalStats.totalAUM, icon: <TrendingUp size={14} color={Colors.positive} />, color: Colors.positive },
                  { label: 'GDP Growth Rate', value: globalStats.globalGDPGrowth, icon: <Zap size={14} color="#9B59B6" />, color: '#9B59B6' },
                  { label: 'Active Investors', value: globalStats.activeInvestors, icon: <Globe size={14} color="#E67E22" />, color: '#E67E22' },
                ].map((stat, i) => (
                  <View key={i} style={[styles.statCard, { borderLeftColor: stat.color }]}>
                    <View style={[styles.statIconWrap, { backgroundColor: stat.color + '20' }]}>{stat.icon}</View>
                    <Text style={styles.statCardValue}>{stat.value}</Text>
                    <Text style={styles.statCardLabel}>{stat.label}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.marketSummary}>
                <Text style={styles.sectionTitle}>Market Summary</Text>
                <View style={styles.marketSummaryRow}>
                  <View style={styles.summaryCard}>
                    <TrendingUp size={20} color={Colors.positive} />
                    <Text style={styles.summaryValue}>{gainers}</Text>
                    <Text style={styles.summaryLabel}>Gainers</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <TrendingDown size={20} color={Colors.negative} />
                    <Text style={styles.summaryValue}>{losers}</Text>
                    <Text style={styles.summaryLabel}>Losers</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Minus size={20} color={Colors.textSecondary} />
                    <Text style={styles.summaryValue}>{indices.length - gainers - losers}</Text>
                    <Text style={styles.summaryLabel}>Flat</Text>
                  </View>
                </View>
              </View>

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Top Movers — Indices</Text>
                {[...indices].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 5).map((idx, i) => (
                  <IndexRow key={idx.symbol} item={idx} index={i} />
                ))}
              </View>

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Top Movers — Forex</Text>
                {[...forex].sort((a, b) => Math.abs(b.changePercent24h) - Math.abs(a.changePercent24h)).slice(0, 5).map((fx, i) => (
                  <ForexRow key={fx.symbol} item={fx} index={i} />
                ))}
              </View>

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Economic Indicators</Text>
                {ECONOMIC_INDICATORS.map((ind, i) => (
                  <View key={ind.country} style={[styles.ecoRow, i % 2 === 0 && styles.dataRowAlt]}>
                    <View style={styles.ecoLeft}>
                      <Text style={styles.ecoFlag}>{ind.flag}</Text>
                      <View>
                        <Text style={styles.ecoCountry}>{ind.country}</Text>
                        <Text style={styles.ecoSub}>{ind.currency}</Text>
                      </View>
                    </View>
                    <View style={styles.ecoMetrics}>
                      <View style={styles.ecoMetric}>
                        <Text style={styles.ecoMetricVal}>{ind.gdpGrowth}%</Text>
                        <Text style={styles.ecoMetricLbl}>GDP</Text>
                      </View>
                      <View style={styles.ecoMetric}>
                        <Text style={[styles.ecoMetricVal, { color: ind.inflation > 4 ? Colors.negative : Colors.positive }]}>{ind.inflation}%</Text>
                        <Text style={styles.ecoMetricLbl}>CPI</Text>
                      </View>
                      <View style={styles.ecoMetric}>
                        <Text style={styles.ecoMetricVal}>{ind.interestRate}%</Text>
                        <Text style={styles.ecoMetricLbl}>Rate</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {activeTab === 'forex' && (
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Live Forex Rates</Text>
                <View style={styles.liveChip}>
                  <Animated.View style={[styles.liveDotSmall, { transform: [{ scale: pulseAnim }] }]} />
                  <Text style={styles.liveChipText}>LIVE</Text>
                </View>
              </View>
              <View style={styles.tableHeader}>
                <Text style={styles.tableHeaderText}>PAIR</Text>
                <Text style={styles.tableHeaderText}>RATE / CHANGE</Text>
              </View>
              {forex.map((fx, i) => <ForexRow key={fx.symbol} item={fx} index={i} />)}
            </View>
          )}

          {activeTab === 'indices' && (
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Global Indices</Text>
                <View style={styles.liveChip}>
                  <Animated.View style={[styles.liveDotSmall, { transform: [{ scale: pulseAnim }] }]} />
                  <Text style={styles.liveChipText}>LIVE</Text>
                </View>
              </View>
              <View style={styles.tableHeader}>
                <Text style={styles.tableHeaderText}>INDEX</Text>
                <Text style={styles.tableHeaderText}>VALUE / CHANGE</Text>
              </View>
              {indices.map((idx, i) => <IndexRow key={idx.symbol} item={idx} index={i} />)}
            </View>
          )}

          {activeTab === 'crypto' && (
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Crypto Markets</Text>
                <View style={styles.liveChip}>
                  <Animated.View style={[styles.liveDotSmall, { transform: [{ scale: pulseAnim }] }]} />
                  <Text style={styles.liveChipText}>LIVE</Text>
                </View>
              </View>
              <View style={styles.tableHeader}>
                <Text style={styles.tableHeaderText}>ASSET</Text>
                <Text style={styles.tableHeaderText}>PRICE / CHANGE</Text>
              </View>
              {crypto.map((c, i) => <CryptoRow key={c.symbol} item={c} index={i} />)}

              <View style={styles.cryptoStatsRow}>
                {[
                  { label: 'Total Market Cap', value: '$2.31T' },
                  { label: '24h Volume', value: '$96.4B' },
                  { label: 'BTC Dominance', value: '57.3%' },
                  { label: 'ETH Dominance', value: '17.8%' },
                ].map((s, i) => (
                  <View key={i} style={styles.cryptoStatCard}>
                    <Text style={styles.cryptoStatValue}>{s.value}</Text>
                    <Text style={styles.cryptoStatLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {activeTab === 'commodities' && (
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Commodities</Text>
                <View style={styles.liveChip}>
                  <Animated.View style={[styles.liveDotSmall, { transform: [{ scale: pulseAnim }] }]} />
                  <Text style={styles.liveChipText}>LIVE</Text>
                </View>
              </View>
              <View style={styles.tableHeader}>
                <Text style={styles.tableHeaderText}>COMMODITY</Text>
                <Text style={styles.tableHeaderText}>PRICE / CHANGE</Text>
              </View>
              {commodities.map((c, i) => <CommodityRow key={c.symbol} item={c} index={i} />)}

              <View style={styles.commodityNote}>
                <Zap size={14} color={Colors.primary} />
                <Text style={styles.commodityNoteText}>
                  Commodity prices directly impact real estate construction costs, rental yields, and property valuations. IVXHOLDINGS monitors all macro signals in real time.
                </Text>
              </View>
            </View>
          )}

          {activeTab === 'flow' && (
            <>
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Global Capital Flow</Text>
                <Text style={styles.sectionSubtitle}>Real-time allocation of institutional capital across global financial centers</Text>

                {MONEY_FLOW_NODES.map((node, _i) => (
                  <View key={node.country} style={styles.flowRow}>
                    <View style={styles.flowLeft}>
                      <Text style={styles.flowFlag}>{node.flag}</Text>
                      <View>
                        <Text style={styles.flowCity}>{node.city}</Text>
                        <Text style={styles.flowCountry}>{node.country}</Text>
                      </View>
                    </View>
                    <View style={styles.flowMid}>
                      <View style={styles.flowBarBg}>
                        <View style={[styles.flowBar, { width: `${node.percentage}%` as any, backgroundColor: node.color }]} />
                      </View>
                    </View>
                    <View style={styles.flowRight}>
                      <Text style={[styles.flowDirection, { color: node.direction === 'inflow' ? Colors.positive : Colors.negative }]}>
                        {node.direction === 'inflow' ? '▲' : '▼'} {node.percentage}%
                      </Text>
                      <Text style={styles.flowVolume}>${new Intl.NumberFormat('en-US').format(node.volume)}B</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Where Your Dollars Go</Text>
                {[
                  { label: 'Real Estate (Global)', pct: 28, color: Colors.primary, amount: '$2.1T' },
                  { label: 'Equity Markets', pct: 32, color: '#4A90D9', amount: '$2.4T' },
                  { label: 'Fixed Income / Bonds', pct: 18, color: '#00C48C', amount: '$1.35T' },
                  { label: 'Cryptocurrencies', pct: 8, color: '#F7931A', amount: '$600B' },
                  { label: 'Commodities', pct: 7, color: '#FFD700', amount: '$525B' },
                  { label: 'Cash & Equivalents', pct: 7, color: '#9A9A9A', amount: '$525B' },
                ].map((item, i) => (
                  <View key={i} style={styles.allocationRow}>
                    <View style={styles.allocationLeft}>
                      <View style={[styles.allocationDot, { backgroundColor: item.color }]} />
                      <Text style={styles.allocationLabel}>{item.label}</Text>
                    </View>
                    <View style={styles.allocationRight}>
                      <View style={styles.allocationBarBg}>
                        <View style={[styles.allocationBar, { width: `${item.pct}%` as any, backgroundColor: item.color }]} />
                      </View>
                      <Text style={[styles.allocationPct, { color: item.color }]}>{item.pct}%</Text>
                      <Text style={styles.allocationAmount}>{item.amount}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={[styles.ipxConnectCard]}>
                <View style={styles.ipxConnectHeader}>
                  <Globe size={18} color={Colors.primary} />
                  <Text style={styles.ipxConnectTitle}>IVXHOLDINGS Real Estate Intelligence</Text>
                </View>
                <Text style={styles.ipxConnectText}>
                  Every IVXHOLDINGS property token is priced against live global capital flow data. When institutional money moves into US real estate, your tokenized holdings respond in real time — giving you the edge that only billionaires had before.
                </Text>
                <View style={styles.ipxConnectStats}>
                  {[
                    { label: 'Correlated Markets', value: '47' },
                    { label: 'Data Points/Min', value: '1,240' },
                    { label: 'Signal Accuracy', value: '94.2%' },
                  ].map((s, i) => (
                    <View key={i} style={styles.ipxConnectStat}>
                      <Text style={styles.ipxConnectStatValue}>{s.value}</Text>
                      <Text style={styles.ipxConnectStatLabel}>{s.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </>
          )}

          <View style={styles.simulatedBanner}>
            <Activity size={14} color={Colors.warning} />
            <Text style={styles.simulatedText}>
              Simulated market data for reference only. Not connected to live market feeds.
            </Text>
          </View>

          <View style={styles.lastUpdate}>
            <RefreshCw size={11} color={Colors.textTertiary} />
            <Text style={styles.lastUpdateText}>
              Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Text>
          </View>

          <View style={styles.bottomPad} />
        </Animated.ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safeTop: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexWrap: 'nowrap'},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0},
  headerTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
    flexShrink: 1},
  sentimentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    flexShrink: 0},
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.positive},
  liveDotSmall: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.positive},
  sentimentText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
    flexShrink: 1},
  tabScroll: { height: 48, flexShrink: 0 },
  tabContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center' as const},
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  tabText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  tabTextActive: {
    color: Colors.black},
  scrollContent: { paddingTop: 8, paddingBottom: 140 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8},
  statCard: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 3,
    gap: 4},
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4},
  statCardValue: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    letterSpacing: -0.5},
  statCardLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 15},
  marketSummary: {
    marginHorizontal: 16,
    marginBottom: 8},
  sectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    marginBottom: 12,
    letterSpacing: 0.2},
  sectionSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: -8,
    marginBottom: 14,
    lineHeight: 18},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12},
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.positive + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20},
  liveChipText: {
    color: Colors.positive,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.8},
  marketSummaryRow: {
    flexDirection: 'row',
    gap: 10},
  summaryCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 4},
  summaryValue: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800' as const},
  summaryLabel: {
    color: Colors.textSecondary,
    fontSize: 11},
  sectionBlock: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border},
  tableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 4},
  tableHeaderText: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.8},
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8},
  dataRowAlt: {
    backgroundColor: Colors.backgroundSecondary},
  dataRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1},
  dataRowFlag: {
    fontSize: 20},
  dataRowSymbol: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const},
  dataRowSub: {
    color: Colors.textTertiary,
    fontSize: 10,
    marginTop: 1},
  dataRowRight: {
    alignItems: 'flex-end',
    gap: 4},
  dataRowPrice: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const},
  changeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8},
  changeTagText: {
    fontSize: 11,
    fontWeight: '700' as const},
  cryptoDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'},
  cryptoStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  cryptoStatCard: {
    width: '47%',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center'},
  cryptoStatValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const},
  cryptoStatLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    marginTop: 2},
  commodityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    backgroundColor: Colors.primary + '10',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '30'},
  commodityNoteText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 17},
  ecoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8},
  ecoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1},
  ecoFlag: { fontSize: 20 },
  ecoCountry: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const},
  ecoSub: {
    color: Colors.textTertiary,
    fontSize: 10},
  ecoMetrics: {
    flexDirection: 'row',
    gap: 14},
  ecoMetric: { alignItems: 'center' },
  ecoMetricVal: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const},
  ecoMetricLbl: {
    color: Colors.textTertiary,
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 0.5},
  flowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '50'},
  flowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 90},
  flowFlag: { fontSize: 18 },
  flowCity: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '700' as const},
  flowCountry: {
    color: Colors.textTertiary,
    fontSize: 9},
  flowMid: { flex: 1 },
  flowBarBg: {
    height: 6,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 3,
    overflow: 'hidden'},
  flowBar: {
    height: 6,
    borderRadius: 3},
  flowRight: {
    alignItems: 'flex-end',
    width: 70},
  flowDirection: {
    fontSize: 11,
    fontWeight: '700' as const},
  flowVolume: {
    color: Colors.textSecondary,
    fontSize: 10},
  allocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: 8},
  allocationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 140},
  allocationDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  allocationLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    flex: 1},
  allocationRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  allocationBarBg: {
    flex: 1,
    height: 5,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 3,
    overflow: 'hidden'},
  allocationBar: {
    height: 5,
    borderRadius: 3},
  allocationPct: {
    fontSize: 11,
    fontWeight: '700' as const,
    width: 32,
    textAlign: 'right'},
  allocationAmount: {
    color: Colors.textTertiary,
    fontSize: 10,
    width: 42,
    textAlign: 'right'},
  ipxConnectCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.primary + '10',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.primary + '30'},
  ipxConnectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10},
  ipxConnectTitle: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const},
  ipxConnectText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 14},
  ipxConnectStats: {
    flexDirection: 'row',
    gap: 10},
  ipxConnectStat: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center'},
  ipxConnectStatValue: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '800' as const},
  ipxConnectStatLabel: {
    color: Colors.textSecondary,
    fontSize: 9,
    marginTop: 2,
    textAlign: 'center'},
  lastUpdate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 4},
  lastUpdateText: {
    color: Colors.textTertiary,
    fontSize: 10},
  simulatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: Colors.warning + '15',
    borderWidth: 1,
    borderColor: Colors.warning + '30',
    borderRadius: 10,
    padding: 12},
  simulatedText: {
    flex: 1,
    color: Colors.warning,
    fontSize: 11,
    fontWeight: '600' as const,
    lineHeight: 16},
  bottomPad: { height: 30 }});
