/**
 * IVX Capital Deployment Platform — Real Deal Tracking store (owner-only).
 *
 * BLOCK 26. The fourth pillar: track every real deal end-to-end through its
 * lifecycle milestones (created → investor/buyer contacted → meetings → docs →
 * offers → capital committed → closed) and roll the portfolio up into the
 * outcome metrics that matter: Conversion Rate, Capital Raised, Average Deal
 * Size, Time to Close, and Investor Response Rate.
 *
 * HARD HONESTY RULE (platform-wide, enforced here):
 *   - IVX NEVER fabricates deal data. `dealName` + a real `source`
 *     (owner_entered | submitted_form | crm_import | public_source | verified_deal)
 *     are required on create; public_source / crm_import also require attribution.
 *   - Milestone counters start at 0 and only move when the owner records real
 *     activity. Capital values stay null until known. Metrics are COMPUTED from
 *     these counters, never invented.
 *
 * Durable layout (mirrors the proven ivx-investor-crm-store pattern):
 *   logs/audit/deal-tracking/deals.jsonl  append-only event log
 *   logs/audit/deal-tracking/deals.json   materialised current state
 *
 * Runtime-light + deterministic: only filesystem I/O, no AI/network. Fully testable.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';

export const IVX_DEAL_TRACKING_MARKER = 'ivx-deal-tracking-2026-05-31';

export type DealSource =
  | 'owner_entered'
  | 'submitted_form'
  | 'crm_import'
  | 'public_source'
  | 'verified_deal';

/** Deal lifecycle status. */
export type DealStatus = 'open' | 'in_progress' | 'closed_won' | 'closed_lost';

/** The structural category of a deal — drives JV / private-lender / tokenized reporting. */
export type DealType =
  | 'jv'          // Joint venture: equity partnership with shared ownership + profit split
  | 'private_lender' // Private lender: debt facility with fixed return terms
  | 'tokenized';  // Tokenized: fractional ownership represented by tokens

export const VALID_DEAL_TYPES: ReadonlySet<DealType> = new Set(['jv', 'private_lender', 'tokenized']);

/** The countable lifecycle milestones (all start at 0). */
export type DealMilestoneField =
  | 'investorsContacted'
  | 'investorsResponded'
  | 'buyersContacted'
  | 'meetingsScheduled'
  | 'documentsShared'
  | 'offersReceived';

export const DEAL_MILESTONE_FIELDS: readonly DealMilestoneField[] = [
  'investorsContacted', 'investorsResponded', 'buyersContacted',
  'meetingsScheduled', 'documentsShared', 'offersReceived',
];

/** A single participant in a deal (investor / lender / token holder). */
export type DealParticipant = {
  /** Stable identifier of the participant (member userId, lender id, or wallet address). */
  participantId: string;
  /** Display name for the participant (kept for audit legibility only). */
  displayName: string;
  /** Percentage of ownership this participant holds (0–100). For tokenized deals this is the token share. */
  ownershipPercentage: number;
  /** Whole-USD amount this participant has invested into the deal. */
  investedAmount: number;
  /** Profit split percentage this participant is entitled to (0–100). */
  profitPercentage: number;
  /** When the participant joined the deal. */
  joinedAt: string;
  /** Optional document references (file names / storage paths). */
  documents?: string[];
};

/** A document attached to a deal (contract, offering memo, KYC packet, etc.). */
export type DealDocument = {
  id: string;
  name: string;
  /** Storage path or URL reference. */
  uri: string;
  /** Document kind for filtering. */
  kind: 'contract' | 'offering_memo' | 'kyc_packet' | 'valuation' | 'closing' | 'other';
  uploadedAt: string;
  uploadedBy?: string;
};

export type DealTrackingRecord = {
  id: string;
  dealName: string;
  /** Developer / seller / counterparty name, or empty if unknown. */
  counterparty: string;
  /** Structural category of the deal. */
  dealType: DealType;
  status: DealStatus;
  investorsContacted: number;
  investorsResponded: number;
  buyersContacted: number;
  meetingsScheduled: number;
  documentsShared: number;
  offersReceived: number;
  /** Capital target in whole USD, or null if unknown. */
  capitalTarget: number | null;
  /** Capital committed so far in whole USD, or null if unknown. */
  capitalCommitted: number | null;
  /** ISO date the deal closed (won or lost), or null if still open. */
  closedAt: string | null;
  notes: string;
  source: DealSource;
  sourceDetail: string;
  /** Participants who have joined the deal (JV partners, lenders, token holders). */
  participants: DealParticipant[];
  /** Documents attached to the deal. */
  documents: DealDocument[];
  createdAt: string;
  updatedAt: string;
};

