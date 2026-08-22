import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  TimerReset,
  XCircle,
} from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const CONTROL_PLANE_URL = `${API_BASE}/api/ivx/autonomous/control-plane`;
const WORKER_JOBS_URL = `${API_BASE}/api/ivx/senior-developer/worker/jobs`;
const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_TTL_MS = 120_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Presence = 'WORKING' | 'QUEUED' | 'IDLE' | 'STALE' | 'ATTENTION' | 'OFFLINE';
type Heartbeat = 'live' | 'stale' | 'none';

type WorkerResult = {
  ok?: boolean;
  finalStatus?: string;
  changedFiles?: string[];
  testsRun?: boolean;
  testsPassed?: boolean;
  typecheckRun?: boolean;
  typecheckPassed?: boolean;
  buildRun?: boolean;
  commitCreated?: boolean;
  commitSha?: string | null;
  commitUrl?: string | null;
  branch?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  prMerged?: boolean;
  prMergeCommitSha?: string | null;
  deployId?: string | null;
  deployStatus?: string | null;
  deployVerified?: boolean;
  liveCommit?: string | null;
  commitMatch?: boolean;
  healthOk?: boolean;
  healthStatus?: number | null;
  error?: string | null;
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
  input?: {
    goal?: string;
    executionMode?: string | null;
    ownerId?: string | null;
  };
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
  updatedAt: string;
  worker: {
    registered: boolean;
    heartbeat: Heartbeat;
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
};

type ControlPlane = {
  ok: boolean;
  generatedAt?: string;
  source?: string;
  enterprise?: {
    expectedAgents: number;
    registered: number;
    heartbeating: number;
    staleHeartbeats: number;
    activeJobs: number;
    lastHeartbeatAt: string | null;
    registryShapeValid: boolean;
    enabled: boolean;
    durableState: boolean;
    blocked: number;
    failed: number;
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
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function formatTimestamp(value?: string | null): string {
  const t = parseTime(value);
  return t === null ? '—' : new Date(t).toLocaleString();
}

function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function isActiveStatus(status: string): boolean {
  return ['running', 'patching', 'testing', 'committing', 'deploying', 'verifying'].includes(status.toLowerCase());
}

function autonomousAgentNumber(job: RawWorkerJob): number | null {
  const ownerId = String(job.ownerId || job.input?.ownerId || '');
  const match = ownerId.match(/^campaign-agent-(\d+)$/i);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 112 ? n : null;
}

function attribution(job: RawWorkerJob): 'IVX AUTONOMOUS' | 'INTERNAL WORKER' | 'OWNER / EXTERNAL' {
  const ownerId = String(job.ownerId || job.input?.ownerId || '');
  if (/^campaign-agent-\d+$/i.test(ownerId)) return 'IVX AUTONOMOUS';
  if (/^worker:/i.test(ownerId)) return 'INTERNAL WORKER';
  return 'OWNER / EXTERNAL';
}

function effectiveEnd(job: RawWorkerJob, now: number): number | null {
  const finished = parseTime(job.finishedAt);
  if (finished !== null) return finished;
  const started = parseTime(job.startedAt);
  if (started === null) return null;
  if (!isActiveStatus(job.status)) return parseTime(job.lastHeartbeatAt) ?? started;
  const heartbeat = parseTime(job.lastHeartbeatAt);
  if (heartbeat !== null && now - heartbeat <= HEARTBEAT_TTL_MS) return now;
  return heartbeat ?? started;
}

function clippedInterval(job: RawWorkerJob, cutoff: number, now: number): Interval | null {
  const started = parseTime(job.startedAt);
  const end = effectiveEnd(job, now);
  if (started === null || end === null || end < cutoff || started > now) return null;
  const clippedStart = Math.max(started, cutoff);
  const clippedEnd = Math.min(Math.max(end, clippedStart), now);
  return { start: clippedStart, end: clippedEnd };
}

function unionDuration(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.start <= currentEnd) currentEnd = Math.max(currentEnd, next.end);
    else {
      total += Math.max(0, currentEnd - currentStart);
      currentStart = next.start;
      currentEnd = next.end;
    }
  }
  return total + Math.max(0, currentEnd - currentStart);
}

function hasStrongEvidence(job: RawWorkerJob): boolean {
  const r = job.result;
  if (!r) return false;
  const codeEvidence = (r.changedFiles?.length || 0) > 0 || Boolean(r.commitSha);
  const qaEvidence = r.testsRun === true ? r.testsPassed === true : true;
  const typecheckEvidence = r.typecheckRun === true ? r.typecheckPassed === true : true;
  return r.finalStatus === 'COMPLETE' && codeEvidence && qaEvidence && typecheckEvidence;
}

function buildSummary(jobs: RawWorkerJob[], now: number): WorkSummary {
  const cutoff = now - DAY_MS;
  const autonomousJobs = jobs.filter((job) => {
    if (autonomousAgentNumber(job) === null) return false;
    const times = [parseTime(job.createdAt), parseTime(job.startedAt), parseTime(job.finishedAt), parseTime(job.lastHeartbeatAt)].filter((v): v is number => v !== null);
    return times.some((t) => t >= cutoff && t <= now);
  });
  const intervals = autonomousJobs.map((job) => clippedInterval(job, cutoff, now)).filter((v): v is Interval => v !== null);
  const agentHoursMs = intervals.reduce((sum, interval) => sum + Math.max(0, interval.end - interval.start), 0);
  return {
    autonomousJobs,
    wallClockMs: unionDuration(intervals),
    agentHoursMs,
    started: autonomousJobs.filter((job) => (parseTime(job.startedAt) ?? 0) >= cutoff).length,
    completed: autonomousJobs.filter((job) => job.status === 'completed' && (parseTime(job.finishedAt) ?? 0) >= cutoff).length,
    running: autonomousJobs.filter((job) => isActiveStatus(job.status)).length,
    failed: autonomousJobs.filter((job) => ['failed', 'blocked', 'cancelled'].includes(job.status)).length,
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

function EvidenceFlag({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={styles.evidenceFlag}>
      {ok ? <CheckCircle2 size={14} color="#22C55E" /> : <XCircle size={14} color="#64748B" />}
      <Text style={[styles.evidenceFlagText, ok ? styles.goodText : null]}>{text}</Text>
    </View>
  );
}

function JobEvidence({ job }: { job: RawWorkerJob }) {
  const result = job.result;
  const started = parseTime(job.startedAt);
  const end = effectiveEnd(job, Date.now());
  const duration = started !== null && end !== null ? formatDuration(end - started) : '—';
  return (
    <View style={styles.jobEvidence}>
      <View style={styles.jobTitleRow}>
        <Text style={styles.jobId}>{job.jobId}</Text>
        <Text style={styles.attribution}>{attribution(job)}</Text>
      </View>
      <Text style={styles.jobGoal}>{job.input?.goal || 'No goal recorded.'}</Text>
      <Text style={styles.jobMeta}>Status {job.status.toUpperCase()} · Stage {(job.stage || '—').toUpperCase()} · Attempt {job.attempts || 0}</Text>
      <Text style={styles.jobMeta}>Started {formatTimestamp(job.startedAt)} · Finished {formatTimestamp(job.finishedAt)} · Duration {duration}</Text>
      <Text style={styles.jobMeta}>Heartbeat {formatTimestamp(job.lastHeartbeatAt)}</Text>
      {job.stageDetail ? <Text style={styles.stageDetail}>{job.stageDetail}</Text> : null}

      <View style={styles.evidenceGrid}>
        <EvidenceFlag ok={Boolean(result?.testsRun && result?.testsPassed)} text={result?.testsRun ? `Tests ${result.testsPassed ? 'PASS' : 'FAIL'}` : 'Tests not recorded'} />
        <EvidenceFlag ok={Boolean(result?.typecheckRun && result?.typecheckPassed)} text={result?.typecheckRun ? `TypeScript ${result.typecheckPassed ? 'PASS' : 'FAIL'}` : 'TypeScript not recorded'} />
        <EvidenceFlag ok={Boolean(result?.commitSha)} text={result?.commitSha ? `Commit ${result.commitSha.slice(0, 10)}` : 'No commit'} />
        <EvidenceFlag ok={Boolean(result?.deployId)} text={result?.deployId ? `Deploy ${result.deployId}` : 'No deploy'} />
        <EvidenceFlag ok={Boolean(result?.healthOk)} text={result?.healthStatus ? `Health ${result.healthStatus}` : 'Health not recorded'} />
        <EvidenceFlag ok={Boolean(result?.commitMatch)} text={result?.liveCommit ? `Live SHA ${result.liveCommit.slice(0, 10)}` : 'Live SHA not recorded'} />
      </View>

      {(result?.changedFiles?.length || 0) > 0 ? (
        <View style={styles.filesBox}>
          <Text style={styles.filesTitle}>FILES CHANGED ({result?.changedFiles?.length})</Text>
          {result?.changedFiles?.slice(0, 12).map((file) => <Text key={file} style={styles.filePath}>• {file}</Text>)}
          {(result?.changedFiles?.length || 0) > 12 ? <Text style={styles.filePath}>+ {(result?.changedFiles?.length || 0) - 12} more</Text> : null}
        </View>
      ) : null}

      <View style={styles.linkRow}>
        {result?.commitUrl ? (
          <TouchableOpacity style={styles.linkButton} onPress={() => void Linking.openURL(result.commitUrl as string)}>
            <GitCommitHorizontal size={14} color="#FBBF24" /><Text style={styles.linkText}>Commit</Text><ExternalLink size={12} color="#FBBF24" />
          </TouchableOpacity>
        ) : null}
        {result?.prUrl ? (
          <TouchableOpacity style={styles.linkButton} onPress={() => void Linking.openURL(result.prUrl as string)}>
            <FileCode2 size={14} color="#FBBF24" /><Text style={styles.linkText}>PR #{result.prNumber || ''}</Text><ExternalLink size={12} color="#FBBF24" />
          </TouchableOpacity>
        ) : null}
      </View>
      {job.error || result?.error ? <Text style={styles.errorText}>ERROR: {job.error || result?.error}</Text> : null}
    </View>
  );
}

function AgentAuditCard({ agent, jobs }: { agent: LiveAgent; jobs: RawWorkerJob[] }) {
  const [expanded, setExpanded] = useState(false);
  const agentJobs = useMemo(() => jobs
    .filter((job) => autonomousAgentNumber(job) === agent.agentNumber)
    .sort((a, b) => (parseTime(b.startedAt) || 0) - (parseTime(a.startedAt) || 0)), [agent.agentNumber, jobs]);
  const latest = agentJobs[0];
  const hasRealWorker = Boolean(latest?.jobId && latest?.startedAt);
  const recentCompleted = agentJobs.filter((job) => job.status === 'completed').length;
  return (
    <View style={styles.agentCard}>
      <TouchableOpacity style={styles.agentHeader} onPress={() => setExpanded((value) => !value)}>
        <View style={styles.agentIdentity}>
          <Text style={styles.agentName}>IA-{String(agent.agentNumber).padStart(3, '0')} · {agent.name}</Text>
          <Text style={styles.agentMeta}>{agent.functionalGroup} · {agent.role || 'IA'}</Text>
        </View>
        <View style={styles.agentRight}>
          <Text style={[styles.agentStatus, { color: agent.presence === 'WORKING' ? '#38BDF8' : agent.presence === 'ATTENTION' || agent.presence === 'STALE' ? '#EF4444' : '#94A3B8' }]}>{agent.presence}</Text>
          {expanded ? <ChevronUp size={18} color="#94A3B8" /> : <ChevronDown size={18} color="#94A3B8" />}
        </View>
      </TouchableOpacity>
      <View style={styles.agentQuickGrid}>
        <Text style={styles.quickText}>Real jobs: {agentJobs.length}</Text>
        <Text style={styles.quickText}>Completed: {recentCompleted}</Text>
        <Text style={[styles.quickText, { color: hasRealWorker ? '#22C55E' : '#F59E0B' }]}>Worker proof: {hasRealWorker ? 'YES' : 'NO'}</Text>
        <Text style={styles.quickText}>Heartbeat: {agent.worker.heartbeat.toUpperCase()}</Text>
      </View>
      <Text style={styles.currentTask}>{latest?.input?.goal || agent.worker.currentTask || agent.mission || 'No real worker job recorded.'}</Text>
      {expanded ? (
        <View style={styles.expandedArea}>
          <Text style={styles.detailTitle}>FULL END-TO-END WORK EVIDENCE</Text>
          {agentJobs.length === 0 ? <Text style={styles.noEvidence}>No autonomous worker job is recorded for this agent. Assignment alone is NOT counted as work.</Text> : agentJobs.slice(0, 10).map((job) => <JobEvidence key={job.jobId} job={job} />)}
        </View>
      ) : null}
    </View>
  );
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
      setError(err instanceof Error ? err.message : 'Unable to load real autonomous work evidence.');
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
  const summary = useMemo(() => buildSummary(jobs, now), [jobs, now]);
  const allAgents = control?.agents?.items || [];
  const agents = useMemo(() => realOnly
    ? allAgents.filter((agent) => jobs.some((job) => autonomousAgentNumber(job) === agent.agentNumber))
    : allAgents, [allAgents, jobs, realOnly]);
  const nonAutonomous24h = useMemo(() => jobs.filter((job) => {
    const t = parseTime(job.startedAt) || parseTime(job.createdAt) || 0;
    return t >= now - DAY_MS && autonomousAgentNumber(job) === null;
  }), [jobs, now]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}><ArrowLeft size={20} color="#E2E8F0" /></TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>IVX Autonomous Owner Audit</Text>
          <Text style={styles.subtitle}>Real worker jobs · evidence · 24h hours · 5s live refresh</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} onPress={() => { setRefreshing(true); void load(true); }}><RefreshCw size={18} color="#FBBF24" /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}>
        {loading && !control ? <View style={styles.loading}><ActivityIndicator color="#FBBF24" /><Text style={styles.message}>Reading real worker ledger…</Text></View> : null}
        {error ? <View style={styles.alert}><AlertTriangle size={18} color="#EF4444" /><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.hero}>
          <View style={styles.heroTop}><TimerReset size={22} color="#FBBF24" /><Text style={styles.heroTitle}>LAST 24 HOURS — VERIFIED WORK</Text></View>
          <View style={styles.metrics}>
            <Metric label="Autonomous active" value={formatDuration(summary.wallClockMs)} tone="#22C55E" />
            <Metric label="Agent-hours" value={formatDuration(summary.agentHoursMs)} tone="#38BDF8" />
            <Metric label="Jobs started" value={summary.started} />
            <Metric label="Completed" value={summary.completed} tone="#22C55E" />
            <Metric label="Running" value={summary.running} tone="#38BDF8" />
            <Metric label="Failed/blocked" value={summary.failed} tone={summary.failed > 0 ? '#EF4444' : '#94A3B8'} />
            <Metric label="Commits" value={summary.commits} />
            <Metric label="Deployments" value={summary.deployments} />
            <Metric label="Evidence complete" value={`${summary.evidenceComplete}/${summary.autonomousJobs.length}`} />
          </View>
          <View style={styles.proofRow}><ShieldCheck size={15} color={control?.enterprise?.durableState ? '#22C55E' : '#EF4444'} /><Text style={styles.proofText}>Durable worker state: {control?.enterprise?.durableState ? 'CONNECTED' : 'NOT CONFIRMED'}</Text></View>
          <View style={styles.proofRow}><Clock3 size={15} color="#94A3B8" /><Text style={styles.proofText}>Last worker heartbeat: {formatTimestamp(control?.enterprise?.lastHeartbeatAt)}</Text></View>
          <Text style={styles.truthRule}>TRUTH RULE: only jobs owned by campaign-agent-NNN count as IVX Autonomous work. Assigned duties without a real worker job do not count.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WORK ATTRIBUTION — LAST 24H</Text>
          <Text style={styles.sectionSub}>This prevents Rork, ChatGPT, owner, or generic internal jobs from being counted as Autonomous hours.</Text>
          <View style={styles.attributionRow}>
            <Metric label="IVX Autonomous" value={summary.autonomousJobs.length} tone="#22C55E" />
            <Metric label="Non-autonomous" value={nonAutonomous24h.length} tone="#F59E0B" />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.filterRow}>
            <View style={styles.filterText}><Text style={styles.sectionTitle}>112 IA — OWNER AUDIT</Text><Text style={styles.sectionSub}>Tap an IA to inspect its complete recorded worker evidence.</Text></View>
            <View style={styles.switchWrap}><Text style={styles.switchLabel}>REAL WORK ONLY</Text><Switch value={realOnly} onValueChange={setRealOnly} trackColor={{ false: '#334155', true: '#166534' }} thumbColor={realOnly ? '#22C55E' : '#94A3B8'} /></View>
          </View>
          <Text style={styles.auditCount}>Showing {agents.length} of {allAgents.length} agents.</Text>
          {agents.map((agent) => <AgentAuditCard key={agent.id} agent={agent} jobs={jobs} />)}
        </View>

        <View style={styles.certificate}>
          <Text style={styles.certificateTitle}>OWNER SELF-CERTIFICATION GATE</Text>
          <Text style={styles.certificateText}>Registry 112/112: {control?.enterprise?.registryShapeValid ? 'YES' : 'NO'}</Text>
          <Text style={styles.certificateText}>Live workforce observed: {control?.certification?.liveWorkforceObserved ? 'YES' : 'NO'}</Text>
          <Text style={styles.certificateText}>Autonomous jobs in 24h: {summary.autonomousJobs.length}</Text>
          <Text style={styles.certificateText}>Evidence-complete jobs: {summary.evidenceComplete}</Text>
          <Text style={styles.certificatePolicy}>You can now open each IA and independently verify job ID, timestamps, heartbeat, files, tests, commit, PR, deploy and health evidence.</Text>
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
  alert: { flexDirection: 'row', gap: 8, padding: 12, borderWidth: 1, borderColor: '#7F1D1D', backgroundColor: '#1F0A0A', borderRadius: 12 },
  errorText: { color: '#FCA5A5', flex: 1, fontSize: 12 },
  hero: { backgroundColor: '#07111F', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 14, gap: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: '#F8FAFC', fontWeight: '900', fontSize: 14, flex: 1 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { minWidth: '29%', flexGrow: 1, backgroundColor: '#0F172A', borderRadius: 10, padding: 9, borderWidth: 1, borderColor: '#1E293B' },
  metricValue: { color: '#F8FAFC', fontSize: 17, fontWeight: '900' },
  metricLabel: { color: '#94A3B8', fontSize: 10, marginTop: 2, textTransform: 'uppercase' },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  proofText: { color: '#CBD5E1', fontSize: 11 },
  truthRule: { color: '#FDE68A', fontSize: 11, lineHeight: 16, backgroundColor: '#1C1917', padding: 9, borderRadius: 9 },
  section: { backgroundColor: '#07111F', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 12, gap: 10 },
  sectionTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '900' },
  sectionSub: { color: '#94A3B8', fontSize: 11, lineHeight: 15 },
  attributionRow: { flexDirection: 'row', gap: 8 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterText: { flex: 1 },
  switchWrap: { alignItems: 'center', gap: 3 },
  switchLabel: { color: '#94A3B8', fontSize: 9, fontWeight: '800' },
  auditCount: { color: '#FBBF24', fontSize: 11, fontWeight: '700' },
  agentCard: { borderWidth: 1, borderColor: '#1E293B', backgroundColor: '#0B1220', borderRadius: 12, padding: 11, gap: 8 },
  agentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agentIdentity: { flex: 1 },
  agentName: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  agentMeta: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  agentRight: { alignItems: 'flex-end', gap: 4 },
  agentStatus: { fontSize: 10, fontWeight: '900' },
  agentQuickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickText: { color: '#CBD5E1', fontSize: 10, minWidth: '44%' },
  currentTask: { color: '#E2E8F0', fontSize: 11, lineHeight: 15 },
  expandedArea: { borderTopWidth: 1, borderTopColor: '#1E293B', paddingTop: 10, gap: 9 },
  detailTitle: { color: '#FBBF24', fontSize: 11, fontWeight: '900' },
  noEvidence: { color: '#FCA5A5', fontSize: 11, lineHeight: 16 },
  jobEvidence: { backgroundColor: '#020617', borderRadius: 10, borderWidth: 1, borderColor: '#1E293B', padding: 10, gap: 6 },
  jobTitleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  jobId: { color: '#38BDF8', fontSize: 10, fontWeight: '800', flex: 1 },
  attribution: { color: '#22C55E', fontSize: 9, fontWeight: '900' },
  jobGoal: { color: '#F8FAFC', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  jobMeta: { color: '#94A3B8', fontSize: 10, lineHeight: 14 },
  stageDetail: { color: '#CBD5E1', fontSize: 10, lineHeight: 14, backgroundColor: '#0F172A', padding: 7, borderRadius: 7 },
  evidenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  evidenceFlag: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: '45%' },
  evidenceFlagText: { color: '#94A3B8', fontSize: 9 },
  goodText: { color: '#86EFAC' },
  filesBox: { backgroundColor: '#0F172A', borderRadius: 8, padding: 8, gap: 3 },
  filesTitle: { color: '#CBD5E1', fontSize: 9, fontWeight: '900' },
  filePath: { color: '#94A3B8', fontSize: 9 },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1C1917', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7 },
  linkText: { color: '#FBBF24', fontSize: 10, fontWeight: '800' },
  certificate: { backgroundColor: '#07111F', borderRadius: 16, borderWidth: 1, borderColor: '#854D0E', padding: 14, gap: 6 },
  certificateTitle: { color: '#FBBF24', fontSize: 13, fontWeight: '900' },
  certificateText: { color: '#E2E8F0', fontSize: 11 },
  certificatePolicy: { color: '#94A3B8', fontSize: 10, lineHeight: 15, marginTop: 4 },
});
