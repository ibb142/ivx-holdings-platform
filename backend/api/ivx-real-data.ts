/**
 * IVX Real-Data Recovery API (owner-only).
 *
 * Implements the API surface for the owner's real-data recovery mandate:
 *   GET  /api/ivx/real-data/separation       → 7-category funding/investor separation + 13 dashboard totals
 *   GET  /api/ivx/real-data/investor-audit   → full investor classification (7 classes) + quarantine
 *   GET  /api/ivx/real-data/financial-ledger → financial ledger summary (9 statuses, reconciled funds only)
 *   POST /api/ivx/real-data/financial-ledger → create a financial transaction (evidence required)
 *   GET  /api/ivx/real-data/financial-ledger/:id → read one transaction
 *   POST /api/ivx/real-data/financial-ledger/:id/reconcile → mark a transaction reconciled (second evidence)
 *   POST /api/ivx/real-data/financial-ledger/:id/delete   → delete a transaction
 *   GET  /api/ivx/real-data/outreach-guardrails → guardrail config + DNC/bounce/unsub counts + audit trail
 *   POST /api/ivx/real-data/outreach-guardrails/dnc          → add a do-not-contact entry
 *   POST /api/ivx/real-data/outreach-guardrails/dnc/remove   → remove a DNC entry
 *   POST /api/ivx/real-data/outreach-guardrails/bounce       → record a bounce
 *   POST /api/ivx/real-data/outreach-guardrails/unsubscribe  → record an unsubscribe
 *   POST /api/ivx/real-data/outreach-guardrails/evaluate     → evaluate send guardrails (no send)
 *   GET  /api/ivx/real-data/architecture-map → live AI architecture map (14 stages + per-agent status)
 *
 * Owner-only. Every mutation is phrase-gated (CONFIRM_OWNER_SUPABASE_WRITE).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildRealDataSeparation } from '../services/ivx-real-data-separation';
import { auditAllInvestors } from '../services/ivx-investor-classification';
import {
  summarizeFinancialLedger,
  listFinancialTransactions,
  getFinancialTransaction,
  createFinancialTransaction,
  updateFinancialTransaction,
  deleteFinancialTransaction,
  validateCreateFinancialTransaction,
  type CreateFinancialTransactionInput,
  type FinancialTransactionStatus,
} from '../services/ivx-financial-ledger-store';
import {
  DEFAULT_GUARDRAIL_CONFIG,
  evaluateSendGuardrails,
  buildOutreachAuditTrail,
  listDoNotContact,
  addToDoNotContact,
  removeFromDoNotContact,
  recordBounce,
  recordUnsubscribe,
  listBounces,
  listUnsubscribes,
} from '../services/ivx-outreach-guardrails';
import { buildAiArchitectureMap } from '../services/ivx-ai-architecture-map';

export const OPTIONS = (): Response => ownerOnlyOptions();

const PHRASE = 'CONFIRM_OWNER_SUPABASE_WRITE';
const VALID_TX_STATUSES: ReadonlySet<string> = new Set([
  'projected',
  'requested',
  'soft_commitment',
  'signed_commitment',
  'pending_wire',
  'escrow_received',
  'bank_received',
  'returned',
  'cancelled',
]);

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requirePhrase(body: Record<string, unknown>): boolean {
  return asString(body.confirm) === PHRASE || asString(body.confirmText) === PHRASE;
}

async function productionVersion(): Promise<string> {
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile('package.json', 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── 7-category separation ────────────────────────────────────────────────────

export async function handleRealDataSeparationRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const version = await productionVersion();
  const separation = await buildRealDataSeparation(version);
  return ownerOnlyJson({ ok: true, separation: separation as unknown as Record<string, unknown> });
}

// ── Investor audit (7-class classification) ──────────────────────────────────

export async function handleInvestorAuditRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const audit = await auditAllInvestors();
  return ownerOnlyJson({ ok: true, audit: audit as unknown as Record<string, unknown> });
}

// ── Financial ledger ─────────────────────────────────────────────────────────

export async function handleFinancialLedgerSummaryRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const transactions = await listFinancialTransactions();
  const summary = await summarizeFinancialLedger();
  return ownerOnlyJson({
    ok: true,
    summary: summary as unknown as Record<string, unknown>,
    transactions: transactions.slice(0, 100),
    total: transactions.length,
  });
}

export async function handleFinancialLedgerCreateRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  if (!requirePhrase(body)) {
    return ownerOnlyJson(
      { ok: false, error: 'Confirmation phrase required (CONFIRM_OWNER_SUPABASE_WRITE).', code: 'confirmationRequired' },
      409,
    );
  }
  const status = asString(body.transactionStatus) as FinancialTransactionStatus;
  if (!VALID_TX_STATUSES.has(status)) {
    return ownerOnlyJson(
      { ok: false, error: 'transactionStatus must be one of the 9 canonical statuses.', code: 'invalidStatus' },
      400,
    );
  }
  const input: CreateFinancialTransactionInput = {
    investorId: asString(body.investorId),
    dealId: asString(body.dealId),
    amount: typeof body.amount === 'number' ? body.amount : Number(asString(body.amount)),
    currency: asString(body.currency) || 'USD',
    transactionStatus: status,
    transactionDate: asString(body.transactionDate),
    evidenceUrl: asString(body.evidenceUrl),
    reconciliationEvidenceUrl: asString(body.reconciliationEvidenceUrl) || undefined,
    reconciliationStatus: asString(body.reconciliationStatus) as 'unreconciled' | 'reconciled' | 'disputed' | undefined,
    approvedBy: asString(body.approvedBy) || 'iperez4242@gmail.com',
    notes: asString(body.notes),
    dataOrigin: asString(body.dataOrigin) as CreateFinancialTransactionInput['dataOrigin'] | undefined,
    sourceRecordId: asString(body.sourceRecordId),
    createdBy: asString(body.createdBy),
  };
  const validation = validateCreateFinancialTransaction(input);
  if (!validation.ok) {
    return ownerOnlyJson({ ok: false, error: validation.error }, 400);
  }
  const result = await createFinancialTransaction(input);
  if (!result.ok) {
    return ownerOnlyJson({ ok: false, error: result.error }, 400);
  }
  return ownerOnlyJson({ ok: true, transaction: result.transaction }, 201);
}

export async function handleFinancialLedgerGetRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const tx = await getFinancialTransaction(id);
  if (!tx) {
    return ownerOnlyJson({ ok: false, error: 'Financial transaction not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, transaction: tx });
}

export async function handleFinancialLedgerReconcileRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  if (!requirePhrase(body)) {
    return ownerOnlyJson(
      { ok: false, error: 'Confirmation phrase required (CONFIRM_OWNER_SUPABASE_WRITE).', code: 'confirmationRequired' },
      409,
    );
  }
  const reconciliationEvidenceUrl = asString(body.reconciliationEvidenceUrl);
  if (!reconciliationEvidenceUrl) {
    return ownerOnlyJson(
      { ok: false, error: 'reconciliationEvidenceUrl is required to mark a transaction reconciled.' },
      400,
    );
  }
  const updated = await updateFinancialTransaction(id, {
    reconciliationStatus: 'reconciled',
    reconciliationEvidenceUrl,
    verifiedBy: asString(body.verifiedBy) || 'iperez4242@gmail.com',
    verifiedAt: new Date().toISOString(),
  });
  if (!updated) {
    return ownerOnlyJson({ ok: false, error: 'Financial transaction not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, transaction: updated });
}

export async function handleFinancialLedgerDeleteRequest(request: Request, id: string): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  if (!requirePhrase(body)) {
    return ownerOnlyJson(
      { ok: false, error: 'Confirmation phrase required (CONFIRM_OWNER_SUPABASE_WRITE).', code: 'confirmationRequired' },
      409,
    );
  }
  const removed = await deleteFinancialTransaction(id);
  if (!removed) {
    return ownerOnlyJson({ ok: false, error: 'Financial transaction not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, deleted: true, id });
}

// ── Outreach guardrails ──────────────────────────────────────────────────────

export async function handleOutreachGuardrailsRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const [dnc, bounces, unsubs, auditTrail] = await Promise.all([
    listDoNotContact(),
    listBounces(),
    listUnsubscribes(),
    buildOutreachAuditTrail(),
  ]);
  return ownerOnlyJson({
    ok: true,
    config: DEFAULT_GUARDRAIL_CONFIG,
    doNotContact: dnc,
    bounces,
    unsubscribes: unsubs,
    auditTrail: auditTrail as unknown as Record<string, unknown>,
  });
}

export async function handleOutreachGuardrailsDncAddRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const identifier = asString(body.identifier);
  if (!identifier) {
    return ownerOnlyJson({ ok: false, error: 'identifier is required.' }, 400);
  }
  const entry = await addToDoNotContact(identifier, asString(body.reason), asString(body.addedBy) || 'iperez4242@gmail.com');
  return ownerOnlyJson({ ok: true, entry }, 201);
}

export async function handleOutreachGuardrailsDncRemoveRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const identifier = asString(body.identifier);
  if (!identifier) {
    return ownerOnlyJson({ ok: false, error: 'identifier is required.' }, 400);
  }
  const removed = await removeFromDoNotContact(identifier);
  if (!removed) {
    return ownerOnlyJson({ ok: false, error: 'Do-not-contact entry not found.' }, 404);
  }
  return ownerOnlyJson({ ok: true, removed: true, identifier });
}

export async function handleOutreachGuardrailsBounceRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const recipient = asString(body.recipient);
  if (!recipient) {
    return ownerOnlyJson({ ok: false, error: 'recipient is required.' }, 400);
  }
  const entry = await recordBounce(recipient);
  return ownerOnlyJson({ ok: true, entry }, 201);
}

export async function handleOutreachGuardrailsUnsubscribeRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const recipient = asString(body.recipient);
  if (!recipient) {
    return ownerOnlyJson({ ok: false, error: 'recipient is required.' }, 400);
  }
  const entry = await recordUnsubscribe(recipient, asString(body.reason));
  return ownerOnlyJson({ ok: true, entry }, 201);
}

export async function handleOutreachGuardrailsEvaluateRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  const result = await evaluateSendGuardrails({
    recipientContact: asString(body.recipientContact),
    subject: asString(body.subject),
    recipientTimezone: asString(body.recipientTimezone) || null,
  });
  if (!result.ok) {
    return ownerOnlyJson({ ok: false, code: result.code, reason: result.reason }, 409);
  }
  return ownerOnlyJson({ ok: true, allowed: true });
}

// ── AI architecture map ──────────────────────────────────────────────────────

export async function handleAiArchitectureMapRequest(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const version = await productionVersion();
  const map = await buildAiArchitectureMap(version);
  return ownerOnlyJson({ ok: true, map: map as unknown as Record<string, unknown> });
}
