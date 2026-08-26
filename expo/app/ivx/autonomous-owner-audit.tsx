import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw, ShieldAlert, ShieldCheck, TimerReset } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { readTelemetryJson, TelemetryJsonError } from '@/src/modules/ivx-autonomous/safeJsonFetch';
import { assessPredictiveHealth, fetchWithDeadline, type PredictiveAssessment, type PredictiveSample } from '@/src/modules/ivx-autonomous/predictiveRadar';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const CONTROL_PLANE_URL = `${API_BASE}/api/ivx/autonomous/control-plane`;
const WORKER_JOBS_URL = `${API_BASE}/api/ivx/senior-developer/worker/jobs`;
const POLL_INTERVAL_MS = 5_000;
const FETCH_TIMEOUT_MS = 4_500;
const DAY_MS = 86_400_000;
const HEARTBEAT_TTL_MS = 120_000;

type TelemetryState = 'loading' | 'healthy' | 'unavailable';
type WorkerResult = { finalStatus?: string; changedFiles?: string[]; testsRun?: boolean; testsPassed?: boolean; typecheckRun?: boolean; typecheckPassed?: boolean; commitSha?: string | null; deployId?: string | null };
type RawWorkerJob = { jobId: string; ownerId?: string | null; status: string; createdAt?: string | null; startedAt?: string | null; lastHeartbeatAt?: string | null; finishedAt?: string | null; input?: { goal?: string; ownerId?: string | null }; result?: WorkerResult | null };
type LiveAgent = { id: string; agentNumber: number; name: string; role?: string | null; presence?: string; worker?: { heartbeat?: string; currentTask?: string | null } };
type ControlPlane = { ok: boolean; enterprise?: { expectedAgents?: number; registered?: number; heartbeating?: number; lastHeartbeatAt?: string | null; registryShapeValid?: boolean; durableState?: boolean }; agents?: { items?: LiveAgent[] }; certification?: { liveWorkforceObserved?: boolean }; error?: string };
type JobsEnvelope = { ok?: boolean; jobs?: RawWorkerJob[]; error?: string };

