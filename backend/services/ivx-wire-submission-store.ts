/**
 * IVX Wire Submission Store — durable persistence for investor wire reports.
 *
 * Fixes the long-standing deferred work in ivx-wire-transfer.ts: wire submissions were
 * only console-logged (lost on every restart/deploy). They now persist in the
 * Supabase-backed durable document store (`ivx_durable_documents`) with a
 * filesystem fallback for local dev, plus an append-only event trail.
 *
 * Lifecycle: submitted → received → credited | rejected (terminal states).
 * Duplicate guard: same referenceCode + amount while not rejected returns the
 * existing record instead of creating a second row (idempotent resubmission).
 *
 * Marker: ivx-wire-submission-store-2026-08-18
 */
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { auditDir } from './ivx-data-root';
import {
  appendDurableEvent,
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';

export const IVX_WIRE_SUBMISSION_STORE_MARKER = 'ivx-wire-submission-store-2026-08-18';

export type WireSubmissionStatus = 'submitted' | 'received' | 'credited' | 'rejected';

export const VALID_WIRE_SUBMISSION_STATUSES: ReadonlySet<WireSubmissionStatus> = new Set([
  'submitted', 'received', 'credited', 'rejected',
]);

const ALLOWED_TRANSITIONS: Record<WireSubmissionStatus, readonly WireSubmissionStatus[]> = {
  submitted: ['received', 'rejected'],
  received: ['credited', 'rejected'],
  credited: [],
  rejected: [],
};

export type WireSubmissionHistoryEntry = {
  at: string;
  from: WireSubmissionStatus | null;
  to: WireSubmissionStatus;
  by?: string;
  reason?: string;
};

export type WireSubmissionRecord = {
  id: string;
  status: WireSubmissionStatus;
  userId?: string;
  email?: string;
  name?: string;
  amount: string;
  currency: string;
  sentAt: string;
  referenceCode: string;
  senderBankName?: string;
  senderAccountLast4?: string;
  receiptUrl?: string;
  notes?: string;
  qa: boolean;
  createdAt: string;
  updatedAt: string;
  history: WireSubmissionHistoryEntry[];
};

export type SaveWireSubmissionInput = {
  userId?: string;
  email?: string;
  name?: string;
  amount: string;
  currency: string;
  sentAt: string;
  referenceCode: string;
  senderBankName?: string;
  senderAccountLast4?: string;
  receiptUrl?: string;
  notes?: string;
  qa?: boolean;
};

const SUBMISSIONS_FILE = () => path.join(auditDir(), 'wire-transfers', 'submissions.json');
const EVENTS_FILE = () => path.join(auditDir(), 'wire-transfers', 'submission-events.jsonl');

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return `wire_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

function isQaSubmission(input: SaveWireSubmissionInput): boolean {
  if (input.qa === true) return true;
  const email = (input.email ?? '').toLowerCase();
  return email.startsWith('ivx.qa.') || email.includes('+qa@');
}

async function readStore(): Promise<WireSubmissionRecord[]> {
  if (isDurableStoreConfigured()) {
    return readDurableJson<WireSubmissionRecord[]>(SUBMISSIONS_FILE(), []);
  }
  try {
    const raw = await readFile(SUBMISSIONS_FILE(), 'utf8');
    return JSON.parse(raw) as WireSubmissionRecord[];
  } catch {
    return [];
  }
}

async function writeStore(records: WireSubmissionRecord[]): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(SUBMISSIONS_FILE(), records);
    return;
  }
  await mkdir(path.dirname(SUBMISSIONS_FILE()), { recursive: true });
  await writeFile(SUBMISSIONS_FILE(), JSON.stringify(records, null, 2), 'utf8');
}

async function appendEvent(event: Record<string, unknown>): Promise<void> {
  const enriched = { ...event, at: nowIso(), marker: IVX_WIRE_SUBMISSION_STORE_MARKER };
  try {
    if (isDurableStoreConfigured()) {
      await appendDurableEvent(EVENTS_FILE(), enriched);
      return;
    }
    await mkdir(path.dirname(EVENTS_FILE()), { recursive: true });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(EVENTS_FILE(), `${JSON.stringify(enriched)}\n`, 'utf8');
  } catch (error) {
    console.error('[IVXWireStore] event append failed', error instanceof Error ? error.message : error);
  }
}

/**
 * Persist a wire submission durably. Idempotent on referenceCode + amount:
 * a resubmission of a live (non-rejected) report returns the existing record.
 */
export async function saveWireSubmission(
  input: SaveWireSubmissionInput,
): Promise<{ record: WireSubmissionRecord; duplicate: boolean; persisted: boolean }> {
  const records = await readStore();
  const refKey = input.referenceCode.trim().toLowerCase();
  const existing = records.find(
    (r) => r.referenceCode.trim().toLowerCase() === refKey
      && r.amount === input.amount
      && r.status !== 'rejected',
  );
  if (existing) {
    return { record: existing, duplicate: true, persisted: isDurableStoreConfigured() };
  }

  const at = nowIso();
  const record: WireSubmissionRecord = {
    id: makeId(),
    status: 'submitted',
    userId: input.userId,
    email: input.email,
    name: input.name,
    amount: input.amount,
    currency: input.currency,
    sentAt: input.sentAt,
    referenceCode: input.referenceCode,
    senderBankName: input.senderBankName,
    senderAccountLast4: input.senderAccountLast4,
    receiptUrl: input.receiptUrl,
    notes: input.notes,
    qa: isQaSubmission(input),
    createdAt: at,
    updatedAt: at,
    history: [{ at, from: null, to: 'submitted', reason: 'Wire report received from investor.' }],
  };
  records.push(record);
  await writeStore(records);
  await appendEvent({
    action: 'wire_submission_created',
    id: record.id,
    referenceCode: record.referenceCode,
    amount: record.amount,
    currency: record.currency,
    qa: record.qa,
  });
  return { record, duplicate: false, persisted: isDurableStoreConfigured() };
}

export async function listWireSubmissions(filters: {
  status?: WireSubmissionStatus;
  qa?: boolean;
  referenceCode?: string;
} = {}): Promise<WireSubmissionRecord[]> {
  let records = await readStore();
  if (filters.status) records = records.filter((r) => r.status === filters.status);
  if (typeof filters.qa === 'boolean') records = records.filter((r) => r.qa === filters.qa);
  if (filters.referenceCode) {
    const key = filters.referenceCode.trim().toLowerCase();
    records = records.filter((r) => r.referenceCode.trim().toLowerCase() === key);
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Owner marks a reported wire as received / credited / rejected. */
export async function transitionWireSubmission(input: {
  id: string;
  toStatus: WireSubmissionStatus;
  reason?: string;
  operatorEmail?: string;
}): Promise<WireSubmissionRecord> {
  if (!VALID_WIRE_SUBMISSION_STATUSES.has(input.toStatus)) {
    throw new Error(`Invalid toStatus: ${input.toStatus}`);
  }
  const records = await readStore();
  const idx = records.findIndex((r) => r.id === input.id);
  if (idx < 0) throw new Error('Wire submission not found.');
  const record = records[idx];
  if (!ALLOWED_TRANSITIONS[record.status].includes(input.toStatus)) {
    throw new Error(`Invalid transition ${record.status} → ${input.toStatus}.`);
  }
  const at = nowIso();
  const entry: WireSubmissionHistoryEntry = {
    at,
    from: record.status,
    to: input.toStatus,
    by: input.operatorEmail,
    reason: input.reason,
  };
  record.status = input.toStatus;
  record.updatedAt = at;
  record.history.push(entry);
  records[idx] = record;
  await writeStore(records);
  await appendEvent({
    action: 'wire_submission_transition',
    id: record.id,
    from: entry.from,
    to: entry.to,
    by: input.operatorEmail,
    reason: input.reason,
  });
  return record;
}

/** Remove QA-flagged submissions (test hygiene). Real investor records are never touched. */
export async function purgeQaWireSubmissions(): Promise<{ removed: number; remaining: number }> {
  const records = await readStore();
  const kept = records.filter((r) => !r.qa);
  const removed = records.length - kept.length;
  if (removed > 0) {
    await writeStore(kept);
    await appendEvent({ action: 'wire_submission_qa_purge', removed, remaining: kept.length });
  }
  return { removed, remaining: kept.length };
}
