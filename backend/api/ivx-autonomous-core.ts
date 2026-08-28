/**
 * IVX Autonomous Core API (owner-only).
 *
 *   GET  /api/ivx/autonomous-core/dashboard            → unified status dashboard
 *   GET  /api/ivx/autonomous-core/code-index           → full structured code index
 *   GET  /api/ivx/autonomous-core/code-index/summary   → totals + breakdown only
 *   POST /api/ivx/autonomous-core/code-index/rebuild    → rebuild + persist the index
 *   GET  /api/ivx/autonomous-core/audit-items           → list structured audit sets
 *   POST /api/ivx/autonomous-core/audit-items           → create a structured audit set
 *   GET  /api/ivx/autonomous-core/audit-items/:id       → one set + status counts
 *   POST /api/ivx/autonomous-core/audit-items/:id/items → upsert items
 *   POST /api/ivx/autonomous-core/audit-items/:id/status→ patch one item status/proof
 *   POST /api/ivx/autonomous-core/self-heal               → run one verified self-heal cycle
 *   GET  /api/ivx/autonomous-core/self-heal               → list recent self-heal reports
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';
import { buildAutonomousDashboard } from '../services/ivx-autonomous-core';
import { buildHandoffManifest } from '../services/ivx-handoff';
import { buildPriorityQueue } from '../services/ivx-priority-engine';
import { listSelfHealReports, runSelfHealCycle, type TestSuiteList } from '../services/ivx-self-heal-cycle';
import { getCodeIndex, getCodeIndexSummary, rebuildCodeIndex } from '../services/ivx-code-index';
import { computeBlastRadius, getCodeGraph, getCodeGraphSummary, rebuildCodeGraph } from '../services/ivx-code-graph';
import {
  advanceContinuousSession,
  getContinuousSession,
  startContinuousSession,
  stopContinuousSession,
} from '../services/ivx-continuous-execution';
import {
  countByStatus,
  createAuditItemSet,
  getAuditItemSet,
  listAuditItemSets,
  updateAuditItemStatus,
  upsertAuditItems,
  type UpsertAuditItemInput,
} from '../services/ivx-audit-item-store';

export const OPTIONS = (): Response => ownerOnlyOptions();

/**
 * Autonomous lifecycle proof. A self-contained build marker that ties together the
 * full autonomous lifecycle run (feature → commit → deploy → DB → monitor → rollback).
 * The BUILD_ID is unique per feature ship and is mirrored as a row in the
 * `ivx_lifecycle_proof` table, so the deployed code and the DB record can be matched.
 */
export const LIFECYCLE_BUILD_ID = 'lifecycle-proof-20260529-v1';

export async function handleLifecycleProofRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  return ownerOnlyJson({
    ok: true,
    feature: 'autonomous-lifecycle-proof',
    buildId: LIFECYCLE_BUILD_ID,
    committedByAgent: true,
    humanInLoop: false,
    dbTable: 'ivx_lifecycle_proof',
    commit: process.env.RENDER_GIT_COMMIT?.trim() || 'unknown',
    generatedAt: new Date().toISOString(),
  });
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function requireOwner(request: Request): Promise<Response | null> {
  // Trusted GitHub Actions OIDC machine identity (repo/ref/workflow-scoped,
  // JWKS-verified, short-lived) authorizes the low-risk autonomous diagnose /
  // read / self-heal endpoints without an interactive owner session — matching
  // the senior-developer worker enqueue contract. A correctly verified OIDC
  // request must never fail with "missing bearer token". High-risk operations
  // (secrets, IAM, payments, destructive migrations, deploy approval) remain
  // OWNER GATED in their dedicated endpoints.
  if (await verifyIVXGitHubActionsOIDCRequest(request)) {
    return null;
  }
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
    const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message }, status);
  }
}

export async function handleAutonomousDashboardRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const dashboard = await buildAutonomousDashboard();
  return ownerOnlyJson({ ok: true, dashboard: dashboard as unknown as Record<string, unknown> });
}

