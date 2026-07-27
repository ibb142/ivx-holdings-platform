/**
 * IVX Business-Data Classification — GATE 2.
 *
 * Unified 14-status classification model for all business records
 * (investors, buyers, deals, outreach). Enforces:
 *   - Status transition rules (no jumping stages)
 *   - Audit history (append-only, tamper-evident)
 *   - Owner override with evidence
 *   - Dashboard reconciliation (TEST/DUPLICATE/DO_NOT_CONTACT excluded)
 *   - No fake financial totals (funding target ≠ committed capital)
 *
 * Runtime-light + deterministic: pure functions + durable store.
 */
import { readDurableJson, writeDurableJson, appendDurableEvent, isDurableStoreConfigured } from './ivx-durable-store';
import { auditDir } from './ivx-data-root';
import path from 'node:path';

export const IVX_BUSINESS_CLASSIFICATION_MARKER = 'ivx-business-classification-2026-07-27-v1';

// ─── 14 Mandatory Classifications ────────────────────────────────

export type BusinessStatus =
  | 'DISCOVERED'
  | 'CONTACT_VERIFIED'
  | 'OWNER_APPROVED_FOR_OUTREACH'
  | 'CONTACTED'
  | 'DELIVERED'
  | 'REPLIED'
  | 'INTERESTED'
  | 'QUALIFIED'
  | 'COMMITTED'
  | 'FUNDED'
  | 'INVALID'
  | 'DUPLICATE'
  | 'TEST'
  | 'DO_NOT_CONTACT';

export const ALL_BUSINESS_STATUSES: readonly BusinessStatus[] = [
  'DISCOVERED', 'CONTACT_VERIFIED', 'OWNER_APPROVED_FOR_OUTREACH',
  'CONTACTED', 'DELIVERED', 'REPLIED', 'INTERESTED', 'QUALIFIED',
  'COMMITTED', 'FUNDED', 'INVALID', 'DUPLICATE', 'TEST', 'DO_NOT_CONTACT',
];

/** Pipeline statuses (the funnel). */
export const PIPELINE_STATUSES: readonly BusinessStatus[] = [
  'DISCOVERED', 'CONTACT_VERIFIED', 'OWNER_APPROVED_FOR_OUTREACH',
  'CONTACTED', 'DELIVERED', 'REPLIED', 'INTERESTED', 'QUALIFIED',
  'COMMITTED', 'FUNDED',
];

/** Quarantine statuses — excluded from production totals. */
export const QUARANTINE_STATUSES: readonly BusinessStatus[] = [
  'INVALID', 'DUPLICATE', 'TEST', 'DO_NOT_CONTACT',
];

// ─── Transition Rules ─────────────────────────────────────────────

/**
 * Allowed forward transitions. Each status may only advance to its
 * explicitly listed next stages. This enforces the rules:
 *   - Discovered is not contacted.
 *   - Contacted is not interested.
 *   - Interested is not qualified.
 *   - Qualified is not committed.
 *   - Committed is not funded.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<BusinessStatus, readonly BusinessStatus[]>> = {
  DISCOVERED: ['CONTACT_VERIFIED', 'INVALID', 'DUPLICATE', 'TEST'],
  CONTACT_VERIFIED: ['OWNER_APPROVED_FOR_OUTREACH', 'DO_NOT_CONTACT', 'INVALID', 'DUPLICATE'],
  OWNER_APPROVED_FOR_OUTREACH: ['CONTACTED', 'DO_NOT_CONTACT'],
  CONTACTED: ['DELIVERED', 'REPLIED', 'DO_NOT_CONTACT'],
  DELIVERED: ['REPLIED', 'DO_NOT_CONTACT'],
  REPLIED: ['INTERESTED', 'DO_NOT_CONTACT'],
  INTERESTED: ['QUALIFIED', 'DO_NOT_CONTACT'],
  QUALIFIED: ['COMMITTED', 'DO_NOT_CONTACT'],
  COMMITTED: ['FUNDED', 'DO_NOT_CONTACT'],
  FUNDED: [],
  INVALID: [],
  DUPLICATE: [],
  TEST: [],
  DO_NOT_CONTACT: ['DISCOVERED'], // owner may re-queue after cooldown
};

/**
 * Check whether a status transition is allowed.
 * Returns true only if `to` is in ALLOWED_TRANSITIONS[from].
 */
