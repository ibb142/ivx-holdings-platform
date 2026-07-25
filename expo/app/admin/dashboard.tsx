import React, { useCallback } from 'react';
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
import { useScreenFocusState } from '@/hooks/useScreenFocusState';
import {
  Users,
  ArrowLeftRight,
  Building2,
  TrendingUp,
  DollarSign,
  Shield,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ChevronRight,
  ArrowLeft,
  Activity,
  BarChart3,
  Wallet,
  AlertCircle,
  CheckCircle2,
  Zap,
  Layers,
  Calendar,
  Cpu,
  Mail,
  Phone,
  Globe,
  Target,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrencyCompact } from '@/lib/formatters';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAdminMemberRegistry } from '@/lib/member-registry';

interface DashboardStatsShape {
  totalInvested?: number;
  trends?: {
    volumeLast30d?: number;
    volumeGrowthRate?: number;
  };
  totalMembers?: number;
  activeMembers?: number;
  totalTransactions?: number;
  totalVolume?: number;
  totalProperties?: number;
  liveProperties?: number;
  pendingKyc?: number;
  totalDeposits?: number;
  totalWithdrawals?: number;
  pendingTransactions?: number;
}

interface DashboardKPI {
  name?: string;
  value?: number | string;
  format?: string;
  change?: number;
  trend?: string;
}

interface SystemHealthShape {
  status: string;
  services: Array<{ name: string; status: string; responseTime: number }>;
  metrics: {
    activeUsers: number;
    transactionsPerHour: number;
    errorRate: number;
    avgResponseTime: number;
  };
}

interface RetentionShape {
  retention: {
    day1: number;
    day7: number;
    day30: number;
  };
  engagement: {
    dauMauRatio: number;
  };
  churn: {
    churnedUsers: number;
    churnRate: number;
    atRisk: number;
  };
}

interface InvestmentShape {
  totalInvestments: number;
  totalInvestmentVolume: number;
  averageInvestment: number;
  uniqueInvestors: number;
  netFlow: number;
  totalDividends: number;
}

const ADMIN_DASHBOARD_REFRESH_MS = 1000 * 60 * 2;
const ADMIN_DASHBOARD_LEADS_REFRESH_MS = 1000 * 90;

function getLatestRecord<T>(value: unknown): T | null {
  if (Array.isArray(value)) {
    const firstValid = value.find((item) => item && typeof item === 'object');
    return (firstValid as T | undefined) ?? null;
  }

  if (value && typeof value === 'object') {
    return value as T;
  }

  return null;
}

function normalizeSystemHealth(value: unknown): SystemHealthShape | null {
  const record = getLatestRecord<Record<string, unknown>>(value);
  if (!record) {
    return null;
  }

  const rawServices = Array.isArray(record.services) ? record.services : [];
  const rawMetrics = record.metrics && typeof record.metrics === 'object' ? record.metrics as Record<string, unknown> : {};

  return {
    status: typeof record.status === 'string' ? record.status : 'unknown',
    services: rawServices
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        name: typeof item.name === 'string' ? item.name : 'Service',
        status: typeof item.status === 'string' ? item.status : 'unknown',
        responseTime: Number(item.responseTime ?? 0),
      })),
    metrics: {
      activeUsers: Number(rawMetrics.activeUsers ?? 0),
      transactionsPerHour: Number(rawMetrics.transactionsPerHour ?? 0),
      errorRate: Number(rawMetrics.errorRate ?? 0),
      avgResponseTime: Number(rawMetrics.avgResponseTime ?? 0),
    },
  };
}

function normalizeRetention(value: unknown): RetentionShape | null {
  const record = getLatestRecord<Record<string, unknown>>(value);
  if (!record) {
    return null;
  }

  const retention = record.retention && typeof record.retention === 'object' ? record.retention as Record<string, unknown> : record;
  const engagement = record.engagement && typeof record.engagement === 'object' ? record.engagement as Record<string, unknown> : record;
  const churn = record.churn && typeof record.churn === 'object' ? record.churn as Record<string, unknown> : record;

  const normalized: RetentionShape = {
    retention: {
      day1: Number(retention.day1 ?? retention.day_1 ?? record.day1 ?? record.day_1 ?? 0),
      day7: Number(retention.day7 ?? retention.day_7 ?? record.day7 ?? record.day_7 ?? 0),
      day30: Number(retention.day30 ?? retention.day_30 ?? record.day30 ?? record.day_30 ?? 0),
    },
    engagement: {
      dauMauRatio: Number(engagement.dauMauRatio ?? engagement.dau_mau_ratio ?? record.dauMauRatio ?? record.dau_mau_ratio ?? 0),
    },
    churn: {
      churnedUsers: Number(churn.churnedUsers ?? churn.churned_users ?? record.churnedUsers ?? record.churned_users ?? 0),
      churnRate: Number(churn.churnRate ?? churn.churn_rate ?? record.churnRate ?? record.churn_rate ?? 0),
      atRisk: Number(churn.atRisk ?? churn.at_risk ?? record.atRisk ?? record.at_risk ?? 0),
    },
  };

  console.log('[AdminDashboard] Normalized retention metrics:', normalized);

  return normalized;
}

