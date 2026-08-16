import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Globe2, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const CONTROL_PLANE_URL = `${API_BASE}/api/ivx/autonomous/control-plane`;
const POLL_INTERVAL_MS = 5_000;

type HeartbeatState = 'live' | 'stale' | 'none';
type Presence = 'WORKING' | 'QUEUED' | 'IDLE' | 'STALE' | 'ATTENTION' | 'OFFLINE';

type WorkerTelemetry = {
  registered: boolean;
  heartbeat: HeartbeatState;
  lastHeartbeatAt: string | null;
  stage: string | null;
  progressPercent: number | null;
  stageDetail: string | null;
  currentTask: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  workerStatus: string | null;
};

type LiveAgent = {
  id: string;
  agentNumber: number;
  name: string;
  role: string | null;
  functionalGroup: string;
  mission: string | null;
  status: string;
  presence: Presence;
  operatingRegion: string;
  jobId: string | null;
  evidence: string[];
  lastError: string | null;
  updatedAt: string;
  worker: WorkerTelemetry;
};

type GroupRow = {
  name: string;
  total: number;
  verified: number;
  working: number;
  queued: number;
  idle: number;
  stale: number;
  attention: number;
};

type ControlPlane = {
  ok: boolean;
  generatedAt?: string;
  source?: string;
  enterprise?: {
    totalAgents: number;
    expectedAgents: number;
    registered: number;
    heartbeating: number;
    staleHeartbeats: number;
    activeJobs: number;
    lastHeartbeatAt: string | null;
    registryShapeValid: boolean;
    phase: string;
    enabled: boolean;
    completionPercent: number;
    verifiedTotal: number;
    running: number;
    queued: number;
    blocked: number;
    failed: number;
    durableState: boolean;
  };
  agents?: {
    total: number;
    verified: number;
    statuses: Record<string, number>;
    items: LiveAgent[];
  };
  functionalGroups?: GroupRow[];
  certification?: {
    liveReady: boolean;
    campaignComplete: boolean;
    liveWorkforceObserved?: boolean;
    proofPolicy: string;
  };
  error?: string;
};

