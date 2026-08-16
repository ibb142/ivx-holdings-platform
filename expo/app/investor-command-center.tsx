import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Activity, ArrowLeft, Bot, Building2, ChevronRight, DollarSign, Eye, Globe2, Handshake, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const CONTROL_PLANE_URL = `${API_BASE}/api/ivx/autonomous/control-plane`;
const INVESTOR_PERFORMANCE_URL = `${API_BASE}/api/ivx/investor-performance`;
const POLL_INTERVAL_MS = 10_000;

type LiveAgent = {
  id: string;
  agentNumber: number;
  name: string;
  role: string | null;
  functionalGroup: string;
  presence: string;
  operatingRegion: string;
  status: string;
  jobId: string | null;
  worker: {
    heartbeat: 'live' | 'stale' | 'none';
    lastHeartbeatAt: string | null;
    progressPercent: number | null;
    currentTask: string | null;
    stageDetail: string | null;
    workerStatus: string | null;
  };
};

type ControlPlane = {
  ok: boolean;
  generatedAt?: string;
  enterprise?: {
    expectedAgents: number;
    registered: number;
    heartbeating: number;
    activeJobs: number;
    lastHeartbeatAt: string | null;
    enabled: boolean;
    verifiedTotal: number;
    blocked: number;
    failed: number;
  };
  agents?: { total: number; verified: number; items: LiveAgent[] };
  certification?: { liveReady: boolean; campaignComplete: boolean; liveWorkforceObserved?: boolean };
  error?: string;
};

type InvestorPerformance = {
  ok: boolean;
  investedCapital: number;
  activeDealsCount: number;
  totalDistributions: number;
  unrealizedValue: number;
  realizedReturn: number;
  totalROI: number;
  lastActivityDate: string;
  error?: string;
  message?: string;
};

function money(value: number | undefined): string {
  if (!Number.isFinite(value)) return 'UNAVAILABLE';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value ?? 0);
}

function pct(value: number | undefined): string {
  if (!Number.isFinite(value)) return 'UNAVAILABLE';
  return `${(value ?? 0).toFixed(2)}%`;
}

function formatTime(value?: string | null): string {
  if (!value) return 'NO DATA';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <View style={styles.metricCard}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text>{sub ? <Text style={styles.metricSub}>{sub}</Text> : null}</View>;
}

function QuickLink({ title, subtitle, route, icon }: { title: string; subtitle: string; route: string; icon: React.ReactNode }) {
  const router = useRouter();
  return (
    <TouchableOpacity style={styles.linkCard} activeOpacity={0.8} onPress={() => router.push(route as never)}>
      <View style={styles.linkIcon}>{icon}</View>
      <View style={styles.linkText}><Text style={styles.linkTitle}>{title}</Text><Text style={styles.linkSubtitle}>{subtitle}</Text></View>
      <ChevronRight size={18} color="#94A3B8" />
    </TouchableOpacity>
  );
}

