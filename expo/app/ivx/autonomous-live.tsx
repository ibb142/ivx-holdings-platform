import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const CONTROL_PLANE_URL = `${API_BASE}/api/ivx/autonomous/control-plane`;
const POLL_INTERVAL_MS = 5_000;

type HeartbeatState = 'live' | 'stale' | 'none';

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
  name: string;
  supervisor: string;
  status: string;
  jobId: string | null;
  evidence: string[];
  lastError: string | null;
  updatedAt: string;
  worker: WorkerTelemetry;
};

type Workforce = {
  label?: string;
  total: number;
  verified: number;
  statuses: Record<string, number>;
  items: LiveAgent[];
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
  specialists?: Workforce;
  divisionA?: Workforce;
  divisionB?: Workforce;
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
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function toneForHeartbeat(state: HeartbeatState) {
  if (state === 'live') return '#22C55E';
  if (state === 'stale') return '#F59E0B';
  return '#64748B';
}

function toneForStatus(status: string) {
  const value = status.toLowerCase();
  if (value === 'verified' || value === 'completed') return '#22C55E';
  if (['running', 'patching', 'testing', 'committing', 'deploying', 'verifying'].includes(value)) return '#38BDF8';
  if (value === 'queued' || value === 'pending') return '#F59E0B';
  if (value === 'blocked' || value === 'failed' || value === 'cancelled') return '#EF4444';
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

function AgentRow({ agent }: { agent: LiveAgent }) {
  const workerStatus = agent.worker.workerStatus || agent.status;
  const progress = agent.worker.progressPercent;
  return (
    <View style={styles.agentCard}>
      <View style={styles.agentHeader}>
        <View style={[styles.heartbeatDot, { backgroundColor: toneForHeartbeat(agent.worker.heartbeat) }]} />
        <View style={styles.agentIdentity}>
          <Text style={styles.agentName}>{agent.name}</Text>
          <Text style={styles.agentMeta}>{agent.id} · Supervisor: {agent.supervisor}</Text>
        </View>
        <Text style={[styles.agentStatus, { color: toneForStatus(workerStatus) }]}>{workerStatus.toUpperCase()}</Text>
      </View>

      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>HEARTBEAT</Text>
        <Text style={[styles.liveValue, { color: toneForHeartbeat(agent.worker.heartbeat) }]}>
          {agent.worker.heartbeat.toUpperCase()} · {formatTime(agent.worker.lastHeartbeatAt)}
        </Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>STAGE</Text>
        <Text style={styles.liveValue}>{agent.worker.stage || 'NO ACTIVE STAGE'}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>PROGRESS</Text>
        <Text style={styles.liveValue}>{progress === null ? '—' : `${progress}%`}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>CURRENT ACTION</Text>
        <Text style={styles.liveValue}>{agent.worker.stageDetail || 'No live worker detail reported.'}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>CURRENT TASK</Text>
        <Text style={styles.liveTask} numberOfLines={4}>{agent.worker.currentTask || 'No active task assigned.'}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>JOB</Text>
        <Text style={styles.liveValue}>{agent.jobId || 'NO JOB'}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>STARTED</Text>
        <Text style={styles.liveValue}>{formatTime(agent.worker.startedAt)}</Text>
      </View>
      <View style={styles.liveLine}>
        <Text style={styles.liveLabel}>EVIDENCE</Text>
        <Text style={styles.liveValue}>{agent.evidence.length} records</Text>
      </View>
      {agent.lastError ? <Text style={styles.errorText}>ERROR: {agent.lastError}</Text> : null}
      {progress !== null ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

function WorkforceBlock({ title, workforce }: { title: string; workforce?: Workforce }) {
  if (!workforce) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSub}>{workforce.verified}/{workforce.total} VERIFIED</Text>
      {workforce.items.map((agent) => <AgentRow key={agent.id} agent={agent} />)}
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
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const enterprise = control?.enterprise;
  const overallState = useMemo(() => {
    if (!enterprise?.enabled) return 'OFFLINE';
    if ((enterprise.failed || 0) > 0 || (enterprise.blocked || 0) > 0) return 'DEGRADED';
    if ((enterprise.heartbeating || 0) > 0) return 'ONLINE';
    return 'IDLE';
  }, [enterprise]);
  const overallTone = overallState === 'ONLINE' ? '#22C55E' : overallState === 'DEGRADED' ? '#F59E0B' : '#94A3B8';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <ArrowLeft size={20} color="#E2E8F0" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>IVX Autonomous Command Center</Text>
          <Text style={styles.subtitle}>Live IA telemetry · owner only · refreshes every 5 seconds</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} onPress={() => { setRefreshing(true); void load(true); }}>
          <RefreshCw size={18} color="#FBBF24" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}
      >
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Activity size={22} color={overallTone} />
            <Text style={styles.heroTitle}>AUTONOMOUS STATUS</Text>
            <Text style={[styles.overallState, { color: overallTone }]}>{overallState}</Text>
          </View>
          <View style={styles.metrics}>
            <Metric label="Registered" value={`${enterprise?.registered ?? 0}/${enterprise?.expectedAgents ?? 112}`} tone="#E2E8F0" />
            <Metric label="Heartbeating" value={enterprise?.heartbeating ?? 0} tone="#22C55E" />
            <Metric label="Active jobs" value={enterprise?.activeJobs ?? 0} tone="#38BDF8" />
            <Metric label="Stale" value={enterprise?.staleHeartbeats ?? 0} tone="#F59E0B" />
            <Metric label="Verified" value={enterprise?.verifiedTotal ?? 0} tone="#22C55E" />
            <Metric label="Blocked" value={(enterprise?.blocked ?? 0) + (enterprise?.failed ?? 0)} tone="#EF4444" />
          </View>
          <View style={styles.proofRow}>
            <ShieldCheck size={15} color={enterprise?.durableState ? '#22C55E' : '#EF4444'} />
            <Text style={styles.proofText}>Durable state: {enterprise?.durableState ? 'CONNECTED' : 'NOT CONFIRMED'}</Text>
          </View>
          <View style={styles.proofRow}>
            <CheckCircle2 size={15} color={enterprise?.registryShapeValid ? '#22C55E' : '#EF4444'} />
            <Text style={styles.proofText}>Registry shape: {enterprise?.registryShapeValid ? '12 + 50 + 50 VALID' : 'INVALID'}</Text>
          </View>
          <View style={styles.proofRow}>
            <Clock3 size={15} color="#94A3B8" />
            <Text style={styles.proofText}>Last real worker heartbeat: {formatTime(enterprise?.lastHeartbeatAt)}</Text>
          </View>
          <Text style={styles.generated}>Snapshot: {formatTime(control?.generatedAt)} · Source: {control?.source || 'unknown'}</Text>
        </View>

        {loading && !control ? <Text style={styles.message}>Loading live telemetry…</Text> : null}
        {error ? (
          <View style={styles.alert}>
            <AlertTriangle size={18} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <WorkforceBlock title="12 CORE IA SUPERVISORS" workforce={control?.specialists} />
        <WorkforceBlock title="50 IVX OPERATIONS IA" workforce={control?.divisionA} />
        <WorkforceBlock title="50 FACTORY IA" workforce={control?.divisionB} />

        <View style={styles.certificate}>
          <Text style={styles.certificateTitle}>LIVE WORKFORCE CERTIFICATE GATE</Text>
          <Text style={styles.certificateText}>Registry complete: {control?.certification?.campaignComplete ? 'YES' : 'NO'}</Text>
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
  generated: { color: '#64748B', fontSize: 10, marginTop: 12 },
  message: { color: '#CBD5E1', textAlign: 'center', padding: 20 },
  alert: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#7F1D1D', backgroundColor: '#1F0A0A', marginBottom: 12 },
  section: { marginBottom: 18 },
  sectionTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '900' },
  sectionSub: { color: '#64748B', fontSize: 11, marginTop: 2, marginBottom: 8 },
  agentCard: { backgroundColor: '#0F172A', borderRadius: 12, borderWidth: 1, borderColor: '#1E293B', padding: 12, marginBottom: 8 },
  agentHeader: { flexDirection: 'row', alignItems: 'center' },
  heartbeatDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  agentIdentity: { flex: 1 },
  agentName: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  agentMeta: { color: '#64748B', fontSize: 10, marginTop: 2 },
  agentStatus: { fontSize: 10, fontWeight: '900', marginLeft: 8 },
  liveLine: { marginTop: 8 },
  liveLabel: { color: '#64748B', fontSize: 9, fontWeight: '800' },
  liveValue: { color: '#CBD5E1', fontSize: 11, marginTop: 2 },
  liveTask: { color: '#E2E8F0', fontSize: 11, lineHeight: 16, marginTop: 2 },
  errorText: { color: '#FCA5A5', fontSize: 11, marginTop: 8, flex: 1 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: '#1E293B', overflow: 'hidden', marginTop: 10 },
  progressFill: { height: 5, backgroundColor: '#38BDF8' },
  certificate: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#0F172A', borderRadius: 14, padding: 14 },
  certificateTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '900', marginBottom: 8 },
  certificateText: { color: '#CBD5E1', fontSize: 12, marginTop: 4 },
  certificatePolicy: { color: '#94A3B8', fontSize: 10, lineHeight: 15, marginTop: 10 },
});
