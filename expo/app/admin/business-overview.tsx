/**
 * Admin Business Overview — protected internal metrics dashboard.
 *
 * Shows global business counts that must NOT appear on the normal Home screen:
 *   - total members, verified members
 *   - total investors, active investors
 *   - live deals, draft deals, funded deals
 *   - capital raised
 *   - annualized return metrics
 *   - pending registrations, pending KYC
 *   - failed uploads, system health, API health, storage usage
 *
 * Access requires authenticated session + owner/admin role (enforced by admin/_layout.tsx).
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Users,
  BadgeCheck,
  TrendingUp,
  Building2,
  FileEdit,
  DollarSign,
  BarChart3,
  Brain,
  Clock,
  AlertCircle,
  Activity,
  Server,
  HardDrive,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { formatCurrencyCompact } from '@/lib/formatters';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAdminMemberRegistry } from '@/lib/member-registry';
import { useScreenFocusState } from '@/hooks/useScreenFocusState';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const REFRESH_MS = 1000 * 60 * 2;

interface BusinessOverviewData {
  totalMembers: number;
  verifiedMembers: number;
  totalInvestors: number;
  activeInvestors: number;
  liveDeals: number;
  draftDeals: number;
  fundedDeals: number;
  totalDeals: number;
  activeOpportunities: number;
  capitalRaised: number;
  annualizedReturn: string;
  pendingRegistrations: number;
  pendingKyc: number;
  failedUploads: number;
  systemHealth: 'healthy' | 'degraded' | 'down';
  apiHealth: 'healthy' | 'degraded' | 'down';
  storageUsage: string;
}

function MetricTile({
  icon,
  label,
  value,
  tint = Colors.primary,
  isLoading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tint?: string;
  isLoading?: boolean;
}) {
  return (
    <View style={[styles.tile, { borderColor: tint + '30' }]}>
      <View style={[styles.tileIcon, { backgroundColor: tint + '15' }]}>
        {icon}
      </View>
      {isLoading ? (
        <ActivityIndicator size="small" color={tint} style={styles.tileLoader} />
      ) : (
        <Text style={[styles.tileValue, { color: tint }]}>{value}</Text>
      )}
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function HealthBadge({ status }: { status: 'healthy' | 'degraded' | 'down' }) {
  const colors = {
    healthy: Colors.success ?? '#22c55e',
    degraded: '#f59e0b',
    down: Colors.error ?? '#ef4444',
  };
  const labels = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down' };
  return (
    <View style={[styles.healthBadge, { backgroundColor: colors[status] + '20' }]}>
      <View style={[styles.healthDot, { backgroundColor: colors[status] }]} />
      <Text style={[styles.healthText, { color: colors[status] }]}>{labels[status]}</Text>
    </View>
  );
}

export default function BusinessOverviewScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isScreenFocused = useScreenFocusState(true);

  const overviewQuery = useQuery<BusinessOverviewData>({
    queryKey: ['admin-business-overview'],
    queryFn: async () => {
      // Fetch member registry stats
      const members = await fetchAdminMemberRegistry();
      const totalMembers = members.length;
      const verifiedMembers = members.filter(
        (m) => m.kycStatus === 'approved' || m.kycStatus === 'verified'
      ).length;
      const totalInvestors = members.filter((m) =>
        (m.role || '').toLowerCase().includes('investor')
      ).length;
      const activeInvestors = members.filter(
        (m) => (m.role || '').toLowerCase().includes('investor') && (m.status || 'active') === 'active'
      ).length;
      const pendingKyc = members.filter(
        (m) => m.kycStatus === 'pending' || m.kycStatus === 'in_review'
      ).length;

      // Fetch deal counts from Supabase
      let liveDeals = 0;
      let draftDeals = 0;
      let fundedDeals = 0;
      try {
        const { data: deals } = await supabase
          .from('jv_deals')
          .select('id, status, published')
          .eq('published', true);
        let totalDeals = 0;
        let activeOpportunities = 0;
        if (Array.isArray(deals)) {
          totalDeals = deals.length;
          activeOpportunities = deals.filter((d) => {
            const status = (d as { status?: string }).status;
            return status !== 'trashed' && status !== 'archived' && status !== 'permanently_deleted';
          }).length;
          liveDeals = deals.filter((d) => (d as { status?: string }).status === 'live').length;
          draftDeals = deals.filter((d) => (d as { status?: string }).status === 'draft').length;
          fundedDeals = deals.filter((d) => (d as { status?: string }).status === 'funded').length;
        }
      } catch (e) {
        console.log('[BusinessOverview] Deal count fetch note:', (e as Error)?.message);
      }

      // Fetch pending registrations
      let pendingRegistrations = 0;
      try {
        const { count } = await supabase
          .from('signups')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
        pendingRegistrations = count || 0;
      } catch {}

      // Fetch capital raised from transactions
      let capitalRaised = 0;
      try {
        const { data: txData } = await supabase
          .from('transactions')
          .select('amount, type')
          .eq('type', 'deposit');
        if (Array.isArray(txData)) {
          capitalRaised = txData.reduce((sum, t) => sum + (Number((t as { amount?: number }).amount) || 0), 0);
        }
      } catch {}

      // Check API health
      let apiHealth: 'healthy' | 'degraded' | 'down' = 'down';
      try {
        const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          apiHealth = data?.status === 'healthy' ? 'healthy' : 'degraded';
        }
      } catch {
        apiHealth = 'down';
      }

      // Check failed uploads
      let failedUploads = 0;
      try {
        const { count: failCount } = await supabase
          .from('videos')
          .select('*', { count: 'exact', head: true })
          .eq('playback_status', 'failed');
        failedUploads = failCount || 0;
      } catch {}

      // Storage usage (approximate from video count)
      let storageUsage = '—';
      try {
        const { count: videoCount } = await supabase
          .from('videos')
          .select('*', { count: 'exact', head: true });
        storageUsage = `${videoCount || 0} videos`;
      } catch {}

      return {
        totalMembers,
        verifiedMembers,
        totalInvestors,
        activeInvestors,
        liveDeals,
        draftDeals,
        fundedDeals,
        totalDeals,
        activeOpportunities,
        capitalRaised,
        annualizedReturn: 'Up to 22%',
        pendingRegistrations,
        pendingKyc,
        failedUploads,
        systemHealth: apiHealth === 'healthy' ? 'healthy' : apiHealth === 'degraded' ? 'degraded' : 'down',
        apiHealth,
        storageUsage,
      };
    },
    staleTime: REFRESH_MS,
    refetchInterval: isScreenFocused ? REFRESH_MS : false,
    retry: 1,
  });

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin-business-overview'] });
  }, [queryClient]);

  const data = overviewQuery.data;
  const isLoading = overviewQuery.isLoading && !data;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Business Overview</Text>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={overviewQuery.isRefetching} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {/* Members Section */}
        <Text style={styles.sectionTitle}>Members</Text>
        <View style={styles.grid}>
          <MetricTile
            icon={<Users size={18} color={Colors.primary} />}
            label="Total Members"
            value={data?.totalMembers ?? 0}
            isLoading={isLoading}
            tint={Colors.primary}
          />
          <MetricTile
            icon={<BadgeCheck size={18} color={Colors.success ?? '#22c55e'} />}
            label="Verified Members"
            value={data?.verifiedMembers ?? 0}
            isLoading={isLoading}
            tint={Colors.success ?? '#22c55e'}
          />
        </View>

        {/* Investors Section */}
        <Text style={styles.sectionTitle}>Investors</Text>
        <View style={styles.grid}>
          <MetricTile
            icon={<TrendingUp size={18} color={Colors.accent ?? '#3b82f6'} />}
            label="Total Investors"
            value={data?.totalInvestors ?? 0}
            isLoading={isLoading}
            tint={Colors.accent ?? '#3b82f6'}
          />
          <MetricTile
            icon={<Activity size={18} color={Colors.success ?? '#22c55e'} />}
            label="Active Investors"
            value={data?.activeInvestors ?? 0}
            isLoading={isLoading}
            tint={Colors.success ?? '#22c55e'}
          />
        </View>

        {/* Activity Snapshot — moved from member Home screen to admin-only view */}
        <Text style={styles.sectionTitle}>Activity Snapshot</Text>
        <View style={styles.grid}>
          <MetricTile
            icon={<TrendingUp size={18} color={Colors.primary} />}
            label="Open Opportunities"
            value={data?.activeOpportunities ?? 0}
            isLoading={isLoading}
            tint={Colors.primary}
          />
          <MetricTile
            icon={<Building2 size={18} color={Colors.accent ?? '#3b82f6'} />}
            label="Available Deals"
            value={data?.totalDeals ?? 0}
            isLoading={isLoading}
            tint={Colors.accent ?? '#3b82f6'}
          />
          <TouchableOpacity
            style={styles.ctaTile}
            onPress={() => router.push('/(tabs)/portfolio' as any)}
            activeOpacity={0.8}
            testID="admin-portfolio-summary"
          >
            <View style={[styles.ctaTileIcon, { backgroundColor: Colors.primary + '15' }]}>
              <BarChart3 size={18} color={Colors.primary} />
            </View>
            <Text style={styles.ctaTileTitle}>Portfolio</Text>
            <Text style={styles.ctaTileSubtitle}>Track investments</Text>
            <ChevronRight size={14} color={Colors.textTertiary} style={styles.ctaTileArrow} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctaTile}
            onPress={() => router.push('/(tabs)/chat' as any)}
            activeOpacity={0.8}
            testID="admin-ai-advisor"
          >
            <View style={[styles.ctaTileIcon, { backgroundColor: (Colors.success ?? '#22c55e') + '15' }]}>
              <Brain size={18} color={Colors.success ?? '#22c55e'} />
            </View>
            <Text style={styles.ctaTileTitle}>AI Advisor</Text>
            <Text style={styles.ctaTileSubtitle}>Smart deal matching</Text>
            <ChevronRight size={14} color={Colors.textTertiary} style={styles.ctaTileArrow} />
          </TouchableOpacity>
        </View>

        {/* Deals Section */}
        <Text style={styles.sectionTitle}>Deals</Text>
        <View style={styles.grid}>
          <MetricTile
            icon={<Building2 size={18} color={Colors.primary} />}
            label="Live Deals"
            value={data?.liveDeals ?? 0}
            isLoading={isLoading}
            tint={Colors.primary}
          />
          <MetricTile
            icon={<FileEdit size={18} color="#f59e0b" />}
            label="Draft Deals"
            value={data?.draftDeals ?? 0}
            isLoading={isLoading}
            tint="#f59e0b"
          />
          <MetricTile
            icon={<DollarSign size={18} color={Colors.success ?? '#22c55e'} />}
            label="Funded Deals"
            value={data?.fundedDeals ?? 0}
            isLoading={isLoading}
            tint={Colors.success ?? '#22c55e'}
          />
          <MetricTile
            icon={<BarChart3 size={18} color={Colors.primary} />}
            label="Capital Raised"
            value={formatCurrencyCompact(data?.capitalRaised ?? 0)}
            isLoading={isLoading}
            tint={Colors.primary}
          />
        </View>

        {/* Returns */}
        <Text style={styles.sectionTitle}>Performance</Text>
        <View style={styles.grid}>
          <MetricTile
            icon={<TrendingUp size={18} color={Colors.success ?? '#22c55e'} />}
            label="Annualized Return"
            value={data?.annualizedReturn ?? '—'}
            isLoading={isLoading}
            tint={Colors.success ?? '#22c55e'}
          />
        </View>

        {/* Pending Items */}
        <Text style={styles.sectionTitle}>Pending</Text>
        <View style={styles.grid}>
          <MetricTile
            icon={<Clock size={18} color="#f59e0b" />}
            label="Pending Registrations"
            value={data?.pendingRegistrations ?? 0}
            isLoading={isLoading}
            tint="#f59e0b"
          />
          <MetricTile
            icon={<Clock size={18} color="#f59e0b" />}
            label="Pending KYC"
            value={data?.pendingKyc ?? 0}
            isLoading={isLoading}
            tint="#f59e0b"
          />
          <MetricTile
            icon={<AlertCircle size={18} color={Colors.error ?? '#ef4444'} />}
            label="Failed Uploads"
            value={data?.failedUploads ?? 0}
            isLoading={isLoading}
            tint={Colors.error ?? '#ef4444'}
          />
        </View>

        {/* System Health */}
        <Text style={styles.sectionTitle}>System Health</Text>
        <View style={styles.healthRow}>
          <View style={styles.healthCard}>
            <View style={styles.healthCardHeader}>
              <Server size={16} color={Colors.textSecondary} />
              <Text style={styles.healthCardLabel}>API Health</Text>
            </View>
            <HealthBadge status={data?.apiHealth ?? 'down'} />
          </View>
          <View style={styles.healthCard}>
            <View style={styles.healthCardHeader}>
              <Activity size={16} color={Colors.textSecondary} />
              <Text style={styles.healthCardLabel}>System</Text>
            </View>
            <HealthBadge status={data?.systemHealth ?? 'down'} />
          </View>
          <View style={styles.healthCard}>
            <View style={styles.healthCardHeader}>
              <HardDrive size={16} color={Colors.textSecondary} />
              <Text style={styles.healthCardLabel}>Storage</Text>
            </View>
            <Text style={styles.healthCardValue}>{data?.storageUsage ?? '—'}</Text>
          </View>
        </View>

        <View style={{ height: 60 }} />
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    marginLeft: 12,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success ?? '#22c55e',
  },
  liveText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  scroll: {
    flex: 1,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 20,
  },
  tile: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    gap: 6,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  tileValue: {
    fontSize: 24,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  tileLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  tileLoader: {
    marginVertical: 6,
  },
  healthRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
  },
  healthCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
  },
  healthCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  healthCardLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  healthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  healthText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  healthCardValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  ctaTile: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    gap: 6,
  },
  ctaTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  ctaTileTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  ctaTileSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  ctaTileArrow: {
    position: 'absolute',
    right: 12,
    top: 14,
  },
});
