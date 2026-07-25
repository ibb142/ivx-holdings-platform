/**
 * IVX AUTONOMOUS QA SCHEDULER — continuous in-process QA (W9).
 *
 * Mandated cadence (AUTOMATIC QA):
 *   - Health check          every 5 minutes
 *   - Authentication API    every 15 minutes
 *   - Protected routes      every 15 minutes (part of the auth probe set)
 *   - Full auth matrix      every 2 hours
 *
 * Runs inside the long-lived Render service process. Results persist to the
 * durable store; incidents open/close through the shared Owner Auth Guardian
 * state, so the guardian, the dashboard and this scheduler share one incident
 * ledger. When a NEW incident opens and the SMS provider is runtime-ready,
 * an owner SMS alert in the mandated IVX ALERT format is attempted and logged.
 *
 * Route (registered in backend/hono-extended.ts):
 *   GET /api/ivx/autonomous/qa — owner-only scheduler status + recent runs
 *
 * Marker: ivx-auth-qa-scheduler-2026-07-17
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { readDurableJson, writeDurableJson } from '../services/ivx-durable-store';
import { sendSnsSms } from '../services/ivx-sns-sms';
import { postQAReportToOwnerChat } from '../services/ivx-qa-chat-reporter';
import { getMigrationSummary } from './ivx-migration-runner';
import { getIAOperatingSummary } from './ivx-ia-orchestrator';
import {
  runAuthProbes,
  reconcileIncidents,
  resolveAlertPhone,
  maskPhone,
  smsProviderStatus,
  GUARDIAN_STATE_FILE_PATH,
  EMPTY_GUARDIAN_STATE,
  type GuardianState,
  type GuardianIncident,
  type AlertLogEntry,
  type ProbeResult,
} from './ivx-owner-auth-guardian';

const QA_MARKER = 'ivx-auth-qa-scheduler-2026-07-17';
const QA_STATE_FILE = 'logs/audit/autonomous-qa/state.json';
const HEALTH_INTERVAL_MS = 5 * 60 * 1000;
const AUTH_INTERVAL_MS = 15 * 60 * 1000;
const MATRIX_INTERVAL_MS = 2 * 60 * 60 * 1000;
const MAX_RUN_LOG = 60;
const SELF_HEALTH_URL = 'https://api.ivxholding.com/health';

type QARunEntry = {
  runId: string;
  kind: 'health' | 'auth' | 'matrix';
  at: string;
  ok: boolean;
  summary: string;
  probes?: { id: string; ok: boolean; httpStatus: number | null; latencyMs: number }[];
};

type QASchedulerState = {
  startedAt: string | null;
  runCounter: number;
  lastHealthAt: string | null;
  lastAuthAt: string | null;
  lastMatrixAt: string | null;
  healthOk: boolean | null;
  authOk: boolean | null;
  recentRuns: QARunEntry[];
};

const EMPTY_QA_STATE: QASchedulerState = {
  startedAt: null,
  runCounter: 0,
  lastHealthAt: null,
  lastAuthAt: null,
  lastMatrixAt: null,
  healthOk: null,
  authOk: null,
  recentRuns: [],
};

type SchedulerGlobal = typeof globalThis & { __ivxQASchedulerStarted?: boolean; __ivxQASchedulerStartedAt?: string };

function nowIso(): string {
  return new Date().toISOString();
}

async function loadQAState(): Promise<QASchedulerState> {
  return readDurableJson<QASchedulerState>(QA_STATE_FILE, EMPTY_QA_STATE);
}

function pushRun(state: QASchedulerState, entry: Omit<QARunEntry, 'runId'>): void {
  state.runCounter += 1;
  state.recentRuns.unshift({ runId: `QA-${String(state.runCounter).padStart(5, '0')}`, ...entry });
  state.recentRuns = state.recentRuns.slice(0, MAX_RUN_LOG);
}

/** 5-minute health tick. Never throws. */
async function healthTick(): Promise<void> {
  try {
    const startedAt = Date.now();
    let status: number | null = null;
    let error: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(SELF_HEALTH_URL, { signal: controller.signal });
      clearTimeout(timer);
      status = response.status;
    } catch (fetchError) {
      error = fetchError instanceof Error ? fetchError.message : 'fetch failed';
    }
    const latencyMs = Date.now() - startedAt;
    const ok = status === 200;
    const state = await loadQAState();
    state.lastHealthAt = nowIso();
    state.healthOk = ok;
    pushRun(state, {
      kind: 'health',
      at: state.lastHealthAt,
      ok,
      summary: error ?? `HTTP ${status} in ${latencyMs}ms`,
    });
    await writeDurableJson(QA_STATE_FILE, state);
  } catch (tickError) {
    console.error('[ivx-qa-scheduler] health tick failed:', tickError instanceof Error ? tickError.message : tickError);
  }
}

