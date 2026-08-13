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
  CreditCard,
  Banknote,
  Wallet,
  TrendingUp,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Building2,
  Percent,
  FileText,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { ownerApi, type PaymentRecord } from '@/lib/ivx-owner-api';
import { formatCurrency, formatCurrencyWithDecimals } from '@/lib/formatters';
import { EmptyState } from '@/components/ProgressiveStates';

const fontWeightBold = 'bold' as const;
const fontWeightSemiBold = '600' as const;
const fontWeightMedium = '500' as const;

function paymentStatusColor(status: string): string {
  if (['completed', 'succeeded', 'settled', 'released'].includes(status)) return Colors.success;
  if (['pending', 'processing', 'in_transit', 'funded'].includes(status)) return Colors.warning;
  if (['failed', 'cancelled', 'refunded'].includes(status)) return Colors.error;
  return Colors.textSecondary;
}

function paymentStatusIcon(status: string): React.ReactNode {
  const color = paymentStatusColor(status);
  if (['completed', 'succeeded', 'settled', 'released'].includes(status)) {
    return <CheckCircle2 size={16} color={color} />;
  }
  if (['pending', 'processing', 'in_transit', 'funded'].includes(status)) {
    return <Clock size={16} color={color} />;
  }
  if (['failed', 'cancelled', 'refunded'].includes(status)) {
    return <XCircle size={16} color={color} />;
  }
  return <AlertCircle size={16} color={color} />;
}

function providerIcon(provider: string): React.ReactNode {
  const p = provider.toLowerCase();
  if (p.includes('stripe')) return <CreditCard size={16} color={Colors.gold} />;
  if (p.includes('wire') || p.includes('bank')) return <Banknote size={16} color={Colors.gold} />;
  return <Wallet size={16} color={Colors.gold} />;
}

