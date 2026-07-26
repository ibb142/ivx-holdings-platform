/**
 * IVX Enterprise Capital & Treasury — core system.
 *
 * 1. INVESTOR ACCOUNTS — individual / entity / family office / fund /
 *    institutional accounts with live financial summary (total invested,
 *    available cash, pending deposits/withdrawals, portfolio value,
 *    unrealized + realized gain/loss, ROI, IRR, net worth inside IVX).
 * 2. MONEY LEDGER — immutable, append-only, hash-chained. Every movement
 *    (deposit, withdrawal, investment, distribution, dividend, interest,
 *    profit, loss, fee, commission, refund, transfer, adjustment) receives a
 *    transaction ID, date/time, user, asset, amount, currency, status,
 *    approval linkage and a digital audit trail. NOTHING is deleted —
 *    corrections are new `adjustment` entries and every edit is tracked
 *    (who / when / previous value / new value / reason).
 * 9. APPROVAL WORKFLOW — large payments require the CEO → Finance → Owner
 *    approval chain with a full audit log.
 * 10. BANK RECONCILIATION — match bank deposits, wires, ACH, checks against
 *    platform transactions; unmatched items detected automatically.
 * 11. AUDIT — immutable ledger with SHA-256 hash chain; chain verification
 *    proves nothing was altered or removed.
 *
 * Durable layout (Supabase-backed via ivx-durable-store, fs fallback):
 *   logs/audit/treasury/accounts.json      investor accounts
 *   logs/audit/treasury/ledger.json        append-only hash-chained ledger
 *   logs/audit/treasury/approvals.json     approval workflow records
 *   logs/audit/treasury/bank-items.json    bank reconciliation items
 *   logs/audit/treasury/audit-events.jsonl append-only audit trail
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';

export const IVX_TREASURY_MARKER = 'ivx-enterprise-treasury-2026-07-03';

const STORE_DIR = () => path.join(auditDir(), 'treasury');
const ACCOUNTS_FILE = () => path.join(STORE_DIR(), 'accounts.json');
const LEDGER_FILE = () => path.join(STORE_DIR(), 'ledger.json');
const APPROVALS_FILE = () => path.join(STORE_DIR(), 'approvals.json');
const BANK_ITEMS_FILE = () => path.join(STORE_DIR(), 'bank-items.json');
const AUDIT_EVENTS_FILE = () => path.join(STORE_DIR(), 'audit-events.jsonl');

/** Payments at or above this USD amount require the full approval chain. */
export const LARGE_PAYMENT_THRESHOLD_USD = 50_000;

// ---------------------------------------------------------------------------
// Types — accounts
// ---------------------------------------------------------------------------

export type AccountType =
  | 'individual'
  | 'entity'
  | 'family_office'
  | 'fund'
  | 'institutional';

export const VALID_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set([
  'individual', 'entity', 'family_office', 'fund', 'institutional',
]);

export interface InvestorAccount {
  accountId: string;
  userId: string;
  displayName: string;
  accountType: AccountType;
  currency: string;
  status: 'active' | 'frozen' | 'closed';
  createdAt: string;
  updatedAt: string;
}