function formatTime(value?: string | null) {
  if (!value) return 'NO HEARTBEAT';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function heartbeatTone(state: HeartbeatState) {
  if (state === 'live') return '#22C55E';
  if (state === 'stale') return '#F59E0B';
  return '#64748B';
}

function presenceTone(presence: Presence) {
  if (presence === 'WORKING') return '#38BDF8';
  if (presence === 'QUEUED') return '#A78BFA';
  if (presence === 'IDLE') return '#94A3B8';
  if (presence === 'STALE') return '#F59E0B';
  if (presence === 'ATTENTION' || presence === 'OFFLINE') return '#EF4444';
  return '#94A3B8';
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function AgentCard({ agent }: { agent: LiveAgent }) {
  const progress = agent.worker.progressPercent;
  return (
    <View style={styles.agentCard}>
      <View style={styles.agentHeader}>
        <View style={[styles.heartbeatDot, { backgroundColor: heartbeatTone(agent.worker.heartbeat) }]} />
        <View style={styles.agentIdentity}>
          <Text style={styles.agentName}>IA-{String(agent.agentNumber).padStart(2, '0')} · {agent.name}</Text>
          <Text style={styles.agentMeta}>{agent.functionalGroup} · {agent.role || 'IA'}</Text>
        </View>
        <Text style={[styles.agentStatus, { color: presenceTone(agent.presence) }]}>{agent.presence}</Text>
      </View>

      <View style={styles.regionRow}>
        <Globe2 size={14} color="#D4AF37" />
        <Text style={styles.regionLabel}>OPERATING REGION</Text>
        <Text style={styles.regionValue}>{agent.operatingRegion}</Text>
      </View>

      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>HEARTBEAT</Text>
        <Text style={[styles.liveValue, { color: heartbeatTone(agent.worker.heartbeat) }]}>{agent.worker.heartbeat.toUpperCase()} · {formatTime(agent.worker.lastHeartbeatAt)}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>STAGE</Text>
        <Text style={styles.liveValue}>{agent.worker.stage || 'IDLE'}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>CURRENT ACTION</Text>
        <Text style={styles.liveValue}>{agent.worker.stageDetail || (agent.presence === 'IDLE' ? 'Standing by for the next assignment.' : 'No worker detail reported.')}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>CURRENT TASK</Text>
        <Text style={styles.liveTask} numberOfLines={4}>{agent.worker.currentTask || agent.mission || 'No active task assigned.'}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>JOB</Text>
        <Text style={styles.liveValue}>{agent.jobId || 'NO ACTIVE JOB'}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>EVIDENCE</Text>
        <Text style={styles.liveValue}>{agent.evidence.length} records</Text>
      </View>
      {agent.lastError ? <Text style={styles.errorText}>ATTENTION: {agent.lastError}</Text> : null}
      {progress !== null ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} />
          <Text style={styles.progressText}>{progress}%</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AutonomousLiveScreen() {
  const router = useRouter();
  const [control, setControl] = useState<ControlPlane | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await getIVXAccessToken();
      if (!token) throw new Error('Owner session required.');
      const response = await fetch(CONTROL_PLANE_URL, { headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json() as ControlPlane;
      if (!response.ok || !json.ok) throw new Error(json.error || `Control plane HTTP ${response.status}`);
      setControl(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load autonomous live telemetry.');
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
  const agents = control?.agents?.items || [];
  const presenceCounts = useMemo(() => agents.reduce<Record<string, number>>((acc, agent) => {
    acc[agent.presence] = (acc[agent.presence] || 0) + 1;
    return acc;
  }, {}), [agents]);
  const regions = useMemo(() => agents.reduce<Record<string, number>>((acc, agent) => {
    acc[agent.operatingRegion] = (acc[agent.operatingRegion] || 0) + 1;
    return acc;
  }, {}), [agents]);
  const regionRows = useMemo(() => Object.entries(regions).sort((a, b) => b[1] - a[1]), [regions]);

  const overallState = !enterprise?.enabled
    ? 'OFFLINE'
    : (enterprise.failed || 0) > 0 || (enterprise.blocked || 0) > 0
      ? 'DEGRADED'
      : (enterprise.heartbeating || 0) > 0
        ? 'ONLINE'
        : 'IDLE';
  const overallTone = overallState === 'ONLINE' ? '#22C55E' : overallState === 'DEGRADED' ? '#F59E0B' : '#94A3B8';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}><ArrowLeft size={20} color="#E2E8F0" /></TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>IVX Enterprise IA Control Tower</Text>
          <Text style={styles.subtitle}>112 IA · live work telemetry · 5 second refresh</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} onPress={() => { setRefreshing(true); void load(true); }}><RefreshCw size={18} color="#FBBF24" /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Activity size={22} color={overallTone} />
            <Text style={styles.heroTitle}>AUTONOMOUS STATUS</Text>
            <Text style={[styles.overallState, { color: overallTone }]}>{overallState}</Text>
          </View>
          <View style={styles.metrics}>
            <Metric label="Registered" value={`${enterprise?.registered ?? 0}/${enterprise?.expectedAgents ?? 112}`} />
            <Metric label="Working" value={presenceCounts.WORKING ?? 0} tone="#38BDF8" />
            <Metric label="Queued" value={presenceCounts.QUEUED ?? 0} tone="#A78BFA" />
            <Metric label="Idle" value={presenceCounts.IDLE ?? 0} tone="#94A3B8" />
            <Metric label="Heartbeating" value={enterprise?.heartbeating ?? 0} tone="#22C55E" />
            <Metric label="Attention" value={(presenceCounts.ATTENTION ?? 0) + (presenceCounts.STALE ?? 0)} tone="#EF4444" />
          </View>
          <View style={styles.proofRow}><ShieldCheck size={15} color={enterprise?.durableState ? '#22C55E' : '#EF4444'} /><Text style={styles.proofText}>Durable state: {enterprise?.durableState ? 'CONNECTED' : 'NOT CONFIRMED'}</Text></View>
          <View style={styles.proofRow}><CheckCircle2 size={15} color={enterprise?.registryShapeValid ? '#22C55E' : '#EF4444'} /><Text style={styles.proofText}>Registry: {enterprise?.registryShapeValid ? '112 / 112 VALID' : 'INVALID'}</Text></View>
          <View style={styles.proofRow}><Clock3 size={15} color="#94A3B8" /><Text style={styles.proofText}>Last real worker heartbeat: {formatTime(enterprise?.lastHeartbeatAt)}</Text></View>
          <Text style={styles.generated}>Snapshot: {formatTime(control?.generatedAt)} · Source: {control?.source || 'unknown'}</Text>
        </View>

        {loading && !control ? <Text style={styles.message}>Connecting to live IA telemetry…</Text> : null}
        {error ? <View style={styles.alert}><AlertTriangle size={18} color="#EF4444" /><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GLOBAL OPERATING REGIONS</Text>
          <Text style={styles.sectionSub}>This is task jurisdiction / operating scope, not physical GPS.</Text>
          <View style={styles.regionGrid}>
            {regionRows.map(([region, count]) => <View key={region} style={styles.regionChip}><Text style={styles.regionChipValue}>{count}</Text><Text style={styles.regionChipLabel}>{region}</Text></View>)}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>FUNCTIONAL GROUPS</Text>
          {(control?.functionalGroups || []).map((group) => (
            <View key={group.name} style={styles.groupRow}>
              <View style={styles.groupIdentity}><Text style={styles.groupName}>{group.name}</Text><Text style={styles.groupMeta}>{group.verified}/{group.total} verified</Text></View>
              <Text style={styles.groupWorking}>{group.working} working</Text>
              <Text style={styles.groupIdle}>{group.idle} idle</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>112 IA — LIVE WORK MAP</Text>
          <Text style={styles.sectionSub}>Tap-refresh or wait 5 seconds. Every row is sourced from the real campaign registry and worker queue.</Text>
          {agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
        </View>

        <View style={styles.certificate}>
          <Text style={styles.certificateTitle}>LIVE WORKFORCE CERTIFICATE GATE</Text>
          <Text style={styles.certificateText}>112 registry complete: {control?.certification?.campaignComplete ? 'YES' : 'NO'}</Text>
          <Text style={styles.certificateText}>Live workforce observed: {control?.certification?.liveWorkforceObserved ? 'YES' : 'NO'}</Text>
          <Text style={styles.certificateText}>Runtime ready: {control?.certification?.liveReady ? 'YES' : 'NO'}</Text>
          <Text style={styles.certificatePolicy}>{control?.certification?.proofPolicy || 'No certificate without runtime proof.'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#020617' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#0F172A' },
  headerText: { flex: 1, paddingHorizontal: 10 },
  title: { color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  content: { padding: 12, paddingBottom: 40 },
  hero: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#0F172A', borderRadius: 14, padding: 14, marginBottom: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: '#CBD5E1', fontSize: 13, fontWeight: '800', flex: 1 },
  overallState: { fontSize: 18, fontWeight: '900' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  metric: { width: '31%', minWidth: 90, backgroundColor: '#020617', borderRadius: 10, padding: 10 },
  metricValue: { color: '#F8FAFC', fontSize: 18, fontWeight: '900' },
  metricLabel: { color: '#64748B', fontSize: 10, marginTop: 3, textTransform: 'uppercase' },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  proofText: { color: '#CBD5E1', fontSize: 12, flex: 1 },
  generated: { color: '#64748B', fontSize: 10, marginTop: 10 },
  message: { color: '#94A3B8', textAlign: 'center', marginVertical: 18 },
  alert: { flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: '#7F1D1D', backgroundColor: '#2B0B0B', borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText: { color: '#FCA5A5', fontSize: 12, flex: 1 },
  section: { marginBottom: 18 },
  sectionTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '900', marginBottom: 4 },
  sectionSub: { color: '#64748B', fontSize: 11, marginBottom: 10 },
  regionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  regionChip: { minWidth: 110, flexGrow: 1, backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#263A50', borderRadius: 10, padding: 10 },
  regionChipValue: { color: '#D4AF37', fontSize: 18, fontWeight: '900' },
  regionChipLabel: { color: '#CBD5E1', fontSize: 10, marginTop: 3 },
  groupRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 10, padding: 10, marginBottom: 7 },
  groupIdentity: { flex: 1 },
  groupName: { color: '#E2E8F0', fontSize: 12, fontWeight: '800' },
  groupMeta: { color: '#64748B', fontSize: 10, marginTop: 2 },
  groupWorking: { color: '#38BDF8', fontSize: 10, fontWeight: '800', marginRight: 10 },
  groupIdle: { color: '#94A3B8', fontSize: 10, fontWeight: '800' },
  agentCard: { borderWidth: 1, borderColor: '#1E293B', backgroundColor: '#0B1220', borderRadius: 12, padding: 12, marginBottom: 9 },
  agentHeader: { flexDirection: 'row', alignItems: 'center' },
  heartbeatDot: { width: 10, height: 10, borderRadius: 5, marginRight: 9 },
  agentIdentity: { flex: 1 },
  agentName: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  agentMeta: { color: '#64748B', fontSize: 10, marginTop: 2 },
  agentStatus: { fontSize: 10, fontWeight: '900', marginLeft: 8 },
  regionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#101827', borderRadius: 8, padding: 8, marginTop: 10 },
  regionLabel: { color: '#64748B', fontSize: 9, fontWeight: '800', flex: 1 },
  regionValue: { color: '#D4AF37', fontSize: 11, fontWeight: '900' },
  liveLine: { marginTop: 8 },
  liveLabel: { color: '#64748B', fontSize: 9, fontWeight: '800' },
  liveValue: { color: '#CBD5E1', fontSize: 11, marginTop: 2 },
  liveTask: { color: '#E2E8F0', fontSize: 12, lineHeight: 17, marginTop: 2 },
  progressTrack: { height: 18, backgroundColor: '#020617', borderRadius: 9, marginTop: 10, overflow: 'hidden', justifyContent: 'center' },
  progressFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#0EA5E9' },
  progressText: { color: '#F8FAFC', fontSize: 9, fontWeight: '900', textAlign: 'center' },
  certificate: { borderWidth: 1, borderColor: '#365314', backgroundColor: '#0B1F11', borderRadius: 12, padding: 14 },
  certificateTitle: { color: '#86EFAC', fontSize: 13, fontWeight: '900', marginBottom: 8 },
  certificateText: { color: '#D1FAE5', fontSize: 11, marginTop: 4 },
  certificatePolicy: { color: '#94A3B8', fontSize: 10, lineHeight: 15, marginTop: 8 },
});
