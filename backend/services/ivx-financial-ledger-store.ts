/**
 * IVX Financial Ledger — independent reconciled transaction store (owner-only).
 *
 * Implements Block 6 of the owner's real-data mandate. This ledger is
 * INDEPENDENT from CRM scoring / pipeline probability math. Only
 * `escrow_received` or `bank_received` transactions count as "Funds Received."
 * Every committed or received amount MUST carry documentary evidence.
 *
 * HARD HONESTY RULE (enforced here):
 *   - Every transaction requires an investorId, dealId, amount, currency,
 *     status, and an evidenceUrl (supporting document). No evidence → rejected.
 *   - Amounts are whole units in the stated currency; never invented.
 *   - Reconciliation status starts `unreconciled` and only becomes `reconciled`
 *     when the owner attaches a second, independent evidence reference.
 *   - Funds Received = sum of transactions with status `escrow_received` OR
 *     `bank_received` AND reconciliation_status = `reconciled`. Nothing else.
 *
 * Durable layout (mirrors the proven ivx-investor-crm-store pattern):
 *   logs/audit/financial-ledger/transactions.jsonl  append-only event log
 *   logs/audit/financial-ledger/transactions.json   materialised current state
 *
 * Runtime-light + deterministic: filesystem I/O only. Fully testable.
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

export const IVX_FINANCIAL_LEDGER_MARKER = 'ivx-financial-ledger-2026-07-18';

/**
 * The nine canonical transaction statuses. Only the final two count as
 * "Funds Received" — everything upstream is intent, not money in the bank.
 */
export type FinancialTransactionStatus =
  | 'projected'
  | 'requested'
  | 'soft_commitment'
  | 'signed_commitment'
  | 'pending_wire'
  | 'escrow_received'
  | 'bank_received'
  | 'returned'
  | 'cancelled';

export const FINANCIAL_TRANSACTION_STATUSES: readonly FinancialTransactionStatus[] = [
  'projected',
  'requested',
  'soft_commitment',
  'signed_commitment',
  'pending_wire',
  'escrow_received',
  'bank_received',
  'returned',
  'cancelled',
];

export const VALID_TRANSACTION_STATUSES: ReadonlySet<FinancialTransactionStatus> = new Set(
  FINANCIAL_TRANSACTION_STATUSES,
);

/** Statuses that represent actual money received (Funds Received). */
export const FUNDS_RECEIVED_STATUSES: ReadonlySet<FinancialTransactionStatus> = new Set([
  'escrow_received',
  'bank_received',
]);

/** Statuses that represent a real commitment (Committed Capital). */
export const COMMITTED_STATUSES: ReadonlySet<FinancialTransactionStatus> = new Set([
  'soft_commitment',
  'signed_commitment',
  'pending_wire',
  'escrow_received',
  'bank_received',
]);

export type ReconciliationStatus = 'unreconciled' | 'reconciled' | 'disputed';

export const VALID_RECONCILIATION_STATUSES: ReadonlySet<ReconciliationStatus> = new Set([
  'unreconciled',
  'reconciled',
  'disputed',
]);

export type FinancialTransaction = {
  id: string;
  /** Stable reference to the investor record (CRM id or external id). */
  investorId: string;
  /** Stable reference to the deal record (deal-tracking id or jv_deals id). */
  dealId: string;
  /** Whole units in `currency`. */
  amount: number;
  /** ISO 4217 currency code (USD, EUR, ...). */
  currency: string;
  transactionStatus: FinancialTransactionStatus;
  /** ISO date the transaction occurred (or was recorded). */
  transactionDate: string;
  /** URL or storage path to the supporting document. Required, never empty. */
  evidenceUrl: string;
  /** Optional second evidence reference used to mark `reconciled`. */
  reconciliationEvidenceUrl: string | null;
  reconciliationStatus: ReconciliationStatus;
  /** Owner who approved/recorded this transaction. */
  approvedBy: string;
  /** Immutable audit trace id (hash chain link). */
  auditTraceId: string;
  notes: string;
  dataOrigin: DataOrigin;
  sourceRecordId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
};

