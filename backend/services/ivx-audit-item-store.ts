/**
 * IVX structured audit item store — durable, per-item engineering state.
 *
 * The chunk-based audit engine (`ivx-audit-job-store.ts`) persists generated
 * *text*. This store persists *structured* per-item records so the autonomous
 * agent can track real engineering work item-by-item:
 *
 *   { number, systemArea, status, issue, severity, rootCause, fix, file,
 *     verification }
 *
 * Status lifecycle:
 *   pending → in_progress → fixed → verified
 *                       ↘ blocked / failed
 *   unverified = fixed but not yet confirmed by a check.
 *
 * Durable document/event keys (server-only store in production; local fallback in development):
 *   logs/audit/audit-items/<auditId>/items.jsonl   append-only event log
 *   logs/audit/audit-items/<auditId>/state.json    materialised current state
 *
 * Events are append-only. The current state and discovery index are persisted
 * through the existing durable adapter when configured, and on disk otherwise.
 */
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appendDurableEvent, isDurableStoreConfigured, readDurableJson, writeDurableJson } from './ivx-durable-store';

export type AuditItemStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'failed'
  | 'fixed'
  | 'unverified'
  | 'verified';

export type AuditItemSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type AuditItem = {
  id: string;
  number: number;
  systemArea: string;
  status: AuditItemStatus;
  issue: string;
  severity: AuditItemSeverity;
  rootCause: string | null;
  fix: string | null;
  file: string | null;
  /** Free-form proof: command run, exit code, log line, commit, etc. */
  verification: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuditItemSet = {
  auditId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  items: AuditItem[];
};

const ITEMS_ROOT = path.join(process.cwd(), 'logs', 'audit', 'audit-items');
const INDEX_PATH = path.join(ITEMS_ROOT, 'index.json');
let indexWrite: Promise<void> = Promise.resolve();

const VALID_STATUSES: ReadonlySet<AuditItemStatus> = new Set<AuditItemStatus>([
  'pending', 'in_progress', 'blocked', 'failed', 'fixed', 'unverified', 'verified',
]);
const VALID_SEVERITIES: ReadonlySet<AuditItemSeverity> = new Set<AuditItemSeverity>([
  'info', 'low', 'medium', 'high', 'critical',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function auditDir(auditId: string): string {
  const safe = sanitizeId(auditId);
  if (!safe) {
    throw new Error('Invalid audit id.');
  }
  return path.join(ITEMS_ROOT, safe);
}

function logPath(auditId: string): string {
  return path.join(auditDir(auditId), 'items.jsonl');
}

function statePath(auditId: string): string {
  return path.join(auditDir(auditId), 'state.json');
}

type ItemEvent =
  | { type: 'create_set'; auditId: string; title: string; at: string }
  | { type: 'upsert_item'; item: AuditItem; at: string }
  | { type: 'update_status'; itemId: string; patch: Partial<AuditItem>; at: string };

async function appendEvent(auditId: string, event: ItemEvent): Promise<void> {
  if (isDurableStoreConfigured()) {
    await appendDurableEvent(logPath(auditId), event);
    return;
  }
  await mkdir(auditDir(auditId), { recursive: true });
  await appendFile(logPath(auditId), `${JSON.stringify(event)}\n`, 'utf8');
}

async function writeState(set: AuditItemSet): Promise<void> {
  if (isDurableStoreConfigured()) {
    await writeDurableJson(statePath(set.auditId), set);
    // Serialize index registration in this process; state lives in its own document.
    const register = indexWrite.catch(() => undefined).then(async () => {
      const ids = await readDurableJson<string[]>(INDEX_PATH, []);
      if (!ids.includes(set.auditId)) await writeDurableJson(INDEX_PATH, [...ids, set.auditId]);
    });
    indexWrite = register;
    await register;
    return;
  }
  await mkdir(auditDir(set.auditId), { recursive: true });
  await writeFile(statePath(set.auditId), JSON.stringify(set, null, 2), 'utf8');
}

function coerceStatus(value: unknown, fallback: AuditItemStatus): AuditItemStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value as AuditItemStatus)
    ? (value as AuditItemStatus)
    : fallback;
}

function coerceSeverity(value: unknown, fallback: AuditItemSeverity): AuditItemSeverity {
  return typeof value === 'string' && VALID_SEVERITIES.has(value as AuditItemSeverity)
    ? (value as AuditItemSeverity)
    : fallback;
}

/** Create a new structured audit set. */
export async function createAuditItemSet(title: string): Promise<AuditItemSet> {
  const auditId = createId('items');
  const set: AuditItemSet = {
    auditId,
    title: title.trim() || 'Untitled audit',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    items: [],
  };
  await appendEvent(auditId, { type: 'create_set', auditId, title: set.title, at: set.createdAt });
  await writeState(set);
  return set;
}

export async function getAuditItemSet(auditId: string): Promise<AuditItemSet | null> {
  if (isDurableStoreConfigured()) {
    const durable = await readDurableJson<AuditItemSet | null>(statePath(auditId), null);
    if (durable) return durable;
    // Keep existing local sets readable during migration. Database errors propagate.
  }
  try {
    const raw = await readFile(statePath(auditId), 'utf8');
    return JSON.parse(raw) as AuditItemSet;
  } catch {
    return null;
  }
}

export type UpsertAuditItemInput = {
  number: number;
  systemArea: string;
  issue: string;
  status?: AuditItemStatus;
  severity?: AuditItemSeverity;
  rootCause?: string | null;
  fix?: string | null;
  file?: string | null;
  verification?: string | null;
};

/**
 * Insert or update items by `number`. Existing items with the same number are
 * merged (only provided fields overwrite). Returns the updated set.
 */
export async function upsertAuditItems(
  auditId: string,
  inputs: UpsertAuditItemInput[],
): Promise<AuditItemSet | null> {
  const set = await getAuditItemSet(auditId);
  if (!set) {
    return null;
  }
  const byNumber = new Map<number, AuditItem>(set.items.map((item) => [item.number, item]));

  for (const input of inputs) {
    const existing = byNumber.get(input.number);
    const item: AuditItem = {
      id: existing?.id ?? createId('item'),
      number: input.number,
      systemArea: input.systemArea.trim() || existing?.systemArea || 'unspecified',
      status: coerceStatus(input.status, existing?.status ?? 'pending'),
      issue: input.issue.trim() || existing?.issue || '',
      severity: coerceSeverity(input.severity, existing?.severity ?? 'medium'),
      rootCause: input.rootCause ?? existing?.rootCause ?? null,
      fix: input.fix ?? existing?.fix ?? null,
      file: input.file ?? existing?.file ?? null,
      verification: input.verification ?? existing?.verification ?? null,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    byNumber.set(input.number, item);
    await appendEvent(auditId, { type: 'upsert_item', item, at: item.updatedAt });
  }

  const next: AuditItemSet = {
    ...set,
    items: Array.from(byNumber.values()).sort((a, b) => a.number - b.number),
    updatedAt: nowIso(),
  };
  await writeState(next);
  return next;
}

/** Patch a single item's status and/or proof fields by item id. */
export async function updateAuditItemStatus(
  auditId: string,
  itemId: string,
  patch: Partial<Pick<AuditItem, 'status' | 'rootCause' | 'fix' | 'file' | 'verification' | 'severity'>>,
): Promise<AuditItemSet | null> {
  const set = await getAuditItemSet(auditId);
  if (!set) {
    return null;
  }
  const index = set.items.findIndex((item) => item.id === itemId);
  if (index === -1) {
    return set;
  }
  const current = set.items[index]!;
  const updated: AuditItem = {
    ...current,
    status: patch.status ? coerceStatus(patch.status, current.status) : current.status,
    severity: patch.severity ? coerceSeverity(patch.severity, current.severity) : current.severity,
    rootCause: patch.rootCause !== undefined ? patch.rootCause : current.rootCause,
    fix: patch.fix !== undefined ? patch.fix : current.fix,
    file: patch.file !== undefined ? patch.file : current.file,
    verification: patch.verification !== undefined ? patch.verification : current.verification,
    updatedAt: nowIso(),
  };
  set.items[index] = updated;
  set.updatedAt = nowIso();
  await appendEvent(auditId, { type: 'update_status', itemId, patch, at: updated.updatedAt });
  await writeState(set);
  return set;
}

export type AuditItemStatusCounts = Record<AuditItemStatus, number>;

export function countByStatus(set: AuditItemSet): AuditItemStatusCounts {
  const counts: AuditItemStatusCounts = {
    pending: 0, in_progress: 0, blocked: 0, failed: 0, fixed: 0, unverified: 0, verified: 0,
  };
  for (const item of set.items) {
    counts[item.status] += 1;
  }
  return counts;
}

export async function listAuditItemSets(limit: number = 25): Promise<AuditItemSet[]> {
  let entries: string[] = isDurableStoreConfigured() ? await readDurableJson<string[]>(INDEX_PATH, []) : [];
  try {
    entries = [...new Set([...entries, ...(await readdir(ITEMS_ROOT))])].filter(entry => !entry.endsWith('.json'));
  } catch {
    // Durable sets remain discoverable on a fresh container with no local directory.
  }
  const sets = await Promise.all(entries.map((entry) => getAuditItemSet(entry)));
  return sets
    .filter((set): set is AuditItemSet => set !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.min(Math.max(1, limit), 100));
}