export default function PaymentsCenterScreen() {
  const router = useRouter();

  const { data: paymentsData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['payment-records'],
    queryFn: () => ownerApi.getPaymentRecords(),
  });

  const { data: feesData, isLoading: feesLoading } = useQuery({
    queryKey: ['fee-structures'],
    queryFn: () => ownerApi.getFeeStructures(),
  });

  const { data: reconciliationData, isLoading: reconLoading } = useQuery({
    queryKey: ['reconciliation'],
    queryFn: () => ownerApi.getReconciliation(),
  });

  const records: PaymentRecord[] = paymentsData?.records ?? [];
  const fees: Record<string, unknown>[] = feesData?.fees ?? [];
  const reconRecords: Record<string, unknown>[] = reconciliationData?.records ?? [];

  const summary = useMemo(() => {
    const totalAmount = records.reduce((sum, r) => sum + (r.amount || 0), 0);
    const totalFees = records.reduce((sum, r) => sum + (r.fee_amount || 0), 0);
    const completed = records.filter((r) => ['completed', 'succeeded', 'settled', 'released'].includes(r.status));
    const completedAmount = completed.reduce((sum, r) => sum + (r.amount || 0), 0);
    const pending = records.filter((r) => ['pending', 'processing', 'in_transit', 'funded'].includes(r.status));
    const pendingAmount = pending.reduce((sum, r) => sum + (r.amount || 0), 0);
    const failed = records.filter((r) => ['failed', 'cancelled', 'refunded'].includes(r.status));

    return {
      totalAmount,
      totalFees,
      completedAmount,
      completedCount: completed.length,
      pendingAmount,
      pendingCount: pending.length,
      failedCount: failed.length,
      totalCount: records.length,
    };
  }, [records]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading payments…</Text>
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
          <Text style={styles.headerTitle}>Payments</Text>
          <Text style={styles.headerSubtitle}>
            Transactions, fees & reconciliation
          </Text>
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCardPrimary}>
            <View style={styles.summaryIconGold}>
              <Wallet size={18} color={Colors.gold} />
            </View>
            <Text style={styles.summaryLabel}>Total Volume</Text>
            <Text style={styles.summaryValueGold}>{formatCurrency(summary.totalAmount)}</Text>
            <Text style={styles.summarySubtext}>{summary.totalCount} transactions</Text>
          </View>
          <View style={styles.summaryCol}>
            <View style={styles.miniCard}>
              <View style={styles.miniCardLeft}>
                <View style={[styles.miniIcon, { backgroundColor: `${Colors.success}15` }]}>
                  <TrendingUp size={14} color={Colors.success} />
                </View>
                <Text style={styles.miniLabel}>Completed</Text>
              </View>
              <Text style={[styles.miniValue, { color: Colors.success }]}>
                {formatCurrency(summary.completedAmount)}
              </Text>
            </View>
            <View style={styles.miniCard}>
              <View style={styles.miniCardLeft}>
                <View style={[styles.miniIcon, { backgroundColor: `${Colors.warning}15` }]}>
                  <Clock size={14} color={Colors.warning} />
                </View>
                <Text style={styles.miniLabel}>Pending</Text>
              </View>
              <Text style={[styles.miniValue, { color: Colors.warning }]}>
                {formatCurrency(summary.pendingAmount)}
              </Text>
            </View>
          </View>
        </View>

        {/* Fee Summary */}
        <View style={styles.feeBar}>
          <View style={styles.feeBarLeft}>
            <Percent size={16} color={Colors.textSecondary} />
            <Text style={styles.feeBarLabel}>Total Fees</Text>
          </View>
          <Text style={styles.feeBarValue}>{formatCurrencyWithDecimals(summary.totalFees)}</Text>
        </View>

        {/* Payment Records */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Transaction History</Text>
        </View>
        {records.length === 0 ? (
          <EmptyState
            title="No payment records"
            message="Payment transactions will appear here once processed."
          />
        ) : (
          <View style={styles.recordsList}>
            {records.slice(0, 20).map((record: PaymentRecord) => (
              <React.Fragment key={record.id}>
                <PaymentRow record={record} />
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Fee Structures */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Fee Structures</Text>
        </View>
        {feesLoading ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyInlineText}>Loading fees…</Text>
          </View>
        ) : fees.length === 0 ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyInlineText}>No fee structures configured</Text>
          </View>
        ) : (
          <View style={styles.feesList}>
            {fees.slice(0, 5).map((fee: Record<string, unknown>, idx: number) => (
              <View key={(fee.id as string) ?? idx} style={styles.feeRow}>
                <View style={styles.feeInfo}>
                  <Text style={styles.feeName}>{String(fee.fee_name ?? 'Unknown Fee')}</Text>
                  <Text style={styles.feeType}>
                    {String(fee.fee_type ?? '—')} · {String(fee.calculation_method ?? '—')}
                  </Text>
                </View>
                <View style={styles.feeRate}>
                  {fee.rate != null && (
                    <Text style={styles.feeRateText}>{String(fee.rate)}%</Text>
                  )}
                  {fee.flat_amount != null && (
                    <Text style={styles.feeRateText}>{formatCurrency(Number(fee.flat_amount))}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Reconciliation */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Reconciliation</Text>
        </View>
        {reconLoading ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyInlineText}>Loading reconciliation…</Text>
          </View>
        ) : reconRecords.length === 0 ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyInlineText}>No reconciliation records</Text>
          </View>
        ) : (
          <View style={styles.reconList}>
            {reconRecords.slice(0, 5).map((recon: Record<string, unknown>, idx: number) => {
              const variance = Number(recon.variance ?? 0);
              const isBalanced = Math.abs(variance) < 0.01;
              return (
                <View key={(recon.id as string) ?? idx} style={styles.reconRow}>
                  <View style={styles.reconInfo}>
                    <Text style={styles.reconProvider}>{String(recon.provider ?? '—')}</Text>
                    <Text style={styles.reconDate}>
                      {recon.reconciliation_date
                        ? new Date(recon.reconciliation_date as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </Text>
                  </View>
                  <View style={styles.reconRight}>
                    <Text style={styles.reconAmount}>
                      {formatCurrency(Number(recon.total_actual ?? 0))}
                    </Text>
                    <Text style={[
                      styles.reconStatus,
                      { color: isBalanced ? Colors.success : Colors.warning },
                    ]}>
                      {isBalanced ? 'Balanced' : `Var: ${formatCurrencyWithDecimals(variance)}`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/owner-portfolio')}
          >
            <Wallet size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Portfolio</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/compliance-center')}
          >
            <FileText size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Compliance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push('/marketplace')}
          >
            <Building2 size={20} color={Colors.gold} />
            <Text style={styles.quickActionText}>Market</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---- Sub-components ----

function PaymentRow({ record }: { record: PaymentRecord }) {
  const color = paymentStatusColor(record.status);
  const isPositive = record.payment_type !== 'refund' && record.payment_type !== 'fee';

  return (
    <View style={styles.recordRow}>
      <View style={[styles.recordIcon, { backgroundColor: `${Colors.gold}15` }]}>
        {providerIcon(record.provider)}
      </View>
      <View style={styles.recordInfo}>
        <Text style={styles.recordType} numberOfLines={1}>
          {record.payment_type.replace(/_/g, ' ')}
        </Text>
        <Text style={styles.recordProvider}>
          {record.provider} · {record.currency_code}
        </Text>
        <View style={styles.recordStatusRow}>
          {paymentStatusIcon(record.status)}
          <Text style={[styles.recordStatus, { color }]}>
            {record.status.replace(/_/g, ' ')}
          </Text>
          {record.completed_at && (
            <Text style={styles.recordDate}>
              {new Date(record.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.recordRight}>
        <Text style={[styles.recordAmount, { color: isPositive ? Colors.text : Colors.error }]}>
          {isPositive ? '+' : '-'}{formatCurrencyWithDecimals(record.amount)}
        </Text>
        {record.fee_amount > 0 && (
          <Text style={styles.recordFee}>
            Fee: {formatCurrencyWithDecimals(record.fee_amount)}
          </Text>
        )}
      </View>
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
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCardPrimary: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  summaryIconGold: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: `${Colors.gold}15`,
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
  summaryValueGold: {
    fontSize: 22,
    fontWeight: fontWeightBold,
    color: Colors.gold,
  },
  summarySubtext: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  summaryCol: {
    gap: 10,
  },
  miniCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    minWidth: 140,
  },
  miniCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  miniIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  miniValue: {
    fontSize: 15,
    fontWeight: fontWeightBold,
  },
  feeBar: {
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
  feeBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feeBarLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  feeBarValue: {
    fontSize: 16,
    fontWeight: fontWeightBold,
    color: Colors.text,
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
  recordsList: {
    gap: 8,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  recordIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  recordInfo: {
    flex: 1,
  },
  recordType: {
    fontSize: 13,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
    textTransform: 'capitalize',
  },
  recordProvider: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  recordStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  recordStatus: {
    fontSize: 11,
    fontWeight: fontWeightMedium,
    textTransform: 'capitalize',
  },
  recordDate: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  recordRight: {
    alignItems: 'flex-end',
  },
  recordAmount: {
    fontSize: 15,
    fontWeight: fontWeightBold,
  },
  recordFee: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 2,
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
  feesList: {
    gap: 8,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  feeInfo: {
    flex: 1,
  },
  feeName: {
    fontSize: 13,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
  },
  feeType: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  feeRate: {
    alignItems: 'flex-end',
  },
  feeRateText: {
    fontSize: 14,
    fontWeight: fontWeightBold,
    color: Colors.gold,
  },
  reconList: {
    gap: 8,
  },
  reconRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  reconInfo: {
    flex: 1,
  },
  reconProvider: {
    fontSize: 13,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
    textTransform: 'capitalize',
  },
  reconDate: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  reconRight: {
    alignItems: 'flex-end',
  },
  reconAmount: {
    fontSize: 14,
    fontWeight: fontWeightBold,
    color: Colors.text,
  },
  reconStatus: {
    fontSize: 11,
    fontWeight: fontWeightMedium,
    marginTop: 2,
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
