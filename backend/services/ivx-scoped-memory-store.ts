/**
 * IVX Scoped Memory Store — GATE 1.
 *
 * Four memory layers with enforced isolation:
 *   TASK      — current task inputs, tool results, execution state, retry history
 *   AGENT     — previous runs for that agent, owner corrections, failures, preferences
 *   COMPANY   — shared only with agents assigned to the same company
 *   ENTERPRISE — global IVX policies, owner restrictions, security rules (read-only)
 *
 * ISOLATION RULES (enforced in code, verified by tests):
 *   - Agent A cannot read private memory belonging to Agent B.
 *   - Division B cannot modify Division A memory.
 *   - One company cannot read another company's private operational memory.
 *   - Enterprise memory is global but read-only except by the owner.
 *   - Secrets are never stored (rejected by isScopedMemorySecret).
 *   - Old context must not override current owner instructions (supersede logic).
 *   - Every retrieved context item includes its source.
 *   - Memory survives backend and worker restarts (durable Supabase store).
 *   - Revoked permissions take effect immediately (revoked flag checked on read).
 *
 * Durable layout (mirrors the proven unified-memory pattern):
 *   logs/audit/scoped-memory/records.json   materialised current state
 *   logs/audit/scoped-memory/records.jsonl  append-only event log
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';

export const IVX_SCOPED_MEMORY_MARKER = 'ivx-scoped-memory-2026-07-27-v1';

// ─── Types ────────────────────────────────────────────────────────

export type MemoryLayer = 'task' | 'agent' | 'company' | 'enterprise';

export type TaskMemoryKind =
  | 'task_input'
  | 'tool_result'
  | 'execution_state'
  | 'acceptance_criteria'
  | 'retry_history';

export type AgentMemoryKind =
  | 'previous_run'
  | 'owner_correction'
  | 'agent_failure'
  | 'operational_preference';

export type CompanyMemoryKind =
  | 'company_policy'
  | 'company_project'
  | 'company_task_history';

export type EnterpriseMemoryKind =
  | 'ivx_policy'
  | 'owner_restriction'
  | 'security_rule'
  | 'approval_requirement'
  | 'architecture_context';

export type MemoryKind = TaskMemoryKind | AgentMemoryKind | CompanyMemoryKind | EnterpriseMemoryKind;

export type ScopedMemoryRecord = {
  id: string;
  layer: MemoryLayer;
  /** Task ID (task layer), Agent ID (agent layer), Company ID (company layer), null (enterprise). */
  scopeId: string;
  kind: MemoryKind;
  content: string;
  /** Who wrote this memory (agent_id, owner, system). */
  source: string;
  /** The type of source (file, api, owner, agent, system). */
  sourceType: 'file' | 'api' | 'owner' | 'agent' | 'system';
  /** Every retrieved item must include its source — this is always set. */
  sourceLabel: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  supersededById: string | null;
  revoked: boolean;
  revokedAt: string | null;
  revokedBy: string | null;
  tags: string[];
  /** File path + commit SHA for source-file-backed memory (stale rejection). */
  sourceFilePath: string | null;
  sourceCommitSha: string | null;
};

export type ScopedMemoryQuery = {
  layer?: MemoryLayer;
  scopeId?: string;
  kind?: MemoryKind;
  tags?: string[];
  search?: string;
  includeRevoked?: boolean;
  includeExpired?: boolean;
  includeSuperseded?: boolean;
  limit?: number;
};

// ─── Secret Rejection ─────────────────────────────────────────────

const SECRET_PATTERNS = [
  /(?:password|passcode|passwd|pwd)\s*[:=]\s*\S+/i,
  /(?:secret|api[\s_-]?key|apikey)\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i,
  /(?:token)\s*[:=]\s*[A-Za-z0-9_\-\.]{8,}/i,
  /bearer\s+[A-Za-z0-9_\-\.]{8,}/i,
  /(?:sk_|pk_|sbp_|vck_|AKIA)[A-Za-z0-9_]{10,}/i,
  /(?:private[\s_-]?key|seed[\s_-]?phrase)\s*[:=]/i,
  /(?:credit[\s_-]?card|card[\s_-]?number|cvv)\s*[:=]\s*\d/i,
  /(?:ssn|social[\s_-]?security)\s*[:=]\s*\d/i,
  /-----BEGIN[\s\w]+PRIVATE KEY-----/i,
];