const ROOT = auditDir('deal-tracking');
const STATE = path.join(ROOT, 'deals.json');

const VALID_SOURCES: ReadonlySet<DealSource> = new Set([
  'owner_entered', 'submitted_form', 'crm_import', 'public_source', 'verified_deal',
]);
const VALID_STATUS: ReadonlySet<DealStatus> = new Set([
  'open', 'in_progress', 'closed_won', 'closed_lost',
]);
const VALID_MILESTONES: ReadonlySet<string> = new Set(DEAL_MILESTONE_FIELDS);

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Parse a non-negative whole count, or 0. */
export function normalizeCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Parse a non-negative whole-USD amount, or null if absent/invalid. */
export function normalizeAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** Normalize an ISO-ish date string to an ISO string, or null if absent/invalid. */
export function normalizeDate(value: unknown): string | null {
  const v = asTrimmedString(value);
  if (!v) return null;
  const time = Date.parse(v);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function isClosed(status: DealStatus): boolean {
  return status === 'closed_won' || status === 'closed_lost';
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  if (isDurableStoreConfigured()) {
    return readDurableJson<T>(file, fallback);
  }
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(file, value);
    return;
  }
  await mkdir(ROOT, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function appendEvent(event: Record<string, unknown>): Promise<void> {
  const eventFile = path.join(ROOT, 'deals.jsonl');
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(eventFile, event);
    } catch {
      // Forensic log is best-effort; never break a write on log failure.
    }
    return;
  }
  try {
    await mkdir(ROOT, { recursive: true });
    await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Forensic log is best-effort; never break a write on log failure.
  }
}

export type CreateDealInput = {
  dealName: string;
  source: DealSource;
  sourceDetail?: string;
  counterparty?: string;
  dealType?: DealType;
  status?: DealStatus;
  investorsContacted?: number;
  investorsResponded?: number;
  buyersContacted?: number;
  meetingsScheduled?: number;
  documentsShared?: number;
  offersReceived?: number;
  capitalTarget?: number | null;
  capitalCommitted?: number | null;
  closedAt?: string | null;
  notes?: string;
  participants?: DealParticipant[];
  documents?: DealDocument[];
};

export type UpdateDealInput = Partial<Omit<CreateDealInput, 'source'>> & {
  source?: DealSource;
};

export type JoinDealInput = {
  participantId: string;
  displayName: string;
  ownershipPercentage?: number;
  investedAmount?: number;
  profitPercentage?: number;
  documents?: string[];
};

export type AddDealDocumentInput = {
  name: string;
  uri: string;
  kind?: DealDocument['kind'];
  uploadedBy?: string;
};

export type DealValidation = { ok: true } | { ok: false; error: string; code: string };

/** Validate a create input. Enforces the honesty rule: name + real source required. */
export function validateCreateDeal(input: CreateDealInput): DealValidation {
  if (!asTrimmedString(input.dealName)) {
    return { ok: false, error: 'Deal name is required — IVX never fabricates a deal record.', code: 'DEAL_NAME_REQUIRED' };
  }
  if (!VALID_SOURCES.has(input.source)) {
    return {
      ok: false,
      error: 'A real source is required (owner_entered | submitted_form | crm_import | public_source | verified_deal).',
      code: 'DEAL_SOURCE_INVALID',
    };
  }
  if ((input.source === 'public_source' || input.source === 'crm_import') && !asTrimmedString(input.sourceDetail)) {
    return {
      ok: false,
      error: 'Source attribution (sourceDetail) is required for public_source and crm_import records.',
      code: 'DEAL_SOURCE_DETAIL_REQUIRED',
    };
  }
  return { ok: true };
}

