import React, { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Filter,
  Layers,
  LockKeyhole,
  Network,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  X,
  XCircle} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { getIVXOwnerAIConfigAudit } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  getIVXAgentLiveActivity,
  type IVXLiveActivityResponse,
  type IVXLiveAgentJob} from '@/src/modules/ivx-owner-ai/services/ivxAgentJobsService';
import {
  ivxAIRequestService,
  type IVXOwnerAIProbeResult} from '@/src/modules/ivx-owner-ai/services/ivxAIRequestService';
import {
  getIVXCTODashboardOverview,
  performIVXAutonomousCycleControlAction,
  performIVXCTOControlAction,
  searchIVXCTOAuditLog,
  type IVXAgentExecutionStatus,
  type IVXAgentId,
  type IVXAgentRiskLevel,
  type IVXAutonomousCycle,
  type IVXAutonomousCycleControlAction,
  type IVXAutonomousCycleStatus,
  type IVXConfidenceBand,
  type IVXCTOAuditEntry,
  type IVXCTOControlAction,
  type IVXCTODashboardOverview,
  type IVXCTOTaskRecord,
  type IVXIssueKind} from '@/src/modules/ivx-owner-ai/services/ivxCTODashboardService';

const QUERY_KEY = ['ivx-owner-ai', 'cto-dashboard-overview'] as const;
const AUDIT_QUERY_KEY = ['ivx-owner-ai', 'cto-dashboard-audit'] as const;
const LIVE_ACTIVITY_QUERY_KEY = ['ivx-owner-ai', 'agent-jobs-live-activity'] as const;
const IVX_AI_STATUS_QUERY_KEY = ['ivx-owner-ai', 'cto-ai-status'] as const;

type IVXAIStatusTone = 'good' | 'warn' | 'bad' | 'info';

type IVXBackendHealthProbe = {
  ok: boolean;
  status: number | null;
  url: string | null;
  deploymentMarker: string | null;
  timestamp: string | null;
  error: string | null;
};

type IVXAIStatusSnapshot = {
  backendHealth: IVXBackendHealthProbe;
  ownerAI: IVXOwnerAIProbeResult | null;
  ownerAIError: string | null;
  localTimezone: string;
  localTimeLabel: string;
  checkedAt: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumberField(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveRuntimeV2TaskCount(taskTree: Record<string, unknown> | null): number {
  const flat = Array.isArray(taskTree?.flat) ? taskTree.flat : null;
  return flat ? flat.length : 0;
}

function resolveDashboardTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timezone === 'string' && timezone.trim().length > 0) {
      return timezone.trim();
    }
  } catch (error) {
    console.log('[IVXCTODashboard] timezone resolution failed', error instanceof Error ? error.message : 'unknown');
  }
  return 'UTC';
}

function formatLocalTime(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'medium'}).format(new Date());
  } catch {
    return new Date().toLocaleString();
  }
}

function pushUniqueUrl(values: string[], value: string | null | undefined): void {
  const normalized = value?.trim();
  if (!normalized || values.includes(normalized)) return;
  values.push(normalized);
}

function buildBackendHealthUrls(): string[] {
  const audit = getIVXOwnerAIConfigAudit();
  const urls: string[] = [];
  pushUniqueUrl(urls, audit.healthCheckUrl);
  if (audit.activeBaseUrl) {
    pushUniqueUrl(urls, `${audit.activeBaseUrl.replace(/\/+$/, '')}/health`);
  }
  for (const endpoint of audit.candidateEndpoints) {
    const normalized = endpoint.replace(/\/+$/, '');
    if (normalized.endsWith('/api/ivx/owner-ai')) {
      pushUniqueUrl(urls, `${normalized.slice(0, -'/api/ivx/owner-ai'.length)}/health`);
    } else if (normalized.endsWith('/ivx/owner-ai')) {
      pushUniqueUrl(urls, `${normalized.slice(0, -'/ivx/owner-ai'.length)}/health`);
    }
  }
  pushUniqueUrl(urls, audit.appApiHealthCheckUrl);
  return urls;
}