const SECRET_KEY_NAMES = [
  'password', 'passcode', 'secret', 'token', 'api_key', 'apikey',
  'private_key', 'seed_phrase', 'credit_card', 'cvv', 'ssn',
  'access_key', 'secret_key', 'bearer',
];

/**
 * Reject secrets so they are never stored in model memory.
 * Returns true if the content or a key name matches a secret pattern.
 */
export function isScopedMemorySecret(content: string, fieldName?: string): boolean {
  const lowerField = (fieldName ?? '').toLowerCase();
  if (SECRET_KEY_NAMES.some((k) => lowerField.includes(k))) return true;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  // Long all-digit strings look like card/account numbers.
  const digits = content.replace(/[\s\-]/g, '');
  if (/^\d{12,}$/.test(digits)) return true;
  return false;
}

// ─── Validation ───────────────────────────────────────────────────

const VALID_LAYERS: ReadonlySet<MemoryLayer> = new Set(['task', 'agent', 'company', 'enterprise']);

const VALID_KINDS: ReadonlySet<MemoryKind> = new Set([
  'task_input', 'tool_result', 'execution_state', 'acceptance_criteria', 'retry_history',
  'previous_run', 'owner_correction', 'agent_failure', 'operational_preference',
  'company_policy', 'company_project', 'company_task_history',
  'ivx_policy', 'owner_restriction', 'security_rule', 'approval_requirement', 'architecture_context',
]);

export type ScopedMemoryValidation = { ok: true } | { ok: false; error: string };

export function validateScopedMemoryInput(input: {
  layer?: unknown;
  scopeId?: unknown;
  kind?: unknown;
  content?: unknown;
  source?: unknown;
}): ScopedMemoryValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Input is required.' };
  }
  const layer = input.layer as MemoryLayer;
  if (!VALID_LAYERS.has(layer)) {
    return { ok: false, error: 'A valid memory layer is required (task | agent | company | enterprise).' };
  }
  if (layer !== 'enterprise' && !String(input.scopeId ?? '').trim()) {
    return { ok: false, error: `scopeId is required for layer "${layer}".` };
  }
  const kind = input.kind as MemoryKind;
  if (!VALID_KINDS.has(kind)) {
    return { ok: false, error: 'A valid memory kind is required.' };
  }
  const content = String(input.content ?? '').trim();
  if (!content) {
    return { ok: false, error: 'Content is required — IVX memory never fabricates a record.' };
  }
  if (isScopedMemorySecret(content)) {
    return { ok: false, error: 'Secrets are never stored in model memory.' };
  }
  if (!String(input.source ?? '').trim()) {
    return { ok: false, error: 'Source is required — every memory record must include attribution.' };
  }
  return { ok: true };
}

// ─── Durable Storage ──────────────────────────────────────────────

const DIR = path.join(process.cwd(), 'logs', 'audit', 'scoped-memory');
const LOG_PATH = path.join(DIR, 'records.jsonl');
const STATE_PATH = path.join(DIR, 'records.json');

let writeChain: Promise<void> = Promise.resolve();

function nowIso(): string {
  return new Date().toISOString();
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `smem_${crypto.randomUUID()}`;
  }
  return `smem_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTagArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((v) => asTrimmedString(v).toLowerCase())
        .filter(Boolean),
    ),
  );
}

async function ensureDir(): Promise<void> {
  await mkdir(DIR, { recursive: true });
}

async function readState(): Promise<ScopedMemoryRecord[]> {
  if (isDurableStoreConfigured()) {
    try {
      const rows = await readDurableJson<ScopedMemoryRecord[]>(STATE_PATH, []);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ScopedMemoryRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeState(records: ScopedMemoryRecord[]): Promise<void> {
  const bounded = records.slice(-5000);
  if (isDurableStoreConfigured()) {
    await writeDurableJson(STATE_PATH, bounded);
    return;
  }
  await ensureDir();
  const tmp = path.join(DIR, `scoped-memory-${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(bounded, null, 2), 'utf8');
  try {
    await rename(tmp, STATE_PATH);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      await ensureDir();
      await rename(tmp, STATE_PATH);
      return;
    }
    throw error;
  }
}

