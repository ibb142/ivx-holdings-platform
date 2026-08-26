import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
} from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import {
  readTelemetryJson,
  TelemetryJsonError,
} from '@/src/modules/ivx-autonomous/safeJsonFetch';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const CONTROL_PLANE_URL = `${API_BASE}/api/ivx/autonomous/control-plane`;
const WORKER_JOBS_URL = `${API_BASE}/api/ivx/senior-developer/worker/jobs`;
const POLL_INTERVAL_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_TTL_MS = 120_000;

type TelemetryState = 'loading' | 'healthy' | 'unavailable';

type WorkerResult = {
  finalStatus?: string;
  changedFiles?: string[];
  testsRun?: boolean;
  testsPassed?: boolean;
  typecheckRun?: boolean;
  typecheckPassed?: boolean;
  commitSha?: string | null;
  deployId?: string | null;
};

type RawWorkerJob = {
  jobId: string;
  ownerId?: string | null;
  status: string;
  createdAt?: string | null;
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
  finishedAt?: string | null;
  input?: { goal?: string; ownerId?: string | null };
  result?: WorkerResult | null;
};

type LiveAgent = {
  id: string;
  agentNumber: number;
  name: string;
  role?: string | null;
  presence?: string;
  worker?: {
    heartbeat?: string;
    currentTask?: string | null;
  };
};

type ControlPlane = {
  ok: boolean;
  enterprise?: {
    expectedAgents?: number;
    registered?: number;
    heartbeating?: number;
    lastHeartbeatAt?: string | null;
    registryShapeValid?: boolean;
    durableState?: boolean;
  };
  agents?: { items?: LiveAgent[] };
  certification?: {
    liveWorkforceObserved?: boolean;
  };
  error?: string;
};

type JobsEnvelope = {
  ok?: boolean;
  jobs?: RawWorkerJob[];
  error?: string;
};

type WorkSummary = {
  autonomousJobs: RawWorkerJob[];
  wallClockMs: number;
  agentHoursMs: number;
  started: number;
  completed: number;
  running: number;
  failed: number;
  commits: number;
  deployments: number;
  evidenceComplete: number;
};

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTimestamp(value?: string | null): string {
  const parsed = parseTime(value);
  return parsed === null ? '—' : new Date(parsed).toLocaleString();
}

function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function isActiveStatus(status: string): boolean {
  return ['running', 'patching', 'testing', 'committing', 'deploying', 'verifying'].includes(status.toLowerCase());
}

function autonomousAgentNumber(job: RawWorkerJob): number | null {
  const ownerId = String(job.ownerId || job.input?.ownerId || '');
  const match = ownerId.match(/^campaign-agent-(\d+)$/i);
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  return Number.isFinite(number) && number >= 1 && number <= 112 ? number : null;
}

function effectiveEnd(job: RawWorkerJob, now: number): number | null {
  const finished = parseTime(job.finishedAt);
  if (finished !== null) return finished;
  const started = parseTime(job.startedAt);
  if (started === null) return null;
  const heartbeat = parseTime(job.lastHeartbeatAt);
  if (!isActiveStatus(job.status)) return heartbeat ?? started;
  if (heartbeat !== null && now - heartbeat <= HEARTBEAT_TTL_MS) return now;
  return heartbeat ?? started;
}

function hasStrongEvidence(job: RawWorkerJob): boolean {
  const result = job.result;
  if (!result) return false;
  const codeEvidence = Boolean(result.commitSha) || (result.changedFiles?.length || 0) > 0;
  const testsOkay = result.testsRun === true ? result.testsPassed === true : true;
  const typecheckOkay = result.typecheckRun === true ? result.typecheckPassed === true : true;
  return result.finalStatus === 'COMPLETE' && codeEvidence && testsOkay && typecheckOkay;
}