function buildRecord(input: CreateDealInput, prior?: DealTrackingRecord): DealTrackingRecord {
  const status: DealStatus = input.status && VALID_STATUS.has(input.status)
    ? input.status
    : prior?.status ?? 'open';
  // Auto-stamp closedAt when transitioning into a closed status without an explicit date.
  let closedAt = input.closedAt !== undefined ? normalizeDate(input.closedAt) : prior?.closedAt ?? null;
  if (isClosed(status) && closedAt === null) closedAt = nowIso();
  if (!isClosed(status)) closedAt = input.closedAt !== undefined ? normalizeDate(input.closedAt) : prior?.closedAt ?? null;

  const num = (key: DealMilestoneField): number =>
    input[key] !== undefined ? normalizeCount(input[key]) : prior?.[key] ?? 0;

  const dealType: DealType = input.dealType && VALID_DEAL_TYPES.has(input.dealType)
    ? input.dealType
    : prior?.dealType ?? 'jv';

  return {
    id: prior?.id ?? createId('deal'),
    dealName: asTrimmedString(input.dealName) || prior?.dealName || '',
    counterparty: input.counterparty !== undefined ? asTrimmedString(input.counterparty) : prior?.counterparty ?? '',
    dealType,
    status,
    investorsContacted: num('investorsContacted'),
    investorsResponded: num('investorsResponded'),
    buyersContacted: num('buyersContacted'),
    meetingsScheduled: num('meetingsScheduled'),
    documentsShared: num('documentsShared'),
    offersReceived: num('offersReceived'),
    capitalTarget: input.capitalTarget !== undefined ? normalizeAmount(input.capitalTarget) : prior?.capitalTarget ?? null,
    capitalCommitted: input.capitalCommitted !== undefined ? normalizeAmount(input.capitalCommitted) : prior?.capitalCommitted ?? null,
    closedAt,
    notes: input.notes !== undefined ? asTrimmedString(input.notes) : prior?.notes ?? '',
    source: input.source && VALID_SOURCES.has(input.source) ? input.source : prior?.source ?? 'owner_entered',
    sourceDetail: input.sourceDetail !== undefined ? asTrimmedString(input.sourceDetail) : prior?.sourceDetail ?? '',
    participants: Array.isArray(input.participants) ? input.participants : prior?.participants ?? [],
    documents: Array.isArray(input.documents) ? input.documents : prior?.documents ?? [],
    createdAt: prior?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
}

/** Optional limit for listDeals — caps the response payload when the deal portfolio grows large. */
export async function listDeals(limit?: number): Promise<DealTrackingRecord[]> {
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const sorted = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
}

export async function getDeal(id: string): Promise<DealTrackingRecord | null> {
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  return items.find((item) => item.id === id) ?? null;
}

/** Create a new tracked deal. Returns the validation error on failure. */
export async function createDeal(
  input: CreateDealInput,
): Promise<{ ok: true; deal: DealTrackingRecord } | { ok: false; error: string }> {
  const validation = validateCreateDeal(input);
  if (!validation.ok) return validation;
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const record = buildRecord(input);
  items.push(record);
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'create', deal: record, at: record.createdAt });
  return { ok: true, deal: record };
}

/** Update a tracked deal. Returns null if not found. */
export async function updateDeal(id: string, patch: UpdateDealInput): Promise<DealTrackingRecord | null> {
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const prior = items[index]!;
  const merged = buildRecord({ ...prior, ...patch, source: patch.source ?? prior.source, dealName: patch.dealName ?? prior.dealName }, prior);
  items[index] = merged;
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'update', dealId: id, deal: merged, at: merged.updatedAt });
  return merged;
}

/** Increment a milestone counter by `by` (default 1). Returns null if not found / invalid. */
export async function incrementDealMilestone(
  id: string,
  field: DealMilestoneField,
  by: number = 1,
): Promise<DealTrackingRecord | null> {
  if (!VALID_MILESTONES.has(field)) return null;
  const current = await getDeal(id);
  if (!current) return null;
  const next = Math.max(0, current[field] + Math.floor(by));
  return updateDeal(id, { [field]: next } as UpdateDealInput);
}

/** Move just the status. Returns null if not found / invalid. */
export async function setDealStatus(id: string, status: DealStatus): Promise<DealTrackingRecord | null> {
  if (!VALID_STATUS.has(status)) return null;
  return updateDeal(id, { status });
}

/** Delete a tracked deal. Returns true if a record was removed. */
export async function deleteDeal(id: string): Promise<boolean> {
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  await writeJsonFile(STATE, next);
  await appendEvent({ type: 'delete', dealId: id, at: nowIso() });
  return true;
}

// ---------------------------------------------------------------------------
// JV / private-lender / tokenized participant + document tracking
// ---------------------------------------------------------------------------

