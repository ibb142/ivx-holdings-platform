import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  MapPin,
  Building2,
  Users,
  FileCheck2,
  TrendingUp,
  Banknote,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Target,
  ChevronRight,
  Globe,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { ownerApi, type PilotMarket } from '@/lib/ivx-owner-api';
import { formatCurrency } from '@/lib/formatters';
import { EmptyState } from '@/components/ProgressiveStates';

const fontWeightBold = 'bold' as const;
const fontWeightSemiBold = '600' as const;
const fontWeightMedium = '500' as const;

function marketStatusColor(status: string): string {
  if (status === 'active' || status === 'launched') return Colors.success;
  if (status === 'planning' || status === 'preparing') return Colors.warning;
  if (status === 'paused' || status === 'closed') return Colors.error;
  return Colors.textSecondary;
}

export default function PilotMarketsScreen() {
  const router = useRouter();

  const { data: marketsData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['pilot-markets'],
    queryFn: () => ownerApi.getPilotMarkets(),
  });

  const markets: PilotMarket[] = marketsData?.markets ?? [];

  const aggregate = useMemo(() => {
    return markets.reduce((acc, m) => {
      acc.totalProperties += m.active_properties || 0;
      acc.verifiedProperties += m.verified_properties || 0;
      acc.totalBrokers += m.active_brokers || 0;
      acc.totalOffers += m.total_offers || 0;
      acc.closedTransactions += m.closed_transactions || 0;
      acc.totalVolume += m.total_volume || 0;
      acc.totalRevenue += m.total_revenue || 0;
      acc.fraudIncidents += m.fraud_incidents || 0;
      return acc;
    }, {
      totalProperties: 0,
      verifiedProperties: 0,
      totalBrokers: 0,
      totalOffers: 0,
      closedTransactions: 0,
      totalVolume: 0,
      totalRevenue: 0,
      fraudIncidents: 0,
    });
  }, [markets]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading pilot markets…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor={Colors.gold}
            colors={[Colors.gold]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Pilot Markets</Text>
          <Text style={styles.headerSubtitle}>
            Real estate transaction markets
          </Text>
        </View>

        {/* Aggregate Metrics */}
        <View style={styles.aggregateCard}>
          <View style={styles.aggregateRow}>
            <MetricTile
              icon={<Building2 size={16} color={Colors.gold} />}
              label="Properties"
              value={String(aggregate.totalProperties)}
            />
            <MetricTile
              icon={<FileCheck2 size={16} color={Colors.success} />}
              label="Verified"
              value={String(aggregate.verifiedProperties)}
            />
            <MetricTile
              icon={<Users size={16} color={Colors.info} />}
              label="Brokers"
              value={String(aggregate.totalBrokers)}
            />
          </View>
          <View style={styles.aggregateDivider} />
          <View style={styles.aggregateRow}>
            <MetricTile
              icon={<TrendingUp size={16} color={Colors.gold} />}
              label="Offers"
              value={String(aggregate.totalOffers)}
            />
            <MetricTile
              icon={<FileCheck2 size={16} color={Colors.success} />}
              label="Closings"
              value={String(aggregate.closedTransactions)}
            />
            <MetricTile
              icon={<AlertTriangle size={16} color={aggregate.fraudIncidents > 0 ? Colors.error : Colors.textSecondary} />}
              label="Fraud"
              value={String(aggregate.fraudIncidents)}
            />
          </View>
          <View style={styles.aggregateDivider} />
          <View style={styles.aggregateRow}>
            <View style={styles.aggregateBigMetric}>
              <View style={styles.aggregateBigMetricLeft}>
                <Banknote size={16} color={Colors.gold} />
                <Text style={styles.aggregateBigLabel}>Total Volume</Text>
              </View>
              <Text style={styles.aggregateBigValue}>{formatCurrency(aggregate.totalVolume)}</Text>
            </View>
            <View style={styles.aggregateBigMetric}>
              <View style={styles.aggregateBigMetricLeft}>
                <Banknote size={16} color={Colors.success} />
                <Text style={styles.aggregateBigLabel}>Revenue</Text>
              </View>
              <Text style={[styles.aggregateBigValue, { color: Colors.success }]}>
                {formatCurrency(aggregate.totalRevenue)}
              </Text>
            </View>
          </View>
        </View>

        {/* Markets List */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Markets</Text>
          <Globe size={16} color={Colors.gold} />
        </View>

        {markets.length === 0 ? (
          <EmptyState
            title="No pilot markets yet"
            message="Pilot markets will appear here once configured. Start with one city or region to launch your first real estate market."
          />
        ) : (
          <View style={styles.marketsList}>
            {markets.map((market: PilotMarket) => (
              <React.Fragment key={market.id}>
                <MarketCard market={market} />
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/owner-portfolio')}
          >
            <Building2 size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Portfolio</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/compliance-center')}
          >
            <ShieldCheck size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Compliance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/marketplace')}
          >
            <ChevronRight size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Marketplace</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Sub-components ----

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricTile}>
      {icon}
      <Text style={styles.metricTileValue}>{value}</Text>
      <Text style={styles.metricTileLabel}>{label}</Text>
    </View>
  );
}

function MarketCard({ market }: { market: PilotMarket }) {
  const statusColor = marketStatusColor(market.status);
  const progress = market.target_properties > 0
    ? (market.active_properties / market.target_properties) * 100
    : 0;
  const avgClose = market.avg_days_to_close;

  return (
    <View style={styles.marketCard}>
      {/* Header */}
      <View style={styles.marketHeader}>
        <View style={styles.marketHeaderLeft}>
          <View style={[styles.marketIcon, { backgroundColor: `${statusColor}15` }]}>
            <MapPin size={18} color={statusColor} />
          </View>
          <View>
            <Text style={styles.marketName}>{market.market_name}</Text>
            <Text style={styles.marketLocation}>
              {market.city}, {market.country_iso}
            </Text>
          </View>
        </View>
        <View style={[styles.marketStatusPill, { backgroundColor: `${statusColor}15` }]}>
          <Text style={[styles.marketStatusText, { color: statusColor }]}>
            {market.status}
          </Text>
        </View>
      </View>

      {/* Target Progress */}
      <View style={styles.targetSection}>
        <View style={styles.targetHeader}>
          <Target size={12} color={Colors.textSecondary} />
          <Text style={styles.targetLabel}>
            {market.active_properties} / {market.target_properties} properties
          </Text>
          <Text style={styles.targetPct}>{Math.round(progress)}%</Text>
        </View>
        <View style={styles.targetBar}>
          <View style={[styles.targetBarFill, { width: `${Math.min(progress, 100)}%` }]} />
        </View>
      </View>

      {/* Metrics Grid */}
      <View style={styles.marketMetrics}>
        <View style={styles.marketMetric}>
          <Building2 size={12} color={Colors.textSecondary} />
          <Text style={styles.marketMetricLabel}>Verified</Text>
          <Text style={styles.marketMetricValue}>{market.verified_properties}</Text>
        </View>
        <View style={styles.marketMetric}>
          <Users size={12} color={Colors.textSecondary} />
          <Text style={styles.marketMetricLabel}>Brokers</Text>
          <Text style={styles.marketMetricValue}>{market.active_brokers}</Text>
        </View>
        <View style={styles.marketMetric}>
          <TrendingUp size={12} color={Colors.textSecondary} />
          <Text style={styles.marketMetricLabel}>Offers</Text>
          <Text style={styles.marketMetricValue}>{market.total_offers}</Text>
        </View>
        <View style={styles.marketMetric}>
          <FileCheck2 size={12} color={Colors.textSecondary} />
          <Text style={styles.marketMetricLabel}>Closings</Text>
          <Text style={styles.marketMetricValue}>{market.closed_transactions}</Text>
        </View>
      </View>

      {/* Volume & Revenue */}
      <View style={styles.marketFooter}>
        <View style={styles.marketFooterItem}>
          <Banknote size={12} color={Colors.gold} />
          <Text style={styles.marketFooterLabel}>Volume</Text>
          <Text style={styles.marketFooterValue}>{formatCurrency(market.total_volume)}</Text>
        </View>
        <View style={styles.marketFooterItem}>
          <TrendingUp size={12} color={Colors.success} />
          <Text style={styles.marketFooterLabel}>Revenue</Text>
          <Text style={[styles.marketFooterValue, { color: Colors.success }]}>
            {formatCurrency(market.total_revenue)}
          </Text>
        </View>
        {avgClose != null && avgClose > 0 && (
          <View style={styles.marketFooterItem}>
            <Clock size={12} color={Colors.textSecondary} />
            <Text style={styles.marketFooterLabel}>Avg Close</Text>
            <Text style={styles.marketFooterValue}>{avgClose}d</Text>
          </View>
        )}
      </View>

      {/* Fraud Alert */}
      {market.fraud_incidents > 0 && (
        <View style={styles.fraudAlert}>
          <AlertTriangle size={12} color={Colors.error} />
          <Text style={styles.fraudAlertText}>
            {market.fraud_incidents} fraud incident{market.fraud_incidents > 1 ? 's' : ''} detected
          </Text>
        </View>
      )}
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: fontWeightBold,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  aggregateCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  aggregateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  metricTileValue: {
    fontSize: 18,
    fontWeight: fontWeightBold,
    color: Colors.text,
  },
  metricTileLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  aggregateDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 14,
  },
  aggregateBigMetric: {
    flex: 1,
    alignItems: 'center',
  },
  aggregateBigMetricLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  aggregateBigLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  aggregateBigValue: {
    fontSize: 16,
    fontWeight: fontWeightBold,
    color: Colors.gold,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: fontWeightBold,
    color: Colors.text,
  },
  marketsList: {
    gap: 12,
  },
  marketCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  marketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  marketHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  marketIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  marketName: {
    fontSize: 15,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
  },
  marketLocation: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  marketStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  marketStatusText: {
    fontSize: 11,
    fontWeight: fontWeightSemiBold,
    textTransform: 'capitalize',
  },
  targetSection: {
    marginBottom: 14,
  },
  targetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  targetLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  targetPct: {
    fontSize: 12,
    fontWeight: fontWeightBold,
    color: Colors.gold,
  },
  targetBar: {
    height: 5,
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 3,
    overflow: 'hidden',
  },
  targetBarFill: {
    height: '100%',
    backgroundColor: Colors.gold,
    borderRadius: 3,
  },
  marketMetrics: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    marginBottom: 12,
  },
  marketMetric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  marketMetricLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  marketMetricValue: {
    fontSize: 12,
    fontWeight: fontWeightBold,
    color: Colors.text,
    marginLeft: 'auto',
  },
  marketFooter: {
    flexDirection: 'row',
    gap: 12,
  },
  marketFooterItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  marketFooterLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  marketFooterValue: {
    fontSize: 12,
    fontWeight: fontWeightBold,
    color: Colors.text,
    marginLeft: 'auto',
  },
  fraudAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: `${Colors.error}10`,
    borderRadius: 8,
  },
  fraudAlertText: {
    fontSize: 11,
    color: Colors.error,
    fontWeight: fontWeightMedium,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  quickActionBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: fontWeightMedium,
    color: Colors.textSecondary,
  },
});
