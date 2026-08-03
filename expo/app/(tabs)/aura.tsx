/**
 * IVX Aura — Premium AI Executive Pulse
 *
 * Real-time, owner-gated executive dashboard that surfaces the health of the
 * IVX autonomous platform, AI assistant status, credentials posture, and
 * latest executive summary from production.
 *
 * Endpoints consumed:
 *   GET /api/ivx/owner-ai/status
 *   GET /api/ivx/autonomous/qa
 *   GET /api/ivx/autonomous/credentials
 *   GET /api/ivx/autonomous/runs/summary
 *   GET /api/ivx/executive-layer
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles,
  Brain,
  ShieldCheck,
  Activity,
  Cpu,
  TrendingUp,
  Zap,
  Lock,
  ChevronRight} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { AuraSkeleton } from '@/components/InstantSkeleton';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

const fetchWithAuth = async <T,>(url: string): Promise<T> => {
  const token = await getIVXAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json() as T;
};

type AuraPulse = {
  ai: { ok: boolean; provider?: string; configured?: boolean; model?: string; error?: string };
  qa: { ok: boolean; schedulerRunning?: boolean; totalRuns?: number; healthOk?: boolean; authOk?: boolean };
  credentials: { ok: boolean; certification?: string; verifiedCount?: number; blockedRequiredCount?: number };
  runs: { ok: boolean; totalRuns?: number; runsWithEvidence?: number; failedRuns?: number };
  executive: { ok: boolean; summary?: string; status?: string };
};

async function loadAuraPulse(): Promise<AuraPulse> {
  const [ai, qa, credentials, runs, executive] = await Promise.allSettled([
    fetchWithAuth<AuraPulse['ai']>(`${API_BASE}/api/ivx/owner-ai/status`),
    fetchWithAuth<AuraPulse['qa']>(`${API_BASE}/api/ivx/autonomous/qa`),
    fetchWithAuth<AuraPulse['credentials']>(`${API_BASE}/api/ivx/autonomous/credentials`),
    fetchWithAuth<AuraPulse['runs']>(`${API_BASE}/api/ivx/autonomous/runs/summary`),
    fetchWithAuth<AuraPulse['executive']>(`${API_BASE}/api/ivx/executive-layer`),
  ]);

  const unwrap = <T,>(p: PromiseSettledResult<T>, fallback: T): T =>
    p.status === 'fulfilled' ? p.value : fallback;

  return {
    ai: unwrap<{ ok: boolean; provider?: string; configured?: boolean; model?: string; error?: string }>(ai, { ok: false, error: 'AI status unavailable' }),
    qa: unwrap<{ ok: boolean; schedulerRunning?: boolean; totalRuns?: number; healthOk?: boolean; authOk?: boolean }>(qa, { ok: false }),
    credentials: unwrap<{ ok: boolean; certification?: string; verifiedCount?: number; blockedRequiredCount?: number }>(credentials, { ok: false }),
    runs: unwrap<{ ok: boolean; totalRuns?: number; runsWithEvidence?: number; failedRuns?: number }>(runs, { ok: false }),
    executive: unwrap<{ ok: boolean; summary?: string; status?: string }>(executive, { ok: false })};
}

function PulseCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  onPress}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  tone: 'gold' | 'green' | 'red' | 'blue';
  onPress?: () => void;
}) {
  const toneMap = {
    gold: { bg: 'rgba(230,194,0,0.12)', text: Colors.officialGold },
    green: { bg: 'rgba(0,196,140,0.12)', text: Colors.success },
    red: { bg: 'rgba(255,77,77,0.12)', text: Colors.error },
    blue: { bg: 'rgba(74,144,217,0.12)', text: Colors.info }};
  const t = toneMap[tone];
  const content = (
    <View style={[styles.card, { backgroundColor: t.bg }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: 'rgba(0,0,0,0.25)' }]}>
          <Icon color={t.text} size={22} strokeWidth={2.2} />
        </View>
        <Text style={[styles.cardLabel, { color: t.text }]}>{label}</Text>
      </View>
      <Text style={[styles.cardValue, { color: Colors.textWhite }]}>{value}</Text>
      <Text style={[styles.cardSub, { color: Colors.mutedGray }]}>{sub}</Text>
    </View>
  );
  if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.85}>{content}</TouchableOpacity>;
  return content;
}

export default function AuraScreen() {
  const router = useRouter();
  const { profileData } = useAuth();

  const isOwner = useMemo(() => {
    if (isOpenAccessModeEnabled()) return true;
    const role = ((profileData as { role?: string } | null)?.role ?? '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }, [profileData]);

  const pulseQuery = useQuery({
    queryKey: ['ivx-aura-pulse'],
    queryFn: loadAuraPulse,
    enabled: isOwner,
    staleTime: 1000 * 30,
    refetchOnWindowFocus: true});

  const data = pulseQuery.data;
  const isReady = pulseQuery.isSuccess && data;

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.restricted}>
          <View style={styles.restrictedIcon}>
            <Lock color={Colors.gold} size={30} strokeWidth={2.2} />
          </View>
          <Text style={styles.restrictedTitle}>Owner access only</Text>
          <Text style={styles.restrictedBody}>Aura is a premium executive dashboard reserved for the IVX owner.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={pulseQuery.isFetching}
            onRefresh={() => pulseQuery.refetch()}
            tintColor={Colors.gold}
          />
        }
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Sparkles color={Colors.officialGold} size={32} strokeWidth={2.2} />
          </View>
          <Text style={styles.heroTitle}>IVX Aura</Text>
          <Text style={styles.heroSubtitle}>Premium AI executive pulse</Text>
        </View>

        {pulseQuery.isLoading && !isReady && (
          <AuraSkeleton />
        )}

        {pulseQuery.isError && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Pulse unavailable</Text>
            <Text style={styles.errorBody}>
              {pulseQuery.error instanceof Error ? pulseQuery.error.message : 'Unknown error'}
            </Text>
          </View>
        )}

        {isReady && (
          <>
            <View style={styles.grid}>
              <PulseCard
                icon={Brain}
                label="IVX IA"
                value={data.ai.ok ? 'Online' : 'Offline'}
                sub={data.ai.ok ? `${data.ai.provider ?? 'AI'} • ${data.ai.model ?? 'ready'}` : data.ai.error ?? 'Check AI provider'}
                tone={data.ai.ok ? 'gold' : 'red'}
                onPress={() => router.push('/(tabs)/chat' as never)}
              />
              <PulseCard
                icon={Activity}
                label="QA Engine"
                value={data.qa.ok ? 'Healthy' : 'Degraded'}
                sub={data.qa.ok ? `${data.qa.totalRuns ?? 0} runs` : 'QA probe failed'}
                tone={data.qa.ok ? 'green' : 'red'}
              />
              <PulseCard
                icon={ShieldCheck}
                label="Credentials"
                value={data.credentials.ok ? 'Verified' : 'Blocked'}
                sub={data.credentials.ok ? `${data.credentials.verifiedCount ?? 0} verified` : 'Credential issue'}
                tone={data.credentials.ok ? 'green' : 'red'}
              />
              <PulseCard
                icon={Cpu}
                label="Autonomous Runs"
                value={data.runs.ok ? 'Live' : 'Paused'}
                sub={data.runs.ok ? `${data.runs.totalRuns ?? 0} total • ${data.runs.runsWithEvidence ?? 0} with evidence` : 'Runs unavailable'}
                tone={data.runs.ok ? 'blue' : 'red'}
                onPress={() => router.push('/autonomous-dashboard' as never)}
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Zap color={Colors.gold} size={18} strokeWidth={2.2} />
                <Text style={styles.sectionTitle}>Executive Summary</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryText}>
                  {data.executive.ok && data.executive.summary
                    ? data.executive.summary
                    : 'Executive summary is being generated. Pull down to refresh.'}
                </Text>
                {data.executive.ok && data.executive.status && (
                  <View style={styles.statusBadge}>
                    <TrendingUp color={Colors.success} size={14} strokeWidth={2.2} />
                    <Text style={styles.statusBadgeText}>{data.executive.status}</Text>
                  </View>
                )}
              </View>
            </View>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/(tabs)/chat' as never)}
              activeOpacity={0.85}
            >
              <Brain color={Colors.black} size={20} strokeWidth={2.2} />
              <Text style={styles.actionButtonText}>Open IVX IA Chat</Text>
              <ChevronRight color={Colors.black} size={20} strokeWidth={2.2} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  content: {
    padding: 20,
    paddingBottom: 120},
  hero: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 24},
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(230,194,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12},
  heroTitle: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.textWhite,
    letterSpacing: -0.5},
  heroSubtitle: {
    fontSize: 14,
    color: Colors.mutedGray,
    marginTop: 4},
  loading: {
    alignItems: 'center',
    marginTop: 40},
  loadingText: {
    color: Colors.mutedGray,
    marginTop: 12,
    fontSize: 14},
  errorCard: {
    backgroundColor: 'rgba(255,77,77,0.12)',
    borderRadius: 16,
    padding: 20,
    marginTop: 12},
  errorTitle: {
    color: Colors.error,
    fontSize: 16,
    fontWeight: '700' as const},
  errorBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 6},
  grid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between' as const,
    gap: 12,
    marginBottom: 24},
  card: {
    width: '48%',
    borderRadius: 16,
    padding: 16,
    minHeight: 130},
  cardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12},
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10},
  cardLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  cardValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    marginBottom: 6},
  cardSub: {
    fontSize: 12},
  section: {
    marginBottom: 20},
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 12},
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textWhite,
    marginLeft: 8},
  summaryCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  summaryText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 22},
  statusBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    marginTop: 14,
    backgroundColor: 'rgba(0,196,140,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20},
  statusBadgeText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '700' as const,
    marginLeft: 6},
  actionButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.gold,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 8},
  actionButtonText: {
    color: Colors.black,
    fontSize: 15,
    fontWeight: '700' as const,
    flex: 1,
    marginLeft: 10},
  restricted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32},
  restrictedIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(230,194,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16},
  restrictedTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.textWhite,
    marginBottom: 8},
  restrictedBody: {
    fontSize: 14,
    color: Colors.mutedGray,
    textAlign: 'center' as const}});
