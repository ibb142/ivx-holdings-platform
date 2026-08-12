/**
 * Admin — Enterprise Capital & Treasury Dashboard.
 *
 * Live financial dashboard: cash on hand, capital raised/deployed, profit,
 * loss, outstanding payments, pending distributions, investor balances,
 * realtor + influencer commissions, ledger integrity (immutable hash chain),
 * pending approvals (CEO → Finance → Owner) and the AI Finance monitor
 * (cash flow, overdue payments, anomalies, fraud signals, forecast,
 * executive summary).
 */
import React from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Landmark,
  Wallet,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Users,
  Percent,
  Megaphone,
  Brain,
  AlertTriangle} from 'lucide-react-native';
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { assertOwnerSessionAccessToken } from '@/src/modules/ivx-owner-ai/services/ownerSessionPreflight';

const GOLD = '#FFD700';
const BG = '#000000';
const CARD = '#141414';
const BORDER = '#2A2A2A';
const TEXT = '#FFFFFF';
const SUB = '#909090';
const GREEN = '#00C48C';
const RED = '#FF4D4D';

interface TreasuryDashboard {
  generatedAt: string;
  cashOnHand: number;
  capitalRaised: number;
  capitalDeployed: number;
  profit: number;
  loss: number;
  outstandingPayments: number;
  pendingDistributions: number;
  pendingApprovals: number;
  investorBalances: { accountId: string; displayName: string; netWorth: number; availableCash: number }[];
  realtorCommissionsUnpaid: number;
  influencerCommissionsDue: number;
  ledgerIntegrity: { valid: boolean; totalEntries: number };
}

interface AIFinance {
  cashFlow: { last30dInflow: number; last30dOutflow: number; net: number; trend: string };
  upcomingDistributions: { distributionId: string; propertyId: string; nextDueDate: string; amount: number }[];
  overduePayments: { transactionId: string; type: string; amount: number; daysPending: number }[];
  profitAnomalies: { transactionId: string; type: string; amount: number; zScore: number; note: string }[];
  fraudSignals: { signal: string; severity: string; detail: string }[];
  capitalForecast: { horizonDays: number; projectedInflow: number; projectedOutflow: number; projectedNet: number };
  executiveSummary: string;
}

