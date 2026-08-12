/**
 * IVX Live Operations Center — Enterprise Dashboard (Phase 6).
 *
 * Central command center showing:
 *   - GitHub / Render / Supabase / Health status
 *   - Active deployments and commit chains
 *   - Enterprise agent status (14 agents)
 *   - Task queue and blockers
 *   - Global AI research findings
 *   - Business opportunities
 *   - Executive KPIs
 *   - Governance actions
 *   - Self-improvement tasks
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Brain,
  Briefcase,
  CheckCircle,
  ChevronRight,
  Clock,
  Cloud,
  Database,
  GitBranch,
  Globe,
  Lightbulb,
  RefreshCw,
  Search,
  Server,
  Shield,
  TrendingUp,
  Users,
  XCircle,
  Zap} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

// ── Types ──────────────────────────────────────────────────────────────────

type HealthStatus = 'healthy' | 'degraded' | 'unreachable' | 'stopped' | 'loading';

type DashboardData = {
  kpis: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    blockedTasks: number;
    pendingTasks: number;
    healthySubsystems: number;
    degradedSubsystems: number;
    unreachableSubsystems: number;
    cyclesRun: number;
  } | null;
  agents: Array<{ id: string; name: string; role: string; riskLevel: string; priority: string }> | null;
  research: { state: { totalFindings: number; runCount: number } | null; latestReport: { topOpportunities: Array<{ title: string }> } | null } | null;
  opportunities: { state: { totalDiscovered: number; activeOpportunities: number } | null; topOpportunities: Array<{ title: string; score: { totalScore: number } }> | null } | null;
  improvement: { openTasks: number } | null;
  governance: { state: { totalActions: number; pendingCount: number } | null } | null;
  memory: { state: { totalEntries: number } | null } | null;
  reports: { state: { totalReports: number } | null; latest: { summary: string } | null } | null;
};

// ── API helper ─────────────────────────────────────────────────────────────

const API_BASE = 'https://api.ivxholding.com';
const AUTH_HEADER = () => {
  // IVX owner token (Supabase JWT) — no Rork runtime dependency.
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.EXPO_PUBLIC_IVX_OWNER_TOKEN ?? ''}`};
};

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: AUTH_HEADER() });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 10;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20},
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center'},
  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,215,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center'},
  // KPIs row
  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    minWidth: (SCREEN_WIDTH - 48) / 2,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  kpiLabel: { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  kpiValue: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', marginTop: 4 },
  kpiSub: { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 },
  // Section
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center'},
  // Status card
  statusCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'},
  statusCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  statusIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statusName: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  statusDetail: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  // Agent card
  agentCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  agentName: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  agentRole: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  agentMeta: { flexDirection: 'row', gap: 8, marginTop: 8 },
  agentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 10,
    fontWeight: '600',
    overflow: 'hidden'},
  // Loading
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { color: 'rgba(255,255,255,0.4)', marginTop: 12, fontSize: 14 },
  // Error
  errorCard: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)'},
  errorText: { color: '#FF4D4D', fontSize: 13 },
  // Empty
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: 20 }});

// ── Health Badge ───────────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  healthy: { color: '#00C48C', bg: 'rgba(34,197,94,0.12)', label: 'Healthy' },
  degraded: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', label: 'Degraded' },
  unreachable: { color: '#FF4D4D', bg: 'rgba(239,68,68,0.12)', label: 'Unreachable' },
  stopped: { color: '#6366F1', bg: 'rgba(99,102,241,0.12)', label: 'Stopped' },
  loading: { color: '#9CA3AF', bg: 'rgba(156,163,175,0.12)', label: 'Loading...' }};

function HealthBadge({ status }: { status: HealthStatus }) {
  const config = HEALTH_CONFIG[status] ?? HEALTH_CONFIG.loading;
  return (
    <View style={[styles.agentBadge, { backgroundColor: config.bg }]}>
      <Text style={[styles.agentBadge, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

// ── Subsystem Status Card ──────────────────────────────────────────────────

function SubsystemCard({
  icon: Icon,
  name,
  detail,
  health,
  onPress}: {
  icon: typeof Activity;
  name: string;
  detail: string;
  health: HealthStatus;
  onPress?: () => void;
}) {
  const config = HEALTH_CONFIG[health] ?? HEALTH_CONFIG.loading;
  return (
    <TouchableOpacity style={styles.statusCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.statusCardLeft}>
        <View style={[styles.statusIcon, { backgroundColor: config.bg }]}>
          <Icon size={20} color={config.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusName}>{name}</Text>
          <Text style={styles.statusDetail}>{detail}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <HealthBadge status={health} />
        {onPress && <ChevronRight size={16} color="rgba(255,255,255,0.3)" />}
      </View>
    </TouchableOpacity>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function LiveOperationsCenter() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData>({
    kpis: null, agents: null, research: null, opportunities: null,
    improvement: null, governance: null, memory: null, reports: null});

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [kpis, agents, research, opportunities, improvement, governance, memory, reports] =
        await Promise.allSettled([
          fetchJSON<any>('/api/ivx/enterprise/kpis'),
          fetchJSON<any>('/api/ivx/enterprise/agents'),
          fetchJSON<any>('/api/ivx/enterprise/research'),
          fetchJSON<any>('/api/ivx/enterprise/opportunities'),
          fetchJSON<any>('/api/ivx/enterprise/improvement'),
          fetchJSON<any>('/api/ivx/enterprise/governance'),
          fetchJSON<any>('/api/ivx/enterprise/memory'),
          fetchJSON<any>('/api/ivx/enterprise/reports'),
        ]);

      setData({
        kpis: kpis.status === 'fulfilled' ? kpis.value : null,
        agents: agents.status === 'fulfilled' ? agents.value : null,
        research: research.status === 'fulfilled' ? research.value : null,
        opportunities: opportunities.status === 'fulfilled' ? opportunities.value : null,
        improvement: improvement.status === 'fulfilled' ? improvement.value : null,
        governance: governance.status === 'fulfilled' ? governance.value : null,
        memory: memory.status === 'fulfilled' ? memory.value : null,
        reports: reports.status === 'fulfilled' ? reports.value : null});
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load operations data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = useCallback(() => fetchAll(true), [fetchAll]);

  // ── Loading State ──────────────────────────────────────────────────────

  if (loading && !data.kpis) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <ShimmerIndicator size="large" color="#FFD700" />
          <Text style={styles.loadingText}>Loading Operations Center...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Compute derived values ─────────────────────────────────────────────

  const totalSubsystems = (data.kpis?.healthySubsystems ?? 0) +
    (data.kpis?.degradedSubsystems ?? 0) +
    (data.kpis?.unreachableSubsystems ?? 0);

  const overallHealth: HealthStatus = data.kpis
    ? data.kpis.unreachableSubsystems > 0
      ? 'degraded'
      : data.kpis.degradedSubsystems > 0
        ? 'degraded'
        : 'healthy'
    : 'loading';

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFD700" />
        }
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <ArrowLeft size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <View>
              <Text style={styles.title}>Live Operations Center</Text>
              <Text style={styles.subtitle}>Enterprise Command</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
            <RefreshCw size={18} color="#FFD700" />
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ── Executive KPIs ──────────────────────────────────────────── */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Cycles Run</Text>
            <Text style={styles.kpiValue}>{data.kpis?.cyclesRun ?? '—'}</Text>
            <Text style={styles.kpiSub}>orchestrator cycles</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Subsystems</Text>
            <Text style={styles.kpiValue}>
              {data.kpis ? `${data.kpis.healthySubsystems}/${totalSubsystems}` : '—'}
            </Text>
            <Text style={styles.kpiSub}>
              {data.kpis?.degradedSubsystems ?? 0} degraded
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Tasks</Text>
            <Text style={styles.kpiValue}>{data.kpis?.totalTasks ?? '—'}</Text>
            <Text style={styles.kpiSub}>
              {data.kpis?.completedTasks ?? 0} done · {data.kpis?.blockedTasks ?? 0} blocked
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Opportunities</Text>
            <Text style={styles.kpiValue}>{data.opportunities?.state?.totalDiscovered ?? '—'}</Text>
            <Text style={styles.kpiSub}>
              {data.opportunities?.state?.activeOpportunities ?? 0} active
            </Text>
          </View>
        </View>

        {/* ── Infrastructure Health ────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Server size={14} color="rgba(255,255,255,0.7)" />  Infrastructure
          </Text>
          <SubsystemCard
            icon={GitBranch}
            name="GitHub"
            detail={data.kpis ? `${data.kpis.completedTasks} completed tasks` : 'Checking...'}
            health={overallHealth}
          />
          <SubsystemCard
            icon={Cloud}
            name="Render"
            detail="Deployment pipeline"
            health={overallHealth}
          />
          <SubsystemCard
            icon={Database}
            name="Supabase"
            detail="Database & Auth"
            health={overallHealth}
          />
        </View>

        {/* ── Agent Fleet ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Users size={14} color="rgba(255,255,255,0.7)" />  Agent Fleet
            {data.agents && (
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: '400' }}>
                {' '}({data.agents.length})
              </Text>
            )}
          </Text>
          {data.agents ? (
            data.agents.slice(0, 6).map((agent) => (
              <View key={agent.id} style={styles.agentCard}>
                <Text style={styles.agentName}>{agent.name}</Text>
                <Text style={styles.agentRole}>{agent.role}</Text>
                <View style={styles.agentMeta}>
                  <View style={[styles.agentBadge, {
                    backgroundColor:
                      agent.riskLevel === 'high' ? 'rgba(239,68,68,0.15)' :
                      agent.riskLevel === 'medium' ? 'rgba(245,158,11,0.15)' :
                      'rgba(34,197,94,0.15)'}]}>
                    <Text style={[styles.agentBadge, {
                      color:
                        agent.riskLevel === 'high' ? '#FF4D4D' :
                        agent.riskLevel === 'medium' ? '#F59E0B' :
                        '#00C48C'}]}>
                      {agent.riskLevel.toUpperCase()}
                    </Text>
                  </View>
                  <View style={[styles.agentBadge, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
                    <Text style={[styles.agentBadge, { color: '#818CF8' }]}>
                      {agent.priority.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>Agent data unavailable</Text>
          )}
          {data.agents && data.agents.length > 6 && (
            <TouchableOpacity style={[styles.statusCard, { justifyContent: 'center' }]}>
              <Text style={{ color: '#FFD700', fontSize: 13, fontWeight: '600' }}>
                +{data.agents.length - 6} more agents
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── AI Research ──────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Brain size={14} color="rgba(255,255,255,0.7)" />  AI Research
          </Text>
          {data.research?.latestReport?.topOpportunities &&
           data.research.latestReport.topOpportunities.length > 0 ? (
            data.research.latestReport.topOpportunities.slice(0, 3).map((f, i) => (
              <View key={i} style={styles.agentCard}>
                <Text style={styles.agentName} numberOfLines={1}>{f.title}</Text>
                <Text style={styles.agentRole}>
                  {data.research?.state?.totalFindings ?? 0} total findings · {data.research?.state?.runCount ?? 0} cycles
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No research findings yet — run a research cycle</Text>
          )}
        </View>

        {/* ── Business Opportunities ───────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Briefcase size={14} color="rgba(255,255,255,0.7)" />  Opportunities
          </Text>
          {data.opportunities?.topOpportunities &&
           data.opportunities.topOpportunities.length > 0 ? (
            data.opportunities.topOpportunities.slice(0, 3).map((o, i) => (
              <View key={i} style={styles.agentCard}>
                <Text style={styles.agentName} numberOfLines={1}>{o.title}</Text>
                <View style={styles.agentMeta}>
                  <View style={[styles.agentBadge, { backgroundColor: 'rgba(34,197,94,0.12)' }]}>
                    <Text style={[styles.agentBadge, { color: '#00C48C' }]}>
                      Score: {o.score.totalScore}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No opportunities discovered yet</Text>
          )}
        </View>

        {/* ── Governance ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Shield size={14} color="rgba(255,255,255,0.7)" />  Governance
          </Text>
          <SubsystemCard
            icon={Shield}
            name="Actions"
            detail={`${data.governance?.state?.totalActions ?? 0} total · ${data.governance?.state?.pendingCount ?? 0} pending`}
            health={data.governance?.state?.pendingCount && data.governance.state.pendingCount > 0 ? 'degraded' : 'healthy'}
          />
        </View>

        {/* ── Memory & Reports ─────────────────────────────────────────── */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Memory</Text>
            <Text style={styles.kpiValue}>{data.memory?.state?.totalEntries ?? '—'}</Text>
            <Text style={styles.kpiSub}>enterprise entries</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Reports</Text>
            <Text style={styles.kpiValue}>{data.reports?.state?.totalReports ?? '—'}</Text>
            <Text style={styles.kpiSub}>executive reports</Text>
          </View>
        </View>

        {/* ── Latest Report Summary ────────────────────────────────────── */}
        {data.reports?.latest?.summary && (
          <View style={[styles.statusCard, { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <TrendingUp size={16} color="#FFD700" />
              <Text style={{ color: '#FFD700', fontSize: 13, fontWeight: '700' }}>Latest Report</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 19 }}>
              {data.reports.latest.summary}
            </Text>
          </View>
        )}

        {/* ── Improvement Tasks ────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Lightbulb size={14} color="rgba(255,255,255,0.7)" />  Self-Improvement
          </Text>
          <SubsystemCard
            icon={Lightbulb}
            name="Open Tasks"
            detail={`${data.improvement?.openTasks ?? 0} pending improvement tasks`}
            health={(data.improvement?.openTasks ?? 0) > 5 ? 'degraded' : 'healthy'}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
