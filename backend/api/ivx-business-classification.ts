/**
 * IVX Business-Data Classification — owner-only HTTP routes (GATE 2).
 *
 * 14-status classification model with transition rules, audit history,
 * owner override with evidence, and dashboard reconciliation.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  createBusinessRecord,
  transitionStatus,
  ownerOverrideStatus,
  buildReconciliationReport,
  getBusinessRecord,
  listBusinessRecords,
  getAuditHistory,
  summarizeClassification,
  isTransitionAllowed,
  assertValidTransition,
  isProductionTotalEligible,
  canEnterOutreach,
  separateFundingTargetFromCommitted,
  reconcileTotal,
  ALL_BUSINESS_STATUSES,
  IVX_BUSINESS_CLASSIFICATION_MARKER,
  type BusinessStatus,
} from '../services/ivx-business-classification';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .replace(/(apikey[=:]\\s*)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .slice(0, 320) || fallback;
}

function getErrorStatus(error: unknown): number {
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  if (msg.includes('missing bearer token') || msg.includes('invalid or expired')) return 401;
  if (msg.includes('privileged ivx access is required')) return 403;
  if (msg.includes('required') || msg.includes('not configured')) return 503;
  return 500;
}

function errorResponse(error: unknown): Response {
  return ownerOnlyJson({
    ok: false,
    error: sanitizeError(error, 'IVX business classification route failed.'),
    marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
    timestamp: new Date().toISOString(),
  }, getErrorStatus(error));
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

// ─── Status / Summary ─────────────────────────────────────────────

export async function handleStatus(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const summary = await summarizeClassification();
    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      summary,
      statuses: ALL_BUSINESS_STATUSES,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Create Record ────────────────────────────────────────────────

type CreateBody = {
  kind?: unknown;
  legalName?: unknown;
  source?: unknown;
  sourceDetail?: unknown;
  secFilingUrl?: unknown;
  fundingTarget?: unknown;
  committedCapital?: unknown;
  initialStatus?: unknown;
  ownerOverrideEvidence?: unknown;
};

export async function handleCreate(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as CreateBody;

    const result = await createBusinessRecord({
      kind: (readTrimmed(body.kind) || 'investor') as 'investor' | 'buyer' | 'deal' | 'outreach',
      legalName: readTrimmed(body.legalName),
      source: readTrimmed(body.source),
      sourceDetail: readTrimmed(body.sourceDetail),
      secFilingUrl: body.secFilingUrl ? String(body.secFilingUrl) : null,
      fundingTarget: body.fundingTarget != null ? Number(body.fundingTarget) : null,
      committedCapital: body.committedCapital != null ? Number(body.committedCapital) : null,
      initialStatus: readTrimmed(body.initialStatus) as BusinessStatus || undefined,
      ownerOverrideEvidence: body.ownerOverrideEvidence ? String(body.ownerOverrideEvidence) : null,
    });

    if (!result.ok) {
      return ownerOnlyJson({
        ok: false,
        error: result.error,
        marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      }, 400);
    }

    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      record: result.record,
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Transition Status ────────────────────────────────────────────

type TransitionBody = {
  id?: unknown;
  toStatus?: unknown;
  changedBy?: unknown;
  reason?: unknown;
  evidenceUrl?: unknown;
  isOwnerOverride?: unknown;
};

export async function handleTransition(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as TransitionBody;
    const id = readTrimmed(body.id);
    if (!id) {
      return ownerOnlyJson({ ok: false, error: 'id is required.', marker: IVX_BUSINESS_CLASSIFICATION_MARKER }, 400);
    }

    const result = await transitionStatus(id, readTrimmed(body.toStatus) as BusinessStatus, {
      changedBy: readTrimmed(body.changedBy) || 'system',
      reason: readTrimmed(body.reason),
      evidenceUrl: body.evidenceUrl ? String(body.evidenceUrl) : null,
      isOwnerOverride: body.isOwnerOverride === true,
    });

    if (!result.ok) {
      return ownerOnlyJson({
        ok: false,
        error: result.error,
        marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      }, 400);
    }

    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      record: result.record,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Owner Override ───────────────────────────────────────────────

type OverrideBody = {
  id?: unknown;
  toStatus?: unknown;
  changedBy?: unknown;
  reason?: unknown;
  evidenceUrl?: unknown;
};

export async function handleOwnerOverride(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as OverrideBody;
    const id = readTrimmed(body.id);
    if (!id) {
      return ownerOnlyJson({ ok: false, error: 'id is required.', marker: IVX_BUSINESS_CLASSIFICATION_MARKER }, 400);
    }

    const result = await ownerOverrideStatus(id, readTrimmed(body.toStatus) as BusinessStatus, {
      changedBy: readTrimmed(body.changedBy) || 'owner',
      reason: readTrimmed(body.reason),
      evidenceUrl: readTrimmed(body.evidenceUrl),
    });

    if (!result.ok) {
      return ownerOnlyJson({
        ok: false,
        error: result.error,
        marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      }, 400);
    }

    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      record: result.record,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Reconciliation Report ────────────────────────────────────────

type ReconcileBody = {
  claimedProductionTotal?: unknown;
};

export async function handleReconcile(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as ReconcileBody;
    const claimed = body.claimedProductionTotal != null ? Number(body.claimedProductionTotal) : undefined;
    const report = await buildReconciliationReport(claimed);
    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Get Record / Audit History ───────────────────────────────────

export async function handleGetRecord(request: Request, id: string): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const record = await getBusinessRecord(id);
    if (!record) {
      return ownerOnlyJson({ ok: false, error: 'Record not found.', marker: IVX_BUSINESS_CLASSIFICATION_MARKER }, 404);
    }
    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      record,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetHistory(request: Request, id: string): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const history = await getAuditHistory(id);
    if (!history) {
      return ownerOnlyJson({ ok: false, error: 'Record not found.', marker: IVX_BUSINESS_CLASSIFICATION_MARKER }, 404);
    }
    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      history,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── List Records ─────────────────────────────────────────────────

type ListBody = {
  status?: unknown;
  kind?: unknown;
};

export async function handleList(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as ListBody;
    const records = await listBusinessRecords({
      status: readTrimmed(body.status) as BusinessStatus || undefined,
      kind: (readTrimmed(body.kind) || undefined) as 'investor' | 'buyer' | 'deal' | 'outreach' | undefined,
    });
    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      records,
      count: records.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Validate Transition (read-only check) ────────────────────────

type ValidateTransitionBody = {
  from?: unknown;
  to?: unknown;
};

export async function handleValidateTransition(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as ValidateTransitionBody;
    const from = readTrimmed(body.from) as BusinessStatus;
    const to = readTrimmed(body.to) as BusinessStatus;
    const allowed = isTransitionAllowed(from, to);
    let error: string | null = null;
    if (!allowed) {
      try { assertValidTransition(from, to); }
      catch (err) { error = err instanceof Error ? err.message : 'Invalid transition.'; }
    }
    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      from,
      to,
      allowed,
      error,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── Reconciliation Helpers (read-only) ───────────────────────────

type ReconcileTotalBody = {
  totalClaimed?: unknown;
  records?: unknown;
};

export async function handleReconcileTotal(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as ReconcileTotalBody;
    const totalClaimed = Number(body.totalClaimed ?? 0);
    const records = Array.isArray(body.records) ? body.records as { status: BusinessStatus }[] : [];
    const result = reconcileTotal(totalClaimed, records, (r) => isProductionTotalEligible(r.status));
    return ownerOnlyJson({
      ok: true,
      marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
      reconciliation: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