async function ownerGet(path: string): Promise<Record<string, unknown>> {
  const token = await assertOwnerSessionAccessToken();
  const base = getDirectApiBaseUrl().replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }});
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`
    );
  }
  return payload;
}

function money(value: number | undefined): string {
  const amount = typeof value === 'number' ? value : 0;
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function TreasuryScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const dashboardQuery = useQuery({
    queryKey: ['treasury-dashboard'],
    queryFn: async (): Promise<TreasuryDashboard> => {
      const payload = await ownerGet('/api/ivx/treasury/dashboard');
      return payload.dashboard as unknown as TreasuryDashboard;
    }});
  const isLoading = false; // IVX: loading state placeholder

  const aiFinanceQuery = useQuery({
    queryKey: ['treasury-ai-finance'],
    queryFn: async (): Promise<AIFinance> => {
      const payload = await ownerGet('/api/ivx/treasury/ai-finance');
      return payload.aiFinance as unknown as AIFinance;
    }});

  const dashboard = dashboardQuery.data;
  const ai = aiFinanceQuery.data;
  const refreshing = dashboardQuery.isRefetching || aiFinanceQuery.isRefetching;

  const onRefresh = () => {
    dashboardQuery.refetch();
    aiFinanceQuery.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Capital & Treasury',
          headerStyle: { backgroundColor: BG },
          headerTintColor: GOLD,
          headerTitleStyle: { color: TEXT }}}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />
        }
      >
        {dashboardQuery.isError ? (
          <View style={styles.card}>
            <AlertTriangle color={RED} size={18} />
            <Text style={styles.errorText}>
              {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'Failed to load treasury.'}
            </Text>
          </View>
        ) : null}

        <View style={styles.heroRow}>
          <View style={styles.heroCard}>
            <Wallet color={GOLD} size={20} />
            <Text style={styles.heroLabel}>Cash on Hand</Text>
            <Text style={styles.heroValue}>{money(dashboard?.cashOnHand)}</Text>
          </View>
          <View style={styles.heroCard}>
            <Landmark color={GOLD} size={20} />
            <Text style={styles.heroLabel}>Capital Raised</Text>
            <Text style={styles.heroValue}>{money(dashboard?.capitalRaised)}</Text>
          </View>
        </View>

        <View style={styles.statGrid}>
          <StatTile icon={<TrendingUp color={GREEN} size={16} />} label="Capital Deployed" value={money(dashboard?.capitalDeployed)} />
          <StatTile icon={<TrendingUp color={GREEN} size={16} />} label="Profit" value={money(dashboard?.profit)} tone={GREEN} />
          <StatTile icon={<TrendingDown color={RED} size={16} />} label="Loss" value={money(dashboard?.loss)} tone={RED} />
          <StatTile icon={<Clock color={GOLD} size={16} />} label="Outstanding" value={money(dashboard?.outstandingPayments)} />
          <StatTile icon={<Clock color={GOLD} size={16} />} label="Pending Distributions" value={money(dashboard?.pendingDistributions)} />
          <StatTile icon={<ShieldCheck color={GOLD} size={16} />} label="Pending Approvals" value={String(dashboard?.pendingApprovals ?? 0)} />
          <StatTile icon={<Percent color={GOLD} size={16} />} label="Realtor Commissions Unpaid" value={money(dashboard?.realtorCommissionsUnpaid)} />
          <StatTile icon={<Megaphone color={GOLD} size={16} />} label="Influencer Commissions Due" value={money(dashboard?.influencerCommissionsDue)} />
        </View>

        <View style={styles.card}>
          {dashboard?.ledgerIntegrity.valid !== false ? (
            <ShieldCheck color={GREEN} size={18} />
          ) : (
            <ShieldAlert color={RED} size={18} />
          )}
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Immutable Ledger</Text>
            <Text style={styles.cardSub}>
              {`${dashboard?.ledgerIntegrity.totalEntries ?? 0} entries · SHA-256 hash chain ${dashboard?.ledgerIntegrity.valid === false ? 'BROKEN' : 'verified'} · nothing deleted, every edit tracked`}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Investor Balances</Text>
        {(dashboard?.investorBalances ?? []).length === 0 ? (
          <Text style={styles.empty}>No investor accounts yet.</Text>
        ) : (
          (dashboard?.investorBalances ?? []).map((balance) => (
            <View key={balance.accountId} style={styles.card}>
              <Users color={GOLD} size={18} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{balance.displayName}</Text>
                <Text style={styles.cardSub}>
                  {`Net worth ${money(balance.netWorth)} · cash ${money(balance.availableCash)}`}
                </Text>
              </View>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>AI Finance Monitor</Text>
        <View style={styles.aiCard}>
          <View style={styles.aiHeader}>
            <Brain color={GOLD} size={18} />
            <Text style={styles.aiTitle}>Executive Summary</Text>
          </View>
          <Text style={styles.aiSummary}>{ai?.executiveSummary ?? 'Loading AI finance monitor…'}</Text>
          {ai ? (
            <View style={styles.aiStats}>
              <Text style={styles.aiStat}>
                {`30d cash flow: ${money(ai.cashFlow.net)} (${ai.cashFlow.trend}) · in ${money(ai.cashFlow.last30dInflow)} / out ${money(ai.cashFlow.last30dOutflow)}`}
              </Text>
              <Text style={styles.aiStat}>
                {`Forecast (${ai.capitalForecast.horizonDays}d): net ${money(ai.capitalForecast.projectedNet)}`}
              </Text>
              <Text style={styles.aiStat}>
                {`Overdue: ${ai.overduePayments.length} · Anomalies: ${ai.profitAnomalies.length} · Fraud signals: ${ai.fraudSignals.length} · Upcoming distributions: ${ai.upcomingDistributions.length}`}
              </Text>
            </View>
          ) : null}
        </View>

        {(ai?.fraudSignals ?? []).map((signal, index) => (
          <View key={`${signal.signal}-${index}`} style={styles.card}>
            <AlertTriangle color={signal.severity === 'high' ? RED : GOLD} size={18} />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{signal.signal.replace(/_/g, ' ')}</Text>
              <Text style={styles.cardSub}>{signal.detail}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <View style={styles.statTile}>
      {icon}
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  heroRow: { flexDirection: 'row', gap: 12 },
  heroCard: {
    flex: 1,
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 6},
  heroLabel: { color: SUB, fontSize: 12 },
  heroValue: { color: GOLD, fontSize: 22, fontWeight: '700' as const },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile: {
    width: '48%',
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4},
  statLabel: { color: SUB, fontSize: 11 },
  statValue: { color: TEXT, fontSize: 16, fontWeight: '600' as const },
  sectionTitle: { color: TEXT, fontSize: 16, fontWeight: '700' as const, marginTop: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14},
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { color: TEXT, fontSize: 14, fontWeight: '600' as const },
  cardSub: { color: SUB, fontSize: 12 },
  empty: { color: SUB, fontSize: 13 },
  errorText: { color: RED, fontSize: 13, flex: 1 },
  aiCard: {
    backgroundColor: CARD,
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 10},
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiTitle: { color: GOLD, fontSize: 14, fontWeight: '700' as const },
  aiSummary: { color: TEXT, fontSize: 13, lineHeight: 19 },
  aiStats: { gap: 4 },
  aiStat: { color: SUB, fontSize: 12 }});