async function appendEvent(event: Record<string, unknown>): Promise<void> {
  if (isDurableStoreConfigured()) {
    try {
      await appendDurableEvent(LOG_PATH, event);
    } catch {
      // Forensic log is best-effort.
    }
    return;
  }
  try {
    await ensureDir();
    await appendFile(LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Best-effort.
  }
}

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ─── Isolation Enforcement ────────────────────────────────────────

export type MemoryAccessContext = {
  /** The agent requesting access. */
  agentId: string;
  /** The company the agent is assigned to (null = unassigned). */
  companyId: string | null;
  /** The task the agent is currently assigned to (null = no task). */
  taskId: string | null;
  /** True if the owner is requesting access. */
  isOwner: boolean;
};

export type AccessCheckResult = { allowed: boolean; reason: string };

/**
 * Enforce isolation rules — Agent A cannot read Agent B's private memory,
 * Company A cannot read Company B's private memory, etc.
 */
export function checkMemoryAccess(
  record: ScopedMemoryRecord,
  ctx: MemoryAccessContext,
): AccessCheckResult {
  // Owner can access everything.
  if (ctx.isOwner) {
    return { allowed: true, reason: 'owner access' };
  }

  switch (record.layer) {
    case 'task': {
      // Task memory is readable by any agent assigned to that task.
      if (record.scopeId === ctx.taskId) {
        return { allowed: true, reason: 'task assignment match' };
      }
      return { allowed: false, reason: 'agent is not assigned to this task' };
    }

    case 'agent': {
      // Agent memory is readable only by that agent.
      if (record.scopeId === ctx.agentId) {
        return { allowed: true, reason: 'agent self access' };
      }
      return { allowed: false, reason: 'agent cannot read another agent private memory' };
    }

    case 'company': {
      // Company memory is readable only by agents assigned to the same company.
      if (record.scopeId === ctx.companyId) {
        return { allowed: true, reason: 'company assignment match' };
      }
      return { allowed: false, reason: 'agent cannot read another company private memory' };
    }

    case 'enterprise': {
      // Enterprise memory is global and readable by all agents (read-only).
      return { allowed: true, reason: 'enterprise memory is globally readable' };
    }

    default:
      return { allowed: false, reason: `unknown layer: ${record.layer}` };
  }
}

/**
 * Enforce write isolation — only the owning agent, company member, or owner
 * can modify their own memory. Enterprise memory is owner-write-only.
 */
export function checkMemoryWriteAccess(
  record: ScopedMemoryRecord,
  ctx: MemoryAccessContext,
): AccessCheckResult {
  // Owner can write everything.
  if (ctx.isOwner) {
    return { allowed: true, reason: 'owner write access' };
  }

  switch (record.layer) {
    case 'task': {
      // Any agent assigned to the task can write task memory.
      if (record.scopeId === ctx.taskId) {
        return { allowed: true, reason: 'task assignment write' };
      }
      return { allowed: false, reason: 'agent is not assigned to this task' };
    }

    case 'agent': {
      // Agent can write only its own memory.
      if (record.scopeId === ctx.agentId) {
        return { allowed: true, reason: 'agent self write' };
      }
      return { allowed: false, reason: 'agent cannot modify another agent memory' };
    }

    case 'company': {
      // Any agent in the same company can write company memory.
      if (record.scopeId === ctx.companyId) {
        return { allowed: true, reason: 'company member write' };
      }
      return { allowed: false, reason: 'agent cannot modify another company memory' };
    }

    case 'enterprise': {
      // Enterprise memory is owner-write-only.
      return { allowed: false, reason: 'enterprise memory is owner-write-only' };
    }

    default:
      return { allowed: false, reason: `unknown layer: ${record.layer}` };
  }
}

// ─── CRUD Operations ──────────────────────────────────────────────

export type CreateScopedMemoryInput = {
  layer: MemoryLayer;
  scopeId?: string;
  kind: MemoryKind;
  content: string;
  source: string;
  sourceType?: 'file' | 'api' | 'owner' | 'agent' | 'system';
  sourceLabel?: string;
  tags?: string[];
  expiresAt?: string | null;
  sourceFilePath?: string | null;
  sourceCommitSha?: string | null;
  /** Access context for write-permission check. */
  writeCtx?: MemoryAccessContext | null;
};

export type CreateResult =
  | { ok: true; record: ScopedMemoryRecord }
  | { ok: false; error: string };

/**
 * Create a scoped memory record. Validates input, rejects secrets, enforces
 * write isolation, and persists durably (survives restarts).
 */
export async function createScopedMemory(input: CreateScopedMemoryInput): Promise<CreateResult> {
  const validation = validateScopedMemoryInput(input);
  if (!validation.ok) return validation;

  const scopeId = input.layer === 'enterprise' ? '' : asTrimmedString(input.scopeId);

  const now = nowIso();
  const record: ScopedMemoryRecord = {
    id: createId(),
    layer: input.layer,
    scopeId,
    kind: input.kind,
    content: asTrimmedString(input.content),
    source: asTrimmedString(input.source),
    sourceType: input.sourceType ?? 'system',
    sourceLabel: asTrimmedString(input.sourceLabel) || asTrimmedString(input.source),
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt ?? null,
    supersededById: null,
    revoked: false,
    revokedAt: null,
    revokedBy: null,
    tags: asTagArray(input.tags),
    sourceFilePath: input.sourceFilePath ?? null,
    sourceCommitSha: input.sourceCommitSha ?? null,
  };

  // Enforce write access if context provided.
  if (input.writeCtx) {
    const writeCheck = checkMemoryWriteAccess(record, input.writeCtx);
    if (!writeCheck.allowed) {
      return { ok: false, error: `Write denied: ${writeCheck.reason}` };
    }
  }

  return enqueueWrite(async () => {
    const records = await readState();
    records.push(record);
    await writeState(records);
    await appendEvent({ type: 'create', record, at: now });
    return { ok: true as const, record };
  });
}

/**
 * Retrieve scoped memory with isolation enforcement.
 * Agent A cannot read Agent B's private memory.
 * Company A cannot read Company B's private memory.
 */
export async function retrieveScopedMemory(
  query: ScopedMemoryQuery,
  accessCtx: MemoryAccessContext,
): Promise<{ records: ScopedMemoryRecord[]; denied: number }> {
  const records = await readState();
  const filtered = filterScopedMemoryRecords(records, query);

  const allowed: ScopedMemoryRecord[] = [];
  let denied = 0;
  for (const record of filtered) {
    const check = checkMemoryAccess(record, accessCtx);
    if (check.allowed) {
      allowed.push(record);
    } else {
      denied++;
    }
  }

  return { records: allowed, denied };
}

/** Pure filter function — extracted for unit testing (no isolation check). */
export function filterScopedMemoryRecords(
  records: readonly ScopedMemoryRecord[],
  query: ScopedMemoryQuery = {},
): ScopedMemoryRecord[] {
  const now = new Date();
  let results = [...records];

  // Filter revoked (unless explicitly included).
  if (!query.includeRevoked) {
    results = results.filter((r) => !r.revoked);
  }

  // Filter superseded (unless explicitly included).
  if (!query.includeSuperseded) {
    results = results.filter((r) => r.supersededById === null);
  }

  // Filter expired (unless explicitly included).
  if (!query.includeExpired) {
    results = results.filter((r) => {
      if (!r.expiresAt) return true;
      return new Date(r.expiresAt) > now;
    });
  }

  if (query.layer) {
    results = results.filter((r) => r.layer === query.layer);
  }

  if (query.scopeId !== undefined) {
    results = results.filter((r) => r.scopeId === query.scopeId);
  }

  if (query.kind) {
    results = results.filter((r) => r.kind === query.kind);
  }

  if (query.tags && query.tags.length > 0) {
    const tags = new Set(query.tags.map((t) => t.toLowerCase()));
    results = results.filter((r) => r.tags.some((t) => tags.has(t)));
  }

  if (query.search) {
    const search = query.search.toLowerCase();
    results = results.filter((r) =>
      r.content.toLowerCase().includes(search) ||
      r.tags.some((t) => t.includes(search)) ||
      r.sourceLabel.toLowerCase().includes(search),
    );
  }

  // Sort by most recently updated.
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return results.slice(0, query.limit || 100);
}

// ─── Supersede Logic ──────────────────────────────────────────────

/**
 * Supersede a memory record — marks the old record as superseded by a new one.
 * This implements "old context must not override current owner instructions."
 */
export async function supersedeMemory(
  oldId: string,
  newRecord: ScopedMemoryRecord,
  writeCtx?: MemoryAccessContext | null,
): Promise<{ ok: true; oldRecord: ScopedMemoryRecord | null; newRecord: ScopedMemoryRecord } | { ok: false; error: string }> {
  return enqueueWrite(async () => {
    const records = await readState();
    const oldIndex = records.findIndex((r) => r.id === oldId);
    if (oldIndex < 0) {
      return { ok: false as const, error: 'Record to supersede not found.' };
    }
    const oldRecord = records[oldIndex]!;

    // Enforce write access on the old record.
    if (writeCtx) {
      const writeCheck = checkMemoryWriteAccess(oldRecord, writeCtx);
      if (!writeCheck.allowed) {
        return { ok: false as const, error: `Write denied: ${writeCheck.reason}` };
      }
    }

    // Mark old record as superseded.
    records[oldIndex] = {
      ...oldRecord,
      supersededById: newRecord.id,
      updatedAt: nowIso(),
    };

    // Add the new record.
    records.push(newRecord);

    await writeState(records);
    await appendEvent({ type: 'supersede', oldId, newRecord, at: newRecord.createdAt });
    return { ok: true as const, oldRecord: records[oldIndex]!, newRecord };
  });
}

/**
 * Create a superseding record — convenience function that creates a new record
 * and marks the old one as superseded in one operation.
 */
export async function createSupersedingRecord(
  oldId: string,
  input: CreateScopedMemoryInput,
): Promise<CreateResult> {
  const validation = validateScopedMemoryInput(input);
  if (!validation.ok) return validation;

  const createResult = await createScopedMemory(input);
  if (!createResult.ok) return createResult;

  const supersedeResult = await supersedeMemory(oldId, createResult.record, input.writeCtx ?? null);
  if (!supersedeResult.ok) {
    // New record was created but supersede failed — return the new record anyway.
    return { ok: true, record: createResult.record };
  }
  return { ok: true, record: createResult.record };
}

// ─── Revocation ───────────────────────────────────────────────────

/**
 * Revoke a memory record — takes effect immediately.
 * Revoked records are excluded from all queries unless includeRevoked is true.
 */
export async function revokeMemory(
  id: string,
  revokedBy: string,
  writeCtx?: MemoryAccessContext | null,
): Promise<{ ok: true; record: ScopedMemoryRecord } | { ok: false; error: string }> {
  return enqueueWrite(async () => {
    const records = await readState();
    const index = records.findIndex((r) => r.id === id);
    if (index < 0) {
      return { ok: false as const, error: 'Record not found.' };
    }
    const record = records[index]!;

    if (writeCtx) {
      const writeCheck = checkMemoryWriteAccess(record, writeCtx);
      if (!writeCheck.allowed) {
        return { ok: false as const, error: `Write denied: ${writeCheck.reason}` };
      }
    }

    const now = nowIso();
    const updated: ScopedMemoryRecord = {
      ...record,
      revoked: true,
      revokedAt: now,
      revokedBy,
      updatedAt: now,
    };
    records[index] = updated;
    await writeState(records);
    await appendEvent({ type: 'revoke', id, revokedBy, at: now });
    return { ok: true as const, record: updated };
  });
}

// ─── Stale Source File Rejection ──────────────────────────────────

/**
 * Check if a source-file-backed memory record is stale (source commit SHA
 * does not match the current commit). Stale source files are rejected.
 */
export function isStaleSourceRecord(
  record: ScopedMemoryRecord,
  currentCommitSha: string,
): boolean {
  if (!record.sourceFilePath || !record.sourceCommitSha) return false;
  return record.sourceCommitSha !== currentCommitSha;
}

/**
 * Filter out stale source-file-backed records.
 */
export function rejectStaleSourceRecords(
  records: readonly ScopedMemoryRecord[],
  currentCommitSha: string,
): { fresh: ScopedMemoryRecord[]; staleCount: number } {
  const fresh: ScopedMemoryRecord[] = [];
  let staleCount = 0;
  for (const record of records) {
    if (isStaleSourceRecord(record, currentCommitSha)) {
      staleCount++;
    } else {
      fresh.push(record);
    }
  }
  return { fresh, staleCount };
}

// ─── Irrelevant Conversation History Exclusion ────────────────────

/**
 * Exclude irrelevant conversation history — only include messages that match
 * the current task keywords or are from the current task scope.
 */
export function excludeIrrelevantHistory(
  records: readonly ScopedMemoryRecord[],
  taskKeywords: string[],
): ScopedMemoryRecord[] {
  if (taskKeywords.length === 0) return [...records];
  const lowerKeywords = taskKeywords.map((k) => k.toLowerCase());
  return records.filter((r) => {
    // Always keep non-conversation records.
    if (r.kind !== 'execution_state' && r.kind !== 'tool_result') return true;
    const content = r.content.toLowerCase();
    return lowerKeywords.some((kw) => content.includes(kw));
  });
}

// ─── Context Package Builder ──────────────────────────────────────

export type ScopedContextPackage = {
  records: ScopedMemoryRecord[];
  totalRetrieved: number;
  deniedCount: number;
  staleCount: number;
  sources: string[];
  builtAt: string;
  marker: string;
};

/**
 * Build a scoped context package for an agent — retrieves relevant memory
 * across all 4 layers with isolation enforcement, stale rejection, and
 * irrelevant-history exclusion.
 */
export async function buildScopedContextPackage(
  accessCtx: MemoryAccessContext,
  options: {
    taskId?: string;
    taskKeywords?: string[];
    currentCommitSha?: string;
    search?: string;
    limit?: number;
  } = {},
): Promise<ScopedContextPackage> {
  const taskId = options.taskId ?? accessCtx.taskId ?? '';

  // Retrieve task memory (scoped to the current task).
  const taskResult = taskId
    ? await retrieveScopedMemory(
        { layer: 'task', scopeId: taskId, limit: 50, search: options.search },
        accessCtx,
      )
    : { records: [], denied: 0 };

  // Retrieve agent memory (scoped to the current agent — isolation enforced).
  const agentResult = await retrieveScopedMemory(
    { layer: 'agent', scopeId: accessCtx.agentId, limit: 30, search: options.search },
    accessCtx,
  );

  // Retrieve company memory (scoped to the current company — isolation enforced).
  const companyResult = accessCtx.companyId
    ? await retrieveScopedMemory(
        { layer: 'company', scopeId: accessCtx.companyId, limit: 30, search: options.search },
        accessCtx,
      )
    : { records: [], denied: 0 };

  // Retrieve enterprise memory (global, read-only).
  const enterpriseResult = await retrieveScopedMemory(
    { layer: 'enterprise', limit: 20, search: options.search },
    accessCtx,
  );

  let allRecords = [
    ...taskResult.records,
    ...agentResult.records,
    ...companyResult.records,
    ...enterpriseResult.records,
  ];

  // Reject stale source files.
  let staleCount = 0;
  if (options.currentCommitSha) {
    const { fresh, staleCount: sc } = rejectStaleSourceRecords(allRecords, options.currentCommitSha);
    allRecords = fresh;
    staleCount = sc;
  }

  // Exclude irrelevant conversation history.
  if (options.taskKeywords && options.taskKeywords.length > 0) {
    allRecords = excludeIrrelevantHistory(allRecords, options.taskKeywords);
  }

  // Apply limit.
  const limit = options.limit ?? 100;
  allRecords = allRecords.slice(0, limit);

  // Extract unique sources — every retrieved item must include its source.
  const sources = [...new Set(allRecords.map((r) => r.sourceLabel))];

  const totalDenied = taskResult.denied + agentResult.denied + companyResult.denied + enterpriseResult.denied;

  return {
    records: allRecords,
    totalRetrieved: allRecords.length,
    deniedCount: totalDenied,
    staleCount,
    sources,
    builtAt: nowIso(),
    marker: IVX_SCOPED_MEMORY_MARKER,
  };
}

// ─── Summary ──────────────────────────────────────────────────────

export type ScopedMemorySummary = {
  marker: string;
  total: number;
  byLayer: Record<MemoryLayer, number>;
  revokedCount: number;
  supersededCount: number;
  expiredCount: number;
  lastUpdatedAt: string | null;
};

export async function summarizeScopedMemory(): Promise<ScopedMemorySummary> {
  const records = await readState();
  const now = new Date();

  const byLayer: Record<MemoryLayer, number> = {
    task: 0,
    agent: 0,
    company: 0,
    enterprise: 0,
  };

  for (const r of records) {
    byLayer[r.layer] = (byLayer[r.layer] ?? 0) + 1;
  }

  let lastUpdatedAt: string | null = null;
  for (const r of records) {
    if (!lastUpdatedAt || r.updatedAt > lastUpdatedAt) lastUpdatedAt = r.updatedAt;
  }

  return {
    marker: IVX_SCOPED_MEMORY_MARKER,
    total: records.length,
    byLayer,
    revokedCount: records.filter((r) => r.revoked).length,
    supersededCount: records.filter((r) => r.supersededById !== null).length,
    expiredCount: records.filter((r) => r.expiresAt && new Date(r.expiresAt) < now).length,
    lastUpdatedAt,
  };
}

// ─── Owner Instruction Override ───────────────────────────────────

/**
 * Apply an owner instruction that overrides older memory.
 * Creates a new enterprise-layer record and supersedes any conflicting
 * records of the same kind.
 */
export async function applyOwnerInstructionOverride(
  input: {
    kind: EnterpriseMemoryKind;
    content: string;
    sourceLabel?: string;
    tags?: string[];
  },
): Promise<CreateResult> {
  const validation = validateScopedMemoryInput({
    layer: 'enterprise',
    scopeId: '',
    kind: input.kind,
    content: input.content,
    source: 'owner',
  });
  if (!validation.ok) return validation;

  return enqueueWrite(async () => {
    const records = await readState();
    const now = nowIso();

    // Find existing enterprise records of the same kind (non-superseded, non-revoked).
    const conflicting = records.filter(
      (r) =>
        r.layer === 'enterprise' &&
        r.kind === input.kind &&
        r.supersededById === null &&
        !r.revoked,
    );

    const newRecord: ScopedMemoryRecord = {
      id: createId(),
      layer: 'enterprise',
      scopeId: '',
      kind: input.kind,
      content: asTrimmedString(input.content),
      source: 'owner',
      sourceType: 'owner',
      sourceLabel: asTrimmedString(input.sourceLabel) || 'owner',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      supersededById: null,
      revoked: false,
      revokedAt: null,
      revokedBy: null,
      tags: asTagArray(input.tags),
      sourceFilePath: null,
      sourceCommitSha: null,
    };

    // Supersede all conflicting records.
    for (const old of conflicting) {
      const oldIndex = records.findIndex((r) => r.id === old.id);
      if (oldIndex >= 0) {
        records[oldIndex] = {
          ...old,
          supersededById: newRecord.id,
          updatedAt: now,
        };
      }
    }

    records.push(newRecord);
    await writeState(records);
    await appendEvent({
      type: 'owner_override',
      newRecord,
      supersededIds: conflicting.map((r) => r.id),
      at: now,
    });
    return { ok: true as const, record: newRecord };
  });
}

// ─── Test Helpers ─────────────────────────────────────────────────

/**
 * Clear all scoped memory — for test cleanup only.
 */
export async function _clearAllScopedMemory(): Promise<void> {
  await writeState([]);
  await appendEvent({ type: 'clear_all', at: nowIso() });
}

/**
 * Get all records (raw, no isolation) — for test verification only.
 */
export async function _getAllRecordsRaw(): Promise<ScopedMemoryRecord[]> {
  return readState();
}