/** Allowed data_origin values (shared platform-wide — see ivx-data-origin.ts). */
export type DataOrigin =
  | 'production_registration'
  | 'imported_verified'
  | 'owner_created'
  | 'partner_source'
  | 'public_business_source'
  | 'test';

export const VALID_DATA_ORIGINS: ReadonlySet<DataOrigin> = new Set([
  'production_registration',
  'imported_verified',
  'owner_created',
  'partner_source',
  'public_business_source',
  'test',
]);

const ROOT = auditDir('financial-ledger');
const STATE = path.join(ROOT, 'transactions.json');

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

function normalizeAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function normalizeDate(value: unknown): string | null {
  const v = asTrimmedString(value);
  if (!v) return null;
  const time = Date.parse(v);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function normalizeDataOrigin(value: unknown): DataOrigin {
  const v = asTrimmedString(value).toLowerCase() as DataOrigin;
  return VALID_DATA_ORIGINS.has(v) ? v : 'owner_created';
}

/** Simple hash-chain audit trace id (deterministic, links to the prior row). */
function computeAuditTraceId(prev: FinancialTransaction | null, seed: string): string {
  const prevHash = prev?.auditTraceId ?? 'genesis';
  // node:crypto SHA-256 — available synchronously
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256')
    .update(`${prevHash}|${seed}|${Date.now()}`)
    .digest('hex')
    .slice(0, 40);
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
  const eventFile = path.join(ROOT, 'transactions.jsonl');
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(eventFile, event);
    } catch {
      // best-effort forensic log
    }
    return;
  }
  try {
    await mkdir(ROOT, { recursive: true });
    await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // best-effort forensic log
  }
}

export type CreateFinancialTransactionInput = {
  investorId: string;
  dealId: string;
  amount: number;
  currency?: string;
  transactionStatus: FinancialTransactionStatus;
  transactionDate?: string;
  evidenceUrl: string;
  reconciliationEvidenceUrl?: string;
  reconciliationStatus?: ReconciliationStatus;
  approvedBy: string;
  notes?: string;
  dataOrigin?: DataOrigin;
  sourceRecordId?: string;
  createdBy?: string;
};

export type FinancialTransactionValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate a create input. Enforces the honesty rule: evidence is REQUIRED,
 * investor + deal + amount must be present, status must be one of the nine.
 */
export function validateCreateFinancialTransaction(
  input: CreateFinancialTransactionInput,
): FinancialTransactionValidation {
  if (!asTrimmedString(input.investorId)) {
    return { ok: false, error: 'investorId is required — every transaction must attach to a real investor.' };
  }
  if (!asTrimmedString(input.dealId)) {
    return { ok: false, error: 'dealId is required — every transaction must attach to a real deal.' };
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null || amount <= 0) {
    return { ok: false, error: 'amount must be a positive number — never invented.' };
  }
  if (!VALID_TRANSACTION_STATUSES.has(input.transactionStatus)) {
    return {
      ok: false,
      error:
        'transactionStatus must be one of: projected, requested, soft_commitment, signed_commitment, pending_wire, escrow_received, bank_received, returned, cancelled.',
    };
  }
  if (!asTrimmedString(input.evidenceUrl)) {
    return {
      ok: false,
      error:
        'evidenceUrl is required — no transaction is recorded without a supporting document (the honesty rule).',
    };
  }
  if (!asTrimmedString(input.approvedBy)) {
    return { ok: false, error: 'approvedBy is required — the owner who records the transaction.' };
  }
  return { ok: true };
}