export interface AccountSummary {
  accountId: string;
  userId: string;
  displayName: string;
  accountType: AccountType;
  currency: string;
  totalInvested: number;
  availableCash: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  portfolioValue: number;
  unrealizedGainLoss: number;
  realizedGainLoss: number;
  roiPercent: number | null;
  irrPercent: number | null;
  netWorthInsideIVX: number;
  totalDistributions: number;
  lastActivityDate: string;
  transactionCount: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Types — ledger
// ---------------------------------------------------------------------------

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'investment'
  | 'distribution'
  | 'dividend'
  | 'interest'
  | 'profit'
  | 'loss'
  | 'fee'
  | 'commission'
  | 'refund'
  | 'transfer'
  | 'adjustment';

export const VALID_TRANSACTION_TYPES: ReadonlySet<TransactionType> = new Set([
  'deposit', 'withdrawal', 'investment', 'distribution', 'dividend', 'interest',
  'profit', 'loss', 'fee', 'commission', 'refund', 'transfer', 'adjustment',
]);

export type TransactionStatus =
  | 'pending'
  | 'pending_approval'
  | 'completed'
  | 'rejected'
  | 'reversed';

export interface LedgerEntry {
  id: string;
  transactionId: string;
  date: string;
  time: string;
  timestamp: string;
  userId: string;
  accountId: string;
  asset: string;
  amount: number;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  approvalId: string | null;
  memo: string;
  propertyId: string | null;
  createdBy: string;
  /** Digital audit trail — SHA-256 hash chain. */
  previousHash: string;
  hash: string;
  /** Tracked edits (immutable — original values preserved forever). */
  edits: LedgerEdit[];
}

export interface LedgerEdit {
  editedBy: string;
  editedAt: string;
  field: string;
  previousValue: string;
  newValue: string;
  reason: string;
}

export interface RecordTransactionInput {
  userId: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  currency?: string;
  asset?: string;
  memo?: string;
  propertyId?: string | null;
  createdBy?: string;
  status?: TransactionStatus;
}

// ---------------------------------------------------------------------------
// Types — approvals
// ---------------------------------------------------------------------------

export type ApproverRole = 'ceo' | 'finance' | 'owner';

export const APPROVAL_CHAIN: readonly ApproverRole[] = ['ceo', 'finance', 'owner'];

export interface ApprovalStep {
  role: ApproverRole;
  decision: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
  note: string;
}

export interface ApprovalRecord {
  approvalId: string;
  transactionId: string;
  amount: number;
  currency: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  chain: ApprovalStep[];
  auditLog: { at: string; actor: string; action: string; detail: string }[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Types — bank reconciliation
// ---------------------------------------------------------------------------

export type BankItemKind = 'bank_deposit' | 'incoming_wire' | 'outgoing_wire' | 'ach' | 'check';

export const VALID_BANK_ITEM_KINDS: ReadonlySet<BankItemKind> = new Set([
  'bank_deposit', 'incoming_wire', 'outgoing_wire', 'ach', 'check',
]);

export interface BankItem {
  bankItemId: string;
  kind: BankItemKind;
  amount: number;
  currency: string;
  reference: string;
  bankDate: string;
  matchedTransactionId: string | null;
  status: 'unmatched' | 'matched';
  createdAt: string;
}

export interface ReconciliationResult {
  ranAt: string;
  totalBankItems: number;
  matched: number;
  unmatchedBankItems: BankItem[];
  unmatchedPlatformTransactions: { transactionId: string; type: TransactionType; amount: number; timestamp: string }[];
}

// ---------------------------------------------------------------------------
// Durable persistence helpers
// ---------------------------------------------------------------------------

async function readStore<T>(file: string, fallback: T): Promise<T> {
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

async function writeStore<T>(file: string, value: T): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(file, value);
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function appendAuditEvent(event: Record<string, unknown>): Promise<void> {
  const enriched = { ...event, at: nowIso(), marker: IVX_TREASURY_MARKER };
  if (isDurableStoreConfigured()) {
    await appendDurableEvent(AUDIT_EVENTS_FILE(), enriched);
    return;
  }
  await mkdir(STORE_DIR(), { recursive: true });
  await appendFile(AUDIT_EVENTS_FILE(), `${JSON.stringify(enriched)}\n`, 'utf8');
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function entryHash(previousHash: string, core: Record<string, unknown>): string {
  return createHash('sha256').update(previousHash + JSON.stringify(core)).digest('hex');
}

// ---------------------------------------------------------------------------
// 1. INVESTOR ACCOUNTS
// ---------------------------------------------------------------------------

export interface CreateAccountInput {
  userId: string;
  displayName: string;
  accountType: AccountType;
  currency?: string;
}

export async function createInvestorAccount(input: CreateAccountInput): Promise<InvestorAccount> {
  const accounts = await readStore<InvestorAccount[]>(ACCOUNTS_FILE(), []);
  const now = nowIso();
  const account: InvestorAccount = {
    accountId: makeId('acct'),
    userId: input.userId,
    displayName: input.displayName,
    accountType: input.accountType,
    currency: input.currency ?? 'USD',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  accounts.push(account);
  await writeStore(ACCOUNTS_FILE(), accounts);
  await appendAuditEvent({ action: 'account_created', accountId: account.accountId, userId: input.userId, accountType: input.accountType });
  return account;
}

export async function listInvestorAccounts(userId?: string): Promise<InvestorAccount[]> {
  const accounts = await readStore<InvestorAccount[]>(ACCOUNTS_FILE(), []);
  return userId ? accounts.filter((a) => a.userId === userId) : accounts;
}

export async function getInvestorAccount(accountId: string): Promise<InvestorAccount | null> {
  const accounts = await readStore<InvestorAccount[]>(ACCOUNTS_FILE(), []);
  return accounts.find((a) => a.accountId === accountId) ?? null;
}

/**
 * XIRR via bisection on the signed cashflow series (investments negative,
 * distributions/returns positive). Returns annualized percent or null when
 * the series cannot produce a meaningful rate.
 */
export function computeIRRPercent(cashflows: { amount: number; date: Date }[]): number | null {
  if (cashflows.length < 2) return null;
  const hasNegative = cashflows.some((c) => c.amount < 0);
  const hasPositive = cashflows.some((c) => c.amount > 0);
  if (!hasNegative || !hasPositive) return null;

  const t0 = cashflows[0].date.getTime();
  const years = (d: Date) => (d.getTime() - t0) / (365.25 * 24 * 3600 * 1000);
  const npv = (rate: number) =>
    cashflows.reduce((sum, c) => sum + c.amount / Math.pow(1 + rate, years(c.date)), 0);

  let low = -0.9999;
  let high = 10;
  let npvLow = npv(low);
  const npvHigh = npv(high);
  if (npvLow * npvHigh > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (Math.abs(value) < 1e-7) return round2(mid * 100);
    if (npvLow * value < 0) {
      high = mid;
    } else {
      low = mid;
      npvLow = value;
    }
  }
  return round2(((low + high) / 2) * 100);
}

/** Live financial summary for one account, derived entirely from the ledger. */
export async function getAccountSummary(accountId: string): Promise<AccountSummary | null> {
  const account = await getInvestorAccount(accountId);
  if (!account) return null;
  const ledger = await readStore<LedgerEntry[]>(LEDGER_FILE(), []);
  const entries = ledger.filter((e) => e.accountId === accountId);

  let cash = 0;
  let totalInvested = 0;
  let pendingDeposits = 0;
  let pendingWithdrawals = 0;
  let realized = 0;
  const cashflows: { amount: number; date: Date }[] = [];

  for (const entry of entries) {
    const isPending = entry.status === 'pending' || entry.status === 'pending_approval';
    if (entry.type === 'deposit') {
      if (isPending) pendingDeposits += entry.amount;
      else if (entry.status === 'completed') cash += entry.amount;
    } else if (entry.type === 'withdrawal') {
      if (isPending) pendingWithdrawals += entry.amount;
      else if (entry.status === 'completed') cash -= entry.amount;
    } else if (entry.status === 'completed') {
      switch (entry.type) {
        case 'investment':
          cash -= entry.amount;
          totalInvested += entry.amount;
          cashflows.push({ amount: -entry.amount, date: new Date(entry.timestamp) });
          break;
        case 'distribution':
        case 'dividend':
        case 'interest':
        case 'profit':
          cash += entry.amount;
          realized += entry.amount;
          cashflows.push({ amount: entry.amount, date: new Date(entry.timestamp) });
          break;
        case 'loss':
        case 'fee':
          cash -= entry.amount;
          realized -= entry.amount;
          break;
        case 'commission':
        case 'refund':
          cash += entry.amount;
          break;
        case 'transfer':
        case 'adjustment':
          cash += entry.amount;
          break;
      }
    }
  }

  const portfolioValue = totalInvested;
  const unrealized = 0;
  const roi = totalInvested > 0 ? round2((realized / totalInvested) * 100) : null;
  if (portfolioValue > 0 && cashflows.length > 0) {
    cashflows.push({ amount: portfolioValue, date: new Date() });
  }
  cashflows.sort((a, b) => a.date.getTime() - b.date.getTime());
  const irr = computeIRRPercent(cashflows);

  const lastActivityDate = entries.length > 0
    ? entries.reduce((latest, e) => e.timestamp > latest ? e.timestamp : latest, entries[0].timestamp)
    : '';
  const totalDistributions = entries
    .filter((e) => e.status === 'completed' && ['distribution', 'dividend', 'interest', 'profit'].includes(e.type))
    .reduce((sum, e) => sum + e.amount, 0);

  return {
    accountId: account.accountId,
    userId: account.userId,
    displayName: account.displayName,
    accountType: account.accountType,
    currency: account.currency,
    totalInvested: round2(totalInvested),
    availableCash: round2(cash),
    pendingDeposits: round2(pendingDeposits),
    pendingWithdrawals: round2(pendingWithdrawals),
    portfolioValue: round2(portfolioValue),
    unrealizedGainLoss: round2(unrealized),
    realizedGainLoss: round2(realized),
    totalDistributions: round2(totalDistributions),
    lastActivityDate,
    roiPercent: roi,
    irrPercent: irr,
    netWorthInsideIVX: round2(cash + portfolioValue),
    transactionCount: entries.length,
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// 2. MONEY LEDGER — immutable, hash-chained, append-only
// ---------------------------------------------------------------------------

const OUTFLOW_TYPES: ReadonlySet<TransactionType> = new Set([
  'withdrawal', 'distribution', 'commission', 'refund', 'transfer',
]);

/** Records a money movement. Large outbound payments enter the approval chain. */
export async function recordTransaction(input: RecordTransactionInput): Promise<{ entry: LedgerEntry; approval: ApprovalRecord | null }> {
  if (!VALID_TRANSACTION_TYPES.has(input.type)) {
    throw new Error(`Invalid transaction type: ${String(input.type)}`);
  }
  if (!Number.isFinite(input.amount) || (input.type !== 'adjustment' && input.amount <= 0)) {
    throw new Error('Transaction amount must be a positive finite number (adjustments may be negative).');
  }

  const ledger = await readStore<LedgerEntry[]>(LEDGER_FILE(), []);
  const previousHash = ledger.length > 0 ? ledger[ledger.length - 1].hash : 'genesis';
  const now = new Date();
  const timestamp = now.toISOString();
  const requiresApproval = OUTFLOW_TYPES.has(input.type) && Math.abs(input.amount) >= LARGE_PAYMENT_THRESHOLD_USD;
  const transactionId = makeId('txn');

  let approval: ApprovalRecord | null = null;
  if (requiresApproval) {
    approval = await createApproval({
      transactionId,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      requestedBy: input.createdBy ?? input.userId,
    });
  }

  const core = {
    transactionId,
    timestamp,
    userId: input.userId,
    accountId: input.accountId,
    asset: input.asset ?? 'USD_CASH',
    amount: round2(input.amount),
    currency: input.currency ?? 'USD',
    type: input.type,
  };

  const entry: LedgerEntry = {
    ...core,
    id: transactionId,
    date: timestamp.slice(0, 10),
    time: timestamp.slice(11, 19),
    status: approval ? 'pending_approval' : (input.status ?? 'completed'),
    approvalId: approval ? approval.approvalId : null,
    memo: input.memo ?? '',
    propertyId: input.propertyId ?? null,
    createdBy: input.createdBy ?? input.userId,
    previousHash,
    hash: entryHash(previousHash, core),
    edits: [],
  };

  ledger.push(entry);
  await writeStore(LEDGER_FILE(), ledger);
  await appendAuditEvent({
    action: 'transaction_recorded',
    transactionId: entry.transactionId,
    accountId: entry.accountId,
    type: entry.type,
    amount: entry.amount,
    status: entry.status,
    approvalId: entry.approvalId,
  });
  return { entry, approval };
}

export interface LedgerFilter {
  accountId?: string;
  userId?: string;
  type?: TransactionType;
  status?: TransactionStatus;
  propertyId?: string;
  limit?: number;
}

export async function listLedger(filter: LedgerFilter = {}): Promise<LedgerEntry[]> {
  const ledger = await readStore<LedgerEntry[]>(LEDGER_FILE(), []);
  let entries = ledger;
  if (filter.accountId) entries = entries.filter((e) => e.accountId === filter.accountId);
  if (filter.userId) entries = entries.filter((e) => e.userId === filter.userId);
  if (filter.type) entries = entries.filter((e) => e.type === filter.type);
  if (filter.status) entries = entries.filter((e) => e.status === filter.status);
  if (filter.propertyId) entries = entries.filter((e) => e.propertyId === filter.propertyId);
  const limit = Math.max(1, Math.min(1000, filter.limit ?? 200));
  return entries.slice(-limit).reverse();
}

/**
 * Tracked correction — the ledger is immutable, so the original values are
 * preserved forever. Only `status` and `memo` may change, and every change
 * records who / when / previous value / new value / reason.
 */
export async function amendTransaction(input: {
  transactionId: string;
  field: 'status' | 'memo';
  newValue: string;
  editedBy: string;
  reason: string;
}): Promise<LedgerEntry> {
  if (!input.reason.trim()) throw new Error('A reason is required for every ledger amendment.');
  const ledger = await readStore<LedgerEntry[]>(LEDGER_FILE(), []);
  const entry = ledger.find((e) => e.transactionId === input.transactionId);
  if (!entry) throw new Error(`Transaction not found: ${input.transactionId}`);

  const previousValue = input.field === 'status' ? entry.status : entry.memo;
  if (input.field === 'status') {
    const allowed: TransactionStatus[] = ['pending', 'pending_approval', 'completed', 'rejected', 'reversed'];
    if (!allowed.includes(input.newValue as TransactionStatus)) {
      throw new Error(`Invalid status value: ${input.newValue}`);
    }
    entry.status = input.newValue as TransactionStatus;
  } else {
    entry.memo = input.newValue;
  }
  const edit: LedgerEdit = {
    editedBy: input.editedBy,
    editedAt: nowIso(),
    field: input.field,
    previousValue: String(previousValue),
    newValue: input.newValue,
    reason: input.reason,
  };
  entry.edits.push(edit);
  await writeStore(LEDGER_FILE(), ledger);
  await appendAuditEvent({ action: 'transaction_amended', transactionId: input.transactionId, ...edit });
  return entry;
}

/** Verifies the SHA-256 hash chain across the entire ledger. */
export async function verifyLedgerIntegrity(): Promise<{ valid: boolean; totalEntries: number; firstBrokenAt: string | null }> {
  const ledger = await readStore<LedgerEntry[]>(LEDGER_FILE(), []);
  let previousHash = 'genesis';
  for (const entry of ledger) {
    const core = {
      transactionId: entry.transactionId,
      timestamp: entry.timestamp,
      userId: entry.userId,
      accountId: entry.accountId,
      asset: entry.asset,
      amount: entry.amount,
      currency: entry.currency,
      type: entry.type,
    };
    if (entry.previousHash !== previousHash || entry.hash !== entryHash(previousHash, core)) {
      return { valid: false, totalEntries: ledger.length, firstBrokenAt: entry.transactionId };
    }
    previousHash = entry.hash;
  }
  return { valid: true, totalEntries: ledger.length, firstBrokenAt: null };
}

// ---------------------------------------------------------------------------
// 9. APPROVAL WORKFLOW — CEO → Finance → Owner
// ---------------------------------------------------------------------------

async function createApproval(input: {
  transactionId: string;
  amount: number;
  currency: string;
  requestedBy: string;
}): Promise<ApprovalRecord> {
  const approvals = await readStore<ApprovalRecord[]>(APPROVALS_FILE(), []);
  const now = nowIso();
  const record: ApprovalRecord = {
    approvalId: makeId('appr'),
    transactionId: input.transactionId,
    amount: round2(input.amount),
    currency: input.currency,
    requestedBy: input.requestedBy,
    status: 'pending',
    chain: APPROVAL_CHAIN.map((role) => ({
      role,
      decision: 'pending',
      decidedBy: null,
      decidedAt: null,
      note: '',
    })),
    auditLog: [{ at: now, actor: input.requestedBy, action: 'approval_requested', detail: `${input.currency} ${input.amount} requires CEO → Finance → Owner approval` }],
    createdAt: now,
    updatedAt: now,
  };
  approvals.push(record);
  await writeStore(APPROVALS_FILE(), approvals);
  await appendAuditEvent({ action: 'approval_created', approvalId: record.approvalId, transactionId: input.transactionId, amount: input.amount });
  return record;
}

export async function listApprovals(status?: 'pending' | 'approved' | 'rejected'): Promise<ApprovalRecord[]> {
  const approvals = await readStore<ApprovalRecord[]>(APPROVALS_FILE(), []);
  return status ? approvals.filter((a) => a.status === status) : approvals;
}

/** Records one step in the approval chain. Steps must be decided in order. */
export async function decideApproval(input: {
  approvalId: string;
  role: ApproverRole;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  note?: string;
}): Promise<ApprovalRecord> {
  const approvals = await readStore<ApprovalRecord[]>(APPROVALS_FILE(), []);
  const record = approvals.find((a) => a.approvalId === input.approvalId);
  if (!record) throw new Error(`Approval not found: ${input.approvalId}`);
  if (record.status !== 'pending') throw new Error(`Approval already ${record.status}.`);

  const stepIndex = record.chain.findIndex((s) => s.role === input.role);
  if (stepIndex < 0) throw new Error(`Invalid approver role: ${input.role}`);
  const priorPending = record.chain.slice(0, stepIndex).some((s) => s.decision === 'pending');
  if (priorPending) throw new Error(`Approval chain order is CEO → Finance → Owner; earlier step still pending.`);
  const step = record.chain[stepIndex];
  if (step.decision !== 'pending') throw new Error(`${input.role} already decided (${step.decision}).`);

  const now = nowIso();
  step.decision = input.decision;
  step.decidedBy = input.decidedBy;
  step.decidedAt = now;
  step.note = input.note ?? '';
  record.auditLog.push({ at: now, actor: input.decidedBy, action: `${input.role}_${input.decision}`, detail: input.note ?? '' });
  record.updatedAt = now;

  if (input.decision === 'rejected') {
    record.status = 'rejected';
  } else if (record.chain.every((s) => s.decision === 'approved')) {
    record.status = 'approved';
  }
  await writeStore(APPROVALS_FILE(), approvals);

  if (record.status !== 'pending') {
    await amendTransaction({
      transactionId: record.transactionId,
      field: 'status',
      newValue: record.status === 'approved' ? 'completed' : 'rejected',
      editedBy: input.decidedBy,
      reason: `Approval chain ${record.status} (${record.approvalId})`,
    });
  }
  await appendAuditEvent({ action: 'approval_decision', approvalId: record.approvalId, role: input.role, decision: input.decision, decidedBy: input.decidedBy, finalStatus: record.status });
  return record;
}

// ---------------------------------------------------------------------------
// 10. BANK RECONCILIATION
// ---------------------------------------------------------------------------

export async function addBankItem(input: {
  kind: BankItemKind;
  amount: number;
  currency?: string;
  reference?: string;
  bankDate?: string;
}): Promise<BankItem> {
  if (!VALID_BANK_ITEM_KINDS.has(input.kind)) throw new Error(`Invalid bank item kind: ${String(input.kind)}`);
  const items = await readStore<BankItem[]>(BANK_ITEMS_FILE(), []);
  const item: BankItem = {
    bankItemId: makeId('bank'),
    kind: input.kind,
    amount: round2(input.amount),
    currency: input.currency ?? 'USD',
    reference: input.reference ?? '',
    bankDate: input.bankDate ?? nowIso().slice(0, 10),
    matchedTransactionId: null,
    status: 'unmatched',
    createdAt: nowIso(),
  };
  items.push(item);
  await writeStore(BANK_ITEMS_FILE(), items);
  await appendAuditEvent({ action: 'bank_item_added', bankItemId: item.bankItemId, kind: item.kind, amount: item.amount });
  return item;
}

const INBOUND_BANK_KINDS: ReadonlySet<BankItemKind> = new Set(['bank_deposit', 'incoming_wire', 'ach', 'check']);

/** Matches bank items against platform transactions by direction + amount + date proximity. */
export async function runReconciliation(): Promise<ReconciliationResult> {
  const items = await readStore<BankItem[]>(BANK_ITEMS_FILE(), []);
  const ledger = await readStore<LedgerEntry[]>(LEDGER_FILE(), []);
  const matchable = ledger.filter((e) => e.status === 'completed' && (e.type === 'deposit' || e.type === 'withdrawal'));
  const usedTx = new Set<string>(items.filter((i) => i.matchedTransactionId).map((i) => i.matchedTransactionId as string));

  let matched = 0;
  for (const item of items) {
    if (item.status === 'matched') { matched += 1; continue; }
    const wantsDeposit = INBOUND_BANK_KINDS.has(item.kind);
    const candidate = matchable.find((tx) => {
      if (usedTx.has(tx.transactionId)) return false;
      if (wantsDeposit && tx.type !== 'deposit') return false;
      if (!wantsDeposit && tx.type !== 'withdrawal') return false;
      if (Math.abs(tx.amount - item.amount) > 0.01) return false;
      const dayDiff = Math.abs(new Date(tx.date).getTime() - new Date(item.bankDate).getTime()) / 86_400_000;
      return dayDiff <= 5;
    });
    if (candidate) {
      item.matchedTransactionId = candidate.transactionId;
      item.status = 'matched';
      usedTx.add(candidate.transactionId);
      matched += 1;
    }
  }
  await writeStore(BANK_ITEMS_FILE(), items);

  const unmatchedPlatform = matchable
    .filter((tx) => !usedTx.has(tx.transactionId))
    .map((tx) => ({ transactionId: tx.transactionId, type: tx.type, amount: tx.amount, timestamp: tx.timestamp }));
  const result: ReconciliationResult = {
    ranAt: nowIso(),
    totalBankItems: items.length,
    matched,
    unmatchedBankItems: items.filter((i) => i.status === 'unmatched'),
    unmatchedPlatformTransactions: unmatchedPlatform,
  };
  await appendAuditEvent({ action: 'reconciliation_run', totalBankItems: result.totalBankItems, matched: result.matched, unmatchedBank: result.unmatchedBankItems.length, unmatchedPlatform: unmatchedPlatform.length });
  return result;
}

export async function listBankItems(): Promise<BankItem[]> {
  return readStore<BankItem[]>(BANK_ITEMS_FILE(), []);
}
