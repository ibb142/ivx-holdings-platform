import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, ShieldCheck, TimerReset } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { autonomousAgentNumber, autonomousAttribution } from '@/src/modules/ivx-autonomous/autonomousJobAttribution';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const CONTROL_PLANE_URL = `${API_BASE}/api/ivx/autonomous/control-plane`;
const WORKER_JOBS_URL = `${API_BASE}/api/ivx/senior-developer/worker/jobs`;
const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_TTL_MS = 120_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Presence = 'WORKING' | 'QUEUED' | 'IDLE' | 'STALE' | 'ATTENTION' | 'OFFLINE';
type Heartbeat = 'live' | 'stale' | 'none';

type WorkerResult = {
  finalStatus?: string;
  changedFiles?: string[];
  testsRun?: boolean;
  testsPassed?: boolean;
  typecheckRun?: boolean;
  typecheckPassed?: boolean;
  commitSha?: string | null;
  deployId?: string | null;
  healthOk?: boolean;
  liveCommit?: string | null;
  commitMatch?: boolean;
};

type RawWorkerJob = {
  jobId: string;
  ownerId?: string | null;
  status: string;
  stage?: string | null;
  progressPercent?: number | null;
  stageDetail?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
  finishedAt?: string | null;
  attempts?: number;
  input?: { goal?: string; executionMode?: string | null; ownerId?: string | null };
  result?: WorkerResult | null;
  error?: string | null;
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
  worker: {
    heartbeat: Heartbeat;
    lastHeartbeatAt: string | null;
    stage: string | null;
    progressPercent: number | null;
    stageDetail: string | null;
    currentTask: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    workerStatus: string | null;
  };
};

type ControlPlane = {
  ok: boolean;
  generatedAt?: string;
  source?: string;
  enterprise?: {
    expectedAgents: number;
    registered: number;
    heartbeating: number;
    activeJobs: number;
    lastHeartbeatAt: string | null;
    registryShapeValid: boolean;
    durableState: boolean;
  };
  agents?: { items: LiveAgent[] };
  certification?: {
    liveReady: boolean;
    campaignComplete: boolean;
    liveWorkforceObserved?: boolean;
    proofPolicy: string;
  };
  error?: string;
};

type Interval = { start: number; end: number };

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTimestamp(value?: string | null): string {
  const parsed = parseTime(value);
  return parsed === null ? 'NO HEARTBEAT' : new Date(parsed).toLocaleString();
}

function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function isActiveStatus(status: string): boolean {
  return ['running', 'patching', 'testing', 'committing', 'deploying', 'verifying'].includes(status.toLowerCase());
}

function effectiveEnd(job: RawWorkerJob, now: number): number | null {
  const finished = parseTime(job.finishedAt);
  if (finished !== null) return finished;
  const started = parseTime(job.startedAt);
  if (started === null) return null;
  const heartbeat = parseTime(job.lastHeartbeatAt);
  if (isActiveStatus(job.status) && heartbeat !== null && now - heartbeat <= HEARTBEAT_TTL_MS) return now;
  return heartbeat ?? started;
}

function clippedInterval(job: RawWorkerJob, cutoff: number, now: number): Interval | null {
  const started = parseTime(job.startedAt);
  const end = effectiveEnd(job, now);
  if (started === null || end === null || end < cutoff || started > now) return null;
  return { start: Math.max(started, cutoff), end: Math.min(Math.max(end, started), now) };
}

function unionDuration(intervals: Interval[]): number {
  if (!intervals.length) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let start = sorted[0].start;
  let end = sorted[0].end;
  for (const next of sorted.slice(1)) {
    if (next.start <= end) end = Math.max(end, next.end);
    else { total += Math.max(0, end - start); start = next.start; end = next.end; }
  }
  return total + Math.max(0, end - start);
}