/**
 * Operator handoff manifest — maps the ten operator capabilities the owner
 * requires (inspect → tasks → patches → checks → approval → commit → deploy →
 * Supabase → monitor → report) to their live backing route + auth gate, deriving
 * readiness from real subsystem state. This is the proof that IVX can continue
 * development independently of Rork.
 */
export async function handleHandoffReadinessRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const manifest = await buildHandoffManifest();
  return ownerOnlyJson({ ok: true, handoff: manifest as unknown as Record<string, unknown> });
}

export async function handlePriorityQueueRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const limit = asNumber(url.searchParams.get('limit')) ?? 200;
  const queue = await buildPriorityQueue(limit);
  return ownerOnlyJson({ ok: true, priority: queue as unknown as Record<string, unknown> });
}

export async function handleCodeIndexRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const { index, cached } = await getCodeIndex();
  return ownerOnlyJson({ ok: true, cached, index: index as unknown as Record<string, unknown> });
}

export async function handleCodeIndexSummaryRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const summary = await getCodeIndexSummary();
  return ownerOnlyJson({ ok: true, summary: summary as unknown as Record<string, unknown> });
}

export async function handleCodeIndexRebuildRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const index = await rebuildCodeIndex();
  return ownerOnlyJson({
    ok: true,
    rebuilt: true,
    totals: index.totals,
    durationMs: index.durationMs,
    generatedAt: index.generatedAt,
  });
}

export async function handleSelfHealRunRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rawSuites = Array.isArray(body.suites) ? body.suites : [];
  const suites = rawSuites
    .map((s) => asString(s))
    .filter((s): s is 'typecheck' | 'lint' | 'smoke' => s === 'typecheck' || s === 'lint' || s === 'smoke');
  const approverEmail = asString(body.approverEmail) || undefined;
  const resumeLimit = asNumber(body.resumeLimit) ?? undefined;
  const report = await runSelfHealCycle({
    suites: suites.length > 0 ? (suites as TestSuiteList) : undefined,
    approverEmail,
    resumeLimit: resumeLimit ?? undefined,
  });
  return ownerOnlyJson({ ok: true, report: report as unknown as Record<string, unknown> });
}

export async function handleSelfHealListRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const limit = asNumber(url.searchParams.get('limit')) ?? 20;
  const reports = await listSelfHealReports(limit);
  return ownerOnlyJson({ ok: true, count: reports.length, reports: reports as unknown as Record<string, unknown>[] });
}

export async function handleCodeGraphRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const { graph, cached } = await getCodeGraph();
  return ownerOnlyJson({ ok: true, cached, graph: graph as unknown as Record<string, unknown> });
}

export async function handleCodeGraphSummaryRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const summary = await getCodeGraphSummary();
  return ownerOnlyJson({ ok: true, summary: summary as unknown as Record<string, unknown> });
}

export async function handleCodeGraphRebuildRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const graph = await rebuildCodeGraph();
  return ownerOnlyJson({ ok: true, rebuilt: true, totals: graph.totals, durationMs: graph.durationMs, generatedAt: graph.generatedAt });
}

export async function handleBlastRadiusRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const file = asString(url.searchParams.get('file'));
  if (!file) {
    return ownerOnlyJson({ ok: false, error: 'file query param is required.' }, 400);
  }
  const blast = await computeBlastRadius(file);
  return ownerOnlyJson({ ok: true, blastRadius: blast as unknown as Record<string, unknown> });
}

export async function handleContinuousGetRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const session = await getContinuousSession();
  return ownerOnlyJson({ ok: true, session: session as unknown as Record<string, unknown> });
}