const parseTime = (value?: string | null) => { if (!value) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; };
const formatDuration = (ms: number) => { const safe = Math.max(0, ms); const h = Math.floor(safe / 3_600_000); const m = Math.floor((safe % 3_600_000) / 60_000); const s = Math.floor((safe % 60_000) / 1000); return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`; };
const isActiveStatus = (status: string) => ['running', 'patching', 'testing', 'committing', 'deploying', 'verifying'].includes(status.toLowerCase());
const autonomousAgentNumber = (job: RawWorkerJob) => { const match = String(job.ownerId || job.input?.ownerId || '').match(/^campaign-agent-(\d+)$/i); if (!match) return null; const n = Number.parseInt(match[1], 10); return Number.isFinite(n) && n >= 1 && n <= 112 ? n : null; };
const hasStrongEvidence = (job: RawWorkerJob) => { const r = job.result; if (!r) return false; const codeEvidence = Boolean(r.commitSha) || (r.changedFiles?.length || 0) > 0; const testsOkay = r.testsRun === true ? r.testsPassed === true : true; const typecheckOkay = r.typecheckRun === true ? r.typecheckPassed === true : true; return r.finalStatus === 'COMPLETE' && codeEvidence && testsOkay && typecheckOkay; };

function buildSummary(jobs: RawWorkerJob[], now: number) {
  const cutoff = now - DAY_MS;
  const autonomousJobs = jobs.filter((job) => autonomousAgentNumber(job) !== null && [job.createdAt, job.startedAt, job.finishedAt, job.lastHeartbeatAt].map(parseTime).some((t) => t !== null && t >= cutoff && t <= now));
  const intervals = autonomousJobs.map((job) => {
    const start = parseTime(job.startedAt); if (start === null) return null;
    const finished = parseTime(job.finishedAt); const heartbeat = parseTime(job.lastHeartbeatAt);
    let end = finished ?? heartbeat ?? start;
    if (!finished && isActiveStatus(job.status) && heartbeat !== null && now - heartbeat <= HEARTBEAT_TTL_MS) end = now;
    return end < cutoff || start > now ? null : { start: Math.max(start, cutoff), end: Math.min(end, now) };
  }).filter((v): v is { start: number; end: number } => v !== null).sort((a, b) => a.start - b.start);
  let wallClockMs = 0;
  if (intervals.length) { let start = intervals[0].start; let end = intervals[0].end; for (const next of intervals.slice(1)) { if (next.start <= end) end = Math.max(end, next.end); else { wallClockMs += Math.max(0, end - start); start = next.start; end = next.end; } } wallClockMs += Math.max(0, end - start); }
  return {
    autonomousJobs,
    wallClockMs,
    agentHoursMs: intervals.reduce((sum, x) => sum + Math.max(0, x.end - x.start), 0),
    started: autonomousJobs.filter((j) => (parseTime(j.startedAt) ?? 0) >= cutoff).length,
    completed: autonomousJobs.filter((j) => j.status.toLowerCase() === 'completed').length,
    running: autonomousJobs.filter((j) => isActiveStatus(j.status)).length,
    failed: autonomousJobs.filter((j) => ['failed', 'blocked', 'cancelled'].includes(j.status.toLowerCase())).length,
    commits: autonomousJobs.filter((j) => Boolean(j.result?.commitSha)).length,
    deployments: autonomousJobs.filter((j) => Boolean(j.result?.deployId)).length,
    evidenceComplete: autonomousJobs.filter(hasStrongEvidence).length,
  };
}

function Metric({ label, value }: { label: string; value: string | number }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }

export default function AutonomousOwnerAuditScreen() {
  const router = useRouter();
  const [control, setControl] = useState<ControlPlane | null>(null);
  const [jobs, setJobs] = useState<RawWorkerJob[]>([]);
  const [telemetryState, setTelemetryState] = useState<TelemetryState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessfulReadAt, setLastSuccessfulReadAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [samples, setSamples] = useState<PredictiveSample[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setTelemetryState('loading');
    const started = Date.now();
    let status = 0; let jsonValid = false; let contentTypeValid = false; let ok = false; let heartbeatAgeMs: number | null = null; let queueDepth: number | null = null; let failedJobs: number | null = null;
    try {
      const token = await getIVXAccessToken();
      if (!token) throw new Error('Owner session required.');
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const [controlTimed, jobsTimed] = await Promise.all([
        fetchWithDeadline(CONTROL_PLANE_URL, { headers }, FETCH_TIMEOUT_MS),
        fetchWithDeadline(WORKER_JOBS_URL, { headers }, FETCH_TIMEOUT_MS),
      ]);
      status = Math.min(controlTimed.response.status, jobsTimed.response.status);
      const ct1 = (controlTimed.response.headers.get('content-type') || '').toLowerCase();
      const ct2 = (jobsTimed.response.headers.get('content-type') || '').toLowerCase();
      contentTypeValid = (ct1.includes('json') || ct1.includes('+json')) && (ct2.includes('json') || ct2.includes('+json'));
      const [controlJson, jobsJson] = await Promise.all([
        readTelemetryJson<ControlPlane>(controlTimed.response, CONTROL_PLANE_URL),
        readTelemetryJson<JobsEnvelope>(jobsTimed.response, WORKER_JOBS_URL),
      ]);
      jsonValid = true;
      if (!controlJson.ok) throw new Error(controlJson.error || 'Control plane reported ok=false.');
      if (jobsJson.ok === false) throw new Error(jobsJson.error || 'Worker jobs reported ok=false.');
      if (!Array.isArray(jobsJson.jobs)) throw new Error('INVALID_TELEMETRY_SHAPE: worker jobs array is missing.');
      const heartbeat = parseTime(controlJson.enterprise?.lastHeartbeatAt);
      heartbeatAgeMs = heartbeat === null ? null : Math.max(0, Date.now() - heartbeat);
      queueDepth = jobsJson.jobs.filter((j) => isActiveStatus(j.status)).length;
      failedJobs = jobsJson.jobs.filter((j) => ['failed', 'blocked', 'cancelled'].includes(j.status.toLowerCase())).length;
      ok = true;
      setControl(controlJson); setJobs(jobsJson.jobs); setLastSuccessfulReadAt(new Date().toISOString()); setTelemetryState('healthy'); setError(null);
    } catch (caught) {
      const message = caught instanceof TelemetryJsonError ? `${caught.code} · HTTP ${caught.status} · ${caught.contentType || 'content-type missing'} · ${caught.preview || 'empty body'}` : caught instanceof Error ? caught.message : 'Unable to load real autonomous work evidence.';
      if (caught instanceof TelemetryJsonError) { status = caught.status; contentTypeValid = !['NON_JSON_CONTENT_TYPE', 'NON_JSON_RUNTIME_RESPONSE'].includes(caught.code); jsonValid = !['INVALID_JSON', 'NON_JSON_RUNTIME_RESPONSE'].includes(caught.code); }
      setTelemetryState('unavailable'); setError(message);
    } finally {
      const sample: PredictiveSample = { at: Date.now(), latencyMs: Date.now() - started, ok, status, jsonValid, contentTypeValid, heartbeatAgeMs, queueDepth, failedJobs, authFailure: status === 401 || status === 403 };
      setSamples((current) => [...current.slice(-11), sample]);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(false); pollRef.current = setInterval(() => void load(true), POLL_INTERVAL_MS); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [load]);

  const now = Date.now();
  const summary = useMemo(() => buildSummary(jobs, now), [jobs, now]);
  const predictive: PredictiveAssessment = useMemo(() => assessPredictiveHealth(samples), [samples]);
  const telemetryHealthy = telemetryState === 'healthy';
  const metric = (value: string | number) => telemetryHealthy ? value : '—';
  const agents = control?.agents?.items || [];

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={styles.header}><TouchableOpacity style={styles.iconButton} onPress={() => router.back()}><ArrowLeft size={22} color="#E2E8F0" /></TouchableOpacity><View style={styles.headerText}><Text style={styles.title}>IVX Autonomous Owner Audit</Text><Text style={styles.subtitle}>Predictive Radar · GPS · Nervous · Autonomous · Quality Firewall</Text></View><TouchableOpacity style={styles.iconButton} onPress={() => { setRefreshing(true); void load(true); }}><RefreshCw size={20} color="#FBBF24" /></TouchableOpacity></View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}>
      <View style={[styles.radar, predictive.level === 'CRITICAL' ? styles.red : predictive.level === 'WARNING' ? styles.orange : predictive.level === 'WATCH' ? styles.yellow : styles.green]} testID="predictive-radar">
        <Text style={styles.radarTitle}>LAYER 0 · PREDICTIVE RADAR — {predictive.level} · RISK {predictive.score}%</Text>
        <Text style={styles.radarText}>Action: {predictive.recommendedAction.toUpperCase()} · latency trend {predictive.latencyTrend.toFixed(1)}x · failure {(predictive.failureRate * 100).toFixed(0)}%</Text>
        <Text style={styles.radarText}>{predictive.reasons.slice(0, 3).join(' ')}</Text>
      </View>
      {telemetryState === 'loading' && !control ? <View style={styles.loading}><ActivityIndicator color="#FBBF24" /><Text style={styles.message}>Preflight telemetry probe — hard timeout {FETCH_TIMEOUT_MS / 1000}s…</Text></View> : null}
      {telemetryState === 'unavailable' ? <View style={styles.criticalAlert}><ShieldAlert size={20} color="#F87171" /><View style={{ flex: 1 }}><Text style={styles.criticalTitle}>TELEMETRY FAIL-CLOSED</Text><Text style={styles.errorText}>{error}</Text><Text style={styles.errorText}>Last verified read: {lastSuccessfulReadAt || 'NONE'}</Text></View></View> : null}
      <View style={styles.layerRow}><View style={styles.layerCard}><Text style={styles.layerTitle}>LAYER 1 · GPS</Text><Text style={styles.layerText}>Reachability + exact endpoint probe</Text></View><View style={styles.layerCard}><Text style={styles.layerTitle}>LAYER 2 · NERVOUS</Text><Text style={styles.layerText}>HTTP + Content-Type + JSON + latency trend</Text></View><View style={styles.layerCard}><Text style={styles.layerTitle}>LAYER 3 · AUTONOMOUS</Text><Text style={styles.layerText}>Early warning → safe self-heal → verify</Text></View></View>
      <View style={styles.hero}><View style={styles.heroTop}><TimerReset size={22} color="#FBBF24" /><Text style={styles.heroTitle}>LAST 24 HOURS — VERIFIED WORK</Text></View><View style={styles.metrics}><Metric label="Autonomous active" value={metric(formatDuration(summary.wallClockMs))}/><Metric label="Agent-hours" value={metric(formatDuration(summary.agentHoursMs))}/><Metric label="Jobs started" value={metric(summary.started)}/><Metric label="Completed" value={metric(summary.completed)}/><Metric label="Running" value={metric(summary.running)}/><Metric label="Failed/blocked" value={metric(summary.failed)}/><Metric label="Commits" value={metric(summary.commits)}/><Metric label="Deployments" value={metric(summary.deployments)}/><Metric label="Evidence complete" value={metric(`${summary.evidenceComplete}/${summary.autonomousJobs.length}`)}/></View><View style={styles.proofRow}>{telemetryHealthy && control?.enterprise?.durableState ? <ShieldCheck size={16} color="#22C55E" /> : <ShieldAlert size={16} color="#F87171" />}<Text style={styles.proofText}>Durable worker state: {telemetryHealthy ? (control?.enterprise?.durableState ? 'CONNECTED' : 'NOT CONFIRMED') : 'UNKNOWN — TELEMETRY FAILED'}</Text></View><Text style={styles.truthRule}>TRUTH RULE: no telemetry failure becomes fake zero. Predictive degradation is surfaced before terminal failure whenever measurable signals exist.</Text></View>
      <View style={styles.section}><Text style={styles.sectionTitle}>112 IA — VERIFIED RUNTIME</Text><Text style={styles.sectionSub}>{telemetryHealthy ? `Registry entries visible: ${agents.length}` : 'Registry visibility withheld while telemetry is unavailable.'}</Text>{telemetryHealthy ? agents.slice(0, 112).map((agent) => <View key={agent.id} style={styles.agentCard}><Text style={styles.agentName}>IA-{String(agent.agentNumber).padStart(3, '0')} · {agent.name}</Text><Text style={styles.agentMeta}>{agent.presence || 'UNKNOWN'} · {agent.role || 'IA'} · {agent.worker?.currentTask || 'No verified current worker task.'}</Text></View>) : null}</View>
      <View style={styles.certificate}><Text style={styles.certificateTitle}>OWNER SELF-CERTIFICATION GATE</Text><Text style={styles.certificateText}>Predictive radar: {predictive.level}</Text><Text style={styles.certificateText}>Telemetry contract: {telemetryHealthy ? 'PASS' : 'FAIL CLOSED'}</Text><Text style={styles.certificateText}>Registry 112/112: {telemetryHealthy ? (control?.enterprise?.registryShapeValid ? 'YES' : 'NO') : 'UNKNOWN'}</Text><Text style={styles.certificateText}>Live workforce observed: {telemetryHealthy ? (control?.certification?.liveWorkforceObserved ? 'YES' : 'NO') : 'UNKNOWN'}</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea:{flex:1,backgroundColor:'#020617'},header:{flexDirection:'row',alignItems:'center',paddingHorizontal:14,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#1E293B'},iconButton:{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#0F172A'},headerText:{flex:1,paddingHorizontal:10},title:{color:'#F8FAFC',fontSize:18,fontWeight:'800'},subtitle:{color:'#94A3B8',fontSize:11,marginTop:2},content:{padding:14,paddingBottom:40,gap:14},loading:{flexDirection:'row',gap:10,alignItems:'center',padding:12},message:{color:'#CBD5E1'},radar:{borderWidth:1,borderRadius:14,padding:13,gap:5},green:{borderColor:'#166534',backgroundColor:'#052E16'},yellow:{borderColor:'#A16207',backgroundColor:'#2A1B05'},orange:{borderColor:'#C2410C',backgroundColor:'#2A1205'},red:{borderColor:'#991B1B',backgroundColor:'#2A0A0A'},radarTitle:{color:'#F8FAFC',fontSize:13,fontWeight:'900'},radarText:{color:'#E2E8F0',fontSize:11,lineHeight:16},criticalAlert:{flexDirection:'row',gap:10,padding:12,borderWidth:1,borderColor:'#991B1B',backgroundColor:'#2A0A0A',borderRadius:12},criticalTitle:{color:'#FCA5A5',fontSize:12,fontWeight:'900'},errorText:{color:'#FCA5A5',fontSize:11,lineHeight:16},layerRow:{gap:8},layerCard:{backgroundColor:'#07111F',borderRadius:12,borderWidth:1,borderColor:'#1E293B',padding:10},layerTitle:{color:'#FBBF24',fontSize:11,fontWeight:'900'},layerText:{color:'#CBD5E1',fontSize:10,marginTop:3},hero:{backgroundColor:'#07111F',borderRadius:16,borderWidth:1,borderColor:'#1E293B',padding:14,gap:10},heroTop:{flexDirection:'row',alignItems:'center',gap:8},heroTitle:{color:'#F8FAFC',fontWeight:'900',fontSize:14,flex:1},metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},metric:{minWidth:'29%',flexGrow:1,backgroundColor:'#0F172A',borderRadius:10,padding:9,borderWidth:1,borderColor:'#1E293B'},metricValue:{color:'#F8FAFC',fontSize:17,fontWeight:'900'},metricLabel:{color:'#94A3B8',fontSize:10,marginTop:2,textTransform:'uppercase'},proofRow:{flexDirection:'row',alignItems:'center',gap:7},proofText:{color:'#CBD5E1',fontSize:11,flex:1},truthRule:{color:'#FDE68A',fontSize:11,lineHeight:16,backgroundColor:'#1C1917',padding:9,borderRadius:9},section:{backgroundColor:'#07111F',borderRadius:16,borderWidth:1,borderColor:'#1E293B',padding:12,gap:10},sectionTitle:{color:'#F8FAFC',fontSize:13,fontWeight:'900'},sectionSub:{color:'#94A3B8',fontSize:11},agentCard:{borderWidth:1,borderColor:'#1E293B',backgroundColor:'#0B1220',borderRadius:12,padding:11,gap:5},agentName:{color:'#F8FAFC',fontSize:12,fontWeight:'800'},agentMeta:{color:'#94A3B8',fontSize:10},certificate:{backgroundColor:'#07111F',borderRadius:16,borderWidth:1,borderColor:'#854D0E',padding:14,gap:6},certificateTitle:{color:'#FBBF24',fontSize:13,fontWeight:'900'},certificateText:{color:'#E2E8F0',fontSize:11}
});
