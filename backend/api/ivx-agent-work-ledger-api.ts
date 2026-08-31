/**
 * IVX Agent Work Ledger API — canonical per-IA dashboard + attribution ingest.
 *
 * Owner mandate 2026-08-28 (Missions F/G):
 *   GET  /api/ivx/autonomous/agent-ledger         — 112-row dashboard + totals
 *   POST /api/ivx/autonomous/agent-ledger/ingest  — GitHub Actions workflows
 *          (OIDC-verified) report run/job/commit/PR attribution so CI and War
 *          Room work is correlated into the canonical per-IA state even when
 *          no worker job exists (fixes the "0 commits" dashboard bug).
 *
 * Auth: trusted GitHub Actions OIDC (machine), X-IVX-System-Key, or the
 * registered owner bearer. No public access.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';
import { checkIVXAISystemKey } from './owner-only';
import {
  IVX_AGENT_WORK_LEDGER_MARKER,
  getAgentLedgerDashboard,
  recordWorkflowAttribution,
} from '../services/ivx-agent-work-ledger';

export function agentLedgerOptions(): Response {
  return ownerOnlyOptions();
}

type LedgerAuth = 'oidc' | 'system_key' | 'owner' | null;

async function authorize(request: Request): Promise<LedgerAuth> {
  if (await verifyIVXGitHubActionsOIDCRequest(request)) return 'oidc';
  if (await checkIVXAISystemKey(request)) return 'system_key';
  try {
    await assertIVXOwnerOnly(request);
    return 'owner';
  } catch {
    return null;
  }
}

function withLiveTimer<T extends {
  status: string;
  startedAt: string | null;
  productiveMs24h: number;
}>(row: T, now: number) {
  const active = !['IDLE', 'COMPLETE', 'BLOCKED'].includes(row.status);
  const parsedStart = row.startedAt ? Date.parse(row.startedAt) : Number.NaN;
  const running = active && Number.isFinite(parsedStart);
  const currentTaskElapsedMs = running ? Math.max(0, now - parsedStart) : 0;
  return {
    ...row,
    timer: {
      running,
      startedAt: running ? row.startedAt : null,
      currentTaskElapsedMs,
      currentTaskElapsedSeconds: Math.floor(currentTaskElapsedMs / 1000),
      currentTaskElapsedMinutes: Math.floor(currentTaskElapsedMs / 60000),
      productiveMs24h: row.productiveMs24h,
      productiveHours24h: Math.round((row.productiveMs24h / 3600000) * 100) / 100,
      measuredAt: new Date(now).toISOString(),
    },
  };
}

export async function handleAgentLedgerGet(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) {
    return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
  }
  try {
    const dashboard = await getAgentLedgerDashboard();
    const now = Date.now();
    const timedAgents = dashboard.rows.map((row) => withLiveTimer(row, now));
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AGENT_WORK_LEDGER_MARKER,
      auth,
      generatedAt: dashboard.generatedAt,
      timerMeasuredAt: new Date(now).toISOString(),
      totals: dashboard.totals,
      agents: timedAgents,
      rowCount: timedAgents.length,
      timerPolicy: 'Each timer runs only while the canonical real-work state is active and startedAt is present. Productive 24h time comes only from durable real execution spans; no synthetic time is added.',
      policy: 'Canonical per-IA state built only from real dispatcher/worker/workflow evidence. Unmeasured time categories are null — never fabricated.',
    });
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_AGENT_WORK_LEDGER_MARKER,
      error: error instanceof Error ? error.message : 'Unable to build agent ledger.',
    }, 500);
  }
}

type IngestPayload = {
  records?: Array<{
    agentNumber?: unknown;
    taskId?: unknown;
    workerJobId?: unknown;
    githubRunId?: unknown;
    githubJobId?: unknown;
    branch?: unknown;
    prNumber?: unknown;
    commitSha?: unknown;
    deployId?: unknown;
    status?: unknown;
    source?: unknown;
  }>;
};

export async function handleAgentLedgerIngest(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) {
    return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
  }
  try {
    const body = (await request.json().catch(() => ({}))) as IngestPayload;
    const incoming = Array.isArray(body.records) ? body.records : [];
    if (incoming.length === 0) {
      return ownerOnlyJson({ ok: false, error: 'records[] required.' }, 400);
    }
    const accepted: number[] = [];
    for (const raw of incoming.slice(0, 200)) {
      const agentNumber = Number(raw.agentNumber);
      if (!Number.isInteger(agentNumber) || agentNumber < 1 || agentNumber > 112) continue;
      const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      await recordWorkflowAttribution({
        agentNumber,
        taskId: asString(raw.taskId),
        workerJobId: asString(raw.workerJobId),
        githubRunId: asNumber(raw.githubRunId),
        githubJobId: asNumber(raw.githubJobId),
        branch: asString(raw.branch),
        prNumber: asNumber(raw.prNumber),
        commitSha: asString(raw.commitSha),
        deployId: asString(raw.deployId),
        status: asString(raw.status),
        source: asString(raw.source) ?? `auth:${auth}`,
      });
      accepted.push(agentNumber);
    }
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AGENT_WORK_LEDGER_MARKER,
      auth,
      acceptedAgents: accepted.length,
      rejected: incoming.length - accepted.length,
    });
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_AGENT_WORK_LEDGER_MARKER,
      error: error instanceof Error ? error.message : 'Ingest failed.',
    }, 500);
  }
}