export default function InvestorCommandCenterScreen() {
  const router = useRouter();
  const [control, setControl] = useState<ControlPlane | null>(null);
  const [performance, setPerformance] = useState<InvestorPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await getIVXAccessToken();
      if (!token) throw new Error('Owner session required for enterprise presentation mode.');
      const headers = { Authorization: `Bearer ${token}` };
      const [controlResult, performanceResult] = await Promise.allSettled([
        fetch(CONTROL_PLANE_URL, { headers }),
        fetch(INVESTOR_PERFORMANCE_URL, { headers }),
      ]);
      let nextError: string | null = null;
      if (controlResult.status === 'fulfilled') {
        const json = await controlResult.value.json() as ControlPlane;
        if (controlResult.value.ok && json.ok) setControl(json);
        else nextError = json.error || `Autonomous control plane HTTP ${controlResult.value.status}`;
      } else nextError = 'Autonomous control plane unavailable.';
      if (performanceResult.status === 'fulfilled') {
        const json = await performanceResult.value.json() as InvestorPerformance;
        if (performanceResult.value.ok && json.ok) setPerformance(json);
        else nextError = nextError || json.message || json.error || `Investor performance HTTP ${performanceResult.value.status}`;
      } else nextError = nextError || 'Investor performance service unavailable.';
      setError(nextError);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load enterprise investor command center.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    pollRef.current = setInterval(() => void load(true), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const enterprise = control?.enterprise;
  const agents = useMemo(() => (control?.agents?.items || [])
    .slice()
    .sort((a, b) => Number(b.presence === 'WORKING') - Number(a.presence === 'WORKING'))
    .slice(0, 8), [control]);
  const systemState = !enterprise?.enabled ? 'OFFLINE' : (enterprise.failed || enterprise.blocked) > 0 ? 'DEGRADED' : enterprise.heartbeating > 0 ? 'ONLINE' : 'READY';

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#D4AF37" />}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}><ArrowLeft size={20} color="#E2E8F0" /></TouchableOpacity>
          <View style={styles.topTitleWrap}><Text style={styles.eyebrow}>IVX HOLDINGS</Text><Text style={styles.topTitle}>Enterprise Investor Command Center</Text></View>
          <TouchableOpacity onPress={() => void load(true)} style={styles.iconButton}><RefreshCw size={19} color="#D4AF37" /></TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroKicker}>LIVE BUSINESS OPERATING VIEW</Text>
          <Text style={styles.heroTitle}>Capital visibility + 112-IA autonomous execution.</Text>
          <Text style={styles.heroBody}>Read-only presentation mode powered by IVX production services. Actual values are displayed when available; missing values are never replaced with projections.</Text>
          <View style={styles.statusRow}><View style={[styles.statusDot, systemState === 'ONLINE' ? styles.statusLive : styles.statusWarn]} /><Text style={styles.statusText}>AUTONOMOUS SYSTEM: {systemState}</Text></View>
          <Text style={styles.timestamp}>Last worker heartbeat: {formatTime(enterprise?.lastHeartbeatAt)}</Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {loading && !control && !performance ? <Text style={styles.loadingText}>Loading verified enterprise data…</Text> : null}

        <Text style={styles.sectionTitle}>Autonomous Enterprise</Text>
        <View style={styles.grid}>
          <Metric label="Registered IA" value={enterprise ? `${enterprise.registered}/${enterprise.expectedAgents}` : '—'} />
          <Metric label="Heartbeating" value={enterprise?.heartbeating ?? '—'} />
          <Metric label="Active Jobs" value={enterprise?.activeJobs ?? '—'} />
          <Metric label="Verified IA" value={enterprise?.verifiedTotal ?? '—'} />
        </View>

        <Text style={styles.sectionTitle}>Capital & Investor Performance</Text>
        <View style={styles.grid}>
          <Metric label="Invested Capital" value={money(performance?.investedCapital)} />
          <Metric label="Active Deals" value={performance?.activeDealsCount ?? '—'} />
          <Metric label="Distributions" value={money(performance?.totalDistributions)} />
          <Metric label="Portfolio Value" value={money(performance?.unrealizedValue)} />
          <Metric label="Realized Return" value={money(performance?.realizedReturn)} />
          <Metric label="Portfolio ROI" value={pct(performance?.totalROI)} sub={performance?.lastActivityDate ? `Last activity ${formatTime(performance.lastActivityDate)}` : undefined} />
        </View>

        <Text style={styles.sectionTitle}>Live IA Activity</Text>
        <View style={styles.panel}>
          {agents.length === 0 ? <Text style={styles.emptyText}>No live worker telemetry reported at this moment.</Text> : agents.map((agent) => (
            <View key={agent.id} style={styles.agentRow}>
              <View style={[styles.agentDot, agent.worker.heartbeat === 'live' ? styles.agentLive : styles.agentIdle]} />
              <View style={styles.agentMain}>
                <Text style={styles.agentName}>IA-{String(agent.agentNumber).padStart(2, '0')} · {agent.name}</Text>
                <Text style={styles.agentMeta}>{agent.functionalGroup} · {agent.operatingRegion}</Text>
                <Text style={styles.agentTask} numberOfLines={2}>{agent.worker.currentTask || agent.worker.stageDetail || 'Standing by.'}</Text>
              </View>
              <View style={styles.agentRight}><Text style={styles.agentStatus}>{agent.presence}</Text><Text style={styles.agentProgress}>{agent.worker.progressPercent === null ? '—' : `${agent.worker.progressPercent}%`}</Text></View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Investor Experience</Text>
        <QuickLink title="Investor Performance" subtitle="Capital, distributions, ROI and deal-level activity" route="/investor-performance" icon={<TrendingUp size={22} color="#D4AF37" />} />
        <QuickLink title="Investment Marketplace" subtitle="Review currently available investment opportunities" route="/invest" icon={<Building2 size={22} color="#D4AF37" />} />
        <QuickLink title="JV Opportunities" subtitle="Joint-venture deal flow and participation" route="/jv-invest" icon={<Handshake size={22} color="#D4AF37" />} />
        <QuickLink title="Autonomous Control Tower" subtitle="Full owner view of all 112 IA, regions, jobs and heartbeat" route="/autonomous-dashboard" icon={<Bot size={22} color="#D4AF37" />} />
        <QuickLink title="Investor Presentation" subtitle="Full IVX enterprise pitch experience" route="/investor-pitch" icon={<Eye size={22} color="#D4AF37" />} />

        <View style={styles.panel}>
          <View style={styles.controlRow}><ShieldCheck size={19} color="#22C55E" /><Text style={styles.controlText}>Owner authority remains separate from autonomous analysis and execution.</Text></View>
          <View style={styles.controlRow}><Activity size={19} color="#38BDF8" /><Text style={styles.controlText}>IA status comes from runtime worker telemetry and heartbeat evidence.</Text></View>
          <View style={styles.controlRow}><Globe2 size={19} color="#34D399" /><Text style={styles.controlText}>Displayed IA location is operating jurisdiction/task scope, never fake physical GPS.</Text></View>
          <View style={styles.controlRow}><DollarSign size={19} color="#D4AF37" /><Text style={styles.controlText}>Capital figures come from the treasury/investor performance service.</Text></View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#07111F' }, scroll: { flex: 1 }, content: { padding: 18, paddingBottom: 48 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }, iconButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: '#23354A', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D1A2B' },
  topTitleWrap: { flex: 1 }, eyebrow: { color: '#D4AF37', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }, topTitle: { color: '#F8FAFC', fontSize: 19, fontWeight: '800', marginTop: 2 },
  hero: { backgroundColor: '#0B1828', borderRadius: 22, padding: 20, borderWidth: 1, borderColor: '#2B3E54', marginBottom: 18 }, heroKicker: { color: '#D4AF37', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 }, heroTitle: { color: '#F8FAFC', fontSize: 27, lineHeight: 33, fontWeight: '900', marginTop: 9 }, heroBody: { color: '#A7B4C5', fontSize: 14, lineHeight: 21, marginTop: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8 }, statusDot: { width: 9, height: 9, borderRadius: 5 }, statusLive: { backgroundColor: '#22C55E' }, statusWarn: { backgroundColor: '#F59E0B' }, statusText: { color: '#E2E8F0', fontSize: 12, fontWeight: '800' }, timestamp: { color: '#64748B', fontSize: 11, marginTop: 7 },
  errorText: { color: '#FCA5A5', backgroundColor: '#2A1117', borderWidth: 1, borderColor: '#5B202A', borderRadius: 12, padding: 12, marginBottom: 14 }, loadingText: { color: '#94A3B8', textAlign: 'center', paddingVertical: 14 }, sectionTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: '900', marginTop: 8, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 }, metricCard: { width: '48%', minHeight: 100, borderRadius: 16, padding: 14, backgroundColor: '#0D1A2B', borderWidth: 1, borderColor: '#22364B' }, metricValue: { color: '#D4AF37', fontSize: 22, fontWeight: '900' }, metricLabel: { color: '#E2E8F0', fontSize: 12, fontWeight: '700', marginTop: 6 }, metricSub: { color: '#64748B', fontSize: 10, lineHeight: 14, marginTop: 5 },
  panel: { backgroundColor: '#0D1A2B', borderRadius: 18, borderWidth: 1, borderColor: '#22364B', padding: 14, marginBottom: 18 }, emptyText: { color: '#94A3B8', paddingVertical: 12 }, agentRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#17283A' }, agentDot: { width: 9, height: 9, borderRadius: 5, marginTop: 6, marginRight: 10 }, agentLive: { backgroundColor: '#22C55E' }, agentIdle: { backgroundColor: '#64748B' }, agentMain: { flex: 1 }, agentName: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' }, agentMeta: { color: '#64748B', fontSize: 10, marginTop: 2 }, agentTask: { color: '#A7B4C5', fontSize: 11, lineHeight: 16, marginTop: 5 }, agentRight: { alignItems: 'flex-end', marginLeft: 10 }, agentStatus: { color: '#38BDF8', fontSize: 9, fontWeight: '900' }, agentProgress: { color: '#D4AF37', fontSize: 12, fontWeight: '800', marginTop: 4 },
  linkCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1A2B', borderRadius: 16, borderWidth: 1, borderColor: '#22364B', padding: 14, marginBottom: 9 }, linkIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#172234' }, linkText: { flex: 1, marginLeft: 12 }, linkTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' }, linkSubtitle: { color: '#7E8DA1', fontSize: 11, lineHeight: 15, marginTop: 3 },
  controlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9 }, controlText: { flex: 1, color: '#B6C2D0', fontSize: 12, lineHeight: 18 },
});
