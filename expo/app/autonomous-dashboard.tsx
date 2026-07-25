/**
 * IVX Autonomous Dashboard — live W1–W12 job ledger (owner-only).
 *
 * Reads REAL production data from:
 *   GET https://api.ivxholding.com/api/ivx/autonomous/ledger
 *
 * No seed data: every job shown carries a stable job ID, status history with
 * timestamps, evidence, and blockers straight from the durable backend ledger.
 * Auto-refreshes via controlled polling (30s) + pull-to-refresh.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  ListChecks,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const LEDGER_URL = `${API_BASE}/api/ivx/autonomous/ledger`;
const GUARDIAN_URL = `${API_BASE}/api/ivx/autonomous/auth-guardian`;
const QA_URL = `${API_BASE}/api/ivx/autonomous/qa`;
const CREDENTIALS_URL = `${API_BASE}/api/ivx/autonomous/credentials`;
const POLL_INTERVAL_MS = 30_000;

type LedgerWorker = { id: string; name: string; scope: string };

type LedgerHistoryEntry = { at: string; from: string | null; to: string; note: string | null };

type LedgerJob = {
  jobId: string;
  workerId: string;
  title: string;
  status: string;
  priority: string;
  evidence: string | null;
  blocker: string | null;
  createdAt: string;
  updatedAt: string;
  history: LedgerHistoryEntry[];
};

type LedgerApproval = {
  approvalId: string;
  workerId: string;
  title: string;
  risk: string;
  rollback: string;
  status: string;
  createdAt: string;
};

type LedgerCounts = {
  workers: number;
  jobs: number;
  verified: number;
  running: number;
  blocked: number;
  ownerActionRequired: number;
  queued: number;
  pendingApprovals: number;
};

type GuardianProbe = {
  id: string;
  name: string;
  target: string;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  detail: string;
  checkedAt: string;
};

type GuardianIncident = {
  incidentId: string;
  probeId: string;
  openedAt: string;
  closedAt: string | null;
  status: string;
  detail: string;
};

type GuardianAlert = {
  alertId: string;
  severity: string;
  area: string;
  problem: string;
  smsStatus: string;
  messageId: string | null;
  toMasked: string;
  sentAt: string;
  test: boolean;
};

type GuardianSmsProvider = {
  provider?: string;
  awsCredentialsConfigured?: boolean;
  awsRegion?: string;
  ownerPhoneResolved?: boolean;
  ownerPhoneMasked?: string | null;
  phoneSource?: string;
  ready?: boolean;
};

type GuardianResponse = {
  ok: boolean;
  error?: string;
  marker?: string;
  generatedAt?: string;
  totalRuns?: number;
  overall?: string;
  probes?: GuardianProbe[];
  openIncidents?: GuardianIncident[];
  recentIncidents?: GuardianIncident[];
  smsProvider?: GuardianSmsProvider;
  recentAlerts?: GuardianAlert[];
};

type QARunEntry = {
  runId: string;
  kind: string;
  at: string;
  ok: boolean;
  summary: string;
};

type QAResponse = {
  ok: boolean;
  error?: string;
  marker?: string;
  schedulerRunning?: boolean;
  cadence?: { healthMinutes?: number; authMinutes?: number; matrixHours?: number };
  lastHealthAt?: string | null;
  lastAuthAt?: string | null;
  lastMatrixAt?: string | null;
  healthOk?: boolean | null;
  authOk?: boolean | null;
  totalRuns?: number;
  recentRuns?: QARunEntry[];
};

type CredentialRow = {
  service: string;
  variable: string;
  environment: string;
  stored: boolean;
  injected: boolean;
  authenticated: boolean | null;
  permissionTest: string;
  runtimeTest: string;
  httpStatus: number | null;
  securityCheck: string;
  blocker: string | null;
  worker: string;
  finalStatus: string;
  testedAt: string;
};

type CredentialsResponse = {
  ok: boolean;
  error?: string;
  marker?: string;
  generatedAt?: string;
  totalRuns?: number;
  totals?: { total: number; verified: number; partial: number; blocked: number };
  credentials?: CredentialRow[];
};

type LedgerResponse = {
  ok: boolean;
  error?: string;
  marker?: string;
  generatedAt?: string;
  version?: number;
  updatedAt?: string;
  counts?: LedgerCounts;
  workers?: LedgerWorker[];
  jobs?: LedgerJob[];
  approvals?: LedgerApproval[];
};

const STATUS_COLORS: Record<string, string> = {
  VERIFIED: '#34D399',
  DONE: '#34D399',
  RUNNING: '#FBBF24',
  QUEUED: '#94A3B8',
  BLOCKED: '#F87171',
  OWNER_ACTION_REQUIRED: '#F97316',
};

const STATUS_ORDER: string[] = ['RUNNING', 'BLOCKED', 'OWNER_ACTION_REQUIRED', 'QUEUED', 'VERIFIED', 'DONE'];

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#94A3B8';
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
  } catch {
    return iso;
  }
}

export default function AutonomousDashboardScreen() {
  const router = useRouter();
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState<boolean>(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [guardian, setGuardian] = useState<GuardianResponse | null>(null);
  const [qa, setQa] = useState<QAResponse | null>(null);
  const [creds, setCreds] = useState<CredentialsResponse | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLedger = useCallback(async (silent: boolean) => {
    if (!silent) setIsLoading(true);
    setErrorMessage(null);
    try {
      const token = await getIVXAccessToken();
      if (!token) {
        setIsUnauthorized(true);
        setErrorMessage('Owner session required. Sign in as the owner to view the autonomous ledger.');
        return;
      }
      const response = await fetch(LEDGER_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        setIsUnauthorized(true);
        setErrorMessage('Access denied: this dashboard is restricted to the IVX owner.');
        return;
      }
      const json = (await response.json()) as LedgerResponse;
      if (!json.ok) {
        setErrorMessage(json.error ?? `Ledger request failed (HTTP ${response.status}).`);
        return;
      }
      setIsUnauthorized(false);
      setData(json);
      setLastFetchedAt(new Date().toISOString());
      try {
        const [guardianResponse, qaResponse, credsResponse] = await Promise.all([
          fetch(GUARDIAN_URL, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }),
          fetch(QA_URL, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }),
          fetch(CREDENTIALS_URL, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (guardianResponse.ok) {
          const guardianJson = (await guardianResponse.json()) as GuardianResponse;
          if (guardianJson.ok) setGuardian(guardianJson);
        }
        if (qaResponse.ok) {
          const qaJson = (await qaResponse.json()) as QAResponse;
          if (qaJson.ok) setQa(qaJson);
        }
        if (credsResponse.ok) {
          const credsJson = (await credsResponse.json()) as CredentialsResponse;
          if (credsJson.ok) setCreds(credsJson);
        }
      } catch (guardianError) {
        console.log('[AutonomousDashboard] guardian/qa fetch skipped:', guardianError instanceof Error ? guardianError.message : guardianError);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error loading ledger.';
      console.log('[AutonomousDashboard] fetch failed:', message);
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLedger(false);
    pollRef.current = setInterval(() => fetchLedger(true), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchLedger]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchLedger(true);
  }, [fetchLedger]);

  const counts = data?.counts;
  const jobs = data?.jobs ?? [];
  const workers = data?.workers ?? [];
  const approvals = (data?.approvals ?? []).filter((a) => a.status === 'PENDING');
  const sortedJobs = [...jobs].sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.status);
    const sb = STATUS_ORDER.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    return a.jobId.localeCompare(b.jobId);
  });
  const completionPercent = counts && counts.jobs > 0 ? Math.round((counts.verified / counts.jobs) * 100) : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="autonomous-dashboard-back">
          <ArrowLeft size={22} color="#E2E8F0" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Autonomous Dashboard</Text>
          <Text style={styles.headerSubtitle}>
            Live ledger · v{data?.version ?? '—'} · {formatTime(lastFetchedAt)}
          </Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshButton} testID="autonomous-dashboard-refresh">
          <RefreshCw size={18} color="#FBBF24" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color="#FBBF24" />
          <Text style={styles.loadingText}>Loading live job ledger…</Text>
        </View>
      ) : isUnauthorized ? (
        <View style={styles.centerFill}>
          <Lock size={40} color="#F87171" />
          <Text style={styles.errorTitle}>Owner access required</Text>
          <Text style={styles.errorBody}>{errorMessage}</Text>
        </View>
      ) : errorMessage && !data ? (
        <View style={styles.centerFill}>
          <AlertTriangle size={40} color="#F87171" />
          <Text style={styles.errorTitle}>Could not load ledger</Text>
          <Text style={styles.errorBody}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchLedger(false)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#FBBF24" />}
        >
          {counts ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Activity size={16} color="#FBBF24" />
                <Text style={styles.cardHeader}>Overview</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${completionPercent}%` }]} />
              </View>
              <Text style={styles.progressLabel}>{completionPercent}% verified ({counts.verified}/{counts.jobs} jobs)</Text>
              <View style={styles.statGrid}>
                <StatPill label="Running" value={counts.running} color="#FBBF24" />
                <StatPill label="Blocked" value={counts.blocked} color="#F87171" />
                <StatPill label="Owner action" value={counts.ownerActionRequired} color="#F97316" />
                <StatPill label="Queued" value={counts.queued} color="#94A3B8" />
                <StatPill label="Workers" value={counts.workers} color="#60A5FA" />
                <StatPill label="Approvals" value={counts.pendingApprovals} color="#F97316" />
              </View>
            </View>
          ) : null}

          {approvals.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <ShieldCheck size={16} color="#F97316" />
                <Text style={styles.cardHeader}>Approvals waiting ({approvals.length})</Text>
              </View>
              {approvals.map((approval) => (
                <View key={approval.approvalId} style={styles.approvalRow}>
                  <Text style={styles.approvalTitle}>{approval.approvalId} · {approval.title}</Text>
                  <Text style={styles.approvalMeta}>Risk: {approval.risk}</Text>
                  <Text style={styles.approvalMeta}>Rollback: {approval.rollback}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {guardian ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <ShieldCheck size={16} color={guardian.overall === 'HEALTHY' ? '#34D399' : '#F87171'} />
                <Text style={styles.cardHeader}>Owner Authentication</Text>
                <Text style={[styles.guardianBadge, { color: guardian.overall === 'HEALTHY' ? '#34D399' : '#F87171' }]}>
                  {guardian.overall ?? '—'}
                </Text>
              </View>
              <Text style={styles.guardianMeta}>
                Auth Guardian · run #{guardian.totalRuns ?? 0} · {formatTime(guardian.generatedAt)}
              </Text>
              {(guardian.probes ?? []).map((probe) => (
                <View key={probe.id} style={styles.probeRow}>
                  <View style={[styles.statusDot, { backgroundColor: probe.ok ? '#34D399' : '#F87171' }]} />
                  <View style={styles.probeTextWrap}>
                    <Text style={styles.probeName}>{probe.name}</Text>
                    <Text style={styles.probeDetail}>
                      HTTP {probe.httpStatus ?? '—'} · {probe.latencyMs}ms · {probe.detail}
                    </Text>
                  </View>
                </View>
              ))}
              {(guardian.openIncidents ?? []).length > 0 ? (
                <View style={styles.incidentBox}>
                  <Text style={styles.incidentHeader}>Open incidents</Text>
                  {(guardian.openIncidents ?? []).map((incident) => (
                    <Text key={incident.incidentId} style={styles.jobBlocker}>
                      {incident.incidentId} · {incident.detail} · opened {formatTime(incident.openedAt)}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.jobEvidence}>No open authentication incidents.</Text>
              )}
              <View style={styles.smsBox}>
                <Text style={styles.smsHeader}>
                  SMS alerts ({guardian.smsProvider?.provider ?? 'aws_sns'}) — {guardian.smsProvider?.ready ? 'READY' : 'NOT READY'}
                </Text>
                <Text style={styles.probeDetail}>
                  AWS creds: {guardian.smsProvider?.awsCredentialsConfigured ? 'configured' : 'MISSING on backend'} · phone: {guardian.smsProvider?.ownerPhoneMasked ?? '—'} ({guardian.smsProvider?.phoneSource ?? '—'})
                </Text>
                {(guardian.recentAlerts ?? []).slice(0, 3).map((alert) => (
                  <Text key={alert.alertId} style={styles.probeDetail}>
                    {alert.alertId} · {alert.severity} · {alert.smsStatus}
                    {alert.messageId ? ` · id ${alert.messageId.slice(0, 8)}…` : ''} · {formatTime(alert.sentAt)}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          {qa ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Activity size={16} color={qa.schedulerRunning ? '#34D399' : '#F87171'} />
                <Text style={styles.cardHeader}>Continuous QA</Text>
                <Text style={[styles.guardianBadge, { color: qa.schedulerRunning ? '#34D399' : '#F87171' }]}>
                  {qa.schedulerRunning ? 'RUNNING 24/7' : 'STOPPED'}
                </Text>
              </View>
              <Text style={styles.guardianMeta}>
                Health every {qa.cadence?.healthMinutes ?? 5}m · auth every {qa.cadence?.authMinutes ?? 15}m · full matrix every {qa.cadence?.matrixHours ?? 2}h · {qa.totalRuns ?? 0} runs
              </Text>
              <View style={styles.qaStatusRow}>
                <View style={styles.qaStatusItem}>
                  <View style={[styles.statusDot, { backgroundColor: qa.healthOk === false ? '#F87171' : qa.healthOk ? '#34D399' : '#64748B' }]} />
                  <Text style={styles.probeDetail}>Health {formatTime(qa.lastHealthAt)}</Text>
                </View>
                <View style={styles.qaStatusItem}>
                  <View style={[styles.statusDot, { backgroundColor: qa.authOk === false ? '#F87171' : qa.authOk ? '#34D399' : '#64748B' }]} />
                  <Text style={styles.probeDetail}>Auth matrix {formatTime(qa.lastMatrixAt)}</Text>
                </View>
              </View>
              {(qa.recentRuns ?? []).slice(0, 6).map((run) => (
                <View key={run.runId} style={styles.probeRow}>
                  <View style={[styles.statusDot, { backgroundColor: run.ok ? '#34D399' : '#F87171' }]} />
                  <View style={styles.probeTextWrap}>
                    <Text style={styles.probeName}>{run.runId} · {run.kind}</Text>
                    <Text style={styles.probeDetail}>{formatTime(run.at)} · {run.summary}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {creds ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Lock size={16} color={creds.totals && creds.totals.blocked > 0 ? '#F97316' : '#34D399'} />
                <Text style={styles.cardHeader}>Credentials &amp; Integrations</Text>
                <Text style={[styles.guardianBadge, { color: creds.totals && creds.totals.blocked > 0 ? '#F97316' : '#34D399' }]}>
                  {creds.totals ? `${creds.totals.verified}/${creds.totals.total} VERIFIED` : '—'}
                </Text>
              </View>
              <Text style={styles.guardianMeta}>
                Live binding tests · run #{creds.totalRuns ?? 0} · {formatTime(creds.generatedAt)} · no secret values shown
              </Text>
              {(creds.credentials ?? []).map((row) => (
                <View key={`${row.service}-${row.variable}`} style={styles.probeRow}>
                  <View
                    style={[styles.statusDot, {
                      backgroundColor:
                        row.finalStatus === 'VERIFIED' ? '#34D399' : row.finalStatus === 'PARTIAL' ? '#FBBF24' : '#F87171',
                    }]}
                  />
                  <View style={styles.probeTextWrap}>
                    <Text style={styles.probeName}>{row.service} · {row.finalStatus} · {row.worker}</Text>
                    <Text style={styles.probeDetail}>{row.variable} · {row.environment} · stored {row.stored ? 'yes' : 'NO'} · injected {row.injected ? 'yes' : 'NO'}</Text>
                    <Text style={styles.probeDetail}>{row.runtimeTest}</Text>
                    <Text style={styles.probeDetail}>{row.permissionTest}</Text>
                    {row.blocker ? <Text style={styles.jobBlocker}>Blocker: {row.blocker}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <ListChecks size={16} color="#60A5FA" />
              <Text style={styles.cardHeader}>Jobs ({sortedJobs.length})</Text>
            </View>
            {sortedJobs.length === 0 ? (
              <Text style={styles.emptyText}>No jobs in the ledger yet.</Text>
            ) : (
              sortedJobs.map((job) => {
                const expanded = expandedJobId === job.jobId;
                return (
                  <TouchableOpacity
                    key={job.jobId}
                    style={styles.jobRow}
                    onPress={() => setExpandedJobId(expanded ? null : job.jobId)}
                    testID={`job-${job.jobId}`}
                  >
                    <View style={styles.jobTopRow}>
                      <View style={[styles.statusDot, { backgroundColor: statusColor(job.status) }]} />
                      <Text style={styles.jobId}>{job.jobId}</Text>
                      <Text style={[styles.jobStatus, { color: statusColor(job.status) }]}>{job.status}</Text>
                      <Text style={styles.jobPriority}>{job.priority}</Text>
                      <Text style={styles.jobWorker}>{job.workerId}</Text>
                      {expanded ? <ChevronDown size={14} color="#64748B" /> : <ChevronRight size={14} color="#64748B" />}
                    </View>
                    <Text style={styles.jobTitle}>{job.title}</Text>
                    {expanded ? (
                      <View style={styles.jobDetail}>
                        {job.evidence ? <Text style={styles.jobEvidence}>Evidence: {job.evidence}</Text> : null}
                        {job.blocker ? <Text style={styles.jobBlocker}>Blocker: {job.blocker}</Text> : null}
                        <Text style={styles.jobMeta}>Updated: {formatTime(job.updatedAt)}</Text>
                        {job.history.map((entry, index) => (
                          <View key={`${job.jobId}-h${index}`} style={styles.historyRow}>
                            <Clock size={11} color="#64748B" />
                            <Text style={styles.historyText}>
                              {formatTime(entry.at)} · {entry.from ?? 'START'} → {entry.to}
                              {entry.note ? ` · ${entry.note}` : ''}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Cpu size={16} color="#34D399" />
              <Text style={styles.cardHeader}>Workers ({workers.length})</Text>
            </View>
            {workers.map((worker) => {
              const workerJobs = jobs.filter((j) => j.workerId === worker.id);
              const active = workerJobs.find((j) => j.status === 'RUNNING');
              return (
                <View key={worker.id} style={styles.workerRow}>
                  <View style={styles.workerTopRow}>
                    <Text style={styles.workerId}>{worker.id}</Text>
                    <Text style={styles.workerName}>{worker.name}</Text>
                    {active ? <CheckCircle2 size={13} color="#FBBF24" /> : null}
                  </View>
                  <Text style={styles.workerScope}>{worker.scope}</Text>
                  <Text style={styles.workerMeta}>
                    {workerJobs.length} jobs · {workerJobs.filter((j) => j.status === 'VERIFIED' || j.status === 'DONE').length} verified
                    {active ? ` · running: ${active.jobId}` : ''}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.footerNote}>
            Source: {data?.marker ?? '—'} · durable backend ledger · auto-refresh every 30s
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0B1220' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E293B',
  },
  backButton: { padding: 6, marginRight: 6 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: '#F1F5F9', fontSize: 18, fontWeight: '700' as const },
  headerSubtitle: { color: '#64748B', fontSize: 11, marginTop: 2 },
  refreshButton: { padding: 8 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  loadingText: { color: '#94A3B8', fontSize: 14 },
  errorTitle: { color: '#F1F5F9', fontSize: 17, fontWeight: '700' as const },
  errorBody: { color: '#94A3B8', fontSize: 13, textAlign: 'center' as const },
  retryButton: { marginTop: 8, backgroundColor: '#FBBF24', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#0B1220', fontWeight: '700' as const },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: '#111A2C', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1E293B' },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardHeader: { color: '#E2E8F0', fontSize: 15, fontWeight: '700' as const },
  progressTrack: { height: 8, backgroundColor: '#1E293B', borderRadius: 4, overflow: 'hidden' as const },
  progressFill: { height: 8, backgroundColor: '#34D399', borderRadius: 4 },
  progressLabel: { color: '#94A3B8', fontSize: 12, marginTop: 6, marginBottom: 10 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  statPill: { backgroundColor: '#0B1220', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, minWidth: 92, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: '#64748B', fontSize: 11, marginTop: 2 },
  approvalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B', paddingVertical: 8, gap: 2 },
  approvalTitle: { color: '#F1F5F9', fontSize: 13, fontWeight: '600' as const },
  approvalMeta: { color: '#94A3B8', fontSize: 11 },
  jobRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B', paddingVertical: 10 },
  jobTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  jobId: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' as const },
  jobStatus: { fontSize: 11, fontWeight: '700' as const },
  jobPriority: { color: '#64748B', fontSize: 11, fontWeight: '600' as const },
  jobWorker: { color: '#60A5FA', fontSize: 11, flex: 1, textAlign: 'right' as const },
  jobTitle: { color: '#CBD5E1', fontSize: 13, marginTop: 4 },
  jobDetail: { marginTop: 8, gap: 4 },
  jobEvidence: { color: '#34D399', fontSize: 12 },
  jobBlocker: { color: '#F87171', fontSize: 12 },
  jobMeta: { color: '#64748B', fontSize: 11 },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  historyText: { color: '#94A3B8', fontSize: 11, flex: 1 },
  workerRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B', paddingVertical: 8 },
  workerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  workerId: { color: '#FBBF24', fontSize: 12, fontWeight: '800' as const },
  workerName: { color: '#E2E8F0', fontSize: 13, fontWeight: '600' as const, flex: 1 },
  workerScope: { color: '#64748B', fontSize: 11, marginTop: 2 },
  workerMeta: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  emptyText: { color: '#64748B', fontSize: 13 },
  footerNote: { color: '#475569', fontSize: 11, textAlign: 'center' as const, marginTop: 4 },
  guardianBadge: { fontSize: 12, fontWeight: '800' as const, marginLeft: 'auto' as const },
  guardianMeta: { color: '#64748B', fontSize: 11, marginBottom: 8 },
  probeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5 },
  probeTextWrap: { flex: 1 },
  probeName: { color: '#E2E8F0', fontSize: 13, fontWeight: '600' as const },
  probeDetail: { color: '#94A3B8', fontSize: 11, marginTop: 1 },
  incidentBox: { marginTop: 8, gap: 3 },
  incidentHeader: { color: '#F87171', fontSize: 12, fontWeight: '700' as const },
  smsBox: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1E293B', paddingTop: 8, gap: 3 },
  smsHeader: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' as const },
  qaStatusRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 14, marginBottom: 6 },
  qaStatusItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});