export async function handleContinuousStartRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rawSuites = Array.isArray(body.suites) ? body.suites : [];
  const suites = rawSuites
    .map((s) => asString(s))
    .filter((s): s is 'typecheck' | 'lint' | 'smoke' => s === 'typecheck' || s === 'lint' || s === 'smoke');
  const session = await startContinuousSession({
    maxDurationMs: asNumber(body.maxDurationMs) ?? undefined,
    maxPasses: asNumber(body.maxPasses) ?? undefined,
    intervalMs: asNumber(body.intervalMs) ?? undefined,
    suites: suites.length > 0 ? suites : undefined,
    approverEmail: asString(body.approverEmail) || undefined,
    stopWhenClean: typeof body.stopWhenClean === 'boolean' ? body.stopWhenClean : undefined,
  });
  return ownerOnlyJson({ ok: true, session: session as unknown as Record<string, unknown> });
}

export async function handleContinuousStopRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const session = await stopContinuousSession();
  return ownerOnlyJson({ ok: true, session: session as unknown as Record<string, unknown> });
}

export async function handleContinuousAdvanceRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const session = await advanceContinuousSession({ force: true });
  return ownerOnlyJson({ ok: true, session: session as unknown as Record<string, unknown> });
}

export async function handleAuditItemSetsListRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const sets = await listAuditItemSets(50);
  return ownerOnlyJson({
    ok: true,
    sets: sets.map((set) => ({
      auditId: set.auditId,
      title: set.title,
      itemCount: set.items.length,
      counts: countByStatus(set),
      createdAt: set.createdAt,
      updatedAt: set.updatedAt,
    })),
  });
}

export async function handleAuditItemSetCreateRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = asString(body.title);
  if (!title) {
    return ownerOnlyJson({ ok: false, error: 'title is required.' }, 400);
  }
  const set = await createAuditItemSet(title);
  return ownerOnlyJson({ ok: true, auditId: set.auditId, set: set as unknown as Record<string, unknown> });
}

export async function handleAuditItemSetGetRequest(request: Request, auditId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const set = await getAuditItemSet(auditId);
  if (!set) {
    return ownerOnlyJson({ ok: false, error: 'audit item set not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, set: set as unknown as Record<string, unknown>, counts: countByStatus(set) });
}

export async function handleAuditItemsUpsertRequest(request: Request, auditId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const inputs: UpsertAuditItemInput[] = [];
  for (const raw of rawItems) {
    const record = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const number = asNumber(record.number);
    if (number === null) continue;
    inputs.push({
      number,
      systemArea: asString(record.systemArea),
      issue: asString(record.issue),
      status: asString(record.status) as UpsertAuditItemInput['status'] || undefined,
      severity: asString(record.severity) as UpsertAuditItemInput['severity'] || undefined,
      rootCause: record.rootCause !== undefined ? asString(record.rootCause) || null : undefined,
      fix: record.fix !== undefined ? asString(record.fix) || null : undefined,
      file: record.file !== undefined ? asString(record.file) || null : undefined,
      verification: record.verification !== undefined ? asString(record.verification) || null : undefined,
    });
  }
  if (inputs.length === 0) {
    return ownerOnlyJson({ ok: false, error: 'items[] with a numeric "number" field is required.' }, 400);
  }
  const set = await upsertAuditItems(auditId, inputs);
  if (!set) {
    return ownerOnlyJson({ ok: false, error: 'audit item set not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, upserted: inputs.length, counts: countByStatus(set) });
}

export async function handleAuditItemStatusRequest(request: Request, auditId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const itemId = asString(body.itemId);
  if (!itemId) {
    return ownerOnlyJson({ ok: false, error: 'itemId is required.' }, 400);
  }
  const set = await updateAuditItemStatus(auditId, itemId, {
    status: asString(body.status) ? (asString(body.status) as never) : undefined,
    severity: asString(body.severity) ? (asString(body.severity) as never) : undefined,
    rootCause: body.rootCause !== undefined ? asString(body.rootCause) || null : undefined,
    fix: body.fix !== undefined ? asString(body.fix) || null : undefined,
    file: body.file !== undefined ? asString(body.file) || null : undefined,
    verification: body.verification !== undefined ? asString(body.verification) || null : undefined,
  });
  if (!set) {
    return ownerOnlyJson({ ok: false, error: 'audit item set not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, counts: countByStatus(set) });
}