function strongEvidence(job: RawWorkerJob): boolean {
  const result = job.result;
  if (!result) return false;
  const code = Boolean(result.commitSha) || Boolean(result.changedFiles?.length);
  const tests = result.testsRun === true ? result.testsPassed === true : true;
  const typecheck = result.typecheckRun === true ? result.typecheckPassed === true : true;
  return result.finalStatus === 'COMPLETE' && code && tests && typecheck;
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

export default function AutonomousOwnerAuditScreen() {
  const router = useRouter();
  const [control, setControl] = useState<ControlPlane | null>(null);
  const [jobs, setJobs] = useState<RawWorkerJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realOnly, setRealOnly] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await getIVXAccessToken();
      if (!token) throw new Error('Owner session required.');
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const [controlResponse, jobsResponse] = await Promise.all([
        fetch(CONTROL_PLANE_URL, { headers }),
        fetch(WORKER_JOBS_URL, { headers }),
      ]);
      const controlJson = await controlResponse.json() as ControlPlane;
      const jobsJson = await jobsResponse.json() as { ok?: boolean; jobs?: RawWorkerJob[]; error?: string };
      if (!controlResponse.ok || !controlJson.ok) throw new Error(controlJson.error || `Control plane HTTP ${controlResponse.status}`);
      if (!jobsResponse.ok) throw new Error(jobsJson.error || `Worker jobs HTTP ${jobsResponse.status}`);
      setControl(controlJson);
      setJobs(Array.isArray(jobsJson.jobs) ? jobsJson.jobs : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load autonomous work evidence.');
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

  const now = Date.now();
  const cutoff = now - DAY_MS;
  const autonomousJobs = useMemo(() => jobs.filter((job) => {
    if (autonomousAgentNumber(job) === null) return false;
    return [job.createdAt, job.startedAt, job.lastHeartbeatAt, job.finishedAt]
      .map(parseTime)
      .some((time) => time !== null && time >= cutoff && time <= now);
  }), [jobs, cutoff, now]);
  const intervals = autonomousJobs.map((job) => clippedInterval(job, cutoff, now)).filter((item): item is Interval => item !== null);
  const wallClockMs = unionDuration(intervals);
  const agentHoursMs = intervals.reduce((sum, item) => sum + Math.max(0, item.end - item.start), 0);
  const allAgents = control?.agents?.items || [];
  const visibleAgents = realOnly
    ? allAgents.filter((agent) => jobs.some((job) => autonomousAgentNumber(job) === agent.agentNumber))
    : allAgents;
  const nonAutonomous24h = jobs.filter((job) => {
    const time = parseTime(job.startedAt) ?? parseTime(job.createdAt) ?? 0;
    return time >= cutoff && autonomousAgentNumber(job) === null;
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}><ArrowLeft size={20} color="#E2E8F0" /></TouchableOpacity>
        <View style={styles.headerText}><Text style={styles.title}>IVX Autonomous Owner Audit</Text><Text style={styles.subtitle}>Real worker jobs · heartbeat · evidence · 5s refresh</Text></View>
        <TouchableOpacity style={styles.iconButton} onPress={() => { setRefreshing(true); void load(true); }}><RefreshCw size={18} color="#FBBF24" /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}>
        {loading && !control ? <View style={styles.loading}><ActivityIndicator color="#FBBF24" /><Text style={styles.message}>Reading worker ledger…</Text></View> : null}
        {error ? <View style={styles.alert}><AlertTriangle size={18} color="#EF4444" /><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.hero}>
          <View style={styles.heroTop}><TimerReset size={22} color="#FBBF24" /><Text style={styles.heroTitle}>LAST 24 HOURS — VERIFIED WORK</Text></View>
          <View style={styles.metrics}>
            <Metric label="Autonomous active" value={formatDuration(wallClockMs)} tone="#22C55E" />
            <Metric label="Agent-hours" value={formatDuration(agentHoursMs)} tone="#38BDF8" />
            <Metric label="Jobs started" value={autonomousJobs.filter((job) => (parseTime(job.startedAt) ?? 0) >= cutoff).length} />
            <Metric label="Completed" value={autonomousJobs.filter((job) => job.status === 'completed').length} tone="#22C55E" />
            <Metric label="Running" value={autonomousJobs.filter((job) => isActiveStatus(job.status)).length} tone="#38BDF8" />
            <Metric label="Evidence complete" value={`${autonomousJobs.filter(strongEvidence).length}/${autonomousJobs.length}`} />
          </View>
          <View style={styles.proofRow}><ShieldCheck size={15} color={control?.enterprise?.durableState ? '#22C55E' : '#EF4444'} /><Text style={styles.proofText}>Durable worker state: {control?.enterprise?.durableState ? 'CONNECTED' : 'NOT CONFIRMED'}</Text></View>
          <View style={styles.proofRow}><Clock3 size={15} color="#94A3B8" /><Text style={styles.proofText}>Last worker heartbeat: {formatTimestamp(control?.enterprise?.lastHeartbeatAt)}</Text></View>
          <Text style={styles.truthRule}>TRUTH RULE: both campaign-agent-N and completion-campaign:agent:N are IVX Autonomous jobs. Registry verification and live worker activity are reported separately.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WORK ATTRIBUTION — LAST 24H</Text>
          <View style={styles.metrics}><Metric label="IVX Autonomous" value={autonomousJobs.length} tone="#22C55E" /><Metric label="Non-autonomous" value={nonAutonomous24h.length} tone="#F59E0B" /></View>
        </View>

        <View style={styles.section}>
          <View style={styles.filterRow}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>112 IA — OWNER AUDIT</Text><Text style={styles.sectionSub}>Real worker evidence per agent.</Text></View><View style={styles.switchWrap}><Text style={styles.switchLabel}>REAL WORK ONLY</Text><Switch value={realOnly} onValueChange={setRealOnly} /></View></View>
          <Text style={styles.auditCount}>Showing {visibleAgents.length} of {allAgents.length} agents.</Text>
          {visibleAgents.map((agent) => {
            const agentJobs = jobs.filter((job) => autonomousAgentNumber(job) === agent.agentNumber).sort((a, b) => (parseTime(b.startedAt) ?? 0) - (parseTime(a.startedAt) ?? 0));
            const latest = agentJobs[0];
            return <View key={agent.id} style={styles.agentCard}>
              <View style={styles.agentHeader}><View style={{ flex: 1 }}><Text style={styles.agentName}>IA-{String(agent.agentNumber).padStart(3, '0')} · {agent.name}</Text><Text style={styles.agentMeta}>{agent.functionalGroup} · {agent.role || 'IA'}</Text></View><Text style={styles.agentStatus}>{agent.presence}</Text></View>
              <Text style={styles.agentLine}>Real jobs: {agentJobs.length} · Heartbeat: {agent.worker.heartbeat.toUpperCase()}</Text>
              <Text style={styles.agentLine}>Latest heartbeat: {formatTimestamp(latest?.lastHeartbeatAt || agent.worker.lastHeartbeatAt)}</Text>
              <Text style={styles.agentLine}>Stage: {latest?.stage || agent.worker.stage || 'IDLE'} · Progress: {latest?.progressPercent ?? agent.worker.progressPercent ?? 0}%</Text>
              <Text style={styles.task}>{latest?.input?.goal || agent.worker.currentTask || agent.mission || 'No active task assigned.'}</Text>
              <Text style={styles.scope}>Task region/scope: {agent.operatingRegion || 'GLOBAL / UNASSIGNED'} · NOT PHYSICAL GPS</Text>
              {latest ? <Text style={styles.jobId}>{latest.jobId} · {autonomousAttribution(latest)} · {latest.status.toUpperCase()}</Text> : <Text style={styles.noEvidence}>No real worker job recorded for this agent.</Text>}
            </View>;
          })}
        </View>

        <View style={styles.certificate}>
          <Text style={styles.certificateTitle}>OWNER SELF-CERTIFICATION GATE</Text>
          <Text style={styles.certificateText}>Registry 112/112: {control?.enterprise?.registryShapeValid ? 'YES' : 'NO'}</Text>
          <Text style={styles.certificateText}>Live workforce observed: {control?.certification?.liveWorkforceObserved ? 'YES' : 'NO'}</Text>
          <Text style={styles.certificateText}>Autonomous jobs in 24h: {autonomousJobs.length}</Text>
          <Text style={styles.certificateText}>Heartbeating now: {control?.enterprise?.heartbeating ?? 0}</Text>
          <Text style={styles.certificatePolicy}>{control?.certification?.proofPolicy || 'No PASS without runtime proof.'}</Text>
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
  subtitle: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  content: { padding: 14, gap: 14, paddingBottom: 40 },
  loading: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  message: { color: '#CBD5E1' },
  alert: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#450A0A' },
  errorText: { color: '#FCA5A5', flex: 1 },
  hero: { padding: 14, borderRadius: 16, backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  heroTitle: { color: '#F8FAFC', fontWeight: '800', fontSize: 14 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { minWidth: '30%', flexGrow: 1, padding: 10, borderRadius: 12, backgroundColor: '#020617' },
  metricValue: { color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  metricLabel: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  proofRow: { flexDirection: 'row', gap: 7, alignItems: 'center', marginTop: 10 },
  proofText: { color: '#CBD5E1', fontSize: 12 },
  truthRule: { color: '#FBBF24', fontSize: 11, marginTop: 12, lineHeight: 16 },
  section: { padding: 14, borderRadius: 16, backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#1E293B' },
  sectionTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '800' },
  sectionSub: { color: '#94A3B8', fontSize: 11, marginTop: 3 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  switchWrap: { alignItems: 'center' },
  switchLabel: { color: '#94A3B8', fontSize: 9, marginBottom: 2 },
  auditCount: { color: '#CBD5E1', fontSize: 12, marginTop: 10, marginBottom: 8 },
  agentCard: { padding: 12, borderRadius: 12, backgroundColor: '#020617', borderWidth: 1, borderColor: '#1E293B', marginTop: 8 },
  agentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agentName: { color: '#F8FAFC', fontWeight: '700', fontSize: 13 },
  agentMeta: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  agentStatus: { color: '#38BDF8', fontWeight: '800', fontSize: 10 },
  agentLine: { color: '#CBD5E1', fontSize: 11, marginTop: 6 },
  task: { color: '#E2E8F0', fontSize: 11, marginTop: 8, lineHeight: 16 },
  scope: { color: '#FBBF24', fontSize: 10, marginTop: 7 },
  jobId: { color: '#22C55E', fontSize: 10, marginTop: 7 },
  noEvidence: { color: '#F59E0B', fontSize: 10, marginTop: 7 },
  certificate: { padding: 14, borderRadius: 16, backgroundColor: '#052E16', borderWidth: 1, borderColor: '#166534' },
  certificateTitle: { color: '#86EFAC', fontWeight: '800', fontSize: 14, marginBottom: 8 },
  certificateText: { color: '#DCFCE7', fontSize: 12, marginTop: 4 },
  certificatePolicy: { color: '#A7F3D0', fontSize: 10, marginTop: 8, lineHeight: 15 },
});