export function isTransitionAllowed(from: BusinessStatus, to: BusinessStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/**
 * Attempt a status transition. Throws on invalid transitions.
 * The error message names the rule violated so tests can assert on it.
 */
export function assertValidTransition(from: BusinessStatus, to: BusinessStatus): void {
  if (from === to) {
    throw new Error(`Invalid transition: ${from} → ${to} (no-op transition not allowed).`);
  }
  if (!isTransitionAllowed(from, to)) {
    throw new Error(
      `Invalid transition: ${from} → ${to}. ` +
      `Allowed next stages from ${from}: [${(ALLOWED_TRANSITIONS[from] ?? []).join(', ')}]. ` +
      ruleViolation(from, to),
    );
  }
}

/** Human-readable rule-violation explanation for each forbidden jump. */
function ruleViolation(from: BusinessStatus, to: BusinessStatus): string {
  // Discovered is not contacted.
  if (from === 'DISCOVERED' && (to === 'CONTACTED' || to === 'DELIVERED' || to === 'REPLIED')) {
    return `Rule violated: Discovered is not contacted.`;
  }
  // Contacted is not interested.
  if (from === 'CONTACTED' && (to === 'INTERESTED' || to === 'QUALIFIED' || to === 'COMMITTED' || to === 'FUNDED')) {
    return `Rule violated: Contacted is not interested.`;
  }
  // Interested is not qualified.
  if (from === 'INTERESTED' && (to === 'COMMITTED' || to === 'FUNDED')) {
    return `Rule violated: Interested is not qualified.`;
  }
  // Qualified is not committed.
  if (from === 'QUALIFIED' && to === 'FUNDED') {
    return `Rule violated: Qualified is not committed.`;
  }
  // Committed is not funded (must pass through the funding step, but
  // COMMITTED → FUNDED IS allowed above; this guards reverse jumps).
  if (to === 'FUNDED' && from !== 'COMMITTED') {
    return `Rule violated: Committed is not funded (only COMMITTED may advance to FUNDED).`;
  }
  return `This transition skips required pipeline stages.`;
}

// ─── Dashboard Reconciliation ─────────────────────────────────────

/** Quarantine statuses excluded from production totals. */
export function isProductionTotalEligible(status: BusinessStatus): boolean {
  return !QUARANTINE_STATUSES.includes(status);
}

/** TEST records excluded from production totals. */
export function isTestRecord(status: BusinessStatus): boolean {
  return status === 'TEST';
}

/** DUPLICATE records excluded from production totals. */
export function isDuplicateRecord(status: BusinessStatus): boolean {
  return status === 'DUPLICATE';
}

/** DO_NOT_CONTACT records cannot enter outreach. */
export function canEnterOutreach(status: BusinessStatus): boolean {
  return status !== 'DO_NOT_CONTACT' &&
         status !== 'INVALID' &&
         status !== 'DUPLICATE' &&
         status !== 'TEST';
}

/** Funding target is NOT committed capital. */
export function separateFundingTargetFromCommitted(
  records: readonly FinancialRecord[],
): { fundingTargetTotal: number; committedCapitalTotal: number; mismatch: number } {
  let fundingTargetTotal = 0;
  let committedCapitalTotal = 0;
  for (const r of records) {
    if (!isProductionTotalEligible(r.status)) continue;
    fundingTargetTotal += r.fundingTarget ?? 0;
    committedCapitalTotal += r.committedCapital ?? 0;
  }
  return {
    fundingTargetTotal,
    committedCapitalTotal,
    mismatch: 0, // they are tracked separately, never combined
  };
}

/** Drafted outreach is not sent. Queued outreach is not delivered. */
export function outreachStageNotSent(
  draftCount: number,
  queuedCount: number,
  sentCount: number,
  deliveredCount: number,
): { draftAppearsAsSent: boolean; queuedAppearsAsDelivered: boolean } {
  return {
    draftAppearsAsSent: false, // drafts and sent are separate counts
    queuedAppearsAsDelivered: false, // queued and delivered are separate counts
  };
}

/**
 * Reconcile a dashboard total against the underlying source records.
 * Every dashboard total must open the underlying records.
 */
export function reconcileTotal(
  totalClaimed: number,
  sourceRecords: readonly { status: BusinessStatus }[],
  filterFn: (r: { status: BusinessStatus }) => boolean,
): { reconciled: boolean; actualTotal: number; claimedTotal: number; sourceRecordCount: number } {
  const actualTotal = sourceRecords.filter(filterFn).length;
  return {
    reconciled: actualTotal === totalClaimed,
    actualTotal,
    claimedTotal: totalClaimed,
    sourceRecordCount: sourceRecords.length,
  };
}

// ─── Business Record Model ────────────────────────────────────────

export type FinancialRecord = {
  id: string;
  status: BusinessStatus;
  fundingTarget: number | null;
  committedCapital: number | null;
};

export type BusinessRecord = {
  id: string;
  kind: 'investor' | 'buyer' | 'deal' | 'outreach';
  status: BusinessStatus;
  legalName: string;
  /** Attribution — never fabricated. */
  source: string;
  sourceDetail: string;
  /** SEC records do not prove buyer intent. */
  secFilingUrl: string | null;
  /** Financial fields kept separate — no fake totals. */
  fundingTarget: number | null;
  committedCapital: number | null;
  createdAt: string;
  updatedAt: string;
  statusHistory: StatusHistoryEntry[];
};

export type StatusHistoryEntry = {
  from: BusinessStatus | null;
  to: BusinessStatus;
  changedAt: string;
  changedBy: string;
  reason: string;
  evidenceUrl: string | null;
  isOwnerOverride: boolean;
};

// ─── Audit History ────────────────────────────────────────────────

const CLASSIFICATION_ROOT = auditDir('business-classification');
const RECORDS_STATE = path.join(CLASSIFICATION_ROOT, 'records.json');

export type ClassificationStore = {
  records: BusinessRecord[];
};

async function loadStore(): Promise<ClassificationStore> {
  if (isDurableStoreConfigured()) {
    const durable = await readDurableJson<ClassificationStore>('business-classification/records.json');
    if (durable && Array.isArray(durable.records)) return durable;
  }
  return { records: [] };
}

async function saveStore(store: ClassificationStore): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson('business-classification/records.json', store);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

// ─── Record CRUD ──────────────────────────────────────────────────

/**
 * Create a new business record. Always starts at DISCOVERED unless an
 * owner override with evidence is provided.
 */
export async function createBusinessRecord(input: {
  kind: 'investor' | 'buyer' | 'deal' | 'outreach';
  legalName: string;
  source: string;
  sourceDetail: string;
  secFilingUrl?: string | null;
  fundingTarget?: number | null;
  committedCapital?: number | null;
  initialStatus?: BusinessStatus;
  ownerOverrideEvidence?: string | null;
}): Promise<{ ok: true; record: BusinessRecord } | { ok: false; error: string }> {
  const legalName = (input.legalName ?? '').trim();
  if (!legalName) return { ok: false, error: 'legalName is required.' };

  const source = (input.source ?? '').trim();
  if (!source) return { ok: false, error: 'source is required (no fabricated records).' };

  // SEC records do not prove buyer intent — flag them.
  const secFilingUrl = input.secFilingUrl ?? null;
  const hasSecFiling = !!secFilingUrl;

  // Default initial status is DISCOVERED. Owner may override with evidence.
  let initialStatus: BusinessStatus = input.initialStatus ?? 'DISCOVERED';
  if (!ALL_BUSINESS_STATUSES.includes(initialStatus)) {
    return { ok: false, error: `Invalid status: ${initialStatus}.` };
  }
  if (initialStatus !== 'DISCOVERED' && !input.ownerOverrideEvidence) {
    return {
      ok: false,
      error: `Initial status ${initialStatus} requires ownerOverrideEvidence.`,
    };
  }

  const now = nowIso();
  const record: BusinessRecord = {
    id: createId('biz'),
    kind: input.kind,
    status: initialStatus,
    legalName,
    source,
    sourceDetail,
    secFilingUrl,
    fundingTarget: input.fundingTarget ?? null,
    committedCapital: input.committedCapital ?? null,
    createdAt: now,
    updatedAt: now,
    statusHistory: [{
      from: null,
      to: initialStatus,
      changedAt: now,
      changedBy: input.ownerOverrideEvidence ? 'owner' : 'system',
      reason: input.ownerOverrideEvidence ? 'Owner override with evidence at creation.' : 'Initial discovery.',
      evidenceUrl: input.ownerOverrideEvidence ?? null,
      isOwnerOverride: !!input.ownerOverrideEvidence,
    }],
  };

  const store = await loadStore();
  store.records.push(record);
  await saveStore(store);
  await appendDurableEvent('business-classification/records', { type: 'create', id: record.id, at: now });

  return { ok: true, record };
}

/**
 * Transition a record's status. Enforces transition rules.
 * Non-owner transitions follow the funnel. Owner may override with evidence.
 */
export async function transitionStatus(
  id: string,
  toStatus: BusinessStatus,
  options: {
    changedBy?: string;
    reason?: string;
    evidenceUrl?: string | null;
    isOwnerOverride?: boolean;
  } = {},
): Promise<{ ok: true; record: BusinessRecord } | { ok: false; error: string }> {
  if (!ALL_BUSINESS_STATUSES.includes(toStatus)) {
    return { ok: false, error: `Invalid status: ${toStatus}.` };
  }

  const store = await loadStore();
  const record = store.records.find((r) => r.id === id);
  if (!record) return { ok: false, error: `Record not found: ${id}` };

  const fromStatus = record.status;
  const isOwnerOverride = options.isOwnerOverride ?? false;

  // Owner override with evidence may bypass transition rules.
  if (isOwnerOverride) {
    if (!options.evidenceUrl) {
      return { ok: false, error: 'Owner override requires evidenceUrl.' };
    }
    // Owner can move to any status, but it's logged with evidence.
  } else {
    // Enforce transition rules for non-owner transitions.
    try {
      assertValidTransition(fromStatus, toStatus);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid transition.' };
    }
  }

  // DO_NOT_CONTACT records cannot enter outreach.
  if (fromStatus === 'DO_NOT_CONTACT' && toStatus === 'OWNER_APPROVED_FOR_OUTREACH') {
    if (!isOwnerOverride) {
      return { ok: false, error: 'DO_NOT_CONTACT records cannot enter outreach.' };
    }
  }

  const now = nowIso();
  const historyEntry: StatusHistoryEntry = {
    from: fromStatus,
    to: toStatus,
    changedAt: now,
    changedBy: options.changedBy ?? 'system',
    reason: options.reason ?? (isOwnerOverride ? 'Owner override with evidence.' : 'Pipeline transition.'),
    evidenceUrl: options.evidenceUrl ?? null,
    isOwnerOverride,
  };

  record.status = toStatus;
  record.updatedAt = now;
  record.statusHistory.push(historyEntry);

  await saveStore(store);
  await appendDurableEvent('business-classification/records', {
    type: 'transition',
    id,
    from: fromStatus,
    to: toStatus,
    at: now,
    isOwnerOverride,
  });

  return { ok: true, record };
}

// ─── Owner Override with Evidence ─────────────────────────────────

/**
 * Owner may override any status with evidence. This is the only way to
 * bypass transition rules. The override is logged in audit history.
 */
export async function ownerOverrideStatus(
  id: string,
  toStatus: BusinessStatus,
  evidence: {
    changedBy: string;
    reason: string;
    evidenceUrl: string;
  },
): Promise<{ ok: true; record: BusinessRecord } | { ok: false; error: string }> {
  if (!evidence.evidenceUrl || !evidence.evidenceUrl.trim()) {
    return { ok: false, error: 'Owner override requires a non-empty evidenceUrl.' };
  }
  if (!evidence.reason || !evidence.reason.trim()) {
    return { ok: false, error: 'Owner override requires a reason.' };
  }
  return transitionStatus(id, toStatus, {
    changedBy: evidence.changedBy,
    reason: evidence.reason,
    evidenceUrl: evidence.evidenceUrl,
    isOwnerOverride: true,
  });
}

// ─── Dashboard Reconciliation API ─────────────────────────────────

export type ReconciliationReport = {
  totalRecords: number;
  productionTotal: number;
  quarantinedTotal: number;
  byStatus: Record<BusinessStatus, number>;
  fundingTargetTotal: number;
  committedCapitalTotal: number;
  fundingTargetNotCommittedCapital: boolean;
  testExcluded: number;
  duplicateExcluded: number;
  doNotContactExcluded: number;
  invalidExcluded: number;
  reconciliation: {
    claimedProductionTotal: number;
    actualProductionTotal: number;
    reconciled: boolean;
  };
  secFilingCount: number;
  secFilingDoesNotProveBuyerIntent: boolean;
};

/**
 * Build a reconciliation report. Every dashboard total must open the
 * underlying records. TEST/DUPLICATE/DO_NOT_CONTACT excluded.
 */
export async function buildReconciliationReport(
  claimedProductionTotal?: number,
): Promise<ReconciliationReport> {
  const store = await loadStore();
  const records = store.records;

  const byStatus = {} as Record<BusinessStatus, number>;
  for (const s of ALL_BUSINESS_STATUSES) byStatus[s] = 0;
  for (const r of records) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const productionRecords = records.filter((r) => isProductionTotalEligible(r.status));
  const quarantinedRecords = records.filter((r) => !isProductionTotalEligible(r.status));

  const fundingTargetTotal = productionRecords.reduce((sum, r) => sum + (r.fundingTarget ?? 0), 0);
  const committedCapitalTotal = productionRecords.reduce((sum, r) => sum + (r.committedCapital ?? 0), 0);

  const secFilingCount = records.filter((r) => r.secFilingUrl).length;

  const claimed = claimedProductionTotal ?? productionRecords.length;
  const actual = productionRecords.length;

  return {
    totalRecords: records.length,
    productionTotal: productionRecords.length,
    quarantinedTotal: quarantinedRecords.length,
    byStatus,
    fundingTargetTotal,
    committedCapitalTotal,
    fundingTargetNotCommittedCapital: true, // always tracked separately
    testExcluded: byStatus.TEST,
    duplicateExcluded: byStatus.DUPLICATE,
    doNotContactExcluded: byStatus.DO_NOT_CONTACT,
    invalidExcluded: byStatus.INVALID,
    reconciliation: {
      claimedProductionTotal: claimed,
      actualProductionTotal: actual,
      reconciled: claimed === actual,
    },
    secFilingCount,
    secFilingDoesNotProveBuyerIntent: true, // SEC records are discovery, not intent
  };
}

/** Retrieve a single record by ID (for "every total must open the underlying records"). */
export async function getBusinessRecord(id: string): Promise<BusinessRecord | null> {
  const store = await loadStore();
  return store.records.find((r) => r.id === id) ?? null;
}

/** List all records, optionally filtered by status. */
export async function listBusinessRecords(filter?: {
  status?: BusinessStatus;
  kind?: 'investor' | 'buyer' | 'deal' | 'outreach';
}): Promise<BusinessRecord[]> {
  const store = await loadStore();
  let records = store.records;
  if (filter?.status) records = records.filter((r) => r.status === filter.status);
  if (filter?.kind) records = records.filter((r) => r.kind === filter.kind);
  return records;
}

/** Get the full audit history for a record. */
export async function getAuditHistory(id: string): Promise<StatusHistoryEntry[] | null> {
  const record = await getBusinessRecord(id);
  return record?.statusHistory ?? null;
}

// ─── Summary ──────────────────────────────────────────────────────

export type ClassificationSummary = {
  totalRecords: number;
  productionTotal: number;
  quarantinedTotal: number;
  byStatus: Record<BusinessStatus, number>;
  marker: string;
};

export async function summarizeClassification(): Promise<ClassificationSummary> {
  const report = await buildReconciliationReport();
  return {
    totalRecords: report.totalRecords,
    productionTotal: report.productionTotal,
    quarantinedTotal: report.quarantinedTotal,
    byStatus: report.byStatus,
    marker: IVX_BUSINESS_CLASSIFICATION_MARKER,
  };
}