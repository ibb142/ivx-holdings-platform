/**
 * IVX Agent Work Ledger API — canonical per-IA dashboard + attribution ingest.
 * Auth: trusted GitHub Actions OIDC (machine), X-IVX-System-Key, or registered owner bearer.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';
import { checkIVXAISystemKey } from './owner-only';
import {
  IVX_AGENT_WORK_LEDGER_MARKER,
  getAgentLedgerDashboard,
  recordWorkflowAttribution,
} from '../services/ivx-agent-work-ledger';
import { listCampaignDispatcherRecords } from '../services/ivx-campaign-dispatcher';
import {
  IVX_112_THREE_LAYER_VERIFY_MARKER,
  buildThreeLayerVerifiedLedger,
} from '../services/ivx-agent-productivity-verifier';

export function agentLedgerOptions(): Response { return ownerOnlyOptions(); }
type LedgerAuth = 'oidc' | 'system_key' | 'owner' | null;

async function authorize(request: Request): Promise<LedgerAuth> {
  if (await verifyIVXGitHubActionsOIDCRequest(request)) return 'oidc';
  if (await checkIVXAISystemKey(request)) return 'system_key';
  try { await assertIVXOwnerOnly(request); return 'owner'; } catch { return null; }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const roundHours = (ms: number) => Math.round((ms / 3600000) * 100) / 100;

function withLiveTimer<T extends {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  productiveMs24h: number;
  idleMs24h: number;
}>(row: T, now: number) {
  const active = !['IDLE', 'COMPLETE', 'BLOCKED'].includes(row.status);
  const parsedStart = row.startedAt ? Date.parse(row.startedAt) : Number.NaN;
  const parsedFinish = row.finishedAt ? Date.parse(row.finishedAt) : Number.NaN;
  const hasStart = Number.isFinite(parsedStart);
  const hasFinish = Number.isFinite(parsedFinish);
  const running = active && hasStart && !hasFinish;
  const endMs = running ? now : (hasFinish ? parsedFinish : (hasStart ? parsedStart : now));
  const elapsedMs = hasStart ? Math.max(0, endMs - parsedStart) : 0;
  return {
    ...row,
    timer: {
      running,
      workStartedAt: hasStart ? row.startedAt : null,
      workEndedAt: hasFinish ? row.finishedAt : null,
      currentTaskElapsedMs: elapsedMs,
      currentTaskElapsedSeconds: Math.floor(elapsedMs / 1000),
      currentTaskElapsedMinutes: Math.floor(elapsedMs / 60000),
      currentTaskElapsedHours: roundHours(elapsedMs),
      windowStartAt: new Date(now - DAY_MS).toISOString(),
      windowEndAt: new Date(now).toISOString(),
      productiveMs24h: row.productiveMs24h,
      productiveHours24h: roundHours(row.productiveMs24h),
      idleMs24h: row.idleMs24h,
      idleHours24h: roundHours(row.idleMs24h),
      measuredAt: new Date(now).toISOString(),
    },
  };
}

type Span = { start: number; end: number };

function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (!last || span.start > last.end) merged.push({ ...span });
    else last.end = Math.max(last.end, span.end);
  }
  return merged;
}

/**
 * Autonomous timer is fail-closed and evidence-derived: Autonomous is counted
 * productive only while at least one real campaign execution span exists.
 * Overlapping IA work is merged, never double-counted, so this is wall-clock
 * orchestration coverage (0..24h), not summed IA-hours.
 */
