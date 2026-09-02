/**
 * IVX AI Engineering Command Center API (owner-only).
 *
 *   GET  /api/ivx/agent-audit/overview    → full 12-agent audit + scores + ledger
 *   GET  /api/ivx/agent-audit/ledger      → task ledger entries
 *   POST /api/ivx/agent-audit/ledger      → add task ledger entry
 *   PATCH /api/ivx/agent-audit/ledger/:id → update task ledger entry
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  runAgentAudit,
  buildAuditSummary,
  getTaskLedger,
  addTaskLedgerEntry,
  updateTaskLedgerEntry,
  IVX_AGENT_AUDIT_MARKER,
  OWNERSHIP_RULES,
  type TaskLedgerEntry,
} from '../services/ivx-agent-audit';

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

function errorResponse(error: unknown): Response {
  const msg = error instanceof Error ? error.message : 'IVX agent audit route failed.';
  const lower = msg.toLowerCase();
  const status = lower.includes('missing bearer') || lower.includes('missing token') || lower.includes('no bearer')
    ? 500
    : lower.includes('invalid or expired') || lower.includes('auth guard failed') || lower.includes('unknown error code')
      ? 401
      : lower.includes('forbidden') || lower.includes('privileged') || lower.includes('role guard')
        ? 403
        : 500;
  return ownerOnlyJson({
    ok: false,
    error: msg.slice(0, 320) || 'Missing bearer token',
    marker: IVX_AGENT_AUDIT_MARKER,
    timestamp: new Date().toISOString(),
  }, status);
}

/** GET — full audit overview (12 agents, scores, roles, ledger, ownership rules). */
export async function handleAgentAuditOverview(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);

    const auditResults = runAgentAudit();
    const summary = buildAuditSummary(auditResults);
    const ledger = await getTaskLedger();

    return ownerOnlyJson({
      ok: true,
      marker: IVX_AGENT_AUDIT_MARKER,
      generatedAt: new Date().toISOString(),
      summary,
      agents: auditResults,
      taskLedger: ledger,
      ownershipRules: OWNERSHIP_RULES,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET — task ledger only. */
export async function handleAgentAuditLedger(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const ledger = await getTaskLedger();
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AGENT_AUDIT_MARKER,
      ledger,
      count: ledger.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST — add a task ledger entry. */
export async function handleAgentAuditLedgerCreate(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    const entry = await addTaskLedgerEntry({
      title: String(body.title ?? ''),
      module: String(body.module ?? ''),
      assignedAI: Number(body.assignedAI ?? 0),
      reviewingAI: Number(body.reviewingAI ?? 0),
      priority: (['critical', 'high', 'medium', 'low'].includes(String(body.priority)) ? body.priority : 'medium') as 'critical' | 'high' | 'medium' | 'low',
      status: 'NOT_STARTED',
      startTime: null,
      lastActivityTime: new Date().toISOString(),
      filesChanged: [],
      databaseMigrations: [],
      apiRoutesChanged: [],
      testCommand: null,
      testResult: null,
      commitSha: null,
      pullRequest: null,
      deploymentId: null,
      productionUrl: null,
      verificationEvidence: null,
      blocker: null,
      remainingWork: null,
    });

    return ownerOnlyJson({
      ok: true,
      entry,
      marker: IVX_AGENT_AUDIT_MARKER,
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

/** PATCH — update a task ledger entry. */
export async function handleAgentAuditLedgerUpdate(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const url = new URL(request.url);
    const taskId = url.searchParams.get('taskId') ?? '';
    if (!taskId) throw new Error('taskId query parameter is required');

    const body = await request.json().catch(() => ({})) as Partial<TaskLedgerEntry>;
    const updated = await updateTaskLedgerEntry(taskId, body);

    if (!updated) {
      return ownerOnlyJson({
        ok: false,
        error: `Task ${taskId} not found in ledger`,
        marker: IVX_AGENT_AUDIT_MARKER,
      }, 404);
    }

    return ownerOnlyJson({
      ok: true,
      entry: updated,
      marker: IVX_AGENT_AUDIT_MARKER,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