/** Send the mandated IVX ALERT SMS for a newly opened incident (auto-repair path). */
async function alertOwnerForIncident(guardianState: GuardianState, incident: GuardianIncident): Promise<void> {
  const provider = smsProviderStatus() as { ready?: boolean };
  const to = resolveAlertPhone();
  const message = [
    'IVX ALERT',
    'Severity: CRITICAL',
    `Incident: ${incident.incidentId}`,
    'Area: Authentication',
    `Problem: ${incident.detail.slice(0, 100)}`,
    'Owner Action: Review Autonomous Dashboard',
    'Dashboard URL: https://ivxholding.com',
    'Status: OPEN',
  ].join('\n');
  const result = provider.ready
    ? await sendSnsSms({ to, message, senderId: 'IVXOwner' })
    : { ok: false, status: 'missing_config' as const, messageId: null, httpStatus: null, missingEnvNames: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'], error: 'SMS provider not runtime-ready; alert logged only.', sentAt: nowIso() };
  guardianState.alertCounter += 1;
  const entry: AlertLogEntry = {
    alertId: `ALERT-${String(guardianState.alertCounter).padStart(4, '0')}`,
    severity: 'CRITICAL',
    area: 'Authentication',
    problem: incident.detail.slice(0, 120),
    smsStatus: result.status,
    messageId: result.messageId ?? null,
    httpStatus: result.httpStatus ?? null,
    toMasked: maskPhone(to),
    sentAt: result.sentAt,
    test: false,
  };
  guardianState.alerts.unshift(entry);
  guardianState.alerts = guardianState.alerts.slice(0, 50);
}

/** 15-minute auth probe tick (auth API + protected routes); matrix flag adds full log detail. */
async function authTick(kind: 'auth' | 'matrix'): Promise<void> {
  try {
    const probes: ProbeResult[] = await runAuthProbes();
    const guardianState = await readDurableJson<GuardianState>(GUARDIAN_STATE_FILE_PATH, EMPTY_GUARDIAN_STATE);
    const newlyOpened = reconcileIncidents(guardianState, probes);
    for (const incident of newlyOpened) {
      await alertOwnerForIncident(guardianState, incident);
    }
    guardianState.lastRunAt = nowIso();
    guardianState.totalRuns += 1;
    await writeDurableJson(GUARDIAN_STATE_FILE_PATH, guardianState);

    const ok = probes.every((probe) => probe.ok);
    const state = await loadQAState();
    const at = nowIso();
    if (kind === 'matrix') {
      state.lastMatrixAt = at;
    }
    state.lastAuthAt = at;
    state.authOk = ok;
    const summary = ok
      ? `${probes.length}/${probes.length} probes ok`
      : `FAIL: ${probes.filter((probe) => !probe.ok).map((probe) => probe.id).join(', ')}${newlyOpened.length > 0 ? ` — opened ${newlyOpened.map((incident) => incident.incidentId).join(', ')}` : ''}`;
    pushRun(state, {
      kind,
      at,
      ok,
      summary,
      probes: probes.map((probe) => ({ id: probe.id, ok: probe.ok, httpStatus: probe.httpStatus, latencyMs: probe.latencyMs })),
    });
    await writeDurableJson(QA_STATE_FILE, state);

    // Every 2h matrix run also posts a verification report into the IVX
    // Owner AI chat (owner mandate 2026-07-17): health, auth and live DB
    // migration status — never a cached green.
    if (kind === 'matrix') {
      const migrations = await getMigrationSummary();
      const iaSummaryLines = await getIAOperatingSummary();
      const runId = state.recentRuns[0]?.runId ?? `QA-${String(state.runCounter).padStart(5, '0')}`;
      await postQAReportToOwnerChat({
        runId,
        healthOk: state.healthOk,
        authOk: ok,
        probesSummary: summary,
        migrations,
        extraLines: iaSummaryLines,
      });
    }
  } catch (tickError) {
    console.error('[ivx-qa-scheduler] auth tick failed:', tickError instanceof Error ? tickError.message : tickError);
  }
}

/** Start the continuous QA scheduler. Idempotent per process. */
export function startAutonomousQAScheduler(): void {
  const globalRef = globalThis as SchedulerGlobal;
  if (globalRef.__ivxQASchedulerStarted) {
    return;
  }
  globalRef.__ivxQASchedulerStarted = true;
  globalRef.__ivxQASchedulerStartedAt = nowIso();

  void (async () => {
    try {
      const state = await loadQAState();
      state.startedAt = globalRef.__ivxQASchedulerStartedAt ?? nowIso();
      await writeDurableJson(QA_STATE_FILE, state);
    } catch (error) {
      console.error('[ivx-qa-scheduler] startup persist failed:', error instanceof Error ? error.message : error);
    }
    // Immediate first ticks so production verification never waits on an interval.
    await healthTick();
    await authTick('matrix');
  })();

  setInterval(() => { void healthTick(); }, HEALTH_INTERVAL_MS);
  setInterval(() => { void authTick('auth'); }, AUTH_INTERVAL_MS);
  setInterval(() => { void authTick('matrix'); }, MATRIX_INTERVAL_MS);
  console.log(`[ivx-qa-scheduler] started ${QA_MARKER} — health 5m, auth 15m, matrix 2h`);
}

export function autonomousQAOptions(): Response {
  return ownerOnlyOptions();
}

/** GET /api/ivx/autonomous/qa — owner-only scheduler status. */
export async function handleAutonomousQAGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401);
  }
  try {
    const globalRef = globalThis as SchedulerGlobal;
    const state = await loadQAState();
    return ownerOnlyJson({
      ok: true,
      marker: QA_MARKER,
      schedulerRunning: Boolean(globalRef.__ivxQASchedulerStarted),
      processStartedAt: globalRef.__ivxQASchedulerStartedAt ?? null,
      cadence: { healthMinutes: 5, authMinutes: 15, matrixHours: 2 },
      startedAt: state.startedAt,
      lastHealthAt: state.lastHealthAt,
      lastAuthAt: state.lastAuthAt,
      lastMatrixAt: state.lastMatrixAt,
      healthOk: state.healthOk,
      authOk: state.authOk,
      totalRuns: state.runCounter,
      recentRuns: state.recentRuns.slice(0, 20),
    } as unknown as Record<string, unknown>);
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: QA_MARKER, error: error instanceof Error ? error.message : 'qa status failed' }, 500);
  }
}