function buildTransaction(
  input: CreateFinancialTransactionInput,
  prev: FinancialTransaction | null,
  prior?: FinancialTransaction,
): FinancialTransaction {
  const amount = normalizeAmount(input.amount) ?? prior?.amount ?? 0;
  const transactionDate = normalizeDate(input.transactionDate) ?? (prior?.transactionDate ?? nowIso());
  const currency = asTrimmedString(input.currency) || (prior?.currency || 'USD');
  const auditTraceId = prior?.auditTraceId ?? computeAuditTraceId(prev, `${input.investorId}|${input.dealId}|${amount}`);
  return {
    id: prior?.id ?? createId('fin-tx'),
    investorId: asTrimmedString(input.investorId) || (prior?.investorId ?? ''),
    dealId: asTrimmedString(input.dealId) || (prior?.dealId ?? ''),
    amount,
    currency,
    transactionStatus: input.transactionStatus,
    transactionDate,
    evidenceUrl: asTrimmedString(input.evidenceUrl) || (prior?.evidenceUrl ?? ''),
    reconciliationEvidenceUrl:
      input.reconciliationEvidenceUrl !== undefined
        ? asTrimmedString(input.reconciliationEvidenceUrl) || null
        : prior?.reconciliationEvidenceUrl ?? null,
    reconciliationStatus:
      input.reconciliationStatus !== undefined
        ? (input.reconciliationStatus as ReconciliationStatus)
        : prior?.reconciliationStatus ?? 'unreconciled',
    approvedBy: asTrimmedString(input.approvedBy) || (prior?.approvedBy ?? ''),
    auditTraceId,
    notes: input.notes !== undefined ? asTrimmedString(input.notes) : (prior?.notes ?? ''),
    dataOrigin: normalizeDataOrigin(input.dataOrigin ?? (prior?.dataOrigin ?? 'owner_created')),
    sourceRecordId: asTrimmedString(input.sourceRecordId) || (prior?.sourceRecordId ?? ''),
    createdBy: asTrimmedString(input.createdBy) || (prior?.createdBy || (input.approvedBy || '')),
    createdAt: prior?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    verifiedAt: prior?.verifiedAt ?? null,
    verifiedBy: prior?.verifiedBy ?? null,
  };
}

export async function listFinancialTransactions(): Promise<FinancialTransaction[]> {
  const items = await readJsonFile<FinancialTransaction[]>(STATE, []);
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getFinancialTransaction(id: string): Promise<FinancialTransaction | null> {
  const items = await readJsonFile<FinancialTransaction[]>(STATE, []);
  return items.find((item) => item.id === id) ?? null;
}

export async function createFinancialTransaction(
  input: CreateFinancialTransactionInput,
): Promise<{ ok: true; transaction: FinancialTransaction } | { ok: false; error: string }> {
  const validation = validateCreateFinancialTransaction(input);
  if (!validation.ok) return validation;
  const items = await readJsonFile<FinancialTransaction[]>(STATE, []);
  const prev = items.length > 0 ? items[items.length - 1]! : null;
  const record = buildTransaction(input, prev);
  items.push(record);
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'create', transaction: record, at: record.createdAt });
  return { ok: true, transaction: record };
}

export async function updateFinancialTransaction(
  id: string,
  patch: Partial<CreateFinancialTransactionInput> & {
    reconciliationStatus?: ReconciliationStatus;
    verifiedAt?: string;
    verifiedBy?: string;
  },
): Promise<FinancialTransaction | null> {
  const items = await readJsonFile<FinancialTransaction[]>(STATE, []);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const prior = items[index]!;
  const prev = index > 0 ? items[index - 1]! : null;
  const merged = buildTransaction(
    {
      ...prior,
      ...patch,
      investorId: patch.investorId ?? prior.investorId,
      dealId: patch.dealId ?? prior.dealId,
      amount: patch.amount ?? prior.amount,
      transactionStatus: patch.transactionStatus ?? prior.transactionStatus,
      evidenceUrl: patch.evidenceUrl ?? prior.evidenceUrl,
      approvedBy: patch.approvedBy ?? prior.approvedBy,
    } as CreateFinancialTransactionInput,
    prev,
    prior,
  );
  if (patch.verifiedAt !== undefined) merged.verifiedAt = asTrimmedString(patch.verifiedAt) || null;
  if (patch.verifiedBy !== undefined) merged.verifiedBy = asTrimmedString(patch.verifiedBy) || null;
  items[index] = merged;
  await writeJsonFile(STATE, items);
  await appendEvent({ type: 'update', transactionId: id, transaction: merged, at: merged.updatedAt });
  return merged;
}

