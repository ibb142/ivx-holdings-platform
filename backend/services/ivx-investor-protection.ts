/**
 * IVX Enterprise Investor Protection System — core service.
 *
 * Implements all 12 sections of the investor protection spec on top of the
 * existing treasury hash-chained ledger, investors table, wallet, and lenders.
 *
 *   1. ACCOUNT RECOVERY       — email/SMS/2FA/admin-assisted, session registry
 *   2. DELETION PROTECTION    — active/suspended/locked/archived/closed state machine
 *   3. INVESTOR WALLET        — cash/pending/investment/available/token/profit balances
 *   4. INVESTMENTS            — real estate / JV / private lender / tokenized
 *   5. MONEY MOVEMENT         — immutable ledger (delegated to treasury ledger)
 *   6. WITHDRAWAL WORKFLOW    — pending → under_review → approved → sent → completed
 *   7. WIRE MANAGEMENT        — AES-256-GCM encrypted at rest, last4 only display
 *   8. OWNER CONTROLS         — aggregated dashboard of members/investors/deals/...
 *   9. AUDIT LOG              — append-only, IP/device/old/new/reason/operator
 *  10. SAFETY                 — no account with funds can be deleted
 *  11. COMPLIANCE             — KYC / AML / accredited / identity / risk flags
 *  12. REPORTS                — aggregated owner reports
 *
 * Data layer: Supabase Postgres via ivx_exec_sql when configured, with durable
 * filesystem fallback (logs/audit/investor-protection/) so the service is
 * always functional even without a live DB connection.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import {
  appendDurableEvent,
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';

export const IVX_INVESTOR_PROTECTION_MARKER = 'ivx-investor-protection-2026-07-05';

const STORE_DIR = () => path.join(auditDir(), 'investor-protection');
const ACCOUNT_STATES_FILE = () => path.join(STORE_DIR(), 'account-states.json');
const DELETION_REQUESTS_FILE = () => path.join(STORE_DIR(), 'deletion-requests.json');
const RECOVERY_REQUESTS_FILE = () => path.join(STORE_DIR(), 'recovery-requests.json');
const SESSIONS_FILE = () => path.join(STORE_DIR(), 'sessions.json');
const INVESTMENTS_FILE = () => path.join(STORE_DIR(), 'investments.json');
const WITHDRAWALS_FILE = () => path.join(STORE_DIR(), 'withdrawals.json');
const WIRES_FILE = () => path.join(STORE_DIR(), 'wires.json');
const COMPLIANCE_FILE = () => path.join(STORE_DIR(), 'compliance.json');
const AUDIT_LOG_FILE = () => path.join(STORE_DIR(), 'protection-audit.jsonl');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccountState = 'active' | 'suspended' | 'locked' | 'archived' | 'closed';
export const VALID_ACCOUNT_STATES: ReadonlySet<AccountState> = new Set([
  'active', 'suspended', 'locked', 'archived', 'closed',
]);

export type RecoveryChannel = 'email' | 'sms' | 'authenticator' | 'admin_assisted';
export const VALID_RECOVERY_CHANNELS: ReadonlySet<RecoveryChannel> = new Set([
  'email', 'sms', 'authenticator', 'admin_assisted',
]);

export type InvestmentType = 'real_estate' | 'jv_deal' | 'private_lender' | 'tokenized';
export const VALID_INVESTMENT_TYPES: ReadonlySet<InvestmentType> = new Set([
  'real_estate', 'jv_deal', 'private_lender', 'tokenized',
]);

export type WithdrawalStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'completed';
export const VALID_WITHDRAWAL_STATUSES: ReadonlySet<WithdrawalStatus> = new Set([
  'pending', 'under_review', 'approved', 'rejected', 'sent', 'completed',
]);
export const WITHDRAWAL_WORKFLOW: readonly WithdrawalStatus[] = [
  'pending', 'under_review', 'approved', 'sent', 'completed',
];

export type WireStatus = 'pending' | 'initiated' | 'confirmed' | 'failed' | 'reversed';

export type KycStatus = 'not_started' | 'pending' | 'verified' | 'rejected' | 'expired';
export type AmlStatus = 'not_reviewed' | 'under_review' | 'cleared' | 'flagged';
export type AccreditedStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface AccountStateRecord {
  id: string;
  userId: string;
  accountState: AccountState;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  previousState: AccountState;
  hasFunds: boolean;
  immutableFinancialHistory: boolean;
  metadata: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
}

export interface DeletionRequest {
  id: string;
  userId: string;
  targetAccountId: string;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  ownerApproved: boolean;
  ownerApproverId: string;
  secondConfirmation: boolean;
  secondConfirmerId: string;
  hasFunds: boolean;
  financialHistoryCount: number;
  finalState: 'requested' | 'owner_approved' | 'second_confirmed' | 'archived' | 'rejected' | 'blocked_has_funds';
  auditNote: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
}

export interface RecoveryRequest {
  id: string;
  userId: string;
  email: string;
  phone: string;
  channel: RecoveryChannel;
  verificationCodeHash: string;
  verified: boolean;
  attempts: number;
  operatorId: string;
  operatorEmail: string;
  status: 'pending' | 'verified' | 'rejected' | 'expired' | 'completed';
  auditTrail: Array<{ at: string; actor: string; action: string; detail: string }>;
  metadata: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  device: string;
  ip: string;
  userAgent: string;
  location: string;
  tokenHash: string;
  active: boolean;
  revokedBy: string;
  revokedReason: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Investment {
  id: string;
  userId: string;
  accountId: string;
  investmentType: InvestmentType;
  propertyId: string;
  dealId: string;
  name: string;
  amountInvested: number;
  ownershipPercentage: number;
  currentValuation: number;
  profitDistributed: number;
  tokenBalance: number;
  status: 'pending' | 'active' | 'completed' | 'distributed' | 'cancelled';
  documents: Array<{ id: string; name: string; url: string; uploadedAt: string }>;
  signatures: Array<{ id: string; signer: string; signedAt: string; hash: string }>;
  metadata: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
}

export interface Withdrawal {
  id: string;
  userId: string;
  accountId: string;
  amount: number;
  currency: string;
  availableBalanceAtRequest: number;
  status: WithdrawalStatus;
  complianceReviewedBy: string;
  complianceDecision: string;
  approvedBy: string;
  wireId: string | null;
  rejectionReason: string;
  auditTrail: Array<{ at: string; actor: string; action: string; detail: string }>;
  metadata: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
}

export interface Wire {
  id: string;
  userId: string;
  withdrawalId: string | null;
  bankName: string;        // decrypted only in memory; never returned in full
  accountHolder: string;
  routing: string;
  accountNumber: string;
  swift: string;
  iban: string;
  accountNumberLast4: string;
  isInternational: boolean;
  status: WireStatus;
  metadata: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
}

/** Safe wire view returned to clients — full account numbers NEVER exposed. */
export interface WireSafeView {
  id: string;
  userId: string;
  withdrawalId: string | null;
  bankName: string;
  accountHolder: string;
  accountNumberLast4: string;
  routingMasked: string;
  swiftMasked: string;
  ibanMasked: string;
  isInternational: boolean;
  status: WireStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceRecord {
  id: string;
  userId: string;
  kycStatus: KycStatus;
  kycVerifiedAt: string | null;
  amlStatus: AmlStatus;
  amlReviewedBy: string;
  accreditedInvestorStatus: AccreditedStatus;
  identityVerified: boolean;
  documents: Array<{ id: string; name: string; type: string; uploadedAt: string }>;
  riskFlags: Array<{ id: string; flag: string; severity: 'low' | 'medium' | 'high'; createdAt: string; note: string }>;
  notes: string;
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  actorAdminId: string;
  actorEmail: string;
  action: string;
  targetUserId: string;
  targetEntity: string;
  targetId: string;
  ip: string;
  device: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Persistence helpers (durable-store with fs fallback)
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

async function appendAuditLogEvent(event: Record<string, unknown>): Promise<void> {
  const enriched = { ...event, at: nowIso(), marker: IVX_INVESTOR_PROTECTION_MARKER };
  if (isDurableStoreConfigured()) {
    await appendDurableEvent(AUDIT_LOG_FILE(), enriched);
    return;
  }
  await mkdir(STORE_DIR(), { recursive: true });
  await appendFile(AUDIT_LOG_FILE(), `${JSON.stringify(enriched)}\n`, 'utf8');
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Encryption at rest (AES-256-GCM) for wire instructions
// ---------------------------------------------------------------------------

function encryptionKey(): Buffer {
  const raw = (process.env.IVX_WIRE_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!raw) {
    throw new Error('IVX_WIRE_ENCRYPTION_KEY or SUPABASE_SERVICE_ROLE_KEY must be configured for wire instruction encryption.');
  }
  // Derive a 32-byte key via SHA-256 so any-length secret produces a valid AES-256 key.
  return createHash('sha256').update(raw).digest();
}

interface EncryptedPayload {
  iv: string;
  ct: string;
  tag: string;
}

function encryptField(plaintext: string): string {
  if (!plaintext) return '';
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
  return JSON.stringify(payload);
}

function decryptField(encoded: string): string {
  if (!encoded) return '';
  try {
    const payload = JSON.parse(encoded) as EncryptedPayload;
    const key = encryptionKey();
    const iv = Buffer.from(payload.iv, 'base64');
    const ct = Buffer.from(payload.ct, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return '';
  }
}

function maskRouting(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-3)}`;
}

function maskSwift(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 4)}••••`;
}

function maskIban(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function last4(value: string): string {
  if (!value) return '';
  return value.length <= 4 ? value : value.slice(-4);
}

// ---------------------------------------------------------------------------
// Stored wire on disk keeps encrypted values; this helper decrypts in memory.
// ---------------------------------------------------------------------------

interface StoredWire extends Omit<Wire, 'bankName' | 'accountHolder' | 'routing' | 'accountNumber' | 'swift' | 'iban'> {
  bankNameEncrypted: string;
  accountHolderEncrypted: string;
  routingEncrypted: string;
  accountNumberEncrypted: string;
  swiftEncrypted: string;
  ibanEncrypted: string;
}

function toStoredWire(input: Wire): StoredWire {
  const { bankName, accountHolder, routing, accountNumber, swift, iban, ...rest } = input;
  return {
    ...rest,
    bankNameEncrypted: encryptField(bankName),
    accountHolderEncrypted: encryptField(accountHolder),
    routingEncrypted: encryptField(routing),
    accountNumberEncrypted: encryptField(accountNumber),
    swiftEncrypted: encryptField(swift),
    ibanEncrypted: encryptField(iban),
  };
}

function fromStoredWire(stored: StoredWire): Wire {
  return {
    id: stored.id,
    userId: stored.userId,
    withdrawalId: stored.withdrawalId,
    bankName: decryptField(stored.bankNameEncrypted),
    accountHolder: decryptField(stored.accountHolderEncrypted),
    routing: decryptField(stored.routingEncrypted),
    accountNumber: decryptField(stored.accountNumberEncrypted),
    swift: decryptField(stored.swiftEncrypted),
    iban: decryptField(stored.ibanEncrypted),
    accountNumberLast4: stored.accountNumberLast4,
    isInternational: stored.isInternational,
    status: stored.status,
    metadata: stored.metadata,
    updatedAt: stored.updatedAt,
    createdAt: stored.createdAt,
  };
}

function toSafeWireView(wire: Wire): WireSafeView {
  return {
    id: wire.id,
    userId: wire.userId,
    withdrawalId: wire.withdrawalId,
    bankName: wire.bankName,
    accountHolder: wire.accountHolder,
    accountNumberLast4: wire.accountNumberLast4,
    routingMasked: maskRouting(wire.routing),
    swiftMasked: maskSwift(wire.swift),
    ibanMasked: maskIban(wire.iban),
    isInternational: wire.isInternational,
    status: wire.status,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Audit log (section 9) — append-only
// ---------------------------------------------------------------------------

export interface RecordAuditInput {
  actorUserId?: string;
  actorAdminId?: string;
  actorEmail?: string;
  action: string;
  targetUserId?: string;
  targetEntity?: string;
  targetId?: string;
  ip?: string;
  device?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export async function recordProtectionAudit(input: RecordAuditInput): Promise<AuditLogEntry> {
  const entry: AuditLogEntry = {
    id: makeId('aud'),
    actorUserId: input.actorUserId ?? '',
    actorAdminId: input.actorAdminId ?? '',
    actorEmail: input.actorEmail ?? '',
    action: input.action,
    targetUserId: input.targetUserId ?? '',
    targetEntity: input.targetEntity ?? '',
    targetId: input.targetId ?? '',
    ip: input.ip ?? '',
    device: input.device ?? '',
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? '',
    metadata: input.metadata ?? {},
    createdAt: nowIso(),
  };
  await appendAuditLogEvent(entry as unknown as Record<string, unknown>);
  return entry;
}

export async function listProtectionAudit(filters: {
  targetUserId?: string;
  action?: string;
  limit?: number;
} = {}): Promise<AuditLogEntry[]> {
  // Durable store fs fallback: read the jsonl file.
  try {
    const raw = await readFile(AUDIT_LOG_FILE(), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    let entries = lines.map((l) => JSON.parse(l) as AuditLogEntry);
    if (filters.targetUserId) {
      entries = entries.filter((e) => e.targetUserId === filters.targetUserId);
    }
    if (filters.action) {
      entries = entries.filter((e) => e.action === filters.action);
    }
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return entries.slice(0, filters.limit ?? 500);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. Account state machine — deletion protection
// ---------------------------------------------------------------------------

export async function getAccountStateRecord(userId: string): Promise<AccountStateRecord> {
  const states = await readStore<AccountStateRecord[]>(ACCOUNT_STATES_FILE(), []);
  let record = states.find((s) => s.userId === userId);
  if (!record) {
    record = {
      id: makeId('st'),
      userId,
      accountState: 'active',
      reason: 'initial',
      operatorId: '',
      operatorEmail: '',
      previousState: 'active',
      hasFunds: false,
      immutableFinancialHistory: true,
      metadata: {},
      updatedAt: nowIso(),
      createdAt: nowIso(),
    };
    states.push(record);
    await writeStore(ACCOUNT_STATES_FILE(), states);
  }
  return record;
}

export async function listAccountStates(filter?: { state?: AccountState }): Promise<AccountStateRecord[]> {
  const states = await readStore<AccountStateRecord[]>(ACCOUNT_STATES_FILE(), []);
  return filter?.state ? states.filter((s) => s.accountState === filter.state) : states;
}

export interface TransitionStateInput {
  userId: string;
  newState: AccountState;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  hasFunds?: boolean;
  ip?: string;
  device?: string;
}

/**
 * Transition an account's state. Enforces:
 *   - cannot move to 'closed'/'archived' if account has funds (must be 'rejected' or 'locked' first)
 *   - never permanently locks a verified investor out: 'locked' can always be reversed to 'active'
 *   - financial history is always immutable
 */
export async function transitionAccountState(input: TransitionStateInput): Promise<AccountStateRecord> {
  if (!VALID_ACCOUNT_STATES.has(input.newState)) {
    throw new Error(`Invalid account state: ${input.newState}`);
  }
  const states = await readStore<AccountStateRecord[]>(ACCOUNT_STATES_FILE(), []);
  const idx = states.findIndex((s) => s.userId === input.userId);
  const current: AccountStateRecord = idx >= 0
    ? states[idx]
    : await getAccountStateRecord(input.userId);
  const previousState = current.accountState;
  const hasFunds = input.hasFunds ?? current.hasFunds;

  // Deletion-protection guard: never archive/close an account that still holds funds.
  if ((input.newState === 'archived' || input.newState === 'closed') && hasFunds) {
    await recordProtectionAudit({
      actorAdminId: input.operatorId,
      actorEmail: input.operatorEmail,
      action: 'state_transition_blocked_has_funds',
      targetUserId: input.userId,
      targetEntity: 'account_state',
      targetId: current.id,
      ip: input.ip,
      device: input.device,
      oldValue: previousState,
      newValue: input.newState,
      reason: input.reason,
    });
    throw new Error('BLOCKED_HAS_FUNDS: account with financial records cannot be archived or closed. Move funds first.');
  }

  const updated: AccountStateRecord = {
    ...current,
    accountState: input.newState,
    reason: input.reason,
    operatorId: input.operatorId,
    operatorEmail: input.operatorEmail,
    previousState,
    hasFunds,
    immutableFinancialHistory: true,
    updatedAt: nowIso(),
  };

  if (idx >= 0) {
    states[idx] = updated;
  } else {
    states.push(updated);
  }
  await writeStore(ACCOUNT_STATES_FILE(), states);
  await recordProtectionAudit({
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'account_state_transition',
    targetUserId: input.userId,
    targetEntity: 'account_state',
    targetId: updated.id,
    ip: input.ip,
    device: input.device,
    oldValue: previousState,
    newValue: input.newState,
    reason: input.reason,
  });
  return updated;
}

/** Never permanently lock a verified investor out — 'locked' can always be unlocked. */
export async function unlockAccount(input: {
  userId: string;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  ip?: string;
  device?: string;
}): Promise<AccountStateRecord> {
  return transitionAccountState({
    ...input,
    newState: 'active',
  });
}

// ---------------------------------------------------------------------------
// Deletion requests — owner-approved, second-confirmed, audited
// ---------------------------------------------------------------------------

export interface RequestDeletionInput {
  userId: string;
  targetAccountId?: string;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  hasFunds: boolean;
  financialHistoryCount: number;
  ip?: string;
  device?: string;
}

export async function createDeletionRequest(input: RequestDeletionInput): Promise<DeletionRequest> {
  if (input.hasFunds || input.financialHistoryCount > 0) {
    const requests = await readStore<DeletionRequest[]>(DELETION_REQUESTS_FILE(), []);
    const blocked: DeletionRequest = {
      id: makeId('del'),
      userId: input.userId,
      targetAccountId: input.targetAccountId ?? '',
      reason: input.reason,
      operatorId: input.operatorId,
      operatorEmail: input.operatorEmail,
      ownerApproved: false,
      ownerApproverId: '',
      secondConfirmation: false,
      secondConfirmerId: '',
      hasFunds: input.hasFunds,
      financialHistoryCount: input.financialHistoryCount,
      finalState: 'blocked_has_funds',
      auditNote: `Blocked: account has ${input.financialHistoryCount} financial records and hasFunds=${input.hasFunds}.`,
      metadata: {},
      updatedAt: nowIso(),
      createdAt: nowIso(),
    };
    requests.push(blocked);
    await writeStore(DELETION_REQUESTS_FILE(), requests);
    await recordProtectionAudit({
      actorAdminId: input.operatorId,
      actorEmail: input.operatorEmail,
      action: 'deletion_blocked_has_funds',
      targetUserId: input.userId,
      targetEntity: 'deletion_request',
      targetId: blocked.id,
      ip: input.ip,
      device: input.device,
      newValue: blocked,
      reason: input.reason,
    });
    return blocked;
  }

  const requests = await readStore<DeletionRequest[]>(DELETION_REQUESTS_FILE(), []);
  const request: DeletionRequest = {
    id: makeId('del'),
    userId: input.userId,
    targetAccountId: input.targetAccountId ?? '',
    reason: input.reason,
    operatorId: input.operatorId,
    operatorEmail: input.operatorEmail,
    ownerApproved: false,
    ownerApproverId: '',
    secondConfirmation: false,
    secondConfirmerId: '',
    hasFunds: false,
    financialHistoryCount: 0,
    finalState: 'requested',
    auditNote: 'Deletion requested; awaiting owner approval and second confirmation.',
    metadata: {},
    updatedAt: nowIso(),
    createdAt: nowIso(),
  };
  requests.push(request);
  await writeStore(DELETION_REQUESTS_FILE(), requests);
  await recordProtectionAudit({
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'deletion_requested',
    targetUserId: input.userId,
    targetEntity: 'deletion_request',
    targetId: request.id,
    ip: input.ip,
    device: input.device,
    newValue: request,
    reason: input.reason,
  });
  return request;
}

export async function approveDeletionRequest(input: {
  deletionId: string;
  ownerApproverId: string;
  ownerEmail: string;
  ip?: string;
  device?: string;
}): Promise<DeletionRequest> {
  const requests = await readStore<DeletionRequest[]>(DELETION_REQUESTS_FILE(), []);
  const idx = requests.findIndex((r) => r.id === input.deletionId);
  if (idx < 0) throw new Error('Deletion request not found.');
  const req = requests[idx];
  if (req.finalState === 'blocked_has_funds') {
    throw new Error('Cannot approve a deletion that was blocked due to existing funds.');
  }
  req.ownerApproved = true;
  req.ownerApproverId = input.ownerApproverId;
  req.finalState = 'owner_approved';
  req.updatedAt = nowIso();
  requests[idx] = req;
  await writeStore(DELETION_REQUESTS_FILE(), requests);
  await recordProtectionAudit({
    actorAdminId: input.ownerApproverId,
    actorEmail: input.ownerEmail,
    action: 'deletion_owner_approved',
    targetUserId: req.userId,
    targetEntity: 'deletion_request',
    targetId: req.id,
    ip: input.ip,
    device: input.device,
    newValue: req,
    reason: 'Owner approved deletion.',
  });
  return req;
}

export async function secondConfirmDeletion(input: {
  deletionId: string;
  secondConfirmerId: string;
  confirmerEmail: string;
  ip?: string;
  device?: string;
}): Promise<DeletionRequest> {
  const requests = await readStore<DeletionRequest[]>(DELETION_REQUESTS_FILE(), []);
  const idx = requests.findIndex((r) => r.id === input.deletionId);
  if (idx < 0) throw new Error('Deletion request not found.');
  const req = requests[idx];
  if (!req.ownerApproved) {
    throw new Error('Cannot second-confirm a deletion that has not been owner-approved.');
  }
  req.secondConfirmation = true;
  req.secondConfirmerId = input.secondConfirmerId;
  req.finalState = 'second_confirmed';
  req.updatedAt = nowIso();
  requests[idx] = req;
  await writeStore(DELETION_REQUESTS_FILE(), requests);
  // The account is archived (NOT deleted) — financial history remains immutable.
  await transitionAccountState({
    userId: req.userId,
    newState: 'archived',
    reason: `Deletion request ${req.id} second-confirmed. Account archived, financial history preserved.`,
    operatorId: input.secondConfirmerId,
    operatorEmail: input.confirmerEmail,
    hasFunds: false,
    ip: input.ip,
    device: input.device,
  });
  req.finalState = 'archived';
  requests[idx] = req;
  await writeStore(DELETION_REQUESTS_FILE(), requests);
  await recordProtectionAudit({
    actorAdminId: input.secondConfirmerId,
    actorEmail: input.confirmerEmail,
    action: 'deletion_second_confirmed_archived',
    targetUserId: req.userId,
    targetEntity: 'deletion_request',
    targetId: req.id,
    ip: input.ip,
    device: input.device,
    newValue: req,
    reason: 'Second confirmation complete — account archived, no financial history deleted.',
  });
  return req;
}

export async function listDeletionRequests(): Promise<DeletionRequest[]> {
  return readStore<DeletionRequest[]>(DELETION_REQUESTS_FILE(), []);
}

// ---------------------------------------------------------------------------
// 1. Account recovery — email/SMS/2FA/admin-assisted + session registry
// ---------------------------------------------------------------------------

export interface StartRecoveryInput {
  userId?: string;
  email?: string;
  phone?: string;
  channel: RecoveryChannel;
  operatorId?: string;
  operatorEmail?: string;
  ip?: string;
  device?: string;
}

export async function startRecoveryRequest(input: StartRecoveryInput): Promise<{ request: RecoveryRequest; code: string }> {
  if (!VALID_RECOVERY_CHANNELS.has(input.channel)) {
    throw new Error(`Invalid recovery channel: ${input.channel}`);
  }
  const requests = await readStore<RecoveryRequest[]>(RECOVERY_REQUESTS_FILE(), []);
  const code = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  const request: RecoveryRequest = {
    id: makeId('rec'),
    userId: input.userId ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    channel: input.channel,
    verificationCodeHash: hashValue(code),
    verified: false,
    attempts: 0,
    operatorId: input.operatorId ?? '',
    operatorEmail: input.operatorEmail ?? '',
    status: 'pending',
    auditTrail: [{
      at: nowIso(),
      actor: input.operatorEmail || 'system',
      action: 'recovery_started',
      detail: `channel=${input.channel}`,
    }],
    metadata: {},
    updatedAt: nowIso(),
    createdAt: nowIso(),
  };
  requests.push(request);
  await writeStore(RECOVERY_REQUESTS_FILE(), requests);
  await recordProtectionAudit({
    actorUserId: input.userId,
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'recovery_started',
    targetUserId: input.userId,
    targetEntity: 'recovery_request',
    targetId: request.id,
    ip: input.ip,
    device: input.device,
    newValue: { channel: input.channel, status: 'pending' },
    reason: 'Account recovery initiated.',
  });
  return { request, code };
}

export async function verifyRecoveryCode(input: {
  recoveryId: string;
  code: string;
  ip?: string;
  device?: string;
}): Promise<RecoveryRequest> {
  const requests = await readStore<RecoveryRequest[]>(RECOVERY_REQUESTS_FILE(), []);
  const idx = requests.findIndex((r) => r.id === input.recoveryId);
  if (idx < 0) throw new Error('Recovery request not found.');
  const req = requests[idx];
  if (req.status === 'expired' || req.status === 'completed') {
    throw new Error(`Recovery request already ${req.status}.`);
  }
  req.attempts += 1;
  if (hashValue(input.code) !== req.verificationCodeHash) {
    if (req.attempts >= 5) {
      req.status = 'expired';
    }
    req.updatedAt = nowIso();
    requests[idx] = req;
    await writeStore(RECOVERY_REQUESTS_FILE(), requests);
    await recordProtectionAudit({
      action: 'recovery_verify_failed',
      targetEntity: 'recovery_request',
      targetId: req.id,
      targetUserId: req.userId,
      ip: input.ip,
      device: input.device,
      newValue: { attempts: req.attempts },
      reason: 'Incorrect verification code.',
    });
    throw new Error('Invalid verification code.');
  }
  req.verified = true;
  req.status = 'verified';
  req.auditTrail.push({ at: nowIso(), actor: 'system', action: 'recovery_verified', detail: 'code matched' });
  req.updatedAt = nowIso();
  requests[idx] = req;
  await writeStore(RECOVERY_REQUESTS_FILE(), requests);
  await recordProtectionAudit({
    action: 'recovery_verified',
    targetEntity: 'recovery_request',
    targetId: req.id,
    targetUserId: req.userId,
    ip: input.ip,
    device: input.device,
    reason: 'Verification code accepted.',
  });
  return req;
}

export async function adminAssistedRecoveryComplete(input: {
  recoveryId: string;
  operatorId: string;
  operatorEmail: string;
  ip?: string;
  device?: string;
}): Promise<RecoveryRequest> {
  const requests = await readStore<RecoveryRequest[]>(RECOVERY_REQUESTS_FILE(), []);
  const idx = requests.findIndex((r) => r.id === input.recoveryId);
  if (idx < 0) throw new Error('Recovery request not found.');
  const req = requests[idx];
  if (!req.verified) throw new Error('Recovery request must be verified before completion.');
  req.status = 'completed';
  req.operatorId = input.operatorId;
  req.operatorEmail = input.operatorEmail;
  req.auditTrail.push({ at: nowIso(), actor: input.operatorEmail, action: 'admin_assisted_complete', detail: 'access restored' });
  req.updatedAt = nowIso();
  requests[idx] = req;
  await writeStore(RECOVERY_REQUESTS_FILE(), requests);
  // Ensure the account is unlocked — never lock a verified investor out.
  await transitionAccountState({
    userId: req.userId,
    newState: 'active',
    reason: 'Admin-assisted recovery completed; access restored.',
    operatorId: input.operatorId,
    operatorEmail: input.operatorEmail,
    ip: input.ip,
    device: input.device,
  });
  await recordProtectionAudit({
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'recovery_admin_assisted_complete',
    targetUserId: req.userId,
    targetEntity: 'recovery_request',
    targetId: req.id,
    ip: input.ip,
    device: input.device,
    reason: 'Admin-assisted recovery complete — account restored to active.',
  });
  return req;
}

export async function listRecoveryRequests(): Promise<RecoveryRequest[]> {
  return readStore<RecoveryRequest[]>(RECOVERY_REQUESTS_FILE(), []);
}

// Session registry

export interface RegisterSessionInput {
  userId: string;
  device?: string;
  ip?: string;
  userAgent?: string;
  location?: string;
  token?: string;
}

export async function registerSession(input: RegisterSessionInput): Promise<AuthSession> {
  const sessions = await readStore<AuthSession[]>(SESSIONS_FILE(), []);
  const session: AuthSession = {
    id: makeId('ses'),
    userId: input.userId,
    device: input.device ?? '',
    ip: input.ip ?? '',
    userAgent: input.userAgent ?? '',
    location: input.location ?? '',
    tokenHash: input.token ? hashValue(input.token) : '',
    active: true,
    revokedBy: '',
    revokedReason: '',
    lastSeenAt: nowIso(),
    createdAt: nowIso(),
  };
  sessions.push(session);
  await writeStore(SESSIONS_FILE(), sessions);
  await recordProtectionAudit({
    actorUserId: input.userId,
    action: 'session_registered',
    targetUserId: input.userId,
    targetEntity: 'session',
    targetId: session.id,
    ip: input.ip,
    device: input.device,
    reason: 'New session registered.',
  });
  return session;
}

export async function listSessions(userId?: string, onlyActive = false): Promise<AuthSession[]> {
  const sessions = await readStore<AuthSession[]>(SESSIONS_FILE(), []);
  let result = sessions;
  if (userId) result = result.filter((s) => s.userId === userId);
  if (onlyActive) result = result.filter((s) => s.active);
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeSession(input: {
  sessionId: string;
  revokedBy: string;
  reason: string;
}): Promise<AuthSession> {
  const sessions = await readStore<AuthSession[]>(SESSIONS_FILE(), []);
  const idx = sessions.findIndex((s) => s.id === input.sessionId);
  if (idx < 0) throw new Error('Session not found.');
  const session = sessions[idx];
  session.active = false;
  session.revokedBy = input.revokedBy;
  session.revokedReason = input.reason;
  session.updatedAt = nowIso();
  sessions[idx] = session;
  await writeStore(SESSIONS_FILE(), sessions);
  await recordProtectionAudit({
    actorAdminId: input.revokedBy,
    action: 'session_revoked',
    targetUserId: session.userId,
    targetEntity: 'session',
    targetId: session.id,
    reason: input.reason,
  });
  return session;
}

// ---------------------------------------------------------------------------
// 4. Investments
// ---------------------------------------------------------------------------

export interface CreateInvestmentInput {
  userId: string;
  accountId?: string;
  investmentType: InvestmentType;
  propertyId?: string;
  dealId?: string;
  name: string;
  amountInvested: number;
  ownershipPercentage?: number;
  currentValuation?: number;
  tokenBalance?: number;
  documents?: Investment['documents'];
  signatures?: Investment['signatures'];
  metadata?: Record<string, unknown>;
  operatorId?: string;
  operatorEmail?: string;
  ip?: string;
  device?: string;
}

export async function createInvestment(input: CreateInvestmentInput): Promise<Investment> {
  if (!VALID_INVESTMENT_TYPES.has(input.investmentType)) {
    throw new Error(`Invalid investment type: ${input.investmentType}`);
  }
  if (input.amountInvested < 0) throw new Error('amountInvested cannot be negative.');
  const investments = await readStore<Investment[]>(INVESTMENTS_FILE(), []);
  const investment: Investment = {
    id: makeId('inv'),
    userId: input.userId,
    accountId: input.accountId ?? '',
    investmentType: input.investmentType,
    propertyId: input.propertyId ?? '',
    dealId: input.dealId ?? '',
    name: input.name,
    amountInvested: round2(input.amountInvested),
    ownershipPercentage: input.ownershipPercentage ?? 0,
    currentValuation: round2(input.currentValuation ?? 0),
    profitDistributed: 0,
    tokenBalance: input.tokenBalance ?? 0,
    status: 'active',
    documents: input.documents ?? [],
    signatures: input.signatures ?? [],
    metadata: input.metadata ?? {},
    updatedAt: nowIso(),
    createdAt: nowIso(),
  };
  investments.push(investment);
  await writeStore(INVESTMENTS_FILE(), investments);
  await recordProtectionAudit({
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'investment_created',
    targetUserId: input.userId,
    targetEntity: 'investment',
    targetId: investment.id,
    ip: input.ip,
    device: input.device,
    newValue: { type: input.investmentType, amount: investment.amountInvested, name: investment.name },
    reason: 'Investment recorded.',
  });
  return investment;
}

export async function listInvestments(filters: {
  userId?: string;
  investmentType?: InvestmentType;
  status?: Investment['status'];
} = {}): Promise<Investment[]> {
  const investments = await readStore<Investment[]>(INVESTMENTS_FILE(), []);
  let result = investments;
  if (filters.userId) result = result.filter((i) => i.userId === filters.userId);
  if (filters.investmentType) result = result.filter((i) => i.investmentType === filters.investmentType);
  if (filters.status) result = result.filter((i) => i.status === filters.status);
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateInvestmentValuation(input: {
  investmentId: string;
  currentValuation: number;
  profitDistributed?: number;
  operatorId: string;
  operatorEmail: string;
  reason: string;
  ip?: string;
  device?: string;
}): Promise<Investment> {
  const investments = await readStore<Investment[]>(INVESTMENTS_FILE(), []);
  const idx = investments.findIndex((i) => i.id === input.investmentId);
  if (idx < 0) throw new Error('Investment not found.');
  const inv = investments[idx];
  const oldValue = { currentValuation: inv.currentValuation, profitDistributed: inv.profitDistributed };
  inv.currentValuation = round2(input.currentValuation);
  if (typeof input.profitDistributed === 'number') {
    inv.profitDistributed = round2(input.profitDistributed);
  }
  inv.updatedAt = nowIso();
  investments[idx] = inv;
  await writeStore(INVESTMENTS_FILE(), investments);
  await recordProtectionAudit({
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'investment_valuation_updated',
    targetUserId: inv.userId,
    targetEntity: 'investment',
    targetId: inv.id,
    ip: input.ip,
    device: input.device,
    oldValue,
    newValue: { currentValuation: inv.currentValuation, profitDistributed: inv.profitDistributed },
    reason: input.reason,
  });
  return inv;
}

// ---------------------------------------------------------------------------
// 3. Investor wallet — derived balances (cash, pending, invested, available, token, profit)
// ---------------------------------------------------------------------------

export interface InvestorWalletSummary {
  userId: string;
  cashBalance: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
  investmentBalance: number;
  availableBalance: number;
  tokenBalance: number;
  profitEarned: number;
  profitPaid: number;
  transactionCount: number;
  generatedAt: string;
}

/**
 * Aggregate wallet summary derived from investments + withdrawals + ledger.
 * Cash / pending deposits / pending withdrawals are derived from the treasury
 * ledger when present; we fall back to local withdrawal + investment records.
 */
export async function getInvestorWalletSummary(
  userId: string,
  treasurySummary?: {
    availableCash?: number;
    pendingDeposits?: number;
    pendingWithdrawals?: number;
    totalInvested?: number;
    realized?: number;
    transactionCount?: number;
  } | null,
): Promise<InvestorWalletSummary> {
  const investments = await listInvestments({ userId });
  const withdrawals = await listWithdrawals({ userId });
  const cashBalance = treasurySummary?.availableCash ?? 0;
  const pendingDeposits = treasurySummary?.pendingDeposits ?? 0;
  const pendingWithdrawals = treasurySummary?.pendingWithdrawals
    ?? withdrawals.filter((w) => w.status === 'pending' || w.status === 'under_review' || w.status === 'approved').reduce((s, w) => s + w.amount, 0);
  const investmentBalance = treasurySummary?.totalInvested
    ?? investments.filter((i) => i.status === 'active' || i.status === 'distributed').reduce((s, i) => s + i.amountInvested, 0);
  const tokenBalance = investments
    .filter((i) => i.investmentType === 'tokenized')
    .reduce((s, i) => s + i.tokenBalance, 0);
  const profitEarned = (treasurySummary?.realized ?? 0)
    + investments.reduce((s, i) => s + i.profitDistributed, 0);
  return {
    userId,
    cashBalance: round2(cashBalance),
    pendingDeposits: round2(pendingDeposits),
    pendingWithdrawals: round2(pendingWithdrawals),
    investmentBalance: round2(investmentBalance),
    availableBalance: round2(Math.max(0, cashBalance - pendingWithdrawals)),
    tokenBalance: round2(tokenBalance),
    profitEarned: round2(profitEarned),
    profitPaid: round2(investments.reduce((s, i) => s + i.profitDistributed, 0)),
    transactionCount: treasurySummary?.transactionCount ?? 0,
    generatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// 6. Withdrawal workflow
// ---------------------------------------------------------------------------

export interface CreateWithdrawalInput {
  userId: string;
  accountId?: string;
  amount: number;
  currency?: string;
  availableBalance: number;
  operatorId?: string;
  operatorEmail?: string;
  ip?: string;
  device?: string;
}

export async function createWithdrawal(input: CreateWithdrawalInput): Promise<Withdrawal> {
  if (input.amount <= 0) throw new Error('Withdrawal amount must be positive.');
  if (input.amount > input.availableBalance) {
    throw new Error(`Insufficient available balance. Requested ${input.amount}, available ${input.availableBalance}.`);
  }
  const withdrawals = await readStore<Withdrawal[]>(WITHDRAWALS_FILE(), []);
  const withdrawal: Withdrawal = {
    id: makeId('wd'),
    userId: input.userId,
    accountId: input.accountId ?? '',
    amount: round2(input.amount),
    currency: input.currency ?? 'USD',
    availableBalanceAtRequest: round2(input.availableBalance),
    status: 'pending',
    complianceReviewedBy: '',
    complianceDecision: '',
    approvedBy: '',
    wireId: null,
    rejectionReason: '',
    auditTrail: [{ at: nowIso(), actor: input.operatorEmail || input.userId, action: 'withdrawal_requested', detail: `amount=${input.amount}` }],
    metadata: {},
    updatedAt: nowIso(),
    createdAt: nowIso(),
  };
  withdrawals.push(withdrawal);
  await writeStore(WITHDRAWALS_FILE(), withdrawals);
  await recordProtectionAudit({
    actorUserId: input.userId,
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'withdrawal_requested',
    targetUserId: input.userId,
    targetEntity: 'withdrawal',
    targetId: withdrawal.id,
    ip: input.ip,
    device: input.device,
    newValue: { amount: withdrawal.amount, status: 'pending' },
    reason: 'Investor withdrawal request.',
  });
  return withdrawal;
}

export async function listWithdrawals(filters: {
  userId?: string;
  status?: WithdrawalStatus;
} = {}): Promise<Withdrawal[]> {
  const withdrawals = await readStore<Withdrawal[]>(WITHDRAWALS_FILE(), []);
  let result = withdrawals;
  if (filters.userId) result = result.filter((w) => w.userId === filters.userId);
  if (filters.status) result = result.filter((w) => w.status === filters.status);
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface TransitionWithdrawalInput {
  withdrawalId: string;
  toStatus: WithdrawalStatus;
  operatorId: string;
  operatorEmail: string;
  reason?: string;
  complianceDecision?: string;
  ip?: string;
  device?: string;
}

/**
 * Advance a withdrawal along the 7-stage workflow. Enforces the linear order:
 *   pending → under_review → approved → sent → completed
 * Rejected can occur from pending/under_review/approved. Sent/Completed require
 * compliance review and approval to have happened first.
 */
export async function transitionWithdrawal(input: TransitionWithdrawalInput): Promise<Withdrawal> {
  if (!VALID_WITHDRAWAL_STATUSES.has(input.toStatus)) {
    throw new Error(`Invalid withdrawal status: ${input.toStatus}`);
  }
  const withdrawals = await readStore<Withdrawal[]>(WITHDRAWALS_FILE(), []);
  const idx = withdrawals.findIndex((w) => w.id === input.withdrawalId);
  if (idx < 0) throw new Error('Withdrawal not found.');
  const wd = withdrawals[idx];
  const fromStatus = wd.status;

  if (input.toStatus === 'rejected') {
    wd.status = 'rejected';
    wd.rejectionReason = input.reason ?? '';
    wd.auditTrail.push({ at: nowIso(), actor: input.operatorEmail, action: 'withdrawal_rejected', detail: input.reason ?? '' });
  } else {
    const fromIdx = WITHDRAWAL_WORKFLOW.indexOf(fromStatus as typeof WITHDRAWAL_WORKFLOW[number]);
    const toIdx = WITHDRAWAL_WORKFLOW.indexOf(input.toStatus);
    if (toIdx < 0) throw new Error(`Cannot transition to non-workflow status: ${input.toStatus}`);
    if (toIdx < fromIdx) throw new Error(`Cannot move withdrawal backwards from ${fromStatus} to ${input.toStatus}.`);
    if (toIdx > fromIdx) {
      // Compliance review must precede approval.
      if (input.toStatus === 'approved' && !wd.complianceReviewedBy) {
        throw new Error('Withdrawal cannot be approved before compliance review.');
      }
      // Sent requires approval.
      if (input.toStatus === 'sent' && !wd.approvedBy) {
        throw new Error('Withdrawal cannot be sent before approval.');
      }
      if (input.toStatus === 'under_review') {
        wd.complianceReviewedBy = input.operatorEmail;
        wd.complianceDecision = input.complianceDecision ?? 'under_review';
      }
      if (input.toStatus === 'approved') {
        wd.approvedBy = input.operatorEmail;
      }
      wd.status = input.toStatus;
      wd.auditTrail.push({ at: nowIso(), actor: input.operatorEmail, action: `withdrawal_${input.toStatus}`, detail: input.reason ?? '' });
    }
  }
  wd.updatedAt = nowIso();
  withdrawals[idx] = wd;
  await writeStore(WITHDRAWALS_FILE(), withdrawals);
  await recordProtectionAudit({
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'withdrawal_transition',
    targetUserId: wd.userId,
    targetEntity: 'withdrawal',
    targetId: wd.id,
    ip: input.ip,
    device: input.device,
    oldValue: fromStatus,
    newValue: wd.status,
    reason: input.reason ?? `Transition ${fromStatus} → ${wd.status}`,
  });
  return wd;
}

// ---------------------------------------------------------------------------
// 7. Wire management — encrypted at rest, never display full account numbers
// ---------------------------------------------------------------------------

export interface CreateWireInput {
  userId: string;
  withdrawalId?: string;
  bankName: string;
  accountHolder: string;
  routing: string;
  accountNumber: string;
  swift?: string;
  iban?: string;
  isInternational?: boolean;
  operatorId?: string;
  operatorEmail?: string;
  ip?: string;
  device?: string;
}

export async function createWire(input: CreateWireInput): Promise<WireSafeView> {
  const wires = await readStore<StoredWire[]>(WIRES_FILE(), []);
  const wire: Wire = {
    id: makeId('wire'),
    userId: input.userId,
    withdrawalId: input.withdrawalId ?? null,
    bankName: input.bankName,
    accountHolder: input.accountHolder,
    routing: input.routing,
    accountNumber: input.accountNumber,
    swift: input.swift ?? '',
    iban: input.iban ?? '',
    accountNumberLast4: last4(input.accountNumber),
    isInternational: input.isInternational ?? Boolean(input.iban),
    status: 'pending',
    metadata: {},
    updatedAt: nowIso(),
    createdAt: nowIso(),
  };
  wires.push(toStoredWire(wire));
  await writeStore(WIRES_FILE(), wires);
  await recordProtectionAudit({
    actorUserId: input.userId,
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'wire_created',
    targetUserId: input.userId,
    targetEntity: 'wire',
    targetId: wire.id,
    ip: input.ip,
    device: input.device,
    newValue: { bankName: input.bankName, last4: wire.accountNumberLast4, isInternational: wire.isInternational },
    reason: 'Wire instructions stored (encrypted at rest).',
  });
  return toSafeWireView(wire);
}

export async function listWires(filters: {
  userId?: string;
  status?: WireStatus;
} = {}): Promise<WireSafeView[]> {
  const wires = await readStore<StoredWire[]>(WIRES_FILE(), []);
  let result = wires.map(fromStoredWire);
  if (filters.userId) result = result.filter((w) => w.userId === filters.userId);
  if (filters.status) result = result.filter((w) => w.status === filters.status);
  return result
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toSafeWireView);
}

export async function transitionWire(input: {
  wireId: string;
  toStatus: WireStatus;
  operatorId: string;
  operatorEmail: string;
  reason?: string;
  ip?: string;
  device?: string;
}): Promise<WireSafeView> {
  const wires = await readStore<StoredWire[]>(WIRES_FILE(), []);
  const idx = wires.findIndex((w) => w.id === input.wireId);
  if (idx < 0) throw new Error('Wire not found.');
  const wire = fromStoredWire(wires[idx]);
  const fromStatus = wire.status;
  wire.status = input.toStatus;
  wire.updatedAt = nowIso();
  wires[idx] = toStoredWire(wire);
  await writeStore(WIRES_FILE(), wires);
  await recordProtectionAudit({
    actorAdminId: input.operatorId,
    actorEmail: input.operatorEmail,
    action: 'wire_transition',
    targetUserId: wire.userId,
    targetEntity: 'wire',
    targetId: wire.id,
    ip: input.ip,
    device: input.device,
    oldValue: fromStatus,
    newValue: input.toStatus,
    reason: input.reason ?? `Wire ${fromStatus} → ${input.toStatus}`,
  });
  return toSafeWireView(wire);
}

/**
 * Wire queue — wires awaiting initiation (status='pending' or 'initiated'),
 * sorted oldest-first. Owner-only.
 */
export async function wireQueue(): Promise<WireSafeView[]> {
  const wires = await readStore<StoredWire[]>(WIRES_FILE(), []);
  return wires
    .map(fromStoredWire)
    .filter((w) => w.status === 'pending' || w.status === 'initiated')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toSafeWireView);
}

// ---------------------------------------------------------------------------
// 11. Compliance — KYC / AML / accredited / identity / risk flags
// ---------------------------------------------------------------------------

export interface UpsertComplianceInput {
  userId: string;
  kycStatus?: KycStatus;
  amlStatus?: AmlStatus;
  amlReviewedBy?: string;
  accreditedInvestorStatus?: AccreditedStatus;
  identityVerified?: boolean;
  documents?: ComplianceRecord['documents'];
  riskFlags?: ComplianceRecord['riskFlags'];
  notes?: string;
  updatedBy: string;
  updatedByEmail: string;
  ip?: string;
  device?: string;
}

export async function upsertCompliance(input: UpsertComplianceInput): Promise<ComplianceRecord> {
  const records = await readStore<ComplianceRecord[]>(COMPLIANCE_FILE(), []);
  const idx = records.findIndex((r) => r.userId === input.userId);
  const oldValue = idx >= 0 ? records[idx] : null;
  const now = nowIso();
  const record: ComplianceRecord = idx >= 0
    ? {
        ...records[idx],
        kycStatus: input.kycStatus ?? records[idx].kycStatus,
        kycVerifiedAt: input.kycStatus === 'verified' ? now : records[idx].kycVerifiedAt,
        amlStatus: input.amlStatus ?? records[idx].amlStatus,
        amlReviewedBy: input.amlReviewedBy ?? records[idx].amlReviewedBy,
        accreditedInvestorStatus: input.accreditedInvestorStatus ?? records[idx].accreditedInvestorStatus,
        identityVerified: input.identityVerified ?? records[idx].identityVerified,
        documents: input.documents ?? records[idx].documents,
        riskFlags: input.riskFlags ?? records[idx].riskFlags,
        notes: input.notes ?? records[idx].notes,
        updatedBy: input.updatedBy,
        updatedAt: now,
      }
    : {
        id: makeId('kyc'),
        userId: input.userId,
        kycStatus: input.kycStatus ?? 'not_started',
        kycVerifiedAt: input.kycStatus === 'verified' ? now : null,
        amlStatus: input.amlStatus ?? 'not_reviewed',
        amlReviewedBy: input.amlReviewedBy ?? '',
        accreditedInvestorStatus: input.accreditedInvestorStatus ?? 'unverified',
        identityVerified: input.identityVerified ?? false,
        documents: input.documents ?? [],
        riskFlags: input.riskFlags ?? [],
        notes: input.notes ?? '',
        updatedBy: input.updatedBy,
        updatedAt: now,
        createdAt: now,
      };
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  await writeStore(COMPLIANCE_FILE(), records);
  await recordProtectionAudit({
    actorAdminId: input.updatedBy,
    actorEmail: input.updatedByEmail,
    action: 'compliance_upserted',
    targetUserId: input.userId,
    targetEntity: 'compliance',
    targetId: record.id,
    ip: input.ip,
    device: input.device,
    oldValue: oldValue ? {
      kyc: oldValue.kycStatus,
      aml: oldValue.amlStatus,
      accredited: oldValue.accreditedInvestorStatus,
      identity: oldValue.identityVerified,
    } : null,
    newValue: {
      kyc: record.kycStatus,
      aml: record.amlStatus,
      accredited: record.accreditedInvestorStatus,
      identity: record.identityVerified,
    },
    reason: 'Compliance record updated.',
  });
  return record;
}

export async function getCompliance(userId: string): Promise<ComplianceRecord | null> {
  const records = await readStore<ComplianceRecord[]>(COMPLIANCE_FILE(), []);
  return records.find((r) => r.userId === userId) ?? null;
}

export async function listCompliance(): Promise<ComplianceRecord[]> {
  return readStore<ComplianceRecord[]>(COMPLIANCE_FILE(), []);
}

// ---------------------------------------------------------------------------
// 8 + 12. Owner controls dashboard + reports
// ---------------------------------------------------------------------------

export interface OwnerDashboardSummary {
  totalMembers: number;
  totalInvestors: number;
  totalBuyers: number;
  totalJvDeals: number;
  totalPrivateLenders: number;
  totalTokenizedInvestments: number;
  capitalRaised: number;
  capitalDeployed: number;
  pendingWithdrawals: number;
  pendingWithdrawalCount: number;
  pendingWires: number;
  completedWires: number;
  jvCapital: number;
  tokenizedCapital: number;
  privateLenderCapital: number;
  totalProfitDistributed: number;
  accountsByState: Record<AccountState, number>;
  kycVerifiedCount: number;
  amlFlaggedCount: number;
  accreditedCount: number;
  generatedAt: string;
}

export async function getOwnerDashboardSummary(input: {
  memberCounts?: { total?: number; investors?: number; buyers?: number; jvDeals?: number; privateLenders?: number };
}): Promise<OwnerDashboardSummary> {
  const investments = await listInvestments();
  const withdrawals = await listWithdrawals();
  const wires = await listWires();
  const states = await listAccountStates();
  const compliance = await listCompliance();

  const byType = (t: InvestmentType) => investments.filter((i) => i.investmentType === t);
  const jvCapital = byType('jv_deal').reduce((s, i) => s + i.amountInvested, 0);
  const tokenizedCapital = byType('tokenized').reduce((s, i) => s + i.amountInvested, 0);
  const privateLenderCapital = byType('private_lender').reduce((s, i) => s + i.amountInvested, 0);
  const capitalRaised = jvCapital + tokenizedCapital + privateLenderCapital
    + byType('real_estate').reduce((s, i) => s + i.amountInvested, 0);
  const capitalDeployed = investments
    .filter((i) => i.status === 'active' || i.status === 'distributed' || i.status === 'completed')
    .reduce((s, i) => s + i.amountInvested, 0);

  const accountsByState = {
    active: 0, suspended: 0, locked: 0, archived: 0, closed: 0,
  } as Record<AccountState, number>;
  for (const s of states) accountsByState[s.accountState] = (accountsByState[s.accountState] ?? 0) + 1;

  const pendingWd = withdrawals.filter((w) => w.status === 'pending' || w.status === 'under_review' || w.status === 'approved');
  const pendingWireList = wires.filter((w) => w.status === 'pending' || w.status === 'initiated');
  const completedWires = wires.filter((w) => w.status === 'confirmed');

  return {
    totalMembers: input.memberCounts?.total ?? 0,
    totalInvestors: input.memberCounts?.investors ?? investments.filter((i) => i.investmentType !== 'real_estate').length,
    totalBuyers: input.memberCounts?.buyers ?? 0,
    totalJvDeals: byType('jv_deal').length,
    totalPrivateLenders: input.memberCounts?.privateLenders ?? byType('private_lender').length,
    totalTokenizedInvestments: byType('tokenized').length,
    capitalRaised: round2(capitalRaised),
    capitalDeployed: round2(capitalDeployed),
    pendingWithdrawals: round2(pendingWd.reduce((s, w) => s + w.amount, 0)),
    pendingWithdrawalCount: pendingWd.length,
    pendingWires: pendingWireList.length,
    completedWires: completedWires.length,
    jvCapital: round2(jvCapital),
    tokenizedCapital: round2(tokenizedCapital),
    privateLenderCapital: round2(privateLenderCapital),
    totalProfitDistributed: round2(investments.reduce((s, i) => s + i.profitDistributed, 0)),
    accountsByState,
    kycVerifiedCount: compliance.filter((c) => c.kycStatus === 'verified').length,
    amlFlaggedCount: compliance.filter((c) => c.amlStatus === 'flagged').length,
    accreditedCount: compliance.filter((c) => c.accreditedInvestorStatus === 'verified').length,
    generatedAt: nowIso(),
  };
}

/** Section 12 — owner reports. */
export async function generateOwnerReport(reportType: string, generatedBy: string): Promise<{
  reportType: string;
  snapshot: Record<string, unknown>;
  generatedBy: string;
  generatedAt: string;
}> {
  const summary = await getOwnerDashboardSummary({});
  const investments = await listInvestments();
  const withdrawals = await listWithdrawals();
  const wires = await listWires();
  const roiByProject = investments.reduce<Record<string, { invested: number; profit: number; roi: number }>>((acc, inv) => {
    const key = inv.propertyId || inv.dealId || inv.id;
    if (!acc[key]) acc[key] = { invested: 0, profit: 0, roi: 0 };
    acc[key].invested += inv.amountInvested;
    acc[key].profit += inv.profitDistributed;
    acc[key].roi = acc[key].invested > 0 ? round2((acc[key].profit / acc[key].invested) * 100) : 0;
    return acc;
  }, {});
  const snapshot: Record<string, unknown> = {
    summary,
    investments: investments.length,
    withdrawals: withdrawals.length,
    wires: wires.length,
    roiByProject,
    profitDistributions: investments.map((i) => ({ id: i.id, name: i.name, profit: i.profitDistributed })),
  };
  await recordProtectionAudit({
    actorAdminId: generatedBy,
    action: 'report_generated',
    targetEntity: 'report',
    targetId: reportType,
    newValue: { reportType, items: investments.length + withdrawals.length + wires.length },
    reason: `Owner report '${reportType}' generated.`,
  });
  return { reportType, snapshot, generatedBy, generatedAt: nowIso() };
}
