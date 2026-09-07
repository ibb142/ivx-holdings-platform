/**
 * IVX Capital Deployment Platform — Real Deal Tracking API (owner-only).
 *
 * BLOCK 26. Full lifecycle tracking over owner-managed deals + computed outcome
 * metrics (conversion rate, capital raised, average deal size, time to close,
 * investor response rate):
 *   GET    /api/ivx/deal-tracking                  → list deals (newest first) + metrics
 *   POST   /api/ivx/deal-tracking                  → create a deal (name + real source required)
 *   GET    /api/ivx/deal-tracking/:id              → read one deal
 *   POST   /api/ivx/deal-tracking/:id              → update a deal (partial)
 *   POST   /api/ivx/deal-tracking/:id/milestone    → increment a lifecycle milestone
 *   POST   /api/ivx/deal-tracking/:id/status       → move lifecycle status
 *   POST   /api/ivx/deal-tracking/:id/delete       → delete a deal
 *
 * Owner-only. IVX never fabricates deal data; metrics are COMPUTED from the
 * recorded milestones, never invented.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  createDeal,
  deleteDeal,
  getDeal,
  incrementDealMilestone,
  joinDeal,
  leaveDeal,
  addDealDocument,
  removeDealDocument,
  listDeals,
  setDealStatus,
  summarizeDeals,
  updateDeal,
  VALID_DEAL_TYPES,
  DEAL_MILESTONE_FIELDS,
  type CreateDealInput,
  type DealMilestoneField,
  type DealSource,
  type DealStatus,
  type DealType,
  type UpdateDealInput,
} from '../services/ivx-deal-tracking-store';

export const OPTIONS = (): Response => ownerOnlyOptions();

const VALID_SOURCES: ReadonlySet<string> = new Set([
  'owner_entered', 'submitted_form', 'crm_import', 'public_source', 'verified_deal',
]);
const VALID_STATUS: ReadonlySet<string> = new Set([
  'open', 'in_progress', 'closed_won', 'closed_lost',
]);
const VALID_MILESTONES: ReadonlySet<string> = new Set(DEAL_MILESTONE_FIELDS);
const VALID_DEAL_TYPE_STRINGS: ReadonlySet<string> = VALID_DEAL_TYPES;
const VALID_DOC_KINDS: ReadonlySet<string> = new Set([
  'contract', 'offering_memo', 'kyc_packet', 'valuation', 'closing', 'other',
]);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function requireOwner(request: Request): Promise<Response | null> {
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

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function bodyToUpdateInput(body: Record<string, unknown>): UpdateDealInput {
  const patch: UpdateDealInput = {};
  if (body.dealName !== undefined) patch.dealName = asString(body.dealName);
  if (body.counterparty !== undefined) patch.counterparty = asString(body.counterparty);
  if (body.dealType !== undefined && VALID_DEAL_TYPE_STRINGS.has(asString(body.dealType))) {
    patch.dealType = asString(body.dealType) as DealType;
  }
  if (body.status !== undefined && VALID_STATUS.has(asString(body.status))) patch.status = asString(body.status) as DealStatus;
  for (const field of DEAL_MILESTONE_FIELDS) {
    const value = asOptionalNumber(body[field]);
    if (value !== undefined) patch[field] = value;
  }
  if (body.capitalTarget !== undefined) patch.capitalTarget = body.capitalTarget === null ? null : asOptionalNumber(body.capitalTarget) ?? null;
  if (body.capitalCommitted !== undefined) patch.capitalCommitted = body.capitalCommitted === null ? null : asOptionalNumber(body.capitalCommitted) ?? null;
  if (body.closedAt !== undefined) patch.closedAt = body.closedAt === null ? null : asString(body.closedAt);
  if (body.notes !== undefined) patch.notes = asString(body.notes);
  if (body.source !== undefined && VALID_SOURCES.has(asString(body.source))) patch.source = asString(body.source) as DealSource;
  if (body.sourceDetail !== undefined) patch.sourceDetail = asString(body.sourceDetail);
  return patch;
}

export async function handleIVXDealTrackingListRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const [deals, metrics] = await Promise.all([listDeals(), summarizeDeals()]);
  return ownerOnlyJson({ ok: true, deals, metrics });
}

export async function handleIVXDealTrackingCreateRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const input: CreateDealInput = {
    dealName: asString(body.dealName),
    source: asString(body.source) as DealSource,
    sourceDetail: asString(body.sourceDetail),
    counterparty: asString(body.counterparty),
    dealType: VALID_DEAL_TYPE_STRINGS.has(asString(body.dealType)) ? (asString(body.dealType) as DealType) : undefined,
    status: VALID_STATUS.has(asString(body.status)) ? (asString(body.status) as DealStatus) : undefined,
    investorsContacted: asOptionalNumber(body.investorsContacted),
    investorsResponded: asOptionalNumber(body.investorsResponded),
    buyersContacted: asOptionalNumber(body.buyersContacted),
    meetingsScheduled: asOptionalNumber(body.meetingsScheduled),
    documentsShared: asOptionalNumber(body.documentsShared),
    offersReceived: asOptionalNumber(body.offersReceived),
    capitalTarget: body.capitalTarget === null ? null : asOptionalNumber(body.capitalTarget) ?? null,
    capitalCommitted: body.capitalCommitted === null ? null : asOptionalNumber(body.capitalCommitted) ?? null,
    closedAt: body.closedAt === null ? null : asString(body.closedAt) || null,
    notes: asString(body.notes),
  };
  const result = await createDeal(input);
  if (!result.ok) {
    return ownerOnlyJson({ ok: false, error: result.error }, 400);
  }
  return ownerOnlyJson({ ok: true, deal: result.deal }, 201);
}

export async function handleIVXDealTrackingGetRequest(request: Request, dealId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const deal = await getDeal(dealId);
  if (!deal) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  return ownerOnlyJson({ ok: true, deal });
}

export async function handleIVXDealTrackingUpdateRequest(request: Request, dealId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const updated = await updateDeal(dealId, bodyToUpdateInput(body));
  if (!updated) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  return ownerOnlyJson({ ok: true, deal: updated });
}

export async function handleDealTrackingMilestoneRequest(request: Request, dealId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const field = asString(body.field);
  if (!VALID_MILESTONES.has(field)) {
    return ownerOnlyJson({ ok: false, error: `Invalid milestone. Use one of: ${DEAL_MILESTONE_FIELDS.join(', ')}.` }, 400);
  }
  const by = asOptionalNumber(body.by) ?? 1;
  const updated = await incrementDealMilestone(dealId, field as DealMilestoneField, by);
  if (!updated) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  return ownerOnlyJson({ ok: true, deal: updated });
}

export async function handleDealTrackingStatusRequest(request: Request, dealId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const status = asString(body.status) as DealStatus;
  if (!VALID_STATUS.has(status)) {
    return ownerOnlyJson({ ok: false, error: 'Invalid status. Use open | in_progress | closed_won | closed_lost.' }, 400);
  }
  const updated = await setDealStatus(dealId, status);
  if (!updated) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  return ownerOnlyJson({ ok: true, deal: updated });
}

export async function handleDealTrackingDeleteRequest(request: Request, dealId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const removed = await deleteDeal(dealId);
  if (!removed) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  return ownerOnlyJson({ ok: true, deleted: true, id: dealId });
}

// ---------------------------------------------------------------------------
// JV / private-lender / tokenized: join deal, leave deal, deal documents
// ---------------------------------------------------------------------------

// POST /api/ivx/deal-tracking/:id/join
export async function handleDealTrackingJoinRequest(request: Request, dealId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const result = await joinDeal(dealId, {
    participantId: asString(body.participantId),
    displayName: asString(body.displayName),
    ownershipPercentage: asOptionalNumber(body.ownershipPercentage),
    investedAmount: asOptionalNumber(body.investedAmount),
    profitPercentage: asOptionalNumber(body.profitPercentage),
    documents: Array.isArray(body.documents) ? (body.documents as string[]).map((d) => asString(d)).filter(Boolean) : undefined,
  });
  if (result === null) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  if (!result.ok) return ownerOnlyJson({ ok: false, error: result.error }, 400);
  return ownerOnlyJson({ ok: true, deal: result.deal });
}

// POST /api/ivx/deal-tracking/:id/leave
export async function handleDealTrackingLeaveRequest(request: Request, dealId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const participantId = asString(body.participantId);
  if (!participantId) return ownerOnlyJson({ ok: false, error: 'participantId is required.' }, 400);
  const result = await leaveDeal(dealId, participantId);
  if (result === null) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  if (result === false) return ownerOnlyJson({ ok: false, error: 'Participant not on this deal.' }, 404);
  return ownerOnlyJson({ ok: true, removed: true, participantId });
}

// POST /api/ivx/deal-tracking/:id/documents
export async function handleDealTrackingAddDocumentRequest(request: Request, dealId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const name = asString(body.name);
  const uri = asString(body.uri);
  if (!name || !uri) return ownerOnlyJson({ ok: false, error: 'name and uri are required.' }, 400);
  const kind = asString(body.kind);
  const doc = await addDealDocument(dealId, {
    name,
    uri,
    kind: VALID_DOC_KINDS.has(kind) ? (kind as never) : undefined,
    uploadedBy: asString(body.uploadedBy) || undefined,
  });
  if (doc === null) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  return ownerOnlyJson({ ok: true, document: doc }, 201);
}

// POST /api/ivx/deal-tracking/:id/documents/:documentId/delete
export async function handleDealTrackingRemoveDocumentRequest(request: Request, dealId: string, documentId: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const result = await removeDealDocument(dealId, documentId);
  if (result === null) return ownerOnlyJson({ ok: false, error: 'Deal not found.' }, 404);
  if (result === false) return ownerOnlyJson({ ok: false, error: 'Document not found on this deal.' }, 404);
  return ownerOnlyJson({ ok: true, removed: true, documentId });
}
