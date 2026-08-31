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

export function agentLedgerOptions(): Response { return ownerOnlyOptions(); }
type LedgerAuth = 'oidc' | 'system_key' | 'owner' | null;

async function authorize(request: Request): Promise<LedgerAuth> {
  if (await verifyIVXGitHubActionsOIDCRequest(request)) return 'oidc';
  if (await checkIVXAISystemKey(request)) return 'system_key';
  try { await assertIVXOwnerOnly(request); return 'owner'; } catch { return null; }
}

function withLiveTimer<T extends {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  productiveMs24h: number;
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
      elapsedMs,
      elapsedSeconds: Math.floor(elapsedMs / 1000),
      elapsedMinutes: Math.floor(elapsedMs / 60000),
      elapsedHours: Math.round((elapsedMs / 3600000) * 100) / 100,
      productiveMs24h: row.productiveMs24h,
      productiveHours24h: Math.round((row.productiveMs24h / 3600000) * 100) / 100,
      measuredAt: new Date(now).toISOString(),
    },
  };
}

export async function handleAgentLedgerGet(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
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
      timerPolicy: 'Per-agent timer uses durable real task startedAt and finishedAt. Running tasks advance against server time; completed tasks freeze at finishedAt. No synthetic time.',
      policy: 'Canonical per-IA state built only from real dispatcher/worker/workflow evidence. Unmeasured time categories are null — never fabricated.',
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
