import React, { useMemo } from 'react';
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
import { useRouter } from 'expo-router';
import {
  Building2,
  TrendingUp,
  Wallet,
  Percent,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  ShieldAlert,
  CircleDollarSign,
  FileText,
  ChevronRight,
  Plus,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { ownerApi, type OwnerHolding, type IncomeExpenseEntry } from '@/lib/ivx-owner-api';
import { formatCurrency, formatCurrencyWithDecimals } from '@/lib/formatters';
import { EmptyState } from '@/components/ProgressiveStates';

const fontWeightBold = 'bold' as const;
const fontWeightSemiBold = '600' as const;
const fontWeightMedium = '500' as const;

export default function OwnerPortfolioScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const { data: portfolioData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['owner-portfolio'],
    queryFn: () => ownerApi.getPortfolio(),
    refetchOnWindowFocus: false,
  });

  const summary = portfolioData?.portfolio?.summary;
  const owner = portfolioData?.portfolio?.owner;
  const holdings = portfolioData?.portfolio?.holdings ?? [];
  const recentTransactions = portfolioData?.portfolio?.recent_transactions ?? [];

  const totalValue = summary?.total_holdings_value ?? 0;
  const totalEquity = summary?.total_equity ?? 0;
  const totalCashFlow = summary?.total_annual_net_cash_flow ?? 0;
  const capRate = summary?.blended_cap_rate ?? 0;
  const cashOnCash = summary?.cash_on_cash_return ?? 0;

  const isVerified = owner?.is_verified ?? false;
  const kycStatus = owner?.kyc_status ?? 'not_started';

  const kycBadgeColor = useMemo(() => {
    switch (kycStatus) {
      case 'verified': return Colors.success;
      case 'pending': return Colors.warning;
      case 'rejected': return Colors.error;
      default: return Colors.textSecondary;
    }
  }, [kycStatus]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading portfolio…</Text>
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
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.headerTitle}>Portfolio</Text>
              <Text style={styles.headerSubtitle}>
                {owner?.display_name ?? 'Owner'}
              </Text>
            </View>
            <View style={[styles.verificationBadge, { borderColor: kycBadgeColor }]}>
              {isVerified ? (
                <ShieldCheck size={14} color={kycBadgeColor} />
              ) : (
                <ShieldAlert size={14} color={kycBadgeColor} />
              )}
              <Text style={[styles.verificationText, { color: kycBadgeColor }]}>
                {isVerified ? 'Verified' : kycStatus}
              </Text>
            </View>
          </View>
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryGrid}>
          <SummaryCard
            icon={<Building2 size={18} color={Colors.gold} />}
            label="Holdings Value"
            value={formatCurrency(totalValue)}
            accent={Colors.gold}
          />
          <SummaryCard
            icon={<Wallet size={18} color={Colors.success} />}
            label="Total Equity"
            value={formatCurrency(totalEquity)}
            accent={Colors.success}
          />
          <SummaryCard
            icon={totalCashFlow >= 0 ? <TrendingUp size={18} color={Colors.success} /> : <TrendingUp size={18} color={Colors.error} />}
            label="Annual Cash Flow"
            value={formatCurrency(totalCashFlow)}
            accent={totalCashFlow >= 0 ? Colors.success : Colors.error}
          />
          <SummaryCard
            icon={<Percent size={18} color={Colors.info} />}
            label="Blended Cap Rate"
            value={`${capRate.toFixed(2)}%`}
            accent={Colors.info}
          />
        </View>

        {/* Cash on Cash Return Bar */}
        <View style={styles.returnBar}>
          <View style={styles.returnBarLeft}>
            <CircleDollarSign size={16} color={Colors.gold} />
            <Text style={styles.returnBarLabel}>Cash-on-Cash Return</Text>
          </View>
          <Text style={styles.returnBarValue}>{cashOnCash.toFixed(2)}%</Text>
        </View>

        {/* Holdings Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Properties</Text>
          <TouchableOpacity
            onPress={() => router.push('/owner-holdings')}
            style={styles.sectionLink}
          >
            <Text style={styles.sectionLinkText}>Manage</Text>
            <ChevronRight size={14} color={Colors.gold} />
          </TouchableOpacity>
        </View>

        {holdings.length === 0 ? (
          <EmptyState
            title="No properties yet"
            message="Add your first property holding to start building your portfolio."
          />
        ) : (
          <View style={styles.holdingsList}>
            {holdings.slice(0, 5).map((h: OwnerHolding) => (
              <React.Fragment key={h.id}>
                <HoldingCard holding={h} />
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Recent Transactions */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <TouchableOpacity
            onPress={() => router.push('/owner-holdings')}
            style={styles.sectionLink}
          >
            <Text style={styles.sectionLinkText}>All</Text>
            <ChevronRight size={14} color={Colors.gold} />
          </TouchableOpacity>
        </View>

        {recentTransactions.length === 0 ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyInlineText}>No recent transactions</Text>
          </View>
        ) : (
          <View style={styles.transactionsList}>
            {recentTransactions.slice(0, 8).map((tx: IncomeExpenseEntry) => (
              <React.Fragment key={tx.id}>
                <TransactionRow entry={tx} />
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/compliance-center')}
          >
            <ShieldCheck size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Compliance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/payments-center')}
          >
            <FileText size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Payments</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/marketplace')}
          >
            <Plus size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Marketplace</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Sub-components ----

function SummaryCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: `${accent}15` }]}>
        {icon}
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function HoldingCard({ holding }: { holding: OwnerHolding }) {
  const equity = holding.equity ?? 0;
  const cashFlow = holding.annual_net_cash_flow ?? 0;
  const capRate = holding.cap_rate ?? 0;
  const isPositive = cashFlow >= 0;

  return (
    <View style={styles.holdingCard}>
      <View style={styles.holdingHeader}>
        <Text style={styles.holdingTitle} numberOfLines={1}>
          {holding.property_title}
        </Text>
        <Text style={styles.holdingStatus}>
          {holding.status === 'active' ? '● Active' : holding.status}
        </Text>
      </View>
      <View style={styles.holdingStats}>
        <View style={styles.holdingStat}>
          <Text style={styles.holdingStatLabel}>Value</Text>
          <Text style={styles.holdingStatValue}>{formatCurrency(holding.current_value)}</Text>
        </View>
        <View style={styles.holdingStat}>
          <Text style={styles.holdingStatLabel}>Equity</Text>
          <Text style={[styles.holdingStatValue, { color: Colors.success }]}>
            {formatCurrency(equity)}
          </Text>
        </View>
        <View style={styles.holdingStat}>
          <Text style={styles.holdingStatLabel}>Cap Rate</Text>
          <Text style={styles.holdingStatValue}>{capRate.toFixed(2)}%</Text>
        </View>
        <View style={styles.holdingStat}>
          <Text style={styles.holdingStatLabel}>Cash Flow</Text>
          <View style={styles.holdingCashFlow}>
            {isPositive ? (
              <ArrowUpRight size={12} color={Colors.success} />
            ) : (
              <ArrowDownRight size={12} color={Colors.error} />
            )}
            <Text style={[styles.holdingStatValue, { color: isPositive ? Colors.success : Colors.error }]}>
              {formatCurrency(Math.abs(cashFlow))}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function TransactionRow({ entry }: { entry: IncomeExpenseEntry }) {
  const isIncome = entry.entry_type === 'income';
  return (
    <View style={styles.transactionRow}>
      <View style={[
        styles.transactionIcon,
        { backgroundColor: isIncome ? `${Colors.success}15` : `${Colors.error}15` },
      ]}>
        {isIncome ? (
          <ArrowUpRight size={14} color={Colors.success} />
        ) : (
          <ArrowDownRight size={14} color={Colors.error} />
        )}
      </View>
      <View style={styles.transactionInfo}>
        <Text style={styles.transactionCategory} numberOfLines={1}>
          {entry.category}
        </Text>
        <Text style={styles.transactionDate}>
          {new Date(entry.entry_date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>
      <Text style={[
        styles.transactionAmount,
        { color: isIncome ? Colors.success : Colors.error },
      ]}>
        {isIncome ? '+' : '-'}{formatCurrencyWithDecimals(entry.amount)}
      </Text>
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
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 12,
  },
  verificationText: {
    fontSize: 11,
    fontWeight: fontWeightSemiBold,
    textTransform: 'capitalize',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  summaryCard: {
    width: '47.5%',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  summaryIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: fontWeightBold,
    color: Colors.text,
  },
  returnBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  returnBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  returnBarLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  returnBarValue: {
    fontSize: 18,
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
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  sectionLinkText: {
    fontSize: 13,
    color: Colors.gold,
    fontWeight: fontWeightSemiBold,
  },
  holdingsList: {
    gap: 10,
  },
  holdingCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  holdingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  holdingTitle: {
    fontSize: 15,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  holdingStatus: {
    fontSize: 11,
    color: Colors.success,
    fontWeight: fontWeightMedium,
  },
  holdingStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  holdingStat: {
    flex: 1,
  },
  holdingStatLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  holdingStatValue: {
    fontSize: 13,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
  },
  holdingCashFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  emptyInline: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyInlineText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  transactionsList: {
    gap: 8,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  transactionIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionCategory: {
    fontSize: 13,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
  },
  transactionDate: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: fontWeightBold,
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