function clampPercent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function normalizeAmountWhole(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

const VALID_DOC_KINDS: ReadonlySet<DealDocument['kind']> = new Set([
  'contract', 'offering_memo', 'kyc_packet', 'valuation', 'closing', 'other',
]);

/** Join a participant into a deal (JV partner, private lender, or token holder).
 *  Validates ownership + profit percentages stay within 0–100 and that the
 *  total ownership across all participants does not exceed 100. Returns null if
 *  the deal is not found. Returns an error string if the ownership cap is exceeded. */
export async function joinDeal(
  dealId: string,
  input: JoinDealInput,
): Promise<{ ok: true; deal: DealTrackingRecord } | { ok: false; error: string } | null> {
  if (!asTrimmedString(input.participantId)) {
    return { ok: false, error: 'participantId is required.' };
  }
  if (!asTrimmedString(input.displayName)) {
    return { ok: false, error: 'displayName is required.' };
  }
  const ownership = clampPercent(input.ownershipPercentage ?? 0);
  const profit = clampPercent(input.profitPercentage ?? 0);
  const invested = normalizeAmountWhole(input.investedAmount ?? 0);

  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const index = items.findIndex((item) => item.id === dealId);
  if (index === -1) return null;

  const deal = items[index]!;
  const existingTotal = deal.participants.reduce((sum, p) => sum + p.ownershipPercentage, 0);
  const existingSame = deal.participants.find((p) => p.participantId === input.participantId);
  if (existingSame) {
    // Updating an existing participant — recompute the total without their prior share.
    const newTotal = existingTotal - existingSame.ownershipPercentage + ownership;
    if (newTotal > 100) {
      return { ok: false, error: `Ownership would exceed 100% (new total: ${newTotal}%).` };
    }
    existingSame.ownershipPercentage = ownership;
    existingSame.profitPercentage = profit;
    existingSame.investedAmount = invested;
    existingSame.joinedAt = existingSame.joinedAt;
    if (Array.isArray(input.documents)) existingSame.documents = input.documents;
  } else {
    const newTotal = existingTotal + ownership;
    if (newTotal > 100) {
      return { ok: false, error: `Ownership would exceed 100% (new total: ${newTotal}%).` };
    }
    const participant: DealParticipant = {
      participantId: asTrimmedString(input.participantId),
      displayName: asTrimmedString(input.displayName),
      ownershipPercentage: ownership,
      investedAmount: invested,
      profitPercentage: profit,
      joinedAt: nowIso(),
      documents: Array.isArray(input.documents) ? input.documents : undefined,
    };
    deal.participants = [...deal.participants, participant];
  }
  // Recompute capitalCommitted from the sum of participant invested amounts when known.
  const participantTotal = deal.participants.reduce((sum, p) => sum + p.investedAmount, 0);
  if (participantTotal > 0) {
    deal.capitalCommitted = participantTotal;
  }
  deal.updatedAt = nowIso();
  items[index] = deal;
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'join', dealId, participantId: input.participantId, deal, at: deal.updatedAt });
  return { ok: true, deal };
}

/** Remove a participant from a deal. Returns null if the deal was not found,
 *  false if the participant was not on the deal, true on success. */
export async function leaveDeal(dealId: string, participantId: string): Promise<boolean | null> {
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const index = items.findIndex((item) => item.id === dealId);
  if (index === -1) return null;
  const deal = items[index]!;
  const before = deal.participants.length;
  deal.participants = deal.participants.filter((p) => p.participantId !== participantId);
  if (deal.participants.length === before) return false;
  const participantTotal = deal.participants.reduce((sum, p) => sum + p.investedAmount, 0);
  if (participantTotal > 0) deal.capitalCommitted = participantTotal;
  deal.updatedAt = nowIso();
  items[index] = deal;
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'leave', dealId, participantId, deal, at: deal.updatedAt });
  return true;
}

/** Attach a document to a deal. Returns null if the deal was not found. */
export async function addDealDocument(
  dealId: string,
  input: AddDealDocumentInput,
): Promise<DealDocument | null> {
  if (!asTrimmedString(input.name) || !asTrimmedString(input.uri)) {
    return null;
  }
  const kind: DealDocument['kind'] = input.kind && VALID_DOC_KINDS.has(input.kind) ? input.kind : 'other';
  const doc: DealDocument = {
    id: createId('doc'),
    name: asTrimmedString(input.name),
    uri: asTrimmedString(input.uri),
    kind,
    uploadedAt: nowIso(),
    uploadedBy: asTrimmedString(input.uploadedBy) || undefined,
  };
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const index = items.findIndex((item) => item.id === dealId);
  if (index === -1) return null;
  const deal = items[index]!;
  deal.documents = [...deal.documents, doc];
  // Also bump the documentsShared milestone so the deal pipeline reflects the new doc.
  deal.documentsShared = deal.documentsShared + 1;
  deal.updatedAt = doc.uploadedAt;
  items[index] = deal;
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'document_added', dealId, document: doc, at: doc.uploadedAt });
  return doc;
}