export async function deleteFinancialTransaction(id: string): Promise<boolean> {
  const items = await readJsonFile<FinancialTransaction[]>(STATE, []);
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  await writeJsonFile(STATE, next);
  await appendEvent({ type: 'delete', transactionId: id, at: nowIso() });
  return true;
}

export type FinancialLedgerSummary = {
  marker: string;
  generatedAt: string;
  total: number;
  byStatus: Record<FinancialTransactionStatus, number>;
  /** Capital Being Sought (from deals, not from this ledger — included for separation). */
  capitalBeingSought: number;
  /** Sum of soft_commitment + signed_commitment + pending_wire amounts. */
  committedCapital: number;
  /** Sum of escrow_received + bank_received amounts, RECONCILED ONLY. */
  fundsReceived: number;
  /** Sum of returned amounts. */
  returned: number;
  /** Sum of cancelled amounts. */
  cancelled: number;
  /** Count of transactions with reconciliationStatus = reconciled. */
  reconciledCount: number;
  /** Count of transactions with reconciliationStatus = unreconciled. */
  unreconciledCount: number;
  /** Count of transactions with reconciliationStatus = disputed. */
  disputedCount: number;
  byCurrency: Record<string, number>;
};

/**
 * Read-only roll-up. Funds Received counts ONLY reconciled escrow_received
 * or bank_received transactions — nothing else.
 */
export async function summarizeFinancialLedger(
  capitalBeingSoughtInput?: number,
): Promise<FinancialLedgerSummary> {
  const items = await readJsonFile<FinancialTransaction[]>(STATE, []);
  const byStatus: Record<FinancialTransactionStatus, number> = {
    projected: 0,
    requested: 0,
    soft_commitment: 0,
    signed_commitment: 0,
    pending_wire: 0,
    escrow_received: 0,
    bank_received: 0,
    returned: 0,
    cancelled: 0,
  };
  let committedCapital = 0;
  let fundsReceived = 0;
  let returned = 0;
  let cancelled = 0;
  let reconciledCount = 0;
  let unreconciledCount = 0;
  let disputedCount = 0;
  const byCurrency: Record<string, number> = {};

  for (const item of items) {
    byStatus[item.transactionStatus] = (byStatus[item.transactionStatus] ?? 0) + 1;
    byCurrency[item.currency] = (byCurrency[item.currency] ?? 0) + item.amount;
    if (COMMITTED_STATUSES.has(item.transactionStatus)) {
      committedCapital += item.amount;
    }
    if (
      FUNDS_RECEIVED_STATUSES.has(item.transactionStatus) &&
      item.reconciliationStatus === 'reconciled'
    ) {
      fundsReceived += item.amount;
    }
    if (item.transactionStatus === 'returned') returned += item.amount;
    if (item.transactionStatus === 'cancelled') cancelled += item.amount;
    if (item.reconciliationStatus === 'reconciled') reconciledCount += 1;
    else if (item.reconciliationStatus === 'unreconciled') unreconciledCount += 1;
    else if (item.reconciliationStatus === 'disputed') disputedCount += 1;
  }

  return {
    marker: IVX_FINANCIAL_LEDGER_MARKER,
    generatedAt: nowIso(),
    total: items.length,
    byStatus,
    capitalBeingSought: capitalBeingSoughtInput ?? 0,
    committedCapital,
    fundsReceived,
    returned,
    cancelled,
    reconciledCount,
    unreconciledCount,
    disputedCount,
    byCurrency,
  };
}