async function fetchWithDashboardTimeout(url: string, timeoutMs: number = 6_000): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId: ReturnType<typeof setTimeout> | null = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {})});
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function probeBackendHealth(): Promise<IVXBackendHealthProbe> {
  let lastError = 'No backend health URL is configured.';
  for (const url of buildBackendHealthUrls()) {
    try {
      const response = await fetchWithDashboardTimeout(url);
      const text = await response.text();
      let record: Record<string, unknown> | null = null;
      try {
        const parsed = text ? JSON.parse(text) as unknown : null;
        record = isPlainRecord(parsed) ? parsed : null;
      } catch {
        record = null;
      }
      const probe: IVXBackendHealthProbe = {
        ok: response.ok,
        status: response.status,
        url,
        deploymentMarker: readStringField(record, 'deploymentMarker') ?? readStringField(record, 'marker'),
        timestamp: readStringField(record, 'timestamp'),
        error: response.ok ? null : readStringField(record, 'error') ?? `HTTP ${response.status}`};
      if (response.ok || response.status >= 500) {
        return probe;
      }
      lastError = probe.error ?? `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Backend health request failed.';
    }
  }
  return {
    ok: false,
    status: null,
    url: null,
    deploymentMarker: null,
    timestamp: null,
    error: lastError};
}

async function getIVXAIStatusSnapshot(localTimezone: string): Promise<IVXAIStatusSnapshot> {
  const [backendHealthResult, ownerAIResult] = await Promise.allSettled([
    probeBackendHealth(),
    ivxAIRequestService.probeOwnerAIHealth(),
  ]);
  const backendHealth: IVXBackendHealthProbe = backendHealthResult.status === 'fulfilled'
    ? backendHealthResult.value
    : {
        ok: false,
        status: null,
        url: null,
        deploymentMarker: null,
        timestamp: null,
        error: backendHealthResult.reason instanceof Error ? backendHealthResult.reason.message : 'Backend health probe failed.'};
  return {
    backendHealth,
    ownerAI: ownerAIResult.status === 'fulfilled' ? ownerAIResult.value : null,
    ownerAIError: ownerAIResult.status === 'rejected'
      ? (ownerAIResult.reason instanceof Error ? ownerAIResult.reason.message : 'Owner AI probe failed.')
      : null,
    localTimezone,
    localTimeLabel: formatLocalTime(localTimezone),
    checkedAt: new Date().toISOString()};
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function liveStatusColor(status: string): string {
  if (status === 'completed') return Colors.success;
  if (status === 'running' || status === 'validating') return Colors.info;
  if (status === 'queued') return Colors.warning;
  if (status === 'waiting_approval') return Colors.warning;
  if (status === 'failed') return Colors.error;
  if (status === 'canceled') return '#6B7280';
  return Colors.textSecondary;
}

function LiveJobCard({ job }: { job: IVXLiveAgentJob }) {
  const color = liveStatusColor(job.status);
  const progress = Math.max(0, Math.min(100, job.progress));
  return (
    <View style={styles.liveJobCard} testID={`cto-live-job-${job.id}`}>
      <View style={styles.taskHeader}>
        <View style={styles.taskTitleBlock}>
          <Text style={styles.taskGoal} numberOfLines={2}>{job.promptPreview || job.type}</Text>
          <Text style={styles.taskMeta}>{job.agentName ?? 'agent pending'} · {job.type} · {shortId(job.id)}</Text>
        </View>
        <Badge label={job.status.replace(/_/g, ' ')} color={color} />
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: color }]} />
      </View>
      <View style={styles.liveMetaRow}>
        <Text style={styles.liveMetaText}>{progress}%</Text>
        <Text style={styles.liveMetaText}>step: {job.currentStep ?? '—'}</Text>
        <Text style={styles.liveMetaText}>eta: {formatEta(job.etaSeconds)}</Text>
        <Text style={styles.liveMetaText}>try {job.attempts}/{job.maxAttempts}</Text>
      </View>
      {job.chatMessage ? (
        <Text style={styles.liveChatMessage} numberOfLines={2}>{job.chatMessage}</Text>
      ) : null}
      {job.logs.length > 0 ? (
        <View style={styles.liveFeed}>
          {job.logs.slice(-3).map((log, idx) => (
            <Text key={`${job.id}-log-${idx}`} style={styles.liveFeedLine} numberOfLines={2}>
              · {log.chatMessage ?? log.message} <Text style={styles.liveFeedAt}>{timeAgo(log.at)}</Text>
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const AGENT_FILTER_OPTIONS: { id: 'all' | IVXAgentId; label: string }[] = [
  { id: 'all', label: 'All agents' },
  { id: 'cto_orchestrator', label: 'CTO' },
  { id: 'backend_developer', label: 'Backend' },
  { id: 'frontend_developer', label: 'Frontend' },
  { id: 'infrastructure_sre', label: 'SRE' },
  { id: 'supabase_database', label: 'Supabase' },
  { id: 'investor_relations', label: 'Investor' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'operations', label: 'Ops' },
];

const STATUS_FILTER_OPTIONS: { id: 'all' | IVXAgentExecutionStatus; label: string }[] = [
  { id: 'all', label: 'Any status' },
  { id: 'pending', label: 'Pending' },
  { id: 'running', label: 'Running' },
  { id: 'paused', label: 'Paused' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const RISK_FILTER_OPTIONS: { id: 'all' | IVXAgentRiskLevel; label: string }[] = [
  { id: 'all', label: 'Any risk' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const ISSUE_FILTER_OPTIONS: { id: 'all' | IVXIssueKind; label: string }[] = [
  { id: 'all', label: 'Any issue' },
  { id: 'ui_bug', label: 'UI bug' },
  { id: 'lint_type_issue', label: 'Lint/type' },
  { id: 'stale_dependency', label: 'Dependency' },
  { id: 'broken_endpoint', label: 'Endpoint' },
  { id: 'deploy_warning', label: 'Deploy warning' },
  { id: 'performance_anomaly', label: 'Performance' },
];

const CONFIDENCE_FILTER_OPTIONS: { id: 'all' | IVXConfidenceBand; label: string }[] = [
  { id: 'all', label: 'Any confidence' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const CYCLE_STATUS_FILTER_OPTIONS: { id: 'all' | IVXAutonomousCycleStatus; label: string }[] = [
  { id: 'all', label: 'Any cycle status' },
  { id: 'completed', label: 'Completed' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'failed', label: 'Failed' },
  { id: 'deploy_proposed', label: 'Deploy proposed' },
  { id: 'validated', label: 'Validated' },
];

function statusColor(status: string): string {
  if (status === 'completed') return Colors.success;
  if (status === 'running') return Colors.info;
  if (status === 'pending') return Colors.warning;
  if (status === 'paused') return '#9CA3AF';
  if (status === 'blocked') return Colors.warning;
  if (status === 'failed') return Colors.error;
  if (status === 'cancelled') return '#6B7280';
  if (status === 'partial') return Colors.warning;
  return Colors.textSecondary;
}

function riskColor(risk: IVXAgentRiskLevel): string {
  if (risk === 'high') return Colors.error;
  if (risk === 'medium') return Colors.warning;
  return Colors.success;
}

function confidenceColor(confidence: IVXConfidenceBand): string {
  if (confidence === 'high') return Colors.success;
  if (confidence === 'medium') return Colors.info;
  return Colors.warning;
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function timeAgo(at: string): string {
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return at;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}1F` }]}>
      <Text style={[styles.badgeText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterPill, active ? styles.filterPillActive : null]}
      testID={`cto-filter-${label}`}
    >
      <Text style={[styles.filterPillText, active ? styles.filterPillTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function MetricTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' | 'info' }) {
  const color = tone === 'bad' ? Colors.error : tone === 'warn' ? Colors.warning : tone === 'good' ? Colors.success : Colors.info;
  return (
    <View style={styles.metricTile} testID={`cto-metric-${label}`}>
      <View style={[styles.metricIconWrap, { backgroundColor: `${color}1F` }]}>{icon}</View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function statusToneColor(tone: IVXAIStatusTone): string {
  if (tone === 'bad') return Colors.error;
  if (tone === 'warn') return Colors.warning;
  if (tone === 'good') return Colors.success;
  return Colors.info;
}

function StatusTile({ label, value, detail, tone, testID }: {
  label: string;
  value: string;
  detail: string;
  tone: IVXAIStatusTone;
  testID: string;
}) {
  const color = statusToneColor(tone);
  return (
    <View style={styles.statusTile} testID={testID}>
      <View style={styles.statusTileHeader}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={styles.statusLabel}>{label}</Text>
      </View>
      <Text style={[styles.statusValue, { color }]}>{value}</Text>
      <Text style={styles.statusDetail} numberOfLines={3}>{detail}</Text>
    </View>
  );
}

function IVXAIStatusCard({ status, loading, liveActivity, liveActivityError, onRefresh }: {
  status: IVXAIStatusSnapshot | null;
  loading: boolean;
  liveActivity: IVXLiveActivityResponse | null;
  liveActivityError: string | null;
  onRefresh: () => void;
}) {
  const backend = status?.backendHealth ?? null;
  const ownerAI = status?.ownerAI ?? null;
  const backendTone: IVXAIStatusTone = backend?.ok ? 'good' : backend?.error ? 'bad' : 'info';
  const ownerAIActive = ownerAI?.health === 'active';
  const fileUploadReady = ownerAI?.capabilities?.file_upload === true;
  const visionTone: IVXAIStatusTone = ownerAIActive && fileUploadReady ? 'good' : ownerAIActive ? 'warn' : ownerAI ? 'bad' : 'info';
  const liveOk = liveActivity?.ok === true;
  const liveTone: IVXAIStatusTone = liveOk ? 'good' : liveActivityError ? 'bad' : 'info';
  const workerOnline = liveActivity?.worker.loopStarted === true;
  const runtimeV2 = ownerAI?.runtimeV2 ?? null;
  const runtimeV2Planner = isPlainRecord(runtimeV2?.planner) ? runtimeV2.planner : null;
  const runtimeV2Memory = isPlainRecord(runtimeV2?.memory) ? runtimeV2.memory : null;
  const runtimeV2Streaming = isPlainRecord(runtimeV2?.streaming) ? runtimeV2.streaming : null;
  const runtimeV2TaskTree = isPlainRecord(runtimeV2?.taskTree) ? runtimeV2.taskTree : null;
  const runtimeV2TaskCount = resolveRuntimeV2TaskCount(runtimeV2TaskTree);
  const runtimeV2Ready = runtimeV2?.version === 'agent_runtime_v2' && runtimeV2?.backendState?.fallbackMasking === false;
  const runtimeTone: IVXAIStatusTone = runtimeV2Ready && ownerAIActive && liveOk ? 'good' : ownerAIActive || liveOk || runtimeV2Ready ? 'warn' : 'bad';
  const timezone = status?.localTimezone ?? resolveDashboardTimezone();
  const localTime = status?.localTimeLabel ?? formatLocalTime(timezone);
  const marker = ownerAI?.deploymentMarker ?? backend?.deploymentMarker ?? liveActivity?.marker ?? 'not reported';
  const checkedAt = status?.checkedAt ? new Date(status.checkedAt).toLocaleTimeString() : 'pending';

  return (
    <View style={styles.card} testID="cto-ivx-ai-status-card">
      <View style={styles.cardHeaderRow}>
        <Sparkles size={16} color={Colors.primary} />
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.cardTitle}>IVX AI Status</Text>
          <Text style={styles.cardSubtitle}>Live checks for health, GPT-4o vision, timezone routing, background activity, and agent runtime.</Text>
        </View>
        <Pressable onPress={onRefresh} style={styles.refreshButton} testID="cto-ai-status-refresh">
          {loading ? <ShimmerIndicator size="small" color={Colors.black} /> : <RefreshCw size={12} color={Colors.black} />}
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </Pressable>
      </View>
      <View style={styles.statusGrid}>
        <StatusTile
          label="Backend health"
          value={backend?.ok ? 'Live' : 'Not verified'}
          detail={backend?.ok ? `HTTP ${backend.status ?? '—'} · marker ${backend.deploymentMarker ?? '—'}` : backend?.error ?? 'Waiting for health probe.'}
          tone={backendTone}
          testID="cto-status-backend-health"
        />
        <StatusTile
          label="GPT-4o vision"
          value={ownerAIActive && fileUploadReady ? 'Ready' : ownerAIActive ? 'AI live / upload pending' : 'Not verified'}
          detail={ownerAIActive ? `Health probe active; image requests switch to openai/gpt-4o. Upload proof: ${fileUploadReady ? 'pass' : 'pending'}.` : status?.ownerAIError ?? 'Owner AI health probe has not confirmed GPT runtime yet.'}
          tone={visionTone}
          testID="cto-status-gpt4o-vision"
        />
        <StatusTile
          label="Local timezone"
          value={timezone}
          detail={`Device timezone is included in every Owner AI payload. Local time: ${localTime}.`}
          tone="good"
          testID="cto-status-local-timezone"
        />
        <StatusTile
          label="Live activity"
          value={liveOk ? 'HTTP 200' : 'Not verified'}
          detail={liveOk ? `Active jobs ${liveActivity.activeCount}; recent ${liveActivity.recentCompleted.length}; marker ${liveActivity.marker}.` : liveActivityError ?? 'Waiting for owner-only live-activity endpoint.'}
          tone={liveTone}
          testID="cto-status-live-activity"
        />
        <StatusTile
          label="Agent runtime"
          value={ownerAIActive && liveOk ? 'Online' : ownerAIActive || liveOk ? 'Partial' : 'Not verified'}
          detail={liveOk ? `Worker ${workerOnline ? 'started' : 'idle'}; in-flight ${liveActivity.worker.inFlight ? 'yes' : 'no'}; last tick ${liveActivity.worker.lastTickAt ? timeAgo(liveActivity.worker.lastTickAt) : '—'}.` : 'Runtime needs Owner AI probe and live activity endpoint confirmation.'}
          tone={runtimeTone}
          testID="cto-status-agent-runtime"
        />
        <StatusTile
          label="Runtime v2"
          value={runtimeV2Ready ? 'Planner online' : 'Not verified'}
          detail={runtimeV2Ready
            ? `Memory ${readStringField(runtimeV2Memory, 'state') ?? 'unknown'}; tasks ${runtimeV2TaskCount}; chunks ${readNumberField(runtimeV2Streaming, 'estimatedChunks') ?? 1}; route ${readStringField(runtimeV2Planner, 'route') ?? 'unknown'}.`
            : 'Waiting for backend runtimeV2 proof; no fallback masking is allowed.'}
          tone={runtimeV2Ready ? 'good' : 'info'}
          testID="cto-status-runtime-v2"
        />
      </View>
      <Text style={styles.statusFooter}>Last check {checkedAt} · deployment marker {marker}</Text>
    </View>
  );
}

function TaskCard({ task, onPress }: { task: IVXCTOTaskRecord; onPress: () => void }) {
  const sColor = statusColor(task.status);
  const rColor = riskColor(task.risk);
  return (
    <Pressable style={styles.taskCard} onPress={onPress} testID={`cto-task-${task.id}`}>
      <View style={styles.taskHeader}>
        <View style={styles.taskTitleBlock}>
          <Text style={styles.taskGoal} numberOfLines={2}>{task.goal}</Text>
          <Text style={styles.taskMeta}>{task.assignedAgent} · {shortId(task.id)} · {timeAgo(task.updatedAt)}</Text>
        </View>
        <ChevronRight size={16} color={Colors.textTertiary} />
      </View>
      <View style={styles.badgeRow}>
        <Badge label={task.status} color={sColor} />
        <Badge label={`risk: ${task.risk}`} color={rColor} />
        {task.approvalRequired ? <Badge label={task.approvedBy ? 'approved' : 'approval needed'} color={task.approvedBy ? Colors.success : Colors.warning} /> : null}
      </View>
      {task.blockedReason ? <Text style={styles.blockedReason} numberOfLines={2}>Blocked: {task.blockedReason}</Text> : null}
      {task.error ? <Text style={styles.errorReason} numberOfLines={2}>Error: {task.error}</Text> : null}
    </Pressable>
  );
}

function AutonomousCycleCard({ cycle, onAction, onInspect }: {
  cycle: IVXAutonomousCycle;
  onAction: (action: IVXAutonomousCycleControlAction, cycleId: string, opts?: { approverEmail?: string; reason?: string }) => Promise<void>;
  onInspect: () => void;
}) {
  const canApprove = cycle.risk === 'low' && cycle.approvalStatus === 'pending_owner_approval' && cycle.validationResult?.ok === true && cycle.rollbackSimulation?.ok === true;
  const canReject = cycle.approvalStatus === 'pending_owner_approval' || cycle.deployProposal?.action === 'requires_owner_approval';
  const run = useCallback((action: IVXAutonomousCycleControlAction, reason?: string) => {
    void onAction(action, cycle.id, { approverEmail: process.env.EXPO_PUBLIC_OWNER_EMAIL ?? 'owner@ivxholding.com', reason });
  }, [cycle.id, onAction]);

  return (
    <View style={styles.cycleCard} testID={`cto-autonomous-cycle-${cycle.id}`}>
      <View style={styles.taskHeader}>
        <View style={styles.taskTitleBlock}>
          <Text style={styles.taskGoal} numberOfLines={2}>{cycle.detectedSignal}</Text>
          <Text style={styles.taskMeta}>{cycle.assignedAgent} · {shortId(cycle.id)} · {timeAgo(cycle.updatedAt)}</Text>
        </View>
        <Pressable onPress={onInspect} hitSlop={10} testID={`cto-cycle-inspect-${cycle.id}`}>
          <ChevronRight size={16} color={Colors.textTertiary} />
        </Pressable>
      </View>
      <View style={styles.badgeRow}>
        <Badge label={cycle.issueType.replace(/_/g, ' ')} color={Colors.info} />
        <Badge label={cycle.status.replace(/_/g, ' ')} color={statusColor(cycle.status)} />
        <Badge label={`confidence: ${cycle.confidence}`} color={confidenceColor(cycle.confidence)} />
        <Badge label={`risk: ${cycle.risk}`} color={riskColor(cycle.risk)} />
        <Badge label={cycle.approvalStatus.replace(/_/g, ' ')} color={cycle.approvalStatus === 'blocked' || cycle.approvalStatus === 'rejected' ? Colors.error : cycle.approvalStatus.includes('approved') ? Colors.success : Colors.warning} />
      </View>
      <Text style={styles.auditDetail} numberOfLines={2}>Patch: {cycle.patchProposal?.summary ?? 'No patch proposal yet'}</Text>
      <Text style={styles.auditDetail} numberOfLines={2}>Validation: {cycle.validationResult ? (cycle.validationResult.ok ? 'green' : 'failed') : 'pending'} · Rollback: {cycle.rollbackSimulation?.rollbackStrategy ?? 'pending'}</Text>
      <Text style={styles.auditDetail} numberOfLines={2}>Deploy: {cycle.deployProposal?.action ?? 'pending'} · Audit {cycle.auditStatus} · Memory {cycle.memoryWriteStatus}</Text>
      <View style={styles.actionRow}>
        <ActionButton icon={<ShieldCheck size={14} color={Colors.black} />} label="Approve low-risk" tone="primary" disabled={!canApprove} onPress={() => run('approve_low_risk_deploy')} />
        <ActionButton icon={<XCircle size={14} color={Colors.white} />} label="Reject" tone="danger" disabled={!canReject} onPress={() => run('reject_proposal', 'rejected from CTO dashboard')} />
        <ActionButton icon={<RefreshCw size={14} color={Colors.black} />} label="Re-run validation" tone="warning" onPress={() => run('rerun_validation')} />
      </View>
      {cycle.risk !== 'low' ? <Text style={styles.highRiskNote}>Medium/high-risk autonomous deploy approvals stay blocked at the API layer.</Text> : null}
    </View>
  );
}

function AutonomousCycleDetailModal({ visible, cycle, onClose, onAction, ownerEmail }: {
  visible: boolean;
  cycle: IVXAutonomousCycle | null;
  onClose: () => void;
  onAction: (action: IVXAutonomousCycleControlAction, cycleId: string, opts?: { approverEmail?: string; reason?: string }) => Promise<void>;
  ownerEmail: string;
}) {
  const [pending, setPending] = useState<IVXAutonomousCycleControlAction | null>(null);

  const run = useCallback(async (action: IVXAutonomousCycleControlAction, reason?: string) => {
    if (!cycle) return;
    setPending(action);
    try {
      await onAction(action, cycle.id, { approverEmail: ownerEmail, reason });
    } finally {
      setPending(null);
    }
  }, [cycle, onAction, ownerEmail]);

  if (!cycle) return null;
  const canApprove = cycle.risk === 'low' && cycle.approvalStatus === 'pending_owner_approval' && cycle.validationResult?.ok === true && cycle.rollbackSimulation?.ok === true;
  const canReject = cycle.approvalStatus === 'pending_owner_approval' || cycle.deployProposal?.action === 'requires_owner_approval';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Autonomous cycle</Text>
          <Pressable onPress={onClose} testID="cto-close-cycle-detail" hitSlop={12}>
            <X size={22} color={Colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalContent}>
          <Text style={styles.modalGoal}>{cycle.detectedSignal}</Text>
          <View style={styles.badgeRow}>
            <Badge label={cycle.issueType.replace(/_/g, ' ')} color={Colors.info} />
            <Badge label={cycle.status.replace(/_/g, ' ')} color={statusColor(cycle.status)} />
            <Badge label={`confidence: ${cycle.confidence}`} color={confidenceColor(cycle.confidence)} />
            <Badge label={`risk: ${cycle.risk}`} color={riskColor(cycle.risk)} />
          </View>
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Cycle ID · Task ID</Text>
            <Text style={styles.detailMono}>{cycle.id}{cycle.taskId ? ` · ${cycle.taskId}` : ''}</Text>
          </View>
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Patch proposal</Text>
            <Text style={styles.detailText}>{cycle.patchProposal?.summary ?? 'No patch proposed yet.'}</Text>
            {cycle.patchProposal?.filePath ? <Text style={styles.detailMono}>{cycle.patchProposal.filePath}</Text> : null}
            {cycle.patchProposal?.diffPreview ? <Text style={styles.detailMono}>{cycle.patchProposal.diffPreview}</Text> : null}
            {cycle.patchProposal?.testPlan ? <Text style={styles.detailText}>Test plan: {cycle.patchProposal.testPlan}</Text> : null}
          </View>
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Validation result</Text>
            <Text style={styles.detailText}>{cycle.validationResult ? (cycle.validationResult.ok ? 'All checks passed' : 'Validation failed') : 'Pending'}</Text>
            {cycle.validationResult?.checks.map((check) => (
              <Text key={`${cycle.id}-${check.name}`} style={check.ok ? styles.detailText : styles.errorText}>· {check.name}: {check.detail}</Text>
            )) ?? null}
          </View>
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Rollback simulation</Text>
            <Text style={styles.detailText}>{cycle.rollbackSimulation ? `${cycle.rollbackSimulation.rollbackStrategy} · ok=${cycle.rollbackSimulation.ok} · ${cycle.rollbackSimulation.estimatedDowntimeSeconds}s` : 'Pending'}</Text>
            {cycle.rollbackSimulation?.notes ? <Text style={styles.detailText}>{cycle.rollbackSimulation.notes}</Text> : null}
          </View>
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Deploy proposal + approval</Text>
            <Text style={styles.detailText}>Deploy: {cycle.deployProposal?.action ?? 'pending'} · Approval: {cycle.approvalStatus}</Text>
            {cycle.deployProposal?.reasons.map((reason, index) => (
              <Text key={`${cycle.id}-reason-${index}`} style={styles.detailText}>· {reason}</Text>
            )) ?? null}
            <Text style={styles.detailText}>Audit: {cycle.auditStatus} · Memory: {cycle.memoryWriteStatus}</Text>
          </View>
          <Text style={styles.sectionTitle}>Cycle timeline</Text>
          {cycle.steps.map((step, idx) => (
            <View key={`${cycle.id}-cycle-step-${idx}`} style={styles.timelineRow}>
              <View style={[styles.timelineDot, { backgroundColor: statusColor(step.status) }]} />
              <View style={styles.timelineCopy}>
                <Text style={styles.timelineAction}>{step.status.replace(/_/g, ' ')}</Text>
                <Text style={styles.timelineDetail} numberOfLines={4}>{step.detail}</Text>
                <Text style={styles.timelineAt}>{new Date(step.at).toLocaleString()}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.sectionTitle}>Owner-only controls</Text>
          <View style={styles.actionRow}>
            <ActionButton icon={<ShieldCheck size={14} color={Colors.black} />} label="Approve low-risk" tone="primary" disabled={!canApprove || pending !== null} loading={pending === 'approve_low_risk_deploy'} onPress={() => void run('approve_low_risk_deploy')} />
            <ActionButton icon={<XCircle size={14} color={Colors.white} />} label="Reject" tone="danger" disabled={!canReject || pending !== null} loading={pending === 'reject_proposal'} onPress={() => void run('reject_proposal', 'rejected from CTO dashboard')} />
            <ActionButton icon={<RefreshCw size={14} color={Colors.black} />} label="Re-run validation" tone="warning" disabled={pending !== null} loading={pending === 'rerun_validation'} onPress={() => void run('rerun_validation')} />
          </View>
          {cycle.risk !== 'low' ? <Text style={styles.highRiskNote}>Medium/high-risk deploy approval is intentionally unavailable here.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function TaskDetailModal({ visible, task, onClose, onAction, ownerEmail }: {
  visible: boolean;
  task: IVXCTOTaskRecord | null;
  onClose: () => void;
  onAction: (action: IVXCTOControlAction, taskId: string, opts?: { approverEmail?: string; reason?: string }) => Promise<void>;
  ownerEmail: string;
}) {
  const [pending, setPending] = useState<IVXCTOControlAction | null>(null);

  const run = useCallback(async (action: IVXCTOControlAction) => {
    if (!task) return;
    setPending(action);
    try {
      await onAction(action, task.id, action === 'approve' ? { approverEmail: ownerEmail } : undefined);
    } finally {
      setPending(null);
    }
  }, [task, onAction, ownerEmail]);

  if (!task) return null;
  const canRetry = task.status === 'failed' || task.status === 'cancelled';
  const canCancel = task.status === 'running' || task.status === 'pending' || task.status === 'paused' || task.status === 'blocked';
  const canPause = task.status === 'running' || task.status === 'pending';
  const canResume = task.status === 'paused';
  const canApprove = task.approvalRequired && !task.approvedBy && task.risk !== 'high';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Task control</Text>
          <Pressable onPress={onClose} testID="cto-close-detail" hitSlop={12}>
            <X size={22} color={Colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalContent}>
          <Text style={styles.modalGoal}>{task.goal}</Text>
          <View style={styles.badgeRow}>
            <Badge label={task.status} color={statusColor(task.status)} />
            <Badge label={`risk: ${task.risk}`} color={riskColor(task.risk)} />
            <Badge label={task.assignedAgent} color={Colors.info} />
          </View>
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Task ID</Text>
            <Text style={styles.detailMono}>{task.id}</Text>
          </View>
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Created · Updated</Text>
            <Text style={styles.detailText}>{new Date(task.createdAt).toLocaleString()} · {new Date(task.updatedAt).toLocaleString()}</Text>
          </View>
          {task.approvalRequired ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>Approval</Text>
              <Text style={styles.detailText}>{task.approvedBy ? `Approved by ${task.approvedBy}` : 'Owner approval required'}</Text>
            </View>
          ) : null}
          {task.blockedReason ? (
            <View style={[styles.detailBlock, styles.warningBlock]}>
              <ShieldAlert size={14} color={Colors.warning} />
              <Text style={styles.warningText}>{task.blockedReason}</Text>
            </View>
          ) : null}
          {task.error ? (
            <View style={[styles.detailBlock, styles.errorBlock]}>
              <AlertTriangle size={14} color={Colors.error} />
              <Text style={styles.errorText}>{task.error}</Text>
            </View>
          ) : null}
          <Text style={styles.sectionTitle}>Execution timeline</Text>
          {task.steps.length === 0 ? (
            <Text style={styles.mutedText}>No steps recorded.</Text>
          ) : task.steps.map((step, idx) => (
            <View key={`${task.id}-step-${idx}`} style={styles.timelineRow}>
              <View style={[styles.timelineDot, { backgroundColor: statusColor(step.status) }]} />
              <View style={styles.timelineCopy}>
                <Text style={styles.timelineAction}>{step.action} · {step.agentId}</Text>
                <Text style={styles.timelineDetail} numberOfLines={3}>{step.detail}</Text>
                <Text style={styles.timelineAt}>{new Date(step.at).toLocaleString()}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.sectionTitle}>Handoffs</Text>
          {task.handoffs.length === 0 ? (
            <Text style={styles.mutedText}>No handoffs recorded.</Text>
          ) : task.handoffs.map((h) => (
            <Text key={h.id} style={styles.timelineDetail}>· {h.fromAgent} → {h.toAgent} ({h.reason}) {timeAgo(h.at)}</Text>
          ))}
          <Text style={styles.sectionTitle}>Owner controls</Text>
          <View style={styles.actionRow}>
            <ActionButton icon={<RotateCcw size={14} color={Colors.black} />} label="Retry" tone="primary" disabled={!canRetry || pending !== null} loading={pending === 'retry'} onPress={() => void run('retry')} />
            <ActionButton icon={<Pause size={14} color={Colors.black} />} label="Pause" tone="warning" disabled={!canPause || pending !== null} loading={pending === 'pause'} onPress={() => void run('pause')} />
            <ActionButton icon={<Play size={14} color={Colors.black} />} label="Resume" tone="primary" disabled={!canResume || pending !== null} loading={pending === 'resume'} onPress={() => void run('resume')} />
            <ActionButton icon={<XCircle size={14} color={Colors.white} />} label="Cancel" tone="danger" disabled={!canCancel || pending !== null} loading={pending === 'cancel'} onPress={() => void run('cancel')} />
            <ActionButton icon={<ShieldCheck size={14} color={Colors.black} />} label="Approve (low/medium)" tone="primary" disabled={!canApprove || pending !== null} loading={pending === 'approve'} onPress={() => void run('approve')} />
          </View>
          {task.risk === 'high' ? (
            <Text style={styles.highRiskNote}>High-risk tasks cannot be approved here. They remain blocked automatically.</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function ActionButton({ icon, label, onPress, tone, disabled, loading }: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  tone: 'primary' | 'danger' | 'warning';
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg = tone === 'danger' ? Colors.error : tone === 'warning' ? Colors.warning : Colors.primary;
  const fg = tone === 'danger' ? Colors.white : Colors.black;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionButton, { backgroundColor: bg, opacity: disabled ? 0.4 : 1 }]}
      testID={`cto-action-${label}`}
    >
      {loading ? <ShimmerIndicator size="small" color={fg} /> : icon}
      <Text style={[styles.actionLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export default function IVXCTODashboardRoute() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [agentFilter, setAgentFilter] = useState<'all' | IVXAgentId>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | IVXAgentExecutionStatus>('all');
  const [riskFilter, setRiskFilter] = useState<'all' | IVXAgentRiskLevel>('all');
  const [issueFilter, setIssueFilter] = useState<'all' | IVXIssueKind>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<'all' | IVXConfidenceBand>('all');
  const [cycleStatusFilter, setCycleStatusFilter] = useState<'all' | IVXAutonomousCycleStatus>('all');
  const [cycleRiskFilter, setCycleRiskFilter] = useState<'all' | IVXAgentRiskLevel>('all');
  const [auditQuery, setAuditQuery] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<IVXCTOTaskRecord | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<IVXAutonomousCycle | null>(null);
  const [memoryAgent, setMemoryAgent] = useState<IVXAgentId | null>(null);

  const ownerEmail = useMemo(() => {
    const fromEnv = (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? '').trim();
    return fromEnv || 'owner@ivxholding.com';
  }, []);

  const overviewQuery = useQuery<IVXCTODashboardOverview, Error>({
    queryKey: [...QUERY_KEY, agentFilter, statusFilter, riskFilter, issueFilter, confidenceFilter, cycleStatusFilter, cycleRiskFilter] as const,
    queryFn: () => getIVXCTODashboardOverview({
      agentId: agentFilter === 'all' ? undefined : agentFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      risk: riskFilter === 'all' ? undefined : riskFilter,
      issueType: issueFilter === 'all' ? undefined : issueFilter,
      confidence: confidenceFilter === 'all' ? undefined : confidenceFilter,
      cycleStatus: cycleStatusFilter === 'all' ? undefined : cycleStatusFilter,
      cycleRisk: cycleRiskFilter === 'all' ? undefined : cycleRiskFilter,
      limit: 60}),
    refetchInterval: 30_000});

  const liveActivityQuery = useQuery<IVXLiveActivityResponse, Error>({
    queryKey: [...LIVE_ACTIVITY_QUERY_KEY] as const,
    queryFn: () => getIVXAgentLiveActivity(40),
    refetchInterval: 5_000,
    retry: 1});

  const localTimezone = useMemo<string>(() => resolveDashboardTimezone(), []);
  const aiStatusQuery = useQuery<IVXAIStatusSnapshot, Error>({
    queryKey: [...IVX_AI_STATUS_QUERY_KEY, localTimezone] as const,
    queryFn: () => getIVXAIStatusSnapshot(localTimezone),
    refetchInterval: 15_000,
    retry: 1});

  const auditQueryResult = useQuery<{ ok: boolean; audit: IVXCTOAuditEntry[]; total: number; marker: string }, Error>({
    queryKey: [...AUDIT_QUERY_KEY, auditQuery, agentFilter] as const,
    queryFn: () => searchIVXCTOAuditLog({
      agentId: agentFilter === 'all' ? undefined : agentFilter,
      q: auditQuery || undefined,
      limit: 80}),
    refetchInterval: 60_000});

  const controlMutation = useMutation({
    mutationFn: async (input: { action: IVXCTOControlAction; taskId: string; approverEmail?: string; reason?: string }) => {
      return performIVXCTOControlAction(input);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: AUDIT_QUERY_KEY });
      setSelectedTask(result.task);
    },
    onError: (error: Error) => {
      Alert.alert('Owner control failed', error.message);
    }});

  const cycleControlMutation = useMutation({
    mutationFn: async (input: { action: IVXAutonomousCycleControlAction; cycleId: string; approverEmail?: string; reason?: string }) => {
      return performIVXAutonomousCycleControlAction(input);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: AUDIT_QUERY_KEY });
      setSelectedCycle(result.cycle);
    },
    onError: (error: Error) => {
      Alert.alert('Autonomous cycle control failed', error.message);
    }});

  const handleControlAction = useCallback(async (action: IVXCTOControlAction, taskId: string, opts?: { approverEmail?: string; reason?: string }) => {
    await controlMutation.mutateAsync({ action, taskId, ...opts });
  }, [controlMutation]);

  const handleCycleControlAction = useCallback(async (action: IVXAutonomousCycleControlAction, cycleId: string, opts?: { approverEmail?: string; reason?: string }) => {
    await cycleControlMutation.mutateAsync({ action, cycleId, ...opts });
  }, [cycleControlMutation]);

  const overview = overviewQuery.data ?? null;
  const tasks = overview?.tasks ?? [];
  const blockedTasks = overview?.blockedTasks ?? [];
  const parents = overview?.parents ?? [];
  const handoffs = overview?.handoffs ?? [];
  const deployProposals = overview?.deployProposals ?? [];
  const retryEvents = overview?.retryEvents ?? [];
  const autonomousCycles = overview?.autonomousCycles ?? [];
  const audit = useMemo<IVXCTOAuditEntry[]>(() => auditQueryResult.data?.audit ?? [], [auditQueryResult.data?.audit]);

  const memoryNamespaces = useMemo(() => overview?.activeAgents.map((a) => ({ id: a.id, namespace: a.memoryNamespace, name: a.name })) ?? [], [overview?.activeAgents]);
  const filteredAuditByAgent = useMemo(() => {
    if (!memoryAgent) return audit;
    return audit.filter((row) => row.agentId === memoryAgent);
  }, [audit, memoryAgent]);

  return (
    <ErrorBoundary fallbackTitle="CTO Dashboard unavailable">
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(120, insets.bottom + 96) }]}
        refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={overviewQuery.isFetching || aiStatusQuery.isFetching} onRefresh={() => { void overviewQuery.refetch(); void auditQueryResult.refetch(); void liveActivityQuery.refetch(); void aiStatusQuery.refetch(); }} />}
        testID="cto-dashboard-screen"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <LockKeyhole size={13} color={Colors.black} />
            <Text style={styles.heroBadgeText}>owner-only</Text>
          </View>
          <Text style={styles.heroTitle}>CTO Operational Dashboard</Text>
          <Text style={styles.heroSubtitle}>Live IVX IA orchestration: parent/child tasks, agent health, audit trail, memory writes, retries, and safe owner controls.</Text>
          {overview ? (
            <View style={styles.metricsGrid}>
              <MetricTile icon={<Layers size={14} color={Colors.info} />} label="Total tasks" value={overview.summary.totalTasks} tone="info" />
              <MetricTile icon={<Activity size={14} color={Colors.success} />} label="Active agents" value={overview.summary.activeAgentsCount} tone="good" />
              <MetricTile icon={<Sparkles size={14} color={Colors.info} />} label="Parent tasks" value={overview.summary.parentTaskCount} tone="info" />
              <MetricTile icon={<ShieldAlert size={14} color={Colors.warning} />} label="Blocked" value={overview.summary.blockedTasksCount} tone="warn" />
              <MetricTile icon={<RotateCcw size={14} color={Colors.warning} />} label="Retries" value={overview.summary.retryEventsCount} tone="warn" />
              <MetricTile icon={<Network size={14} color={Colors.info} />} label="Handoffs" value={overview.summary.handoffsCount} tone="info" />
              <MetricTile icon={<ShieldCheck size={14} color={Colors.success} />} label="Auto cycles" value={overview.summary.autonomousCyclesCount ?? 0} tone="good" />
              <MetricTile icon={<AlertTriangle size={14} color={Colors.warning} />} label="Cycle approvals" value={overview.summary.autonomousApprovalQueueCount ?? 0} tone="warn" />
            </View>
          ) : null}
          {overviewQuery.error ? (
            <Text style={styles.errorText}>{overviewQuery.error.message}</Text>
          ) : null}
        </View>

        <IVXAIStatusCard
          status={aiStatusQuery.data ?? null}
          loading={aiStatusQuery.isFetching}
          liveActivity={liveActivityQuery.data ?? null}
          liveActivityError={liveActivityQuery.error?.message ?? null}
          onRefresh={() => { void aiStatusQuery.refetch(); void liveActivityQuery.refetch(); }}
        />

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Filter size={16} color={Colors.primary} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Filters</Text>
              <Text style={styles.cardSubtitle}>Agent · status · risk · time range</Text>
            </View>
            <Pressable onPress={() => { void overviewQuery.refetch(); }} style={styles.refreshButton} testID="cto-refresh">
              <RefreshCw size={12} color={Colors.black} />
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </Pressable>
          </View>
          <Text style={styles.subLabel}>Agent</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {AGENT_FILTER_OPTIONS.map((opt) => (
              <FilterPill key={opt.id} label={opt.label} active={agentFilter === opt.id} onPress={() => setAgentFilter(opt.id)} />
            ))}
          </ScrollView>
          <Text style={styles.subLabel}>Status</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <FilterPill key={opt.id} label={opt.label} active={statusFilter === opt.id} onPress={() => setStatusFilter(opt.id)} />
            ))}
          </ScrollView>
          <Text style={styles.subLabel}>Risk</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {RISK_FILTER_OPTIONS.map((opt) => (
              <FilterPill key={opt.id} label={opt.label} active={riskFilter === opt.id} onPress={() => setRiskFilter(opt.id)} />
            ))}
          </ScrollView>
          <Text style={styles.subLabel}>Autonomous issue type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {ISSUE_FILTER_OPTIONS.map((opt) => (
              <FilterPill key={opt.id} label={opt.label} active={issueFilter === opt.id} onPress={() => setIssueFilter(opt.id)} />
            ))}
          </ScrollView>
          <Text style={styles.subLabel}>Autonomous confidence</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {CONFIDENCE_FILTER_OPTIONS.map((opt) => (
              <FilterPill key={opt.id} label={opt.label} active={confidenceFilter === opt.id} onPress={() => setConfidenceFilter(opt.id)} />
            ))}
          </ScrollView>
          <Text style={styles.subLabel}>Autonomous status + risk</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {CYCLE_STATUS_FILTER_OPTIONS.map((opt) => (
              <FilterPill key={opt.id} label={opt.label} active={cycleStatusFilter === opt.id} onPress={() => setCycleStatusFilter(opt.id)} />
            ))}
            {RISK_FILTER_OPTIONS.map((opt) => (
              <FilterPill key={`cycle-risk-${opt.id}`} label={`Cycle ${opt.label.toLowerCase()}`} active={cycleRiskFilter === opt.id} onPress={() => setCycleRiskFilter(opt.id)} />
            ))}
          </ScrollView>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Activity size={16} color={Colors.success} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Agent health</Text>
              <Text style={styles.cardSubtitle}>Active task counts per specialist agent.</Text>
            </View>
          </View>
          <View style={styles.agentGrid}>
            {(overview?.activeAgents ?? []).map((agent) => (
              <View key={agent.id} style={styles.agentTile} testID={`cto-agent-${agent.id}`}>
                <View style={[styles.agentDot, { backgroundColor: agent.activeTaskCount > 0 ? Colors.success : Colors.textTertiary }]} />
                <Text style={styles.agentName}>{agent.name}</Text>
                <Text style={styles.agentMeta}>active: {agent.activeTaskCount} · risk≤{agent.riskLimit}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Activity size={16} color={Colors.info} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Live agent activity ({liveActivityQuery.data?.activeCount ?? 0})</Text>
              <Text style={styles.cardSubtitle}>Background jobs streaming progress, agent, step and ETA. Owner-only.</Text>
            </View>
            <Pressable onPress={() => { void liveActivityQuery.refetch(); }} style={styles.refreshButton} testID="cto-live-refresh">
              <RefreshCw size={12} color={Colors.black} />
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </Pressable>
          </View>
          {liveActivityQuery.error ? (
            <Text style={styles.errorText}>{liveActivityQuery.error.message}</Text>
          ) : null}
          {liveActivityQuery.isLoading ? (
            <ShimmerIndicator color={Colors.primary} />
          ) : (liveActivityQuery.data?.activeJobs.length ?? 0) === 0 ? (
            <Text style={styles.mutedText}>No background jobs running. Create one via POST /api/ivx/agent-jobs to see live progress here.</Text>
          ) : (liveActivityQuery.data?.activeJobs ?? []).map((job) => (
            <LiveJobCard key={job.id} job={job} />
          ))}
          {(liveActivityQuery.data?.recentCompleted.length ?? 0) > 0 ? (
            <View style={styles.recentBlock}>
              <Text style={styles.subLabel}>Recently finished</Text>
              {(liveActivityQuery.data?.recentCompleted ?? []).map((j) => (
                <Text key={`recent-${j.id}`} style={styles.recentLine} numberOfLines={2}>
                  · <Text style={{ color: liveStatusColor(j.status) }}>{j.status.replace(/_/g, ' ')}</Text> {j.agentName ?? 'agent'} — {j.chatMessage ?? j.error ?? j.type}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <ShieldCheck size={16} color={Colors.success} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Autonomous cycles ({autonomousCycles.length})</Text>
              <Text style={styles.cardSubtitle}>Block 29 issue detection, routing, patches, validation, rollback, deploy proposals, audit and memory writes.</Text>
            </View>
          </View>
          <View style={styles.cycleSummaryRow}>
            <Badge label={`blocked: ${overview?.summary.autonomousBlockedCount ?? 0}`} color={Colors.warning} />
            <Badge label={`approval queue: ${overview?.summary.autonomousApprovalQueueCount ?? 0}`} color={Colors.info} />
            <Badge label="owner-only controls" color={Colors.success} />
          </View>
          {overviewQuery.isLoading ? (
            <ShimmerIndicator color={Colors.primary} />
          ) : autonomousCycles.length === 0 ? (
            <Text style={styles.mutedText}>No autonomous cycles match the current filters. Run Block 29 validation to seed sample cycles.</Text>
          ) : autonomousCycles.map((cycle) => (
            <AutonomousCycleCard key={cycle.id} cycle={cycle} onInspect={() => setSelectedCycle(cycle)} onAction={handleCycleControlAction} />
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Layers size={16} color={Colors.info} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Tasks ({tasks.length})</Text>
              <Text style={styles.cardSubtitle}>Tap a task to inspect, retry, cancel, pause, or approve (low/medium risk).</Text>
            </View>
          </View>
          {overviewQuery.isLoading ? (
            <ShimmerIndicator color={Colors.primary} />
          ) : tasks.length === 0 ? (
            <Text style={styles.mutedText}>No tasks match the current filters.</Text>
          ) : tasks.map((task) => (
            <TaskCard key={task.id} task={task} onPress={() => setSelectedTask(task)} />
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <ShieldAlert size={16} color={Colors.warning} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Blocked tasks ({blockedTasks.length})</Text>
              <Text style={styles.cardSubtitle}>Risk gates and high-risk blocks.</Text>
            </View>
          </View>
          {blockedTasks.length === 0 ? (
            <Text style={styles.mutedText}>No blocked tasks.</Text>
          ) : blockedTasks.map((task) => (
            <TaskCard key={task.id} task={task} onPress={() => setSelectedTask(task)} />
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Network size={16} color={Colors.info} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Parent tasks ({parents.length})</Text>
              <Text style={styles.cardSubtitle}>Parallel parent/child trees with aggregation summaries.</Text>
            </View>
          </View>
          {parents.length === 0 ? (
            <Text style={styles.mutedText}>No parent tasks recorded.</Text>
          ) : parents.map((p) => (
            <View key={p.id} style={styles.parentCard} testID={`cto-parent-${p.id}`}>
              <View style={styles.taskHeader}>
                <View style={styles.taskTitleBlock}>
                  <Text style={styles.taskGoal} numberOfLines={2}>{p.goal}</Text>
                  <Text style={styles.taskMeta}>{shortId(p.id)} · {p.children} children · {timeAgo(p.createdAt)}</Text>
                </View>
                <Badge label={p.status} color={statusColor(p.status)} />
              </View>
              {p.aggregation ? (
                <Text style={styles.aggregationText}>{p.aggregation.summary}</Text>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Sparkles size={16} color={Colors.primary} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Deployment proposals ({deployProposals.length})</Text>
              <Text style={styles.cardSubtitle}>Low/medium-risk approvals waiting for owner. High-risk is blocked automatically.</Text>
            </View>
          </View>
          {deployProposals.length === 0 ? (
            <Text style={styles.mutedText}>No deployment proposals.</Text>
          ) : deployProposals.map((proposal) => (
            <Pressable
              key={proposal.taskId}
              style={styles.proposalRow}
              onPress={() => {
                const t = tasks.find((task) => task.id === proposal.taskId) ?? blockedTasks.find((task) => task.id === proposal.taskId);
                if (t) setSelectedTask(t);
              }}
              testID={`cto-proposal-${proposal.taskId}`}
            >
              <View style={styles.taskTitleBlock}>
                <Text style={styles.taskGoal} numberOfLines={2}>{proposal.goal}</Text>
                <Text style={styles.taskMeta}>{proposal.agentId} · {shortId(proposal.taskId)}</Text>
              </View>
              <Badge label={`risk: ${proposal.risk}`} color={riskColor(proposal.risk)} />
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Timer size={16} color={Colors.warning} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Retry & timeout signals ({retryEvents.length})</Text>
              <Text style={styles.cardSubtitle}>Captured from parent/child execution audit.</Text>
            </View>
          </View>
          {retryEvents.length === 0 ? (
            <Text style={styles.mutedText}>No retries observed.</Text>
          ) : retryEvents.slice(0, 12).map((e) => (
            <View key={e.id} style={styles.auditRow}>
              <CircleDashed size={12} color={Colors.warning} />
              <View style={styles.auditCopy}>
                <Text style={styles.auditAction}>{e.action}</Text>
                <Text style={styles.auditDetail} numberOfLines={2}>{e.detail}</Text>
                <Text style={styles.auditAt}>{timeAgo(e.at)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Network size={16} color={Colors.info} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Recent handoffs ({handoffs.length})</Text>
              <Text style={styles.cardSubtitle}>Agent → agent routing.</Text>
            </View>
          </View>
          {handoffs.length === 0 ? (
            <Text style={styles.mutedText}>No handoffs.</Text>
          ) : handoffs.slice(0, 14).map((h) => (
            <Text key={h.id} style={styles.handoffRow}>· {h.fromAgent} → {h.toAgent}  ({h.reason}) {timeAgo(h.at)}</Text>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Search size={16} color={Colors.primary} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Audit log search</Text>
              <Text style={styles.cardSubtitle}>Search by action, detail, or task id.</Text>
            </View>
          </View>
          <View style={styles.searchRow}>
            <TextInput
              value={auditQuery}
              onChangeText={setAuditQuery}
              placeholder="e.g. retry, blocked, parent.aggregated"
              placeholderTextColor={Colors.textTertiary}
              style={styles.searchInput}
              autoCapitalize="none"
              testID="cto-audit-search"
            />
          </View>
          {auditQueryResult.isLoading ? (
            <ShimmerIndicator color={Colors.primary} />
          ) : audit.length === 0 ? (
            <Text style={styles.mutedText}>No audit entries.</Text>
          ) : audit.slice(0, 30).map((row) => (
            <View key={row.id} style={styles.auditRow}>
              <CheckCircle2 size={12} color={Colors.info} />
              <View style={styles.auditCopy}>
                <Text style={styles.auditAction}>{row.action} · {row.agentId}</Text>
                <Text style={styles.auditDetail} numberOfLines={2}>{row.detail}</Text>
                <Text style={styles.auditAt}>{row.taskId ? `${shortId(row.taskId)} · ` : ''}{timeAgo(row.at)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Layers size={16} color={Colors.info} />
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.cardTitle}>Memory namespaces</Text>
              <Text style={styles.cardSubtitle}>Pick an agent to filter audit signals to its namespace.</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <FilterPill label="all" active={memoryAgent === null} onPress={() => setMemoryAgent(null)} />
            {memoryNamespaces.map((m) => (
              <FilterPill key={m.id} label={m.namespace} active={memoryAgent === m.id} onPress={() => setMemoryAgent(m.id)} />
            ))}
          </ScrollView>
          {filteredAuditByAgent.length === 0 ? (
            <Text style={styles.mutedText}>No memory writes recorded.</Text>
          ) : filteredAuditByAgent
            .filter((row) => row.action === 'memory.write' || (row.metadata && typeof row.metadata === 'object' && 'namespace' in row.metadata))
            .slice(0, 16)
            .map((row) => (
              <View key={`${row.id}-mem`} style={styles.auditRow}>
                <CheckCircle2 size={12} color={Colors.success} />
                <View style={styles.auditCopy}>
                  <Text style={styles.auditAction}>{row.action} · {row.agentId}</Text>
                  <Text style={styles.auditDetail} numberOfLines={2}>{row.detail}</Text>
                </View>
              </View>
            ))}
        </View>
      </ScrollView>

      <TaskDetailModal
        visible={selectedTask !== null}
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onAction={handleControlAction}
        ownerEmail={ownerEmail}
      />
      <AutonomousCycleDetailModal
        visible={selectedCycle !== null}
        cycle={selectedCycle}
        onClose={() => setSelectedCycle(null)}
        onAction={handleCycleControlAction}
        ownerEmail={ownerEmail}
      />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  content: {
    padding: 14,
    gap: 12},
  heroCard: {
    padding: 18,
    borderRadius: 28,
    backgroundColor: '#071019',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.28)',
    gap: 12},
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  heroBadgeText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  heroTitle: {
    color: Colors.text,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '900' as const},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600' as const},
  metricsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10},
  metricTile: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 96,
    padding: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 6},
  metricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  metricValue: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '900' as const},
  metricLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700' as const},
  card: {
    padding: 14,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12},
  cardHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10},
  cardHeaderCopy: {
    flex: 1,
    gap: 2},
  cardTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '900' as const},
  cardSubtitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const},
  statusGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8},
  statusTile: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 142,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#07131D',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 6},
  statusTileHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7},
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  statusLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.45},
  statusValue: {
    fontSize: 14,
    fontWeight: '900' as const},
  statusDetail: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700' as const},
  statusFooter: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '800' as const},
  refreshButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.primary},
  refreshButtonText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const},
  subLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  filterRow: {
    flexDirection: 'row' as const,
    gap: 7,
    paddingVertical: 4},
  filterPill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: 'transparent'},
  filterPillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterPillText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '800' as const},
  filterPillTextActive: {
    color: Colors.black},
  agentGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8},
  agentTile: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 130,
    padding: 11,
    borderRadius: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4},
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  agentName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '900' as const},
  agentMeta: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700' as const},
  taskCard: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8},
  cycleCard: {
    padding: 13,
    borderRadius: 18,
    backgroundColor: '#0B1621',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.24)',
    gap: 9},
  cycleSummaryRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6},
  liveJobCard: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#0A1622',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.24)',
    gap: 8},
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden' as const},
  progressFill: {
    height: 6,
    borderRadius: 999},
  liveMetaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 12},
  liveMetaText: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const},
  liveChatMessage: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const},
  liveFeed: {
    gap: 3},
  liveFeedLine: {
    color: Colors.textSecondary,
    fontSize: 11},
  liveFeedAt: {
    color: Colors.textTertiary,
    fontSize: 10},
  recentBlock: {
    gap: 4,
    marginTop: 4},
  recentLine: {
    color: Colors.textSecondary,
    fontSize: 11},
  taskHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8},
  taskTitleBlock: {
    flex: 1,
    gap: 3},
  taskGoal: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800' as const},
  taskMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const},
  badgeRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6},
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1},
  badgeText: {
    fontSize: 10,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.4},
  blockedReason: {
    color: Colors.warning,
    fontSize: 11,
    fontWeight: '700' as const},
  errorReason: {
    color: Colors.error,
    fontSize: 11,
    fontWeight: '700' as const},
  parentCard: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8},
  aggregationText: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700' as const},
  proposalRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border},
  auditRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    paddingVertical: 5},
  auditCopy: {
    flex: 1,
    gap: 2},
  auditAction: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '800' as const},
  auditDetail: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const},
  auditAt: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const},
  handoffRow: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700' as const},
  searchRow: {
    flexDirection: 'row' as const,
    gap: 8},
  searchInput: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const,
    borderWidth: 1,
    borderColor: Colors.border},
  mutedText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '700' as const},
  errorText: {
    color: Colors.error,
    fontSize: 12,
    fontWeight: '800' as const},
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background},
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  modalTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '900' as const},
  modalContent: {
    padding: 16,
    gap: 14},
  modalGoal: {
    color: Colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800' as const},
  detailBlock: {
    padding: 11,
    borderRadius: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 5},
  detailLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '900' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  detailText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const},
  detailMono: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const},
  warningBlock: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: 'rgba(245,158,11,0.3)'},
  warningText: {
    flex: 1,
    color: Colors.warning,
    fontSize: 12,
    fontWeight: '700' as const},
  errorBlock: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.3)'},
  sectionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '900' as const,
    marginTop: 4},
  timelineRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    paddingVertical: 5},
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5},
  timelineCopy: {
    flex: 1,
    gap: 2},
  timelineAction: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '800' as const},
  timelineDetail: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600' as const},
  timelineAt: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const},
  actionRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8},
  actionButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999},
  actionLabel: {
    fontSize: 12,
    fontWeight: '900' as const},
  highRiskNote: {
    color: Colors.error,
    fontSize: 11,
    fontWeight: '800' as const,
    marginTop: 6}});