/** Remove a document from a deal. Returns null if the deal was not found,
 *  false if the document was not on the deal, true on success. */
export async function removeDealDocument(dealId: string, documentId: string): Promise<boolean | null> {
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const index = items.findIndex((item) => item.id === dealId);
  if (index === -1) return null;
  const deal = items[index]!;
  const before = deal.documents.length;
  deal.documents = deal.documents.filter((d) => d.id !== documentId);
  if (deal.documents.length === before) return false;
  deal.updatedAt = nowIso();
  items[index] = deal;
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'document_removed', dealId, documentId, at: deal.updatedAt });
  return true;
}

export type DealTrackingMetrics = {
  marker: string;
  generatedAt: string;
  total: number;
  byStatus: Record<DealStatus, number>;
  byType: Record<DealType, number>;
  /** closed_won / total, 0–100. */
  conversionRate: number;
  /** Sum of capitalCommitted on closed_won deals. */
  capitalRaised: number;
  /** capitalRaised / count of closed_won deals with a committed amount. */
  averageDealSize: number;
  /** Avg days from createdAt → closedAt over closed_won deals (null if none). */
  avgTimeToCloseDays: number | null;
  /** investorsResponded / investorsContacted across all deals, 0–100 (null if none contacted). */
  investorResponseRate: number | null;
  totalMeetings: number;
  totalOffers: number;
  /** Total participants across all deals (JV partners + lenders + token holders). */
  totalParticipants: number;
  /** Total invested amount summed across all participants (whole USD). */
  totalInvestedByParticipants: number;
};

/** Read-only roll-up of the real outcome metrics across all tracked deals. */
export async function summarizeDeals(): Promise<DealTrackingMetrics> {
  const items = await readJsonFile<DealTrackingRecord[]>(STATE, []);
  const byStatus: Record<DealStatus, number> = {
    open: 0, in_progress: 0, closed_won: 0, closed_lost: 0,
  };
  const byType: Record<DealType, number> = {
    jv: 0, private_lender: 0, tokenized: 0,
  };
  let capitalRaised = 0;
  let wonWithAmount = 0;
  let closeDaysSum = 0;
  let closeDaysCount = 0;
  let investorsContacted = 0;
  let investorsResponded = 0;
  let totalMeetings = 0;
  let totalOffers = 0;
  let totalParticipants = 0;
  let totalInvestedByParticipants = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    byType[item.dealType] = (byType[item.dealType] ?? 0) + 1;
    investorsContacted += item.investorsContacted ?? 0;
    investorsResponded += item.investorsResponded ?? 0;
    totalMeetings += item.meetingsScheduled ?? 0;
    totalOffers += item.offersReceived ?? 0;
    const participants = Array.isArray(item.participants) ? item.participants : [];
    totalParticipants += participants.length;
    totalInvestedByParticipants += participants.reduce((sum, p) => sum + (p?.investedAmount ?? 0), 0);
    if (item.status === 'closed_won') {
      if (item.capitalCommitted !== null) {
        capitalRaised += item.capitalCommitted;
        wonWithAmount += 1;
      }
      if (item.closedAt) {
        const days = (Date.parse(item.closedAt) - Date.parse(item.createdAt)) / (1000 * 60 * 60 * 24);
        if (Number.isFinite(days) && days >= 0) {
          closeDaysSum += days;
          closeDaysCount += 1;
        }
      }
    }
  }

  const total = items.length;
  return {
    marker: IVX_DEAL_TRACKING_MARKER,
    generatedAt: nowIso(),
    total,
    byStatus,
    byType,
    conversionRate: total > 0 ? Math.round((byStatus.closed_won / total) * 100) : 0,
    capitalRaised,
    averageDealSize: wonWithAmount > 0 ? Math.round(capitalRaised / wonWithAmount) : 0,
    avgTimeToCloseDays: closeDaysCount > 0 ? Math.round(closeDaysSum / closeDaysCount) : null,
    investorResponseRate: investorsContacted > 0 ? Math.round((investorsResponded / investorsContacted) * 100) : null,
    totalMeetings,
    totalOffers,
    totalParticipants,
    totalInvestedByParticipants,
  };
}