export function buildAutonomous24hTimer(
  records: Array<{ startedAt?: string | null; finishedAt?: string | null; status?: string | null }>,
  now: number,
) {
  const windowStart = now - DAY_MS;
  const spans: Span[] = [];
  const runningStarts: number[] = [];

  for (const record of records) {
    if (!record.startedAt) continue;
    const parsedStart = Date.parse(record.startedAt);
    if (!Number.isFinite(parsedStart)) continue;

    const parsedFinish = record.finishedAt ? Date.parse(record.finishedAt) : Number.NaN;
    const running = record.status === 'RUNNING' && !Number.isFinite(parsedFinish);
    const rawEnd = Number.isFinite(parsedFinish) ? parsedFinish : (running ? now : parsedStart);
    const start = Math.max(parsedStart, windowStart);
    const end = Math.min(Math.max(rawEnd, start), now);
    if (end > start) spans.push({ start, end });
    if (running && parsedStart <= now) runningStarts.push(parsedStart);
  }

  const merged = mergeSpans(spans);
  const productiveMs24h = merged.reduce((sum, span) => sum + (span.end - span.start), 0);
  const latest = merged[merged.length - 1] ?? null;
  const running = runningStarts.length > 0;
  const currentStart = running ? Math.min(...runningStarts) : (latest?.start ?? Number.NaN);
  const workEndedAt = running ? null : (latest ? new Date(latest.end).toISOString() : null);

  return {
    id: 'AUTONOMOUS',
    name: 'Autonomous Manager',
    status: running ? 'ACTIVE' : 'IDLE',
    running,
    workStartedAt: Number.isFinite(currentStart) ? new Date(currentStart).toISOString() : null,
    workEndedAt,
    windowStartAt: new Date(windowStart).toISOString(),
    windowEndAt: new Date(now).toISOString(),
    productiveMs24h,
    productiveHours24h: roundHours(productiveMs24h),
    idleMs24h: Math.max(0, DAY_MS - productiveMs24h),
    idleHours24h: roundHours(Math.max(0, DAY_MS - productiveMs24h)),
    coveragePercent24h: Math.round((productiveMs24h / DAY_MS) * 10000) / 100,
    activeManagedExecutions: runningStarts.length,
    measuredAt: new Date(now).toISOString(),
    evidencePolicy: 'Counts wall-clock time only when at least one real campaign execution span exists; overlapping IA spans are merged and never double-counted.',
  };
}

export async function handleAgentLedgerGet(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
  try {
    const [base, campaignRecords] = await Promise.all([
      getAgentLedgerDashboard(),
      listCampaignDispatcherRecords(),
    ]);
    const verified = await buildThreeLayerVerifiedLedger(base);
    const dashboard = verified.dashboard;
    const now = Date.now();
    const timedAgents = dashboard.rows.map((row) => withLiveTimer(row, now));
    const autonomous = buildAutonomous24hTimer(campaignRecords, now);
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AGENT_WORK_LEDGER_MARKER,
      verificationMarker: IVX_112_THREE_LAYER_VERIFY_MARKER,
      auth,
      generatedAt: dashboard.generatedAt,
      timerMeasuredAt: new Date(now).toISOString(),
      timerWindow: {
        startAt: new Date(now - DAY_MS).toISOString(),
        endAt: new Date(now).toISOString(),
        durationHours: 24,
      },
      totals: dashboard.totals,
      autonomous,
      agents: timedAgents,
      rowCount: timedAgents.length,
      systemRowCount: timedAgents.length + 1,
      verificationLayers: verified.verificationLayers,
      timerPolicy: 'Every IA and Autonomous expose start, end/current state, and evidence-derived productive total for the rolling previous 24 hours. Running timers refresh from real dispatcher/runtime state; no synthetic time.',
      policy: 'Three-layer fail-closed truth: runtime proof, time-integrity reconciliation, then exact-SHA certificate. FAIL/BLOCKED evidence never contributes productive time; ambiguous overlapping sources are never added together.',
    });
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_AGENT_WORK_LEDGER_MARKER, error: error instanceof Error ? error.message : 'Unable to build agent ledger.' }, 500);
  }
}

type IngestPayload = { records?: Array<{ agentNumber?: unknown; taskId?: unknown; workerJobId?: unknown; githubRunId?: unknown; githubJobId?: unknown; branch?: unknown; prNumber?: unknown; commitSha?: unknown; deployId?: unknown; status?: unknown; source?: unknown; }> };

export async function handleAgentLedgerIngest(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
  try {
    const body = (await request.json().catch(() => ({}))) as IngestPayload;
    const incoming = Array.isArray(body.records) ? body.records : [];
    if (incoming.length === 0) return ownerOnlyJson({ ok: false, error: 'records[] required.' }, 400);
    const accepted: number[] = [];
    for (const raw of incoming.slice(0, 200)) {
      const agentNumber = Number(raw.agentNumber);
      if (!Number.isInteger(agentNumber) || agentNumber < 1 || agentNumber > 112) continue;
      const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      await recordWorkflowAttribution({ agentNumber, taskId: asString(raw.taskId), workerJobId: asString(raw.workerJobId), githubRunId: asNumber(raw.githubRunId), githubJobId: asNumber(raw.githubJobId), branch: asString(raw.branch), prNumber: asNumber(raw.prNumber), commitSha: asString(raw.commitSha), deployId: asString(raw.deployId), status: asString(raw.status), source: asString(raw.source) ?? `auth:${auth}` });
      accepted.push(agentNumber);
    }
    return ownerOnlyJson({ ok: true, marker: IVX_AGENT_WORK_LEDGER_MARKER, auth, acceptedAgents: accepted.length, rejected: incoming.length - accepted.length });
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_AGENT_WORK_LEDGER_MARKER, error: error instanceof Error ? error.message : 'Ingest failed.' }, 500);
  }
}
