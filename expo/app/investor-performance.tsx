/**
 * IVX Investor Performance Center
 *
 * Displays real investor performance data: invested capital, active deals,
 * distributions, unrealized value, realized return, ROI, and last activity.
 * Pulls from the backend /api/ivx/investor-performance endpoint.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Filter,
  Calendar,
  Percent,
  Wallet,
  Target,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PerformanceMetric = {
  label: string;
  value: number;
  formatted: string;
  trend: 'up' | 'down' | 'flat';
  trendPercent: number | null;
  icon: 'wallet' | 'building' | 'target' | 'percent' | 'dollar' | 'calendar';
};

type ActiveDeal = {
  id: string;
  title: string;
  investedAmount: number;
  currentValue: number;
  unrealizedGain: number;
  unrealizedPercent: number;
  status: string;
  lastActivityDate: string;
};

type Distribution = {
  id: string;
  dealTitle: string;
  amount: number;
  date: string;
  type: 'dividend' | 'interest' | 'profit' | 'refund';
};

type InvestorPerformanceData = {
  investedCapital: number;
  activeDealsCount: number;
  totalDistributions: number;
  unrealizedValue: number;
  realizedReturn: number;
  totalROI: number;
  lastActivityDate: string;
  activeDeals: ActiveDeal[];
  distributions: Distribution[];
};

type FilterType = 'all' | 'active' | 'completed' | 'distributions';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InvestorPerformanceScreen() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [data, setData] = useState<InvestorPerformanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('https://api.ivxholding.com/api/ivx/investor-performance', {
        headers: {
          'Content-Type': 'application/json',
          ...(user?.id ? { 'x-user-id': user.id } : {}),
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.id]);

  React.useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void fetchData();
  }, [fetchData]);

  // Filter deals based on search + filter
  const filteredDeals = useMemo(() => {
    if (!data?.activeDeals) return [];
    return data.activeDeals.filter((deal) => {
      const matchesSearch = !searchQuery || deal.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter =
        activeFilter === 'all' ||
        (activeFilter === 'active' && deal.status === 'active') ||
        (activeFilter === 'completed' && deal.status === 'completed');
      return matchesSearch && matchesFilter;
    });
  }, [data, searchQuery, activeFilter]);

  const filteredDistributions = useMemo(() => {
    if (!data?.distributions) return [];
    if (activeFilter !== 'all' && activeFilter !== 'distributions') return [];
    if (!searchQuery) return data.distributions;
    return data.distributions.filter((d) => d.dealTitle.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [data, searchQuery, activeFilter]);

  // Build metric cards
  const metrics: PerformanceMetric[] = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: 'Invested Capital',
        value: data.investedCapital,
        formatted: formatCurrency(data.investedCapital),
        trend: 'flat',
        trendPercent: null,
        icon: 'wallet',
      },
      {
        label: 'Active Deals',
        value: data.activeDealsCount,
        formatted: String(data.activeDealsCount),
        trend: 'flat',
        trendPercent: null,
        icon: 'building',
      },
      {
        label: 'Total Distributions',
        value: data.totalDistributions,
        formatted: formatCurrency(data.totalDistributions),
        trend: 'up',
        trendPercent: null,
        icon: 'dollar',
      },
      {
        label: 'Unrealized Value',
        value: data.unrealizedValue,
        formatted: formatCurrency(data.unrealizedValue),
        trend: data.unrealizedValue >= 0 ? 'up' : 'down',
        trendPercent: null,
        icon: 'target',
      },
      {
        label: 'Realized Return',
        value: data.realizedReturn,
        formatted: formatCurrency(data.realizedReturn),
        trend: data.realizedReturn >= 0 ? 'up' : 'down',
        trendPercent: null,
        icon: 'trending',
      },
      {
        label: 'Total ROI',
        value: data.totalROI,
        formatted: `${data.totalROI.toFixed(2)}%`,
        trend: data.totalROI >= 0 ? 'up' : 'down',
        trendPercent: null,
        icon: 'percent',
      },
    ];
  }, [data]);

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading performance data…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Unable to load</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchData}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Empty state
  if (data && data.investedCapital === 0 && data.activeDealsCount === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Investor Performance</Text>
            <Text style={styles.headerSubtitle}>Track your portfolio in real time</Text>
          </View>
          <View style={styles.emptyState}>
            <Wallet size={48} color={Colors.muted} />
            <Text style={styles.emptyTitle}>No investments yet</Text>
            <Text style={styles.emptySubtitle}>
              Your performance metrics will appear here once you start investing.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => router.push('/(tabs)/invest' as any)}
            >
              <Text style={styles.emptyCtaText}>Browse Deals</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Partial error state (data loaded but refresh failed)
  const showPartialError = error && data;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Investor Performance</Text>
          <Text style={styles.headerSubtitle}>Track your portfolio in real time</Text>
        </View>

        {showPartialError && (
          <View style={styles.partialErrorBanner}>
            <Text style={styles.partialErrorText}>Some data may be stale: {error}</Text>
          </View>
        )}

        {/* Metric Cards Grid */}
        <View style={styles.metricsGrid}>
          {metrics.map((metric, index) => (
            <View key={index} style={styles.metricCard}>
              <View style={styles.metricIconRow}>
                {renderMetricIcon(metric.icon)}
                {metric.trend === 'up' && <ArrowUpRight size={14} color={Colors.success} />}
                {metric.trend === 'down' && <ArrowDownRight size={14} color={Colors.error} />}
              </View>
              <Text style={styles.metricValue}>{metric.formatted}</Text>
              <Text style={styles.metricLabel}>{metric.label}</Text>
            </View>
          ))}
        </View>

        {/* Last Activity */}
        {data?.lastActivityDate && (
          <View style={styles.lastActivityRow}>
            <Calendar size={14} color={Colors.muted} />
            <Text style={styles.lastActivityText}>
              Last activity: {formatDate(data.lastActivityDate)}
            </Text>
          </View>
        )}

        {/* Search + Filters */}
        <View style={styles.controlsContainer}>
          <View style={styles.searchContainer}>
            <Search size={16} color={Colors.muted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search deals…"
              placeholderTextColor={Colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {(['all', 'active', 'completed', 'distributions'] as FilterType[]).map((filter) => (
              <TouchableOpacity
                key={filter}
                style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}
                onPress={() => setActiveFilter(filter)}
              >
                <Text style={[styles.filterChipText, activeFilter === filter && styles.filterChipTextActive]}>
                  {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Active Deals */}
        {(activeFilter === 'all' || activeFilter === 'active' || activeFilter === 'completed') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active Deals</Text>
            {filteredDeals.length === 0 ? (
              <Text style={styles.emptySectionText}>No deals match your filters.</Text>
            ) : (
              filteredDeals.map((deal) => (
                <View key={deal.id} style={styles.dealCard}>
                  <View style={styles.dealCardHeader}>
                    <Text style={styles.dealTitle}>{deal.title}</Text>
                    <View style={[styles.statusBadge, deal.status === 'active' ? styles.statusActive : styles.statusCompleted]}>
                      <Text style={styles.statusText}>{deal.status}</Text>
                    </View>
                  </View>
                  <View style={styles.dealMetricsRow}>
                    <View style={styles.dealMetric}>
                      <Text style={styles.dealMetricLabel}>Invested</Text>
                      <Text style={styles.dealMetricValue}>{formatCurrency(deal.investedAmount)}</Text>
                    </View>
                    <View style={styles.dealMetric}>
                      <Text style={styles.dealMetricLabel}>Current Value</Text>
                      <Text style={styles.dealMetricValue}>{formatCurrency(deal.currentValue)}</Text>
                    </View>
                    <View style={styles.dealMetric}>
                      <Text style={styles.dealMetricLabel}>Unrealized</Text>
                      <Text style={[styles.dealMetricValue, deal.unrealizedGain >= 0 ? styles.valuePositive : styles.valueNegative]}>
                        {deal.unrealizedGain >= 0 ? '+' : ''}{formatCurrency(deal.unrealizedGain)}
                      </Text>
                      <Text style={[styles.dealMetricSub, deal.unrealizedPercent >= 0 ? styles.valuePositive : styles.valueNegative]}>
                        {deal.unrealizedPercent >= 0 ? '+' : ''}{deal.unrealizedPercent.toFixed(1)}%
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Distributions */}
        {(activeFilter === 'all' || activeFilter === 'distributions') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Distributions</Text>
            {filteredDistributions.length === 0 ? (
              <Text style={styles.emptySectionText}>No distributions yet.</Text>
            ) : (
              filteredDistributions.map((dist) => (
                <View key={dist.id} style={styles.distributionRow}>
                  <View style={styles.distributionInfo}>
                    <Text style={styles.distributionTitle}>{dist.dealTitle}</Text>
                    <Text style={styles.distributionDate}>{formatDate(dist.date)}</Text>
                    <View style={styles.distributionTypeBadge}>
                      <Text style={styles.distributionTypeText}>{dist.type}</Text>
                    </View>
                  </View>
                  <Text style={styles.distributionAmount}>{formatCurrency(dist.amount)}</Text>
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function renderMetricIcon(icon: PerformanceMetric['icon']) {
  const color = Colors.primary;
  const size = 18;
  switch (icon) {
    case 'wallet': return <Wallet size={size} color={color} />;
    case 'building': return <Building2 size={size} color={color} />;
    case 'target': return <Target size={size} color={color} />;
    case 'percent': return <Percent size={size} color={color} />;
    case 'dollar': return <DollarSign size={size} color={color} />;
    default: return <TrendingUp size={size} color={color} />;
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: Colors.muted,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
  },
  errorMessage: {
    color: Colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.primary,
    borderRadius: 12,
  },
  retryButtonText: {
    color: Colors.primaryBlack,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '700' as const,
  },
  headerSubtitle: {
    color: Colors.muted,
    fontSize: 14,
    marginTop: 4,
  },
  partialErrorBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  partialErrorText: {
    color: Colors.warning,
    fontSize: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
  },
  metricCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  metricIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  metricValue: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '700' as const,
  },
  metricLabel: {
    color: Colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  lastActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  lastActivityText: {
    color: Colors.muted,
    fontSize: 12,
  },
  controlsContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    paddingVertical: 10,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    color: Colors.muted,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  filterChipTextActive: {
    color: Colors.primaryBlack,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
    marginBottom: 12,
  },
  emptySectionText: {
    color: Colors.muted,
    fontSize: 13,
    fontStyle: 'italic' as const,
  },
  dealCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  dealCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dealTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600' as const,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: 'rgba(0, 196, 140, 0.15)',
  },
  statusCompleted: {
    backgroundColor: 'rgba(74, 144, 217, 0.15)',
  },
  statusText: {
    color: Colors.success,
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
  },
  dealMetricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dealMetric: {
    flex: 1,
  },
  dealMetricLabel: {
    color: Colors.muted,
    fontSize: 10,
    marginBottom: 2,
  },
  dealMetricValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  dealMetricSub: {
    fontSize: 10,
    marginTop: 1,
  },
  valuePositive: {
    color: Colors.success,
  },
  valueNegative: {
    color: Colors.error,
  },
  distributionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  distributionInfo: {
    flex: 1,
  },
  distributionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  distributionDate: {
    color: Colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  distributionTypeBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(230, 194, 0, 0.1)',
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  distributionTypeText: {
    color: Colors.primary,
    fontSize: 9,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
  },
  distributionAmount: {
    color: Colors.success,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
  },
  emptySubtitle: {
    color: Colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  emptyCta: {
    marginTop: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: Colors.primary,
    borderRadius: 14,
  },
  emptyCtaText: {
    color: Colors.primaryBlack,
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
