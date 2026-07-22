import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import { TrendingUp, TrendingDown, Activity, BarChart3, Clock, Zap, Globe, ArrowUpRight, ArrowDownRight, ChevronRight, Tag, ShoppingCart } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { getResponsiveSize, isCompactScreen, isExtraSmallScreen } from '@/lib/responsive';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTranslation } from '@/lib/i18n-context';
import { useAnalytics } from '@/lib/analytics-context';
import PriceChart from '@/components/PriceChart';
import TradingModal from '@/components/TradingModal';
import { TimeRange, Property, MarketData, Order } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useGlobalMarkets } from '@/lib/global-markets';
import { formatCurrencyWithDecimals, formatCurrencyCompact, formatNumber } from '@/lib/formatters';
import type { ResaleListing } from '@/lib/investment-service';

type MarketTab = 'all' | 'gainers' | 'losers';

const MarketPropertyThumb = React.memo(function MarketPropertyThumb({ uri, name, size, borderRadius, marginRight }: {
  uri?: string;
  name?: string;
  size: number;
  borderRadius: number;
  marginRight: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View style={[styles.propertyImage, styles.propertyImagePlaceholder, { width: size, height: size, borderRadius, marginRight }]}>
        <Text style={styles.propertyImagePlaceholderText}>{name?.charAt(0) ?? 'P'}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[styles.propertyImage, { width: size, height: size, borderRadius, marginRight }]}
      onError={() => { setFailed(true); console.log('[Market] Image failed:', uri?.substring(0, 60)); }}
    />
  );
});