function normalizeInvestment(value: unknown): InvestmentShape | null {
  const record = getLatestRecord<Record<string, unknown>>(value);
  if (!record) {
    return null;
  }

  return {
    totalInvestments: Number(record.totalInvestments ?? 0),
    totalInvestmentVolume: Number(record.totalInvestmentVolume ?? 0),
    averageInvestment: Number(record.averageInvestment ?? 0),
    uniqueInvestors: Number(record.uniqueInvestors ?? 0),
    netFlow: Number(record.netFlow ?? 0),
    totalDividends: Number(record.totalDividends ?? 0),
  };
}

export default function AdminDashboardScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const queryClient = useQueryClient();
  const isScreenFocused = useScreenFocusState(true);



  const dashboardQuery = useQuery<any>({
    queryKey: ['analytics.getDashboard'],
    queryFn: async () => {
      console.log('[Supabase] Fetching analytics dashboard');
      const { data, error } = await supabase.from('analytics_dashboard').select('*').limit(50);
      if (error) { console.log('[Supabase] analytics_dashboard error:', error.message); return null; }
      return data;
    },
    staleTime: ADMIN_DASHBOARD_REFRESH_MS,
    refetchInterval: isScreenFocused ? ADMIN_DASHBOARD_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });

  const memberRegistryStatsQuery = useQuery<{ total: number; active: number; pendingKyc: number }>({
    queryKey: ['members.registryStats'],
    queryFn: async () => {
      console.log('[Dashboard] Fetching canonical member registry stats');
      const members = await fetchAdminMemberRegistry();
      return {
        total: members.length,
        active: members.filter((m) => (m.status || 'active') === 'active').length,
        pendingKyc: members.filter((m) => (m.kycStatus || 'pending') === 'pending' || m.kycStatus === 'in_review').length,
      };
    },
    staleTime: 15000,
    refetchInterval: isScreenFocused ? 30000 : false,
    placeholderData: (prev) => prev,
  });
  const registryStats = memberRegistryStatsQuery.data;

  const kpiQuery = useQuery<any>({
    queryKey: ['analytics.getKPIDashboard'],
    queryFn: async () => {
      console.log('[Supabase] Fetching KPI dashboard');
      const { data, error } = await supabase.from('analytics_kpi').select('*').limit(50);
      if (error) { console.log('[Supabase] analytics_kpi error:', error.message); return null; }
      return data;
    },
    staleTime: 1000 * 30,
    placeholderData: (prev: any) => prev,
  });

  const systemHealthQuery = useQuery<any>({
    queryKey: ['analytics.getSystemHealth'],
    queryFn: async () => {
      console.log('[Supabase] Fetching system health');
      const { data, error } = await supabase.from('system_health').select('*').limit(50);
      if (error) { console.log('[Supabase] system_health error:', error.message); return null; }
      return data;
    },
    staleTime: ADMIN_DASHBOARD_REFRESH_MS,
    refetchInterval: isScreenFocused ? ADMIN_DASHBOARD_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });

  const transactionsQuery = useQuery<any>({
    queryKey: ['transactions.list', { page: 1, limit: 6 }],
    queryFn: async () => {
      console.log('[Supabase] Fetching transactions');
      const { data, error } = await supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(6);
      if (error) { console.log('[Supabase] transactions error:', error.message); return null; }
      return { transactions: data ?? [] };
    },
    staleTime: 1000 * 30,
    placeholderData: (prev: any) => prev,
  });

  const pendingKycQuery = useQuery<any>({
    queryKey: ['members.list', { kycStatus: 'pending', limit: 5 }],
    queryFn: async () => {
      console.log('[Supabase] Fetching pending KYC members');
      const { data, error } = await supabase.from('profiles').select('*').limit(5);
      if (error) { console.log('[Supabase] profiles pending error:', error.message); return null; }
      return { members: data ?? [] };
    },
    staleTime: 1000 * 30,
    placeholderData: (prev: any) => prev,
  });

  const inReviewKycQuery = useQuery<any>({
    queryKey: ['members.list', { kycStatus: 'in_review', limit: 5 }],
    queryFn: async () => {
      console.log('[Supabase] Fetching in-review KYC members');
      const { data, error } = await supabase.from('profiles').select('*').limit(5);
      if (error) { console.log('[Supabase] profiles in_review error:', error.message); return null; }
      return { members: data ?? [] };
    },
    staleTime: 1000 * 30,
    placeholderData: (prev: any) => prev,
  });

  const retentionQuery = useQuery<any>({
    queryKey: ['analytics.getRetentionMetrics', { period: '30d' }],
    queryFn: async () => {
      console.log('[Supabase] Fetching retention metrics');
      const { data, error } = await supabase.from('analytics_retention').select('*').limit(50);
      if (error) { console.log('[Supabase] analytics_retention error:', error.message); return null; }
      return data;
    },
    staleTime: 1000 * 60 * 2,
    placeholderData: (prev: any) => prev,
  });

  const investmentQuery = useQuery<any>({
    queryKey: ['analytics.getInvestmentAnalytics', { period: '30d' }],
    queryFn: async () => {
      console.log('[Supabase] Fetching investment analytics');
      const { data, error } = await supabase.from('analytics_investments').select('*').limit(50);
      if (error) { console.log('[Supabase] analytics_investments error:', error.message); return null; }
      return data;
    },
    staleTime: 1000 * 60 * 2,
    placeholderData: (prev: any) => prev,
  });

  const cachedDash = dashboardQuery.data;
  const cachedTx = transactionsQuery.data;
  const cachedPendingKyc = pendingKycQuery.data;
  const cachedInReviewKyc = inReviewKycQuery.data;
  const cachedKpi = kpiQuery.data;
  const cachedHealth = systemHealthQuery.data;
  const cachedRetention = retentionQuery.data;
  const cachedInvestment = investmentQuery.data;

  const leadsQuery = useQuery<any>({
    queryKey: ['analytics.getAllSignups', { page: 1, limit: 10, type: 'all' }],
    queryFn: async () => {
      console.log('[Supabase] Fetching signups for dashboard');
      const { data, error } = await supabase.from('signups').select('*').order('created_at', { ascending: false }).limit(10);
      if (error) { console.log('[Supabase] signups error:', error.message); return null; }
      return { signups: data ?? [], stats: null };
    },
    staleTime: ADMIN_DASHBOARD_LEADS_REFRESH_MS,
    refetchInterval: isScreenFocused ? ADMIN_DASHBOARD_LEADS_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const leadsStats = leadsQuery.data?.stats;
  const recentLeads = leadsQuery.data?.signups ?? [];

  const stats = getLatestRecord<DashboardStatsShape>(cachedDash);
  const recentTransactions = cachedTx?.transactions ?? [];
  const pendingKyc = [
    ...(cachedPendingKyc?.members ?? []),
    ...(cachedInReviewKyc?.members ?? []),
  ];
  const kpiSource = getLatestRecord<Record<string, unknown>>(cachedKpi);
  const kpis = Array.isArray(kpiSource?.kpis) ? (kpiSource?.kpis as DashboardKPI[]) : [];
  const health = normalizeSystemHealth(cachedHealth);
  const retention = normalizeRetention(cachedRetention);
  const investment = normalizeInvestment(cachedInvestment);
  const retentionDay1 = retention?.retention?.day1 ?? 0;
  const retentionDay7 = retention?.retention?.day7 ?? 0;
  const retentionDay30 = retention?.retention?.day30 ?? 0;
  const retentionDauMauRatio = retention?.engagement?.dauMauRatio ?? 0;
  const retentionChurnedUsers = retention?.churn?.churnedUsers ?? 0;
  const retentionChurnRate = retention?.churn?.churnRate ?? 0;
  const retentionAtRisk = retention?.churn?.atRisk ?? 0;

  const hasAnyCachedData = !!stats || recentTransactions.length > 0;
  const statsLoading = dashboardQuery.isLoading && !hasAnyCachedData;
  const refreshing = dashboardQuery.isRefetching;

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['analytics.getDashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics.getKPIDashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics.getSystemHealth'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics.getRetentionMetrics'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics.getInvestmentAnalytics'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions.list'] });
    void queryClient.invalidateQueries({ queryKey: ['members.list'] });
  }, [queryClient]);

  const formatCurrency = useCallback((amount: number) => formatCurrencyCompact(amount), []);

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const getTransactionIcon = useCallback((type: string) => {
    switch (type) {
      case 'deposit':
        return <ArrowDownRight size={14} color={Colors.positive} />;
      case 'withdrawal':
        return <ArrowUpRight size={14} color={Colors.negative} />;
      case 'buy':
        return <ArrowDownRight size={14} color={Colors.primary} />;
      case 'sell':
        return <ArrowUpRight size={14} color={Colors.accent} />;
      default:
        return <DollarSign size={14} color={Colors.textSecondary} />;
    }
  }, []);

  const cardWidth = (width - 48) / 2;

  const SkeletonCard = useCallback(({ w }: { w?: number }) => (
    <View style={[styles.statCard, w ? { width: w } : { flex: 1 }]}>
      <View style={[styles.statIconWrap, { backgroundColor: Colors.border }]} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, { width: '55%', marginTop: 6 }]} />
    </View>
  ), []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Dashboard</Text>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {statsLoading ? (
          <View style={styles.heroRow}>
            <View style={[styles.heroCard, { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }]}>
              <View style={[styles.skeletonLine, { width: '40%' }]} />
              <View style={[styles.skeletonLine, { height: 22, marginTop: 10 }]} />
              <View style={[styles.skeletonLine, { width: '50%', marginTop: 6 }]} />
            </View>
            <View style={[styles.heroCard, { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }]}>
              <View style={[styles.skeletonLine, { width: '40%' }]} />
              <View style={[styles.skeletonLine, { height: 22, marginTop: 10 }]} />
              <View style={[styles.skeletonLine, { width: '50%', marginTop: 6 }]} />
            </View>
          </View>
        ) : (
          <View style={styles.heroRow}>
            <View style={[styles.heroCard, { backgroundColor: Colors.primary }]}>
              <View style={styles.heroIcon}>
                <Wallet size={20} color={Colors.background} />
              </View>
              <Text style={styles.heroLabel}>Total Invested</Text>
              <Text style={styles.heroValue}>{formatCurrency(stats?.totalInvested ?? 0)}</Text>
              <Text style={styles.heroSub}>Platform-wide AUM</Text>
            </View>
            <View style={[styles.heroCard, { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }]}>
              <View style={[styles.heroIcon, { backgroundColor: Colors.positive + '20' }]}>
                <TrendingUp size={20} color={Colors.positive} />
              </View>
              <Text style={[styles.heroLabel, { color: Colors.textSecondary }]}>Volume (30d)</Text>
              <Text style={[styles.heroValue, { color: Colors.positive }]}>{formatCurrency(stats?.trends?.volumeLast30d ?? 0)}</Text>
              <Text style={styles.heroSub}>{stats?.trends?.volumeGrowthRate ?? 0}% vs prev</Text>
            </View>
          </View>
        )}

        {statsLoading ? (
          <View style={styles.statsGrid}>
            {[1,2,3,4].map((i) => <SkeletonCard key={i} w={cardWidth} />)}
          </View>
        ) : (
        <View style={styles.statsGrid}>
          <TouchableOpacity
            style={[styles.statCard, { width: cardWidth }]}
            onPress={() => router.push('/admin/members' as any)}
          >
            <View style={[styles.statIconWrap, { backgroundColor: Colors.primary + '20' }]}>
              <Users size={18} color={Colors.primary} />
            </View>
            <Text style={styles.statVal}>{registryStats?.total ?? stats?.totalMembers ?? 0}</Text>
            <Text style={styles.statLbl}>Total Members</Text>
            <View style={styles.statFooter}>
              <View style={styles.statDot} />
              <Text style={styles.statSub}>{registryStats?.active ?? stats?.activeMembers ?? 0} active</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, { width: cardWidth }]}
            onPress={() => router.push('/admin/transactions' as any)}
          >
            <View style={[styles.statIconWrap, { backgroundColor: Colors.accent + '20' }]}>
              <ArrowLeftRight size={18} color={Colors.accent} />
            </View>
            <Text style={styles.statVal}>{stats?.totalTransactions ?? 0}</Text>
            <Text style={styles.statLbl}>Transactions</Text>
            <View style={styles.statFooter}>
              <Text style={styles.statSub}>{formatCurrency(stats?.totalVolume ?? 0)} vol</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, { width: cardWidth }]}
            onPress={() => router.push('/admin/properties' as any)}
          >
            <View style={[styles.statIconWrap, { backgroundColor: Colors.positive + '20' }]}>
              <Building2 size={18} color={Colors.positive} />
            </View>
            <Text style={styles.statVal}>{stats?.totalProperties ?? 0}</Text>
            <Text style={styles.statLbl}>Properties</Text>
            <View style={styles.statFooter}>
              <View style={[styles.statDot, { backgroundColor: Colors.positive }]} />
              <Text style={styles.statSub}>{stats?.liveProperties ?? 0} live</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, { width: cardWidth }]}
            onPress={() => router.push('/admin/members' as any)}
          >
            <View style={[styles.statIconWrap, { backgroundColor: Colors.warning + '20' }]}>
              <Shield size={18} color={Colors.warning} />
            </View>
            <Text style={styles.statVal}>{registryStats?.pendingKyc ?? stats?.pendingKyc ?? 0}</Text>
            <Text style={styles.statLbl}>Pending KYC</Text>
            <View style={styles.statFooter}>
              <Text style={styles.statSub}>{(registryStats?.total ?? stats?.totalMembers ?? 0) - (registryStats?.pendingKyc ?? stats?.pendingKyc ?? 0)} verified</Text>
            </View>
          </TouchableOpacity>
        </View>
        )}

        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <BarChart3 size={16} color={Colors.primary} />
            <Text style={styles.metricValue}>{formatCurrency(stats?.totalDeposits ?? 0)}</Text>
            <Text style={styles.metricLabel}>Total Deposits</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricItem}>
            <ArrowUpRight size={16} color={Colors.negative} />
            <Text style={styles.metricValue}>{formatCurrency(stats?.totalWithdrawals ?? 0)}</Text>
            <Text style={styles.metricLabel}>Withdrawals</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricItem}>
            <AlertCircle size={16} color={Colors.warning} />
            <Text style={styles.metricValue}>{stats?.pendingTransactions ?? 0}</Text>
            <Text style={styles.metricLabel}>Pending Tx</Text>
          </View>
        </View>

        {/* IVX Operating Map — live dashboards */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitle}>
              <Activity size={16} color={Colors.accent} />
              <Text style={styles.sectionTitleText}>IVX Operating Map</Text>
            </View>
          </View>
          <View style={styles.kpiGrid}>
            <TouchableOpacity
              style={styles.kpiCard}
              onPress={() => router.push('/module-command-center' as any)}
            >
              <Layers size={18} color={Colors.primary} />
              <Text style={styles.kpiName}>Module Command Center</Text>
              <Text style={styles.kpiValue}>200</Text>
              <Text style={styles.kpiName}>modules mapped live</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.kpiCard}
              onPress={() => router.push('/autonomous-engineering-calendar' as any)}
            >
              <Calendar size={18} color={Colors.accent} />
              <Text style={styles.kpiName}>Engineering Calendar</Text>
              <Text style={styles.kpiValue}>24/7</Text>
              <Text style={styles.kpiName}>autonomous schedule</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.kpiCard}
              onPress={() => router.push('/live-work-panel' as any)}
            >
              <Zap size={18} color={Colors.warning} />
              <Text style={styles.kpiName}>Live Work Panel</Text>
              <Text style={styles.kpiValue}>LIVE</Text>
              <Text style={styles.kpiName}>real execution feed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.kpiCard}
              onPress={() => router.push('/autonomous-dashboard' as any)}
            >
              <Cpu size={18} color={Colors.positive} />
              <Text style={styles.kpiName}>Autonomous Dashboard</Text>
              <Text style={styles.kpiValue}>W1-12</Text>
              <Text style={styles.kpiName}>job ledger + QA</Text>
            </TouchableOpacity>
          </View>
        </View>

        {kpis.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitle}>
                <Activity size={16} color={Colors.accent} />
                <Text style={styles.sectionTitleText}>Key Performance Indicators</Text>
              </View>
            </View>
            <View style={styles.kpiGrid}>
              {kpis.map((kpi: any, idx: number) => (
                <View key={idx} style={styles.kpiCard}>
                  <Text style={styles.kpiName}>{kpi.name}</Text>
                  <Text style={styles.kpiValue}>
                    {kpi.format === 'currency' ? formatCurrency(kpi.value) :
                     kpi.format === 'percentage' ? `${kpi.value}%` :
                     kpi.value}
                  </Text>
                  {kpi.change !== 0 && (
                    <View style={[styles.kpiChange, kpi.trend === 'up' ? styles.kpiUp : styles.kpiDown]}>
                      <Text style={[styles.kpiChangeText, kpi.trend === 'up' ? styles.kpiUpText : styles.kpiDownText]}>
                        {kpi.change > 0 ? '+' : ''}{kpi.change}%
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {health && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitle}>
                <CheckCircle2 size={16} color={Colors.positive} />
                <Text style={styles.sectionTitleText}>System Health</Text>
              </View>
              <View style={[styles.healthBadge, health.status === 'healthy' ? styles.healthGood : styles.healthBad]}>
                <Text style={styles.healthBadgeText}>{health.status}</Text>
              </View>
            </View>
            <View style={styles.servicesGrid}>
              {health.services.map((svc: any, idx: number) => (
                <View key={idx} style={styles.serviceRow}>
                  <View style={[styles.serviceDot, svc.status === 'up' ? styles.serviceUp : styles.serviceDown]} />
                  <Text style={styles.serviceName}>{svc.name}</Text>
                  <Text style={styles.serviceTime}>{svc.responseTime}ms</Text>
                </View>
              ))}
            </View>
            <View style={styles.healthMetrics}>
              <View style={styles.healthMetricItem}>
                <Text style={styles.healthMetricVal}>{health.metrics.activeUsers}</Text>
                <Text style={styles.healthMetricLbl}>Active Users</Text>
              </View>
              <View style={styles.healthMetricItem}>
                <Text style={styles.healthMetricVal}>{health.metrics.transactionsPerHour}</Text>
                <Text style={styles.healthMetricLbl}>Tx/Hour</Text>
              </View>
              <View style={styles.healthMetricItem}>
                <Text style={styles.healthMetricVal}>{health.metrics.errorRate}%</Text>
                <Text style={styles.healthMetricLbl}>Error Rate</Text>
              </View>
              <View style={styles.healthMetricItem}>
                <Text style={styles.healthMetricVal}>{health.metrics.avgResponseTime}ms</Text>
                <Text style={styles.healthMetricLbl}>Avg Response</Text>
              </View>
            </View>
          </View>
        )}

        {retention && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitle}>
                <Users size={16} color={Colors.primary} />
                <Text style={styles.sectionTitleText}>Retention & Engagement</Text>
              </View>
            </View>
            <View style={styles.retentionGrid}>
              <View style={styles.retentionCard}>
                <Text style={styles.retentionLabel}>Day 1</Text>
                <Text style={styles.retentionValue}>{retentionDay1}%</Text>
              </View>
              <View style={styles.retentionCard}>
                <Text style={styles.retentionLabel}>Day 7</Text>
                <Text style={styles.retentionValue}>{retentionDay7}%</Text>
              </View>
              <View style={styles.retentionCard}>
                <Text style={styles.retentionLabel}>Day 30</Text>
                <Text style={styles.retentionValue}>{retentionDay30}%</Text>
              </View>
              <View style={styles.retentionCard}>
                <Text style={styles.retentionLabel}>DAU/MAU</Text>
                <Text style={styles.retentionValue}>{retentionDauMauRatio}%</Text>
              </View>
            </View>
            <View style={styles.churnRow}>
              <View style={styles.churnItem}>
                <Text style={styles.churnLabel}>Churned Users</Text>
                <Text style={[styles.churnValue, { color: Colors.negative }]}>{retentionChurnedUsers}</Text>
              </View>
              <View style={styles.churnItem}>
                <Text style={styles.churnLabel}>Churn Rate</Text>
                <Text style={[styles.churnValue, { color: Colors.negative }]}>{retentionChurnRate}%</Text>
              </View>
              <View style={styles.churnItem}>
                <Text style={styles.churnLabel}>At Risk</Text>
                <Text style={[styles.churnValue, { color: Colors.warning }]}>{retentionAtRisk}</Text>
              </View>
            </View>
          </View>
        )}

        {investment && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitle}>
                <TrendingUp size={16} color={Colors.positive} />
                <Text style={styles.sectionTitleText}>Investment Analytics (30d)</Text>
              </View>
            </View>
            <View style={styles.investGrid}>
              <View style={styles.investCard}>
                <Text style={styles.investLabel}>Total Investments</Text>
                <Text style={styles.investValue}>{investment.totalInvestments}</Text>
              </View>
              <View style={styles.investCard}>
                <Text style={styles.investLabel}>Volume</Text>
                <Text style={styles.investValue}>{formatCurrency(investment.totalInvestmentVolume)}</Text>
              </View>
              <View style={styles.investCard}>
                <Text style={styles.investLabel}>Avg Investment</Text>
                <Text style={styles.investValue}>{formatCurrency(investment.averageInvestment)}</Text>
              </View>
              <View style={styles.investCard}>
                <Text style={styles.investLabel}>Unique Investors</Text>
                <Text style={styles.investValue}>{investment.uniqueInvestors}</Text>
              </View>
              <View style={styles.investCard}>
                <Text style={styles.investLabel}>Net Flow</Text>
                <Text style={[styles.investValue, { color: investment.netFlow >= 0 ? Colors.positive : Colors.negative }]}>
                  {formatCurrency(investment.netFlow)}
                </Text>
              </View>
              <View style={styles.investCard}>
                <Text style={styles.investLabel}>Dividends Paid</Text>
                <Text style={styles.investValue}>{formatCurrency(investment.totalDividends)}</Text>
              </View>
            </View>
          </View>
        )}

        {pendingKyc.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitle}>
                <Shield size={16} color={Colors.warning} />
                <Text style={styles.sectionTitleText}>Pending KYC</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{pendingKyc.length}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => router.push('/admin/members' as any)}>
                <Text style={styles.seeAll}>Review All</Text>
              </TouchableOpacity>
            </View>
            {pendingKyc.map((member) => (
              <TouchableOpacity
                key={member.id}
                style={styles.kycRow}
                onPress={() => router.push(`/admin/member/${member.id}` as any)}
              >
                <View style={[styles.kycAvatar, { backgroundColor: Colors.warning + '20' }]}>
                  <Text style={styles.kycInitials}>
                    {member.firstName?.[0] ?? '?'}{member.lastName?.[0] ?? '?'}
                  </Text>
                </View>
                <View style={styles.kycInfo}>
                  <Text style={styles.kycName}>{member.firstName ?? 'Unknown'} {member.lastName ?? 'Member'}</Text>
                  <Text style={styles.kycEmail}>{member.email}</Text>
                </View>
                <View style={[
                  styles.kycBadge,
                  member.kycStatus === 'in_review' ? styles.inReview : styles.pendingBadge,
                ]}>
                  <Text style={styles.kycBadgeText}>
                    {member.kycStatus === 'in_review' ? 'In Review' : 'Pending'}
                  </Text>
                </View>
                <ChevronRight size={16} color={Colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitle}>
              <Clock size={16} color={Colors.primary} />
              <Text style={styles.sectionTitleText}>Recent Transactions</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/admin/transactions' as any)}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          {recentTransactions.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No transactions yet</Text>
            </View>
          )}
          {recentTransactions.map((tx: any) => (
            <View key={tx.id} style={styles.txRow}>
              <View style={[styles.txIconWrap, {
                backgroundColor: tx.type === 'deposit' ? Colors.positive + '15'
                  : tx.type === 'withdrawal' ? Colors.negative + '15'
                  : tx.type === 'buy' ? Colors.primary + '15'
                  : Colors.accent + '15',
              }]}>
                {getTransactionIcon(tx.type)}
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txUser} numberOfLines={1}>{tx.userId}</Text>
                <Text style={styles.txDesc} numberOfLines={1}>{tx.description || tx.type}</Text>
                <Text style={styles.txDate}>{formatDate(tx.createdAt)}</Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[
                  styles.txAmount,
                  tx.amount > 0 ? { color: Colors.positive } : { color: Colors.negative },
                ]}>
                  {tx.amount > 0 ? '+' : ''}{formatCurrency(Math.abs(tx.amount))}
                </Text>
                <View style={[
                  styles.txStatus,
                  tx.status === 'completed' ? styles.txDone
                    : tx.status === 'pending' ? styles.txPend
                    : styles.txFail,
                ]}>
                  <Text style={styles.txStatusText}>{tx.status}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitle}>
              <Target size={16} color="#E91E63" />
              <Text style={styles.sectionTitleText}>Lead Intelligence</Text>
              {leadsStats && (
                <View style={[styles.badge, { backgroundColor: '#E91E6325' }]}>
                  <Text style={[styles.badgeText, { color: '#E91E63' }]}>{leadsStats.totalSignups}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={() => router.push('/admin/lead-intelligence' as any)}>
              <Text style={styles.seeAll}>View All</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.leadsHeroCard}
            onPress={() => router.push('/admin/lead-intelligence' as any)}
            activeOpacity={0.85}
          >
            <View style={styles.leadsHeroTop}>
              <View style={styles.leadsHeroIconWrap}>
                <Zap size={22} color="#fff" />
              </View>
              <View style={styles.leadsHeroInfo}>
                <Text style={styles.leadsHeroLabel}>TOTAL LEADS</Text>
                <Text style={styles.leadsHeroValue}>{leadsStats?.totalSignups ?? '—'}</Text>
              </View>
              <View style={styles.leadsHeroBreakdown}>
                <View style={styles.leadsHeroBreakdownItem}>
                  <View style={[styles.leadsHeroDot, { backgroundColor: '#00C48C' }]} />
                  <Text style={styles.leadsHeroBreakdownText}>{leadsStats?.totalUsers ?? 0} Registered</Text>
                </View>
                <View style={styles.leadsHeroBreakdownItem}>
                  <View style={[styles.leadsHeroDot, { backgroundColor: '#F57C00' }]} />
                  <Text style={styles.leadsHeroBreakdownText}>{leadsStats?.totalWaitlist ?? 0} Waitlist</Text>
                </View>
              </View>
            </View>
            <View style={styles.leadsKpiRow}>
              <View style={styles.leadsKpiItem}>
                <Mail size={12} color="#4A90D9" />
                <Text style={styles.leadsKpiValue}>{leadsStats?.withEmail ?? 0}</Text>
                <Text style={styles.leadsKpiLabel}>Emails</Text>
              </View>
              <View style={styles.leadsKpiDivider} />
              <View style={styles.leadsKpiItem}>
                <Phone size={12} color="#00C48C" />
                <Text style={styles.leadsKpiValue}>{leadsStats?.withPhone ?? 0}</Text>
                <Text style={styles.leadsKpiLabel}>Phones</Text>
              </View>
              <View style={styles.leadsKpiDivider} />
              <View style={styles.leadsKpiItem}>
                <Globe size={12} color="#7B61FF" />
                <Text style={styles.leadsKpiValue}>{leadsStats?.byCountry?.length ?? 0}</Text>
                <Text style={styles.leadsKpiLabel}>Countries</Text>
              </View>
            </View>
          </TouchableOpacity>

          {recentLeads.length > 0 && (
            <View style={styles.recentLeadsList}>
              {recentLeads.slice(0, 5).map((lead: any) => (
                <View key={lead.id} style={styles.recentLeadRow}>
                  <View style={[styles.recentLeadAvatar, { backgroundColor: lead.type === 'user' ? '#00C48C18' : '#F57C0018' }]}>
                    <Text style={[styles.recentLeadInitials, { color: lead.type === 'user' ? '#00C48C' : '#F57C00' }]}>
                      {lead.firstName?.charAt(0) ?? ''}{lead.lastName?.charAt(0) ?? ''}
                    </Text>
                  </View>
                  <View style={styles.recentLeadInfo}>
                    <Text style={styles.recentLeadName} numberOfLines={1}>{lead.firstName} {lead.lastName}</Text>
                    <Text style={styles.recentLeadEmail} numberOfLines={1}>{lead.email}</Text>
                  </View>
                  <View style={[styles.recentLeadTypeBadge, { backgroundColor: lead.type === 'user' ? '#00C48C18' : '#F57C0018' }]}>
                    <Text style={[styles.recentLeadTypeText, { color: lead.type === 'user' ? '#00C48C' : '#F57C00' }]}>
                      {lead.type === 'user' ? 'Registered' : 'Waitlist'}
                    </Text>
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={styles.viewAllLeadsBtn}
                onPress={() => router.push('/admin/lead-intelligence' as any)}
                activeOpacity={0.8}
              >
                <Text style={styles.viewAllLeadsBtnText}>Open Lead Intelligence</Text>
                <ChevronRight size={14} color="#E91E63" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.quickLinks}>
          <Text style={styles.quickLinksTitle}>Quick Actions</Text>
          <View style={styles.quickGrid}>
            {[
              { label: 'Leads', route: '/admin/lead-intelligence', icon: Target, color: '#E91E63' },
              { label: 'Members', route: '/admin/members', icon: Users, color: Colors.primary },
              { label: 'Transactions', route: '/admin/transactions', icon: ArrowLeftRight, color: Colors.accent },
              { label: 'Properties', route: '/admin/properties', icon: Building2, color: Colors.positive },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <TouchableOpacity
                  key={item.route}
                  style={styles.quickCard}
                  onPress={() => router.push(item.route as any)}
                >
                  <View style={[styles.quickIcon, { backgroundColor: item.color + '20' }]}>
                    <Icon size={20} color={item.color} />
                  </View>
                  <Text style={styles.quickLabel}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.positive + '15',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.positive,
  },
  liveText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.positive,
  },
  scroll: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  heroRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  heroCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
  },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.6)',
    marginBottom: 4,
  },
  heroValue: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.background,
    marginBottom: 2,
  },
  heroSub: {
    fontSize: 11,
    color: 'rgba(0,0,0,0.5)',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  statCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  statVal: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  statLbl: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginBottom: 6,
  },
  statFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  statSub: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  metricsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  metricDivider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  metricLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sectionTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  badge: {
    backgroundColor: Colors.warning + '25',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.warning,
  },
  seeAll: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kpiCard: {
    width: '48%' as any,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  kpiName: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  kpiChange: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  kpiUp: {
    backgroundColor: Colors.positive + '20',
  },
  kpiDown: {
    backgroundColor: Colors.negative + '20',
  },
  kpiChangeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  kpiUpText: {
    color: Colors.positive,
  },
  kpiDownText: {
    color: Colors.negative,
  },
  healthBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  healthGood: {
    backgroundColor: Colors.positive + '20',
  },
  healthBad: {
    backgroundColor: Colors.negative + '20',
  },
  healthBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.positive,
    textTransform: 'capitalize',
  },
  servicesGrid: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serviceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serviceUp: {
    backgroundColor: Colors.positive,
  },
  serviceDown: {
    backgroundColor: Colors.negative,
  },
  serviceName: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
    fontWeight: '500',
  },
  serviceTime: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '600',
  },
  healthMetrics: {
    flexDirection: 'row',
    marginTop: 8,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  healthMetricItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  healthMetricVal: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  healthMetricLbl: {
    fontSize: 9,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  retentionGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  retentionCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  retentionLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  retentionValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  churnRow: {
    flexDirection: 'row',
    marginTop: 8,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  churnItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  churnLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
  },
  churnValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  investGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  investCard: {
    width: '48%' as any,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  investLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  investValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  kycRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  kycAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kycInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warning,
  },
  kycInfo: {
    flex: 1,
  },
  kycName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
  kycEmail: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  kycBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  inReview: {
    backgroundColor: Colors.accent + '20',
  },
  pendingBadge: {
    backgroundColor: Colors.warning + '20',
  },
  kycBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.text,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  txIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txUser: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
  txDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  txDate: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  txRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  txAmount: {
    fontSize: 13,
    fontWeight: '700',
  },
  txStatus: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  txDone: {
    backgroundColor: Colors.positive + '20',
  },
  txPend: {
    backgroundColor: Colors.warning + '20',
  },
  txFail: {
    backgroundColor: Colors.negative + '20',
  },
  txStatusText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.text,
    textTransform: 'capitalize',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  quickLinks: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  quickLinksTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  quickCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  leadsHeroCard: {
    backgroundColor: '#1B1040',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E91E6320',
  },
  leadsHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  leadsHeroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: '#E91E6330',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadsHeroInfo: {
    flex: 1,
  },
  leadsHeroLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
  },
  leadsHeroValue: {
    fontSize: 32,
    fontWeight: '900' as const,
    color: '#fff',
    marginTop: 1,
  },
  leadsHeroBreakdown: {
    gap: 5,
  },
  leadsHeroBreakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leadsHeroDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  leadsHeroBreakdownText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600' as const,
  },
  leadsKpiRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingVertical: 12,
  },
  leadsKpiItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  leadsKpiValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#fff',
  },
  leadsKpiLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '600' as const,
  },
  leadsKpiDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  recentLeadsList: {
    marginTop: 10,
    gap: 6,
  },
  recentLeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  recentLeadAvatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentLeadInitials: {
    fontSize: 12,
    fontWeight: '800' as const,
  },
  recentLeadInfo: {
    flex: 1,
  },
  recentLeadName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  recentLeadEmail: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  recentLeadTypeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recentLeadTypeText: {
    fontSize: 9,
    fontWeight: '700' as const,
  },
  viewAllLeadsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#E91E6310',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E91E6320',
    marginTop: 4,
  },
  viewAllLeadsBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#E91E63',
  },
  bottomPad: {
    height: 100,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 6,
    backgroundColor: Colors.border,
    width: '80%',
    marginTop: 10,
  },
});