function buildSummary(jobs: RawWorkerJob[], now: number): WorkSummary {
  const cutoff = now - DAY_MS;
  const autonomousJobs = jobs.filter((job) => {
    if (autonomousAgentNumber(job) === null) return false;
    const times = [job.createdAt, job.startedAt, job.finishedAt, job.lastHeartbeatAt]
      .map(parseTime)
      .filter((value): value is number => value !== null);
    return times.some((value) => value >= cutoff && value <= now);
  });

  const intervals = autonomousJobs
    .map((job) => {
      const start = parseTime(job.startedAt);
      const end = effectiveEnd(job, now);
      if (start === null || end === null || end < cutoff || start > now) return null;
      return { start: Math.max(start, cutoff), end: Math.min(end, now) };
    })
    .filter((value): value is { start: number; end: number } => value !== null)
    .sort((a, b) => a.start - b.start);

  let wallClockMs = 0;
  if (intervals.length > 0) {
    let start = intervals[0].start;
    let end = intervals[0].end;
    for (const next of intervals.slice(1)) {
      if (next.start <= end) end = Math.max(end, next.end);
      else {
        wallClockMs += Math.max(0, end - start);
        start = next.start;
        end = next.end;
      }
    }
    wallClockMs += Math.max(0, end - start);
  }

  const agentHoursMs = intervals.reduce((sum, interval) => sum + Math.max(0, interval.end - interval.start), 0);

  return {
    autonomousJobs,
    wallClockMs,
    agentHoursMs,
    started: autonomousJobs.filter((job) => (parseTime(job.startedAt) ?? 0) >= cutoff).length,
    completed: autonomousJobs.filter((job) => job.status.toLowerCase() === 'completed').length,
    running: autonomousJobs.filter((job) => isActiveStatus(job.status)).length,
    failed: autonomousJobs.filter((job) => ['failed', 'blocked', 'cancelled'].includes(job.status.toLowerCase())).length,
    commits: autonomousJobs.filter((job) => Boolean(job.result?.commitSha)).length,
    deployments: autonomousJobs.filter((job) => Boolean(job.result?.deployId)).length,
    evidenceComplete: autonomousJobs.filter(hasStrongEvidence).length,
  };
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export default function AutonomousOwnerAuditScreen() {
  const router = useRouter();
  const [control, setControl] = useState<ControlPlane | null>(null);
  const [jobs, setJobs] = useState<RawWorkerJob[]>([]);
  const [telemetryState, setTelemetryState] = useState<TelemetryState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessfulReadAt, setLastSuccessfulReadAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setTelemetryState('loading');
    try {
      const token = await getIVXAccessToken();
      if (!token) throw new Error('Owner session required.');

      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const [controlResponse, jobsResponse] = await Promise.all([
        fetch(CONTROL_PLANE_URL, { headers }),
        fetch(WORKER_JOBS_URL, { headers }),
      ]);

      const [controlJson, jobsJson] = await Promise.all([
        readTelemetryJson<ControlPlane>(controlResponse, CONTROL_PLANE_URL),
        readTelemetryJson<JobsEnvelope>(jobsResponse, WORKER_JOBS_URL),
      ]);

      if (!controlJson.ok) throw new Error(controlJson.error || 'Control plane reported ok=false.');
      if (jobsJson.ok === false) throw new Error(jobsJson.error || 'Worker jobs reported ok=false.');
      if (!Array.isArray(jobsJson.jobs)) throw new Error('INVALID_TELEMETRY_SHAPE: worker jobs array is missing.');

      setControl(controlJson);
      setJobs(jobsJson.jobs);
      setLastSuccessfulReadAt(new Date().toISOString());
      setTelemetryState('healthy');
      setError(null);
    } catch (caught) {
      const message = caught instanceof TelemetryJsonError
        ? `${caught.code} · HTTP ${caught.status} · ${caught.contentType || 'content-type missing'} · ${caught.preview || 'empty body'}`
        : caught instanceof Error
          ? caught.message
          : 'Unable to load real autonomous work evidence.';
      setTelemetryState('unavailable');
      setError(message);
      // FAIL CLOSED: preserve the last known-good snapshot if one exists. Never
      // overwrite it with []/zero values just because telemetry could not parse.
    } finally {
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

  const now = Date.now();
  const summary = useMemo(() => buildSummary(jobs, now), [jobs, now]);
  const agents = control?.agents?.items || [];
  const telemetryHealthy = telemetryState === 'healthy';
  const metric = (value: string | number): string | number => telemetryHealthy ? value : '—';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <ArrowLeft size={20} color="#E2E8F0" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>IVX Autonomous Owner Audit</Text>
          <Text style={styles.subtitle}>GPS · Nervous · Autonomous · fail-closed telemetry</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} onPress={() => { setRefreshing(true); void load(true); }}>
          <RefreshCw size={18} color="#FBBF24" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}
      >
        {telemetryState === 'loading' && !control ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#FBBF24" />
            <Text style={styles.message}>Reading verified autonomous telemetry…</Text>
          </View>
        ) : null}

        {telemetryState === 'unavailable' ? (
          <View style={styles.criticalAlert} testID="autonomous-telemetry-unavailable">
            <ShieldAlert size={20} color="#F87171" />
            <View style={styles.alertTextWrap}>
              <Text style={styles.criticalTitle}>TELEMETRY UNAVAILABLE — ZERO VALUES SUPPRESSED</Text>
              <Text style={styles.errorText}>{error || 'Unknown telemetry failure.'}</Text>
              <Text style={styles.staleText}>Last verified read: {lastSuccessfulReadAt ? formatTimestamp(lastSuccessfulReadAt) : 'NONE'}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.layerRow}>
          <View style={styles.layerCard}><Text style={styles.layerTitle}>LAYER 1 · GPS</Text><Text style={styles.layerText}>Surface reachability + exact endpoints</Text></View>
          <View style={styles.layerCard}><Text style={styles.layerTitle}>LAYER 2 · NERVOUS</Text><Text style={styles.layerText}>HTTP + Content-Type + JSON contract</Text></View>
          <View style={styles.layerCard}><Text style={styles.layerTitle}>LAYER 3 · AUTONOMOUS</Text><Text style={styles.layerText}>Incident → safe self-heal → verify</Text></View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <TimerReset size={22} color="#FBBF24" />
            <Text style={styles.heroTitle}>LAST 24 HOURS — VERIFIED WORK</Text>
          </View>
          <View style={styles.metrics}>
            <Metric label="Autonomous active" value={metric(formatDuration(summary.wallClockMs))} tone={telemetryHealthy ? '#22C55E' : '#F87171'} />
            <Metric label="Agent-hours" value={metric(formatDuration(summary.agentHoursMs))} tone={telemetryHealthy ? '#38BDF8' : '#F87171'} />
            <Metric label="Jobs started" value={metric(summary.started)} />
            <Metric label="Completed" value={metric(summary.completed)} />
            <Metric label="Running" value={metric(summary.running)} />
            <Metric label="Failed/blocked" value={metric(summary.failed)} />
            <Metric label="Commits" value={metric(summary.commits)} />
            <Metric label="Deployments" value={metric(summary.deployments)} />
            <Metric label="Evidence complete" value={metric(`${summary.evidenceComplete}/${summary.autonomousJobs.length}`)} />
          </View>

          <View style={styles.proofRow}>
            {telemetryHealthy && control?.enterprise?.durableState ? <ShieldCheck size={15} color="#22C55E" /> : <ShieldAlert size={15} color="#F87171" />}
            <Text style={styles.proofText}>Durable worker state: {telemetryHealthy ? (control?.enterprise?.durableState ? 'CONNECTED' : 'NOT CONFIRMED') : 'UNKNOWN — TELEMETRY FAILED'}</Text>
          </View>
          <View style={styles.proofRow}>
            <Clock3 size={15} color="#94A3B8" />
            <Text style={styles.proofText}>Last worker heartbeat: {telemetryHealthy ? formatTimestamp(control?.enterprise?.lastHeartbeatAt) : 'UNKNOWN'}</Text>
          </View>
          <Text style={styles.truthRule}>TRUTH RULE: a telemetry failure is NEVER converted into 0 jobs, 0 agent-hours, or 0 evidence. Unknown stays UNKNOWN until verified data returns.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>112 IA — VERIFIED RUNTIME</Text>
          <Text style={styles.sectionSub}>{telemetryHealthy ? `Registry entries visible: ${agents.length}` : 'Registry visibility: UNKNOWN while telemetry is unavailable.'}</Text>
          {telemetryHealthy ? agents.slice(0, 112).map((agent) => {
            const agentJobs = jobs.filter((job) => autonomousAgentNumber(job) === agent.agentNumber);
            const latest = agentJobs.sort((a, b) => (parseTime(b.startedAt) || 0) - (parseTime(a.startedAt) || 0))[0];
            return (
              <View key={agent.id} style={styles.agentCard}>
                <View style={styles.agentHeader}>
                  <Text style={styles.agentName}>IA-{String(agent.agentNumber).padStart(3, '0')} · {agent.name}</Text>
                  <Text style={styles.agentPresence}>{agent.presence || 'UNKNOWN'}</Text>
                </View>
                <Text style={styles.agentMeta}>{agent.role || 'IA'} · Jobs: {agentJobs.length} · Heartbeat: {agent.worker?.heartbeat || 'none'}</Text>
                <Text style={styles.currentTask}>{latest?.input?.goal || agent.worker?.currentTask || 'No verified current worker task.'}</Text>
              </View>
            );
          }) : (
            <View style={styles.unknownBox}>
              <AlertTriangle size={18} color="#F87171" />
              <Text style={styles.errorText}>Agent cards withheld because showing empty agents during a telemetry failure would be false evidence.</Text>
            </View>
          )}
        </View>

        <View style={styles.certificate}>
          <Text style={styles.certificateTitle}>OWNER SELF-CERTIFICATION GATE</Text>
          <Text style={styles.certificateText}>Telemetry contract: {telemetryHealthy ? 'PASS' : 'FAIL CLOSED'}</Text>
          <Text style={styles.certificateText}>Registry 112/112: {telemetryHealthy ? (control?.enterprise?.registryShapeValid ? 'YES' : 'NO') : 'UNKNOWN'}</Text>
          <Text style={styles.certificateText}>Live workforce observed: {telemetryHealthy ? (control?.certification?.liveWorkforceObserved ? 'YES' : 'NO') : 'UNKNOWN'}</Text>
          <Text style={styles.certificateText}>Autonomous jobs in 24h: {telemetryHealthy ? summary.autonomousJobs.length : 'UNKNOWN'}</Text>
          <Text style={styles.certificateText}>Evidence-complete jobs: {telemetryHealthy ? summary.evidenceComplete : 'UNKNOWN'}</Text>
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
  content: { padding: 14, paddingBottom: 40, gap: 14 },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12 },
  message: { color: '#CBD5E1' },
  criticalAlert: { flexDirection: 'row', gap: 10, padding: 12, borderWidth: 1, borderColor: '#991B1B', backgroundColor: '#2A0A0A', borderRadius: 12 },
  alertTextWrap: { flex: 1, gap: 4 },
  criticalTitle: { color: '#FCA5A5', fontSize: 12, fontWeight: '900' },
  errorText: { color: '#FCA5A5', fontSize: 11, lineHeight: 16 },
  staleText: { color: '#FDE68A', fontSize: 10 },
  layerRow: { gap: 8 },
  layerCard: { backgroundColor: '#07111F', borderRadius: 12, borderWidth: 1, borderColor: '#1E293B', padding: 10 },
  layerTitle: { color: '#FBBF24', fontSize: 11, fontWeight: '900' },
  layerText: { color: '#CBD5E1', fontSize: 10, marginTop: 3 },
  hero: { backgroundColor: '#07111F', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 14, gap: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: '#F8FAFC', fontWeight: '900', fontSize: 14, flex: 1 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { minWidth: '29%', flexGrow: 1, backgroundColor: '#0F172A', borderRadius: 10, padding: 9, borderWidth: 1, borderColor: '#1E293B' },
  metricValue: { color: '#F8FAFC', fontSize: 17, fontWeight: '900' },
  metricLabel: { color: '#94A3B8', fontSize: 10, marginTop: 2, textTransform: 'uppercase' },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  proofText: { color: '#CBD5E1', fontSize: 11, flex: 1 },
  truthRule: { color: '#FDE68A', fontSize: 11, lineHeight: 16, backgroundColor: '#1C1917', padding: 9, borderRadius: 9 },
  section: { backgroundColor: '#07111F', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 12, gap: 10 },
  sectionTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '900' },
  sectionSub: { color: '#94A3B8', fontSize: 11, lineHeight: 15 },
  agentCard: { borderWidth: 1, borderColor: '#1E293B', backgroundColor: '#0B1220', borderRadius: 12, padding: 11, gap: 6 },
  agentHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  agentName: { color: '#F8FAFC', fontSize: 12, fontWeight: '800', flex: 1 },
  agentPresence: { color: '#38BDF8', fontSize: 10, fontWeight: '900' },
  agentMeta: { color: '#94A3B8', fontSize: 10 },
  currentTask: { color: '#E2E8F0', fontSize: 11, lineHeight: 15 },
  unknownBox: { flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: '#7F1D1D', borderRadius: 10, padding: 10 },
  certificate: { backgroundColor: '#07111F', borderRadius: 16, borderWidth: 1, borderColor: '#854D0E', padding: 14, gap: 6 },
  certificateTitle: { color: '#FBBF24', fontSize: 13, fontWeight: '900' },
  certificateText: { color: '#E2E8F0', fontSize: 11 },
});
