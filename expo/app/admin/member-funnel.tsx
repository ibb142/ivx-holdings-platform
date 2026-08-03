/**
 * Admin — Two-Stage Member & Investor Funnel Dashboard.
 *
 * Segments: members, investors pending, verified investors, buyers,
 * JV partners, brokers, agents, land owners + AI-reviewed application
 * pipeline. Conversion analytics: Visitor → Member → Investor Application
 * → Verified Investor → Investment Made, with rate at every step.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Clock,
  BadgeCheck,
  Home,
  Handshake,
  Briefcase,
  UserCheck,
  Trees,
  ArrowDown,
  Sparkles} from 'lucide-react-native';
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { assertOwnerSessionAccessToken } from '@/src/modules/ivx-owner-ai/services/ownerSessionPreflight';

const GOLD = '#FFD700';
const BG = '#000000';
const CARD = '#141414';
const BORDER = '#2A2A2A';
const TEXT = '#FFFFFF';
const SUB = '#909090';
const GREEN = '#00C48C';

interface FunnelDashboard {
  generatedAt: string;
  segments: {
    totalMembers: number;
    freeMembers: number;
    investorsPending: number;
    investorsVerified: number;
    buyers: number;
    jvPartners: number;
    brokers: number;
    agents: number;
    landOwners: number;
    manualReview: number;
  };
  funnel: {
    visitors: number;
    members: number;
    investorApplications: number;
    verifiedInvestors: number;
    investmentsMade: number;
    conversionRates: {
      visitorToMember: number | null;
      memberToApplication: number | null;
      applicationToVerified: number | null;
      verifiedToInvestment: number | null;
    };
  };
}

interface AdminApplication {
  applicationId: string;
  userId: string;
  status: string;
  investmentRange: string;
  accreditedInvestor: boolean;
  interests: string[];
  zipCodes: string[];
  aiScore: number | null;
  aiReasons: string[];
  matchCount: number;
  alertCount: number;
  submittedAt: string;
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

export default function MemberFunnelScreen() {
  const dashboardQuery = useQuery({
    queryKey: ['member-admin-dashboard'],
    queryFn: async (): Promise<FunnelDashboard> => {
      const payload = await ownerGet('/api/ivx/member-admin/dashboard');
      return payload.dashboard as unknown as FunnelDashboard;
    }});

  const applicationsQuery = useQuery({
    queryKey: ['member-admin-applications'],
    queryFn: async (): Promise<AdminApplication[]> => {
      const payload = await ownerGet('/api/ivx/member-admin/investors');
      return Array.isArray(payload.applications)
        ? (payload.applications as AdminApplication[])
        : [];
    }});

  const dashboard = dashboardQuery.data;
  const applications = applicationsQuery.data ?? [];
  const isRefreshing = dashboardQuery.isFetching || applicationsQuery.isFetching;

  const refresh = () => {
    void dashboardQuery.refetch();
    void applicationsQuery.refetch();
  };

  const segments = dashboard?.segments;
  const funnel = dashboard?.funnel;

  const segmentTiles: { label: string; value: number; icon: React.ReactNode }[] = segments
    ? [
        { label: 'Members', value: segments.totalMembers, icon: <Users size={18} color={GOLD} /> },
        { label: 'Investors Pending', value: segments.investorsPending, icon: <Clock size={18} color={GOLD} /> },
        { label: 'Verified Investors', value: segments.investorsVerified, icon: <BadgeCheck size={18} color={GREEN} /> },
        { label: 'Buyers', value: segments.buyers, icon: <Home size={18} color={GOLD} /> },
        { label: 'JV Partners', value: segments.jvPartners, icon: <Handshake size={18} color={GOLD} /> },
        { label: 'Brokers', value: segments.brokers, icon: <Briefcase size={18} color={GOLD} /> },
        { label: 'Agents', value: segments.agents, icon: <UserCheck size={18} color={GOLD} /> },
        { label: 'Land Owners', value: segments.landOwners, icon: <Trees size={18} color={GOLD} /> },
      ]
    : [];

  const funnelSteps: { label: string; value: number; rate: number | null }[] = funnel
    ? [
        { label: 'Visitor', value: funnel.visitors, rate: null },
        { label: 'Member', value: funnel.members, rate: funnel.conversionRates.visitorToMember },
        { label: 'Investor Application', value: funnel.investorApplications, rate: funnel.conversionRates.memberToApplication },
        { label: 'Verified Investor', value: funnel.verifiedInvestors, rate: funnel.conversionRates.applicationToVerified },
        { label: 'Investment Made', value: funnel.investmentsMade, rate: funnel.conversionRates.verifiedToInvestment },
      ]
    : [];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Member Funnel', headerShown: true }} />
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl tintColor={GOLD} refreshing={isRefreshing} onRefresh={refresh} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Two-Stage Member System</Text>
        <Text style={styles.sub}>
          Phase 1 free members → Phase 2 verified investors, with AI review and matching.
        </Text>

        {dashboardQuery.isError && (
          <TouchableOpacity style={styles.errorBox} onPress={refresh}>
            <Text style={styles.errorText}>
              {(dashboardQuery.error as Error)?.message || 'Failed to load. Tap to retry.'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Segments */}
        <View style={styles.tileGrid}>
          {segmentTiles.map((tile) => (
            <View key={tile.label} style={styles.tile}>
              {tile.icon}
              <Text style={styles.tileValue}>{tile.value}</Text>
              <Text style={styles.tileLabel}>{tile.label}</Text>
            </View>
          ))}
        </View>

        {/* Conversion Funnel */}
        {funnel && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Conversion Analytics</Text>
            {funnelSteps.map((step, idx) => {
              const maxValue = Math.max(1, ...funnelSteps.map((s) => s.value));
              const widthPct = Math.max(8, Math.round((step.value / maxValue) * 100));
              return (
                <View key={step.label}>
                  {idx > 0 && (
                    <View style={styles.funnelArrowRow}>
                      <ArrowDown size={14} color={SUB} />
                      <Text style={styles.funnelRate}>
                        {step.rate === null ? '—' : `${step.rate}% conversion`}
                      </Text>
                    </View>
                  )}
                  <View style={styles.funnelRow}>
                    <View style={[styles.funnelBar, { width: `${widthPct}%` as const }]} />
                    <View style={styles.funnelTextRow}>
                      <Text style={styles.funnelLabel}>{step.label}</Text>
                      <Text style={styles.funnelValue}>{step.value}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Application pipeline */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Investor Applications ({applications.length})</Text>
          {applications.length === 0 && (
            <Text style={styles.emptyText}>
              No investor applications yet. They appear here the moment a member taps
              &quot;Become an Investor&quot;.
            </Text>
          )}
          {applications.map((app) => (
            <View key={app.applicationId} style={styles.appRow}>
              <View style={styles.appHeader}>
                <View
                  style={[
                    styles.statusBadge,
                    app.status === 'investor_verified' && styles.statusBadgeVerified,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      app.status === 'investor_verified' && styles.statusBadgeTextVerified,
                    ]}
                  >
                    {app.status.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>
                {app.aiScore !== null && (
                  <View style={styles.scoreRow}>
                    <Sparkles size={12} color={GOLD} />
                    <Text style={styles.scoreText}>AI {app.aiScore}/100</Text>
                  </View>
                )}
              </View>
              <Text style={styles.appMeta}>
                Range {app.investmentRange.toUpperCase().replace('_PLUS', '+')} ·{' '}
                {app.accreditedInvestor ? 'Accredited' : 'Non-accredited'} ·{' '}
                {app.matchCount} matches · {app.alertCount} alerts
              </Text>
              {app.interests.length > 0 && (
                <Text style={styles.appMetaDim}>Interests: {app.interests.join(', ')}</Text>
              )}
              {app.zipCodes.length > 0 && (
                <Text style={styles.appMetaDim}>ZIPs: {app.zipCodes.join(', ')}</Text>
              )}
              {app.aiReasons.length > 0 && (
                <Text style={styles.appReason}>{app.aiReasons[0]}</Text>
              )}
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1, paddingHorizontal: 16 },
  heading: { fontSize: 24, fontWeight: '800' as const, color: TEXT, marginTop: 16 },
  sub: { fontSize: 13, color: SUB, marginTop: 4, marginBottom: 16, lineHeight: 18 },

  errorBox: {
    backgroundColor: '#2A1212',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5A2A2A',
    padding: 12,
    marginBottom: 12},
  errorText: { color: '#F87171', fontSize: 13 },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '31%' as const,
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    alignItems: 'flex-start',
    gap: 4},
  tileValue: { fontSize: 20, fontWeight: '800' as const, color: TEXT },
  tileLabel: { fontSize: 10, color: SUB, fontWeight: '600' as const },

  card: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginTop: 16},
  cardTitle: { fontSize: 16, fontWeight: '800' as const, color: TEXT, marginBottom: 14 },

  funnelRow: {
    height: 40,
    borderRadius: 8,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden' as const,
    justifyContent: 'center'},
  funnelBar: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,215,0,0.18)'},
  funnelTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12},
  funnelLabel: { fontSize: 13, fontWeight: '700' as const, color: TEXT },
  funnelValue: { fontSize: 13, fontWeight: '800' as const, color: GOLD },
  funnelArrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 12},
  funnelRate: { fontSize: 11, color: SUB, fontWeight: '600' as const },

  emptyText: { fontSize: 13, color: SUB, lineHeight: 19 },

  appRow: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingVertical: 12,
    gap: 4},
  appHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: {
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3},
  statusBadgeVerified: { backgroundColor: 'rgba(34,197,94,0.14)' },
  statusBadgeText: { fontSize: 10, fontWeight: '800' as const, color: GOLD, letterSpacing: 0.6 },
  statusBadgeTextVerified: { color: GREEN },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scoreText: { fontSize: 11, fontWeight: '700' as const, color: GOLD },
  appMeta: { fontSize: 12, color: TEXT, fontWeight: '600' as const },
  appMetaDim: { fontSize: 11, color: SUB },
  appReason: { fontSize: 11, color: SUB, fontStyle: 'italic' as const }});