function GlobalMarketsSection({ router }: { router: ReturnType<typeof useRouter> }) {
  const { forex, indices, crypto: _crypto, commodities, marketSentiment } = useGlobalMarkets(4000);
  const sentimentColor = marketSentiment === 'bullish' ? Colors.success : marketSentiment === 'bearish' ? Colors.error : Colors.warning;
  const sentimentLabel = marketSentiment === 'bullish' ? '🐂 Bullish' : marketSentiment === 'bearish' ? '🐻 Bearish' : '⚖️ Neutral';

  const topForex = forex.slice(0, 4);
  const topIndices = indices.slice(0, 4);

  return (
    <View style={gmStyles.wrap}>
      <View style={gmStyles.header}>
        <View style={gmStyles.headerLeft}>
          <Globe size={16} color={Colors.primary} />
          <Text style={gmStyles.headerTitle}>Global Markets</Text>
          <View style={[gmStyles.sentimentBadge, { backgroundColor: sentimentColor + '20' }]}>
            <Text style={[gmStyles.sentimentText, { color: sentimentColor }]}>{sentimentLabel}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={gmStyles.viewAllBtn}
          onPress={() => router.push('/global-intelligence' as any)}
          activeOpacity={0.7}
        >
          <Text style={gmStyles.viewAllText}>Full Intelligence</Text>
          <ChevronRight size={13} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={gmStyles.grid}>
        <View style={gmStyles.section}>
          <Text style={gmStyles.sectionLabel}>FOREX</Text>
          {topForex.map((fx) => {
            const up = fx.changePercent24h >= 0;
            return (
              <View key={fx.symbol} style={gmStyles.row}>
                <Text style={gmStyles.rowFlag}>{fx.flag}</Text>
                <Text style={gmStyles.rowSymbol}>{fx.symbol}</Text>
                <Text style={gmStyles.rowRate}>
                  {fx.rate < 10 ? fx.rate.toFixed(4) : fx.rate.toFixed(2)}
                </Text>
                <View style={[gmStyles.changePill, { backgroundColor: (up ? Colors.success : Colors.error) + '20' }]}>
                  {up ? <ArrowUpRight size={9} color={Colors.success} /> : <ArrowDownRight size={9} color={Colors.error} />}
                  <Text style={[gmStyles.changeVal, { color: up ? Colors.success : Colors.error }]}>
                    {Math.abs(fx.changePercent24h).toFixed(2)}%
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={gmStyles.divider} />

        <View style={gmStyles.section}>
          <Text style={gmStyles.sectionLabel}>INDICES</Text>
          {topIndices.map((idx) => {
            const up = idx.changePercent >= 0;
            return (
              <View key={idx.symbol} style={gmStyles.row}>
                <Text style={gmStyles.rowFlag}>{idx.flag}</Text>
                <Text style={gmStyles.rowSymbol}>{idx.symbol}</Text>
                <Text style={gmStyles.rowRate}>
                  {idx.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </Text>
                <View style={[gmStyles.changePill, { backgroundColor: (up ? Colors.success : Colors.error) + '20' }]}>
                  {up ? <ArrowUpRight size={9} color={Colors.success} /> : <ArrowDownRight size={9} color={Colors.error} />}
                  <Text style={[gmStyles.changeVal, { color: up ? Colors.success : Colors.error }]}>
                    {Math.abs(idx.changePercent).toFixed(2)}%
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View style={gmStyles.commodityRow}>
        {commodities.slice(0, 3).map((c) => {
          const up = c.changePercent24h >= 0;
          return (
            <View key={c.symbol} style={gmStyles.commodityCard}>
              <View style={[gmStyles.commodityDot, { backgroundColor: c.color }]} />
              <Text style={gmStyles.commodityName}>{c.name}</Text>
              <Text style={gmStyles.commodityPrice}>
                {formatCurrencyWithDecimals(c.price)}
              </Text>
              <Text style={[gmStyles.commodityChange, { color: up ? Colors.success : Colors.error }]}>
                {up ? '+' : ''}{c.changePercent24h.toFixed(2)}%
              </Text>
            </View>
          );
        })}
      </View>

      <TouchableOpacity
        style={gmStyles.intelligenceBtn}
        onPress={() => router.push('/global-intelligence' as any)}
        activeOpacity={0.85}
      >
        <Globe size={15} color={Colors.black} />
        <Text style={gmStyles.intelligenceBtnText}>Open Global Financial Intelligence</Text>
        <ChevronRight size={15} color={Colors.black} />
      </TouchableOpacity>
    </View>
  );
}

const gmStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  sentimentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  sentimentText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  section: {
    flex: 1,
  },
  sectionLabel: {
    color: Colors.textTertiary,
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  rowFlag: {
    fontSize: 13,
  },
  rowSymbol: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: '700' as const,
    flex: 1,
  },
  rowRate: {
    color: Colors.text,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
  },
  changeVal: {
    fontSize: 9,
    fontWeight: '700' as const,
  },
  divider: {
    width: 1,
    backgroundColor: Colors.surfaceBorder,
  },
  commodityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  commodityCard: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 2,
  },
  commodityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  commodityName: {
    color: Colors.textTertiary,
    fontSize: 9,
    fontWeight: '600' as const,
  },
  commodityPrice: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '800' as const,
  },
  commodityChange: {
    fontSize: 9,
    fontWeight: '700' as const,
  },
  intelligenceBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  intelligenceBtnText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '800' as const,
  },
});

function ResaleMarketplaceSection({ router }: { router: ReturnType<typeof useRouter> }) {
  const resaleQuery = useQuery({
    queryKey: ['resale-listings', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resale_listings')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) {
        console.log('[Market] Resale listings fetch error:', error.message);
        return [];
      }
      return (data || []) as ResaleListing[];
    },
    staleTime: 1000 * 30,
  });

  const listings = resaleQuery.data ?? [];
  if (listings.length === 0) return null;

  return (
    <View style={rsStyles.wrap}>
      <View style={rsStyles.header}>
        <View style={rsStyles.headerLeft}>
          <Tag size={16} color={Colors.primary} />
          <Text style={rsStyles.headerTitle}>Secondary Market</Text>
          <View style={rsStyles.countBadge}>
            <Text style={rsStyles.countText}>{listings.length}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={rsStyles.viewAllBtn}
          onPress={() => router.push('/resale-marketplace' as any)}
          activeOpacity={0.7}
        >
          <Text style={rsStyles.viewAllText}>View All</Text>
          <ChevronRight size={13} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      <Text style={rsStyles.subtext}>
        Buy shares from other investors at their listed prices
      </Text>
      {listings.map((listing: ResaleListing) => (
        <TouchableOpacity
          key={listing.id}
          style={rsStyles.listingCard}
          onPress={() => router.push(`/resale-marketplace?listingId=${listing.id}` as any)}
          activeOpacity={0.8}
        >
          <View style={rsStyles.listingLeft}>
            <ShoppingCart size={16} color={Colors.primary} />
            <View style={rsStyles.listingInfo}>
              <Text style={rsStyles.listingName} numberOfLines={1}>{listing.property_name}</Text>
              <Text style={rsStyles.listingMeta}>
                {formatNumber(listing.shares)} shares @ {formatCurrencyWithDecimals(listing.ask_price_per_share)}
              </Text>
            </View>
          </View>
          <View style={rsStyles.listingRight}>
            <Text style={rsStyles.listingTotal}>{formatCurrencyCompact(listing.total_ask)}</Text>
            {listing.ask_price_per_share > listing.original_cost_basis ? (
              <View style={[rsStyles.premiumBadge, { backgroundColor: Colors.error + '20' }]}>
                <Text style={[rsStyles.premiumText, { color: Colors.error }]}>
                  +{((listing.ask_price_per_share - listing.original_cost_basis) / listing.original_cost_basis * 100).toFixed(1)}%
                </Text>
              </View>
            ) : (
              <View style={[rsStyles.premiumBadge, { backgroundColor: Colors.success + '20' }]}>
                <Text style={[rsStyles.premiumText, { color: Colors.success }]}>
                  {((listing.ask_price_per_share - listing.original_cost_basis) / listing.original_cost_basis * 100).toFixed(1)}%
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const rsStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
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
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  subtext: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginBottom: 12,
    lineHeight: 16,
  },
  listingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  listingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  listingInfo: {
    flex: 1,
    minWidth: 0,
  },
  listingName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  listingMeta: {
    color: Colors.textTertiary,
    fontSize: 10,
    marginTop: 2,
  },
  listingRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  listingTotal: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  premiumBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  premiumText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
});

export default function MarketScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<MarketTab>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('1M');
  const [tradingModalVisible, setTradingModalVisible] = useState(false);
  const [selectedTradeProperty, setSelectedTradeProperty] = useState<Property | null>(null);
  const [selectedTradeMarket, setSelectedTradeMarket] = useState<MarketData | null>(null);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [liveMarketData, setLiveMarketData] = useState<Record<string, MarketData>>({});
  const [liveIndexValue, setLiveIndexValue] = useState<number>(1000);
  const [liveIndexChange, setLiveIndexChange] = useState<number>(0.5);
  
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const globalStats = useMemo(() => ({
    totalMarketCap: 0,
    totalVolume24h: 0,
    totalProperties: 0,
    avgYield: 0,
    countriesActive: 12,
    totalInvestors: 5000,
  }), []);
  const { t } = useTranslation();
  const { trackScreen, trackAction: _trackAction, trackTransaction } = useAnalytics();

  useEffect(() => {
    trackScreen('Market');
  }, [trackScreen]);

  const propertiesQuery = useQuery({
    queryKey: ['properties', 'market'],
    queryFn: async () => {
      const { data, error } = await supabase.from('properties').select('*').limit(50);
      if (error) throw error;
      return { properties: data || [] };
    },
    staleTime: 1000 * 60 * 2,
  });
  const properties: Property[] = useMemo(() => {
    const raw = (propertiesQuery.data?.properties as Property[] | undefined) ?? [];
    return Array.isArray(raw) ? raw : [];
  }, [propertiesQuery.data?.properties]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveMarketData((prev: Record<string, MarketData>) => {
        const updated = { ...prev };
        Object.keys(updated).forEach(key => {
          if (!updated[key]?.lastPrice) return;
          const change = (Math.random() - 0.5) * 0.1;
          const newPrice = Math.max(1, updated[key].lastPrice + change);
          const basePrice = newPrice - (updated[key].change24h ?? 0);
          const priceChange = newPrice - (updated[key].lastPrice - (updated[key].change24h ?? 0));
          const denominator = basePrice || 1;
          updated[key] = {
            ...updated[key],
            lastPrice: Math.round(newPrice * 100) / 100,
            change24h: Math.round(priceChange * 100) / 100,
            changePercent24h: Math.round((priceChange / denominator) * 10000) / 100,
          };
        });
        return updated;
      });
      setLiveIndexValue((prev: number) => {
        const tick = (Math.random() - 0.45) * 0.3;
        return Math.round((prev + tick) * 100) / 100;
      });
      setLiveIndexChange((prev: number) => {
        const drift = (Math.random() - 0.5) * 0.05;
        return Math.round((prev + drift) * 100) / 100;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const screenSize = getResponsiveSize(width);
  const isCompact = isCompactScreen(screenSize);
  const isNarrow = screenSize !== 'lg' && screenSize !== 'xl';
  const isXs = isExtraSmallScreen(screenSize);

  const responsiveStyles = useMemo(() => ({
    headerTitle: isXs ? 24 : isCompact ? 26 : 28,
    statValue: isXs ? 14 : isCompact ? 16 : 18,
    statLabel: isXs ? 9 : isCompact ? 10 : 11,
    statPadding: isXs ? 10 : isCompact ? 12 : 14,
    tabText: isXs ? 12 : isCompact ? 13 : 14,
    propertyImage: isXs ? 28 : isCompact ? 32 : 40,
    propertyName: isXs ? 11 : isCompact ? 12 : 14,
    propertyCity: isXs ? 9 : isCompact ? 10 : 12,
    priceText: isXs ? 11 : isCompact ? 12 : 14,
    changeText: isXs ? 9 : isCompact ? 10 : 12,
    volumeText: isXs ? 11 : isCompact ? 12 : 13,
    rowPadding: isXs ? 8 : isCompact ? 10 : 12,
    cellMinWidth: isXs ? 42 : isCompact ? 50 : 60,
    volumeCellWidth: isXs ? 45 : 55,
  }), [isCompact, isXs]);

  const { gainers, losers } = useMemo(() => {
    const allData = Object.values(liveMarketData) as MarketData[];
    const sorted = [...allData].sort((a: MarketData, b: MarketData) => b.changePercent24h - a.changePercent24h);
    return {
      gainers: sorted.filter((d: MarketData) => d.changePercent24h > 0).slice(0, 3),
      losers: sorted.filter((d: MarketData) => d.changePercent24h < 0).slice(0, 3),
    };
  }, [liveMarketData]);

  const marketList = useMemo(() => {
    const list = properties
      .filter((p: Property) => p.status !== 'coming_soon')
      .map((property: Property) => ({
        property,
        market: liveMarketData[property.id],
      }))
      .filter((item: { property: Property; market: MarketData | undefined }) => item.market);

    switch (activeTab) {
      case 'gainers':
        return list.filter((item) => item.market && item.market.changePercent24h > 0)
          .sort((a, b) => (b.market?.changePercent24h ?? 0) - (a.market?.changePercent24h ?? 0));
      case 'losers':
        return list.filter((item) => item.market && item.market.changePercent24h < 0)
          .sort((a, b) => (a.market?.changePercent24h ?? 0) - (b.market?.changePercent24h ?? 0));
      default:
        return list.sort((a, b) => (b.market?.volume24h ?? 0) - (a.market?.volume24h ?? 0));
    }
  }, [activeTab, liveMarketData, properties]);

  const selectedProperty = useMemo(() => {
    if (!selectedPropertyId) return null;
    return properties.find(p => p.id === selectedPropertyId);
  }, [selectedPropertyId, properties]);

  const { isAuthenticated } = useAuth();

  const allMarketQuery = useQuery({
    queryKey: ['market', 'all'],
    queryFn: async () => {
      const { data } = await supabase.from('market_data').select('*');
      return data || null;
    },
  });
  const globalIndexQuery = useQuery({
    queryKey: ['market', 'global-index'],
    queryFn: async () => {
      const { data } = await supabase.from('market_index').select('*').single();
      return data || null;
    },
  });
  const topMoversQuery = useQuery({
    queryKey: ['market', 'top-movers'],
    queryFn: async () => {
      const { data } = await supabase.from('market_data').select('*').order('change_percent_24h', { ascending: false }).limit(10);
      return data || null;
    },
  });
  const balanceQuery = useQuery({
    queryKey: ['wallet-balance', 'market'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
      return data || null;
    },
    enabled: isAuthenticated,
  });

  const userWalletBalance = balanceQuery.data?.available ?? 0;

  useEffect(() => {
    if (allMarketQuery.data) {
      const raw = allMarketQuery.data as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const backendData = raw as Record<string, MarketData>;
        const keys = Object.keys(backendData).filter(k => k !== 'markets');
        if (keys.length > 0) {
          const filtered: Record<string, MarketData> = {};
          keys.forEach(k => { if (backendData[k]?.lastPrice) filtered[k] = backendData[k]; });
          if (Object.keys(filtered).length > 0) {
            setLiveMarketData(prev => ({ ...prev, ...filtered }));
            console.log('[Market] Loaded backend market data:', Object.keys(filtered).length, 'items');
          }
        }
      }
    }
  }, [allMarketQuery.data]);

  useEffect(() => {
    if (globalIndexQuery.data) {
      const idx = globalIndexQuery.data as { currentValue?: number; changePercent24h?: number };
      if (idx.currentValue) setLiveIndexValue(idx.currentValue);
      if (idx.changePercent24h != null) setLiveIndexChange(idx.changePercent24h);
    }
  }, [globalIndexQuery.data]);

  const onRefresh = () => {
    setRefreshing(true);
    void Promise.all([
      allMarketQuery.refetch(),
      globalIndexQuery.refetch(),
      topMoversQuery.refetch(),
      balanceQuery.refetch(),
      propertiesQuery.refetch(),
    ]).finally(() => setRefreshing(false));
  };

  const totalVolume = useMemo(() => {
    return Object.values(liveMarketData).reduce((sum, m) => sum + m.volume24h, 0);
  }, [liveMarketData]);

  const openTradeModal = (property: Property, market: MarketData, type: 'buy' | 'sell') => {
    setSelectedTradeProperty(property);
    setSelectedTradeMarket(market);
    setTradeType(type);
    setTradingModalVisible(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const placeMutation = useMutation({
    mutationFn: async (params: { propertyId: string; type: string; shares: number; price: number; orderType?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from('orders').insert({ ...params, user_id: user?.id }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void allMarketQuery.refetch();
      void balanceQuery.refetch();
    },
  });

  const handleTradeComplete = (order: Order) => {
    console.log('[Market] Trade completed:', order);
    trackTransaction(order.type, order.shares * order.price, 'USD', { propertyId: order.propertyId, shares: order.shares });
    placeMutation.mutate({
      propertyId: order.propertyId,
      type: order.type,
      orderType: order.orderType,
      shares: order.shares,
      price: order.price,
    });
  };

  const getUserShares = (_propertyId: string): number => {
    return 0;
  };

  return (
    <View style={styles.container}>
      <ModuleErrorBoundary moduleName="Market">
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>{t('market')}</Text>
            <View style={styles.marketStatusRow}>
              <Animated.View style={[styles.liveIndicator, { transform: [{ scale: pulseAnim }] }]} />
              <Text style={styles.marketStatusText}>{t('open247')}</Text>
              <Clock size={12} color={Colors.success} />
            </View>
          </View>
          <TouchableOpacity style={styles.headerButton} onPress={() => router.push('/notifications' as any)}>
            <Activity size={22} color={Colors.text} />
          </TouchableOpacity>
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
          <View style={styles.indexBanner}>
            <View style={styles.indexBannerTop}>
              <View>
                <View style={styles.indexTickerRow}>
                  <Animated.View style={[styles.indexLiveDot, { transform: [{ scale: pulseAnim }] }]} />
                  <Text style={styles.indexTickerText}>IPX-RE</Text>
                  <Text style={styles.indexSubLabel}>{t('realEstateIndex')}</Text>
                </View>
                <Text style={styles.indexBigValue}>{formatCurrencyWithDecimals(liveIndexValue)}</Text>
              </View>
              <View style={styles.indexBannerRight}>
                <View style={[
                  styles.indexBannerBadge,
                  { backgroundColor: liveIndexChange >= 0 ? Colors.success + '20' : Colors.error + '20' }
                ]}>
                  {liveIndexChange >= 0 ? <TrendingUp size={14} color={Colors.success} /> : <TrendingDown size={14} color={Colors.error} />}
                  <Text style={[styles.indexBannerChangeText, { color: liveIndexChange >= 0 ? Colors.success : Colors.error }]}>
                    {liveIndexChange >= 0 ? '+' : ''}{liveIndexChange.toFixed(2)}%
                  </Text>
                </View>
                <Text style={styles.indexBannerAth}>ATH {formatCurrencyWithDecimals(1250)}</Text>
              </View>
            </View>
            <View style={styles.indexBannerStats}>
              <View style={styles.indexBannerStat}>
                <Text style={styles.indexBannerStatValue}>{formatCurrencyCompact(globalStats.totalMarketCap)}</Text>
                <Text style={styles.indexBannerStatLabel}>{t('totalMarketCap')}</Text>
              </View>
              <View style={styles.indexBannerStatDivider} />
              <View style={styles.indexBannerStat}>
                <Text style={styles.indexBannerStatValue}>{globalStats.countriesActive}</Text>
                <Text style={styles.indexBannerStatLabel}>{t('countries')}</Text>
              </View>
              <View style={styles.indexBannerStatDivider} />
              <View style={styles.indexBannerStat}>
                <Text style={styles.indexBannerStatValue}>{globalStats.totalProperties}</Text>
                <Text style={styles.indexBannerStatLabel}>{t('properties')}</Text>
              </View>
              <View style={styles.indexBannerStatDivider} />
              <View style={styles.indexBannerStat}>
                <Text style={styles.indexBannerStatValue}>{(globalStats.totalInvestors / 1000).toFixed(1)}K</Text>
                <Text style={styles.indexBannerStatLabel}>{t('investors')}</Text>
              </View>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={[styles.statCard, { padding: responsiveStyles.statPadding }]}>
              <BarChart3 size={isCompact ? 16 : 20} color={Colors.primary} />
              <Text style={[styles.statValue, { fontSize: responsiveStyles.statValue }]}>
                {formatCurrencyCompact(totalVolume)}
              </Text>
              <Text style={[styles.statLabel, { fontSize: responsiveStyles.statLabel }]}>{t('volume24h')}</Text>
            </View>
            <View style={[styles.statCard, { padding: responsiveStyles.statPadding }]}>
              <TrendingUp size={isCompact ? 16 : 20} color={Colors.success} />
              <Text style={[styles.statValue, { fontSize: responsiveStyles.statValue }]}>{gainers.length}</Text>
              <Text style={[styles.statLabel, { fontSize: responsiveStyles.statLabel }]}>{t('gainers')}</Text>
            </View>
            <View style={[styles.statCard, { padding: responsiveStyles.statPadding }]}>
              <TrendingDown size={isCompact ? 16 : 20} color={Colors.error} />
              <Text style={[styles.statValue, { fontSize: responsiveStyles.statValue }]}>{losers.length}</Text>
              <Text style={[styles.statLabel, { fontSize: responsiveStyles.statLabel }]}>{t('losers')}</Text>
            </View>
          </View>

          {selectedProperty && (
            <View style={styles.chartSection}>
              <View style={styles.chartHeader}>
                <Text style={styles.chartTitle}>{selectedProperty.name}</Text>
                <TouchableOpacity onPress={() => setSelectedPropertyId(null)}>
                  <Text style={styles.closeChart}>{t('closeLabel')}</Text>
                </TouchableOpacity>
              </View>
              <PriceChart
                data={selectedProperty.priceHistory}
                timeRange={timeRange}
                onTimeRangeChange={setTimeRange}
              />
            </View>
          )}

          <View style={styles.tabsContainer}>
            {(['all', 'gainers', 'losers'] as MarketTab[]).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, { fontSize: responsiveStyles.tabText }, activeTab === tab && styles.tabTextActive]}>
                  {tab === 'all' ? t('allProperties') : tab === 'gainers' ? t('gainers') : t('losers')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.tableHeader, { paddingHorizontal: isXs ? 12 : 20 }]}>
            <Text style={[styles.tableHeaderText, { flex: isCompact ? 1.5 : 2, fontSize: isXs ? 10 : 12 }]}>{t('properties')}</Text>
            <Text style={[styles.tableHeaderText, styles.cellRight, { minWidth: responsiveStyles.cellMinWidth, fontSize: isXs ? 10 : 12 }]}>{t('price')}</Text>
            <Text style={[styles.tableHeaderText, styles.cellRight, { minWidth: responsiveStyles.cellMinWidth, fontSize: isXs ? 10 : 12 }]}>{t('change24h')}</Text>
            {!isCompact && <Text style={[styles.tableHeaderText, styles.cellRight, { minWidth: responsiveStyles.volumeCellWidth, fontSize: isXs ? 10 : 12 }]}>{t('volume')}</Text>}
          </View>

          {marketList.map(({ property, market }) => {
            if (!market) return null;
            const isPositive = market.changePercent24h >= 0;
            return (
              <View key={property.id} style={[styles.marketRowContainer, { paddingHorizontal: isXs ? 12 : 20 }]}>
                <TouchableOpacity
                  style={[styles.marketRow, { paddingVertical: responsiveStyles.rowPadding }]}
                  onPress={() => setSelectedPropertyId(property.id)}
                  onLongPress={() => router.push(`/property/${property.id}` as any)}
                >
                  <View style={[styles.propertyCell, { flex: isCompact ? 1.5 : 2 }]}>
                    <MarketPropertyThumb
                      uri={property.images?.[0]}
                      name={property.name}
                      size={responsiveStyles.propertyImage}
                      borderRadius={isXs ? 4 : isCompact ? 6 : 8}
                      marginRight={isXs ? 6 : isCompact ? 8 : 10}
                    />
                    <View style={styles.propertyInfo}>
                      <Text style={[styles.propertyName, { fontSize: responsiveStyles.propertyName }]} numberOfLines={1}>
                        {property.name}
                      </Text>
                      <Text style={[styles.propertyCity, { fontSize: responsiveStyles.propertyCity }]}>
                        {property.city}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.priceCell, { minWidth: responsiveStyles.cellMinWidth }]}>
                    <Text style={[styles.priceText, { fontSize: responsiveStyles.priceText }]}>
                      {formatCurrencyWithDecimals(market.lastPrice)}
                    </Text>
                  </View>
                  <View style={[styles.changeCell, { minWidth: responsiveStyles.cellMinWidth }]}>
                    <View style={[
                      styles.changeBadge, 
                      { 
                        backgroundColor: isPositive ? Colors.success + '20' : Colors.error + '20',
                        paddingHorizontal: isXs ? 4 : isCompact ? 5 : 8,
                        paddingVertical: isXs ? 2 : isCompact ? 3 : 4,
                      }
                    ]}>
                      <Text style={[styles.changeText, { fontSize: responsiveStyles.changeText, color: isPositive ? Colors.success : Colors.error }]}>
                        {isPositive ? '+' : ''}{market.changePercent24h.toFixed(isNarrow ? 1 : 2)}%
                      </Text>
                    </View>
                  </View>
                  {!isCompact && (
                    <View style={[styles.volumeCell, { minWidth: responsiveStyles.volumeCellWidth }]}>
                      <Text style={[styles.volumeText, { fontSize: responsiveStyles.volumeText }]}>
                        {formatCurrencyCompact(market.volume24h)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                <View style={styles.tradeButtonsRow}>
                  <TouchableOpacity
                    style={styles.buyButton}
                    onPress={() => openTradeModal(property, market!, 'buy')}
                  >
                    <Zap size={12} color={Colors.white} />
                    <Text style={styles.buyButtonText}>{t('buy')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.sellButton}
                    onPress={() => openTradeModal(property, market!, 'sell')}
                  >
                    <Text style={styles.sellButtonText}>{t('sell')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {!selectedPropertyId && marketList.length > 0 && (() => {
            const first = marketList[0];
            const market = first?.market;
            const bids = Array.isArray(market?.bids) ? market.bids.slice(0, 5) : [];
            const asks = Array.isArray(market?.asks) ? market.asks.slice(0, 5) : [];
            return (
            <View style={styles.orderBookSection}>
              <Text style={styles.sectionTitle}>{t('orderBook')} - {first?.property?.name ?? t('market')}</Text>
              <View style={styles.orderBookContainer}>
                <View style={styles.orderBookSide}>
                  <Text style={styles.orderBookHeader}>{t('bids')}</Text>
                  {bids.map((bid, index) => (
                    <View key={`bid-${index}`} style={styles.orderBookRow}>
                      <Text style={[styles.orderBookPrice, { color: Colors.success }]}>
                        {formatCurrencyWithDecimals(bid?.price ?? 0)}
                      </Text>
                      <Text style={styles.orderBookShares}>{bid?.shares ?? 0}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.orderBookDivider} />
                <View style={styles.orderBookSide}>
                  <Text style={styles.orderBookHeader}>{t('asks')}</Text>
                  {asks.map((ask, index) => (
                    <View key={`ask-${index}`} style={styles.orderBookRow}>
                      <Text style={[styles.orderBookPrice, { color: Colors.error }]}>
                        {formatCurrencyWithDecimals(ask?.price ?? 0)}
                      </Text>
                      <Text style={styles.orderBookShares}>{ask?.shares ?? 0}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
            );
          })()}

          <ResaleMarketplaceSection router={router} />

          <GlobalMarketsSection router={router} />

          <View style={styles.bottomPadding} />
        </ScrollView>
      </SafeAreaView>

      <TradingModal
        visible={tradingModalVisible}
        onClose={() => setTradingModalVisible(false)}
        property={selectedTradeProperty}
        marketData={selectedTradeMarket}
        initialType={tradeType}
        userBalance={userWalletBalance}
        userShares={selectedTradeProperty ? getUserShares(selectedTradeProperty.id) : 0}
        onTradeComplete={handleTradeComplete}
      />
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: {
    fontWeight: '800' as const,
    color: Colors.text,
  },
  marketStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  marketStatusText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  headerButton: {
    padding: 8,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  statValue: {
    fontWeight: '800' as const,
    color: Colors.text,
  },
  statLabel: {
    color: Colors.textTertiary,
    fontWeight: '500' as const,
    textAlign: 'center' as const,
  },
  chartSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  chartTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    flex: 1,
  },
  closeChart: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
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
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    marginBottom: 4,
  },
  tableHeaderText: {
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    textTransform: 'uppercase',
  },
  marketRowContainer: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  marketRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tradeButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 10,
    paddingTop: 4,
  },
  buyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  buyButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  sellButton: {
    backgroundColor: Colors.error + '20',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  sellButtonText: {
    color: Colors.error,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  cellRight: {
    textAlign: 'right',
  },
  propertyCell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  propertyImage: {
    backgroundColor: Colors.surfaceLight,
  },
  propertyInfo: {
    flex: 1,
  },
  propertyName: {
    color: Colors.text,
    fontWeight: '700' as const,
  },
  propertyCity: {
    color: Colors.textTertiary,
    marginTop: 2,
  },
  priceCell: {
    alignItems: 'flex-end',
  },
  priceText: {
    color: Colors.text,
    fontWeight: '700' as const,
  },
  changeCell: {
    alignItems: 'flex-end',
  },
  changeBadge: {
    borderRadius: 8,
  },
  changeText: {
    fontWeight: '700' as const,
  },
  volumeCell: {
    alignItems: 'flex-end',
  },
  volumeText: {
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  orderBookSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 12,
  },
  orderBookContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  orderBookSide: {
    flex: 1,
  },
  orderBookDivider: {
    width: 1,
    backgroundColor: Colors.surfaceBorder,
    marginHorizontal: 12,
  },
  orderBookHeader: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  orderBookRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  orderBookPrice: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  orderBookShares: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  bottomPadding: {
    height: 120,
  },
  indexBanner: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  indexBannerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  indexTickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  indexLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  indexTickerText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  indexSubLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    flexShrink: 1,
  },
  indexBigValue: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '800' as const,
  },
  indexBannerRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  indexBannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  indexBannerChangeText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  indexBannerAth: {
    color: Colors.textTertiary,
    fontSize: 11,
  },
  indexBannerStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 14,
    gap: 8,
  },
  indexBannerStat: {
    flex: 1,
    minWidth: 70,
    alignItems: 'center',
  },
  indexBannerStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.surfaceBorder,
  },
  indexBannerStatValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  indexBannerStatLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center' as const,
  },
  scrollView: {
    backgroundColor: Colors.background,
  },
  propertyImagePlaceholder: {
    backgroundColor: Colors.backgroundTertiary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  propertyImagePlaceholderText: {
    color: Colors.textTertiary,
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
