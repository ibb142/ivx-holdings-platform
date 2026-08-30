/**
 * IVX Agent Work Ledger API — canonical per-IA dashboard + attribution ingest.
 * Fail-closed live evidence: an agent is never reported as working merely because
 * it is registered or assigned. WORKING requires a fresh real heartbeat.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions, checkIVXAISystemKey } from './owner-only';
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';
import {
  IVX_AGENT_WORK_LEDGER_MARKER,
  getAgentLedgerDashboard,
  recordWorkflowAttribution,
} from '../services/ivx-agent-work-ledger';

export function agentLedgerOptions(): Response { return ownerOnlyOptions(); }
type LedgerAuth = 'oidc' | 'system_key' | 'owner' | null;
const HEARTBEAT_FRESH_MS = 120_000;

async function authorize(request: Request): Promise<LedgerAuth> {
  if (await verifyIVXGitHubActionsOIDCRequest(request)) return 'oidc';
  if (await checkIVXAISystemKey(request)) return 'system_key';
  try { await assertIVXOwnerOnly(request); return 'owner'; } catch { return null; }
}

function liveEvidence(row: any, now: number) {
  const startedAtMs = row.startedAt ? Date.parse(row.startedAt) : NaN;
  const heartbeatAtMs = row.heartbeatAt ? Date.parse(row.heartbeatAt) : NaN;
  const started = Number.isFinite(startedAtMs);
  const heartbeatAgeMs = Number.isFinite(heartbeatAtMs) ? Math.max(0, now - heartbeatAtMs) : null;
  const heartbeatFresh = heartbeatAgeMs !== null && heartbeatAgeMs <= HEARTBEAT_FRESH_MS;
  const activeState = ['CODING','TESTING','PR_OPEN','CI','MERGING','DEPLOYING','VERIFYING'].includes(row.status);
  const workingNow = activeState && heartbeatFresh;
  const proofSignals = [row.workerJobId, row.githubRunId, row.commitSha, row.prNumber, row.deployId]
    .filter((v) => v !== null && v !== undefined && v !== '').length + (row.filesChanged?.length ? 1 : 0);
  return {
    started,
    workingNow,
    verdict: workingNow ? 'WORKING_VERIFIED' : (started ? 'NOT_CURRENTLY_VERIFIED' : 'NOT_STARTED'),
    heartbeatFresh,
    heartbeatAgeMs,
    heartbeatFreshLimitMs: HEARTBEAT_FRESH_MS,
    proofSignals,
    evidenceState: row.evidenceState,
    startedAt: row.startedAt,
    heartbeatAt: row.heartbeatAt,
    finishedAt: row.finishedAt,
    taskId: row.taskId,
    workerJobId: row.workerJobId,
    githubRunId: row.githubRunId,
    commitSha: row.commitSha,
    prNumber: row.prNumber,
    deployId: row.deployId,
  };
}

export async function handleAgentLedgerGet(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
  try {
    const dashboard = await getAgentLedgerDashboard();
    const now = Date.now();
    const agents = dashboard.rows.map((row) => ({ ...row, liveEvidence: liveEvidence(row, now) }));
    const workingVerified = agents.filter((a) => a.liveEvidence.workingNow).length;
    const startedVerified = agents.filter((a) => a.liveEvidence.started).length;
    const staleActiveClaims = agents.filter((a) =>
      ['CODING','TESTING','PR_OPEN','CI','MERGING','DEPLOYING','VERIFYING'].includes(a.status) && !a.liveEvidence.workingNow
    ).length;
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AGENT_WORK_LEDGER_MARKER,
      auth,
      generatedAt: dashboard.generatedAt,
      totals: dashboard.totals,
      liveControl: {
        totalAgents: agents.length,
        startedVerified,
        workingVerified,
        staleActiveClaims,
        all112WorkingVerified: agents.length === 112 && workingVerified === 112,
        policy: 'FAIL_CLOSED: WORKING requires active state plus heartbeat <=120s. Registration/assignment alone never counts as working.',
      },
      agents,
      rowCount: agents.length,
      policy: 'Canonical per-IA state built only from real dispatcher/worker/workflow evidence. Unmeasured or stale work is never fabricated.',
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
