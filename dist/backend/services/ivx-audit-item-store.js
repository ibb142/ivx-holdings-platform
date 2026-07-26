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
 * Layout (durable across restarts):
 *   logs/audit/audit-items/<auditId>/items.jsonl   append-only event log
 *   logs/audit/audit-items/<auditId>/state.json    materialised current state
 *
 * The JSONL log is the source of truth (append-only, never rewritten); the
 * state file is a fast-read materialised view rebuilt on each mutation.
 */
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const ITEMS_ROOT = path.join(process.cwd(), 'logs', 'audit', 'audit-items');
const VALID_STATUSES = new Set([
    'pending', 'in_progress', 'blocked', 'failed', 'fixed', 'unverified', 'verified',
]);
const VALID_SEVERITIES = new Set([
    'info', 'low', 'medium', 'high', 'critical',
]);
function nowIso() {
    return new Date().toISOString();
}
function sanitizeId(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function auditDir(auditId) {
    const safe = sanitizeId(auditId);
    if (!safe) {
        throw new Error('Invalid audit id.');
    }
    return path.join(ITEMS_ROOT, safe);
}
function logPath(auditId) {
    return path.join(auditDir(auditId), 'items.jsonl');
}
function statePath(auditId) {
    return path.join(auditDir(auditId), 'state.json');
}
async function appendEvent(auditId, event) {
    await mkdir(auditDir(auditId), { recursive: true });
    await appendFile(logPath(auditId), `${JSON.stringify(event)}\n`, 'utf8');
}
async function writeState(set) {
    await mkdir(auditDir(set.auditId), { recursive: true });
    await writeFile(statePath(set.auditId), JSON.stringify(set, null, 2), 'utf8');
}
function coerceStatus(value, fallback) {
    return typeof value === 'string' && VALID_STATUSES.has(value)
        ? value
        : fallback;
}
function coerceSeverity(value, fallback) {
    return typeof value === 'string' && VALID_SEVERITIES.has(value)
        ? value
        : fallback;
}
/** Create a new structured audit set. */
export async function createAuditItemSet(title) {
    const auditId = createId('items');
    const set = {
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
export async function getAuditItemSet(auditId) {
    try {
        const raw = await readFile(statePath(auditId), 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/**
 * Insert or update items by `number`. Existing items with the same number are
 * merged (only provided fields overwrite). Returns the updated set.
 */
export async function upsertAuditItems(auditId, inputs) {
    const set = await getAuditItemSet(auditId);
    if (!set) {
        return null;
    }
    const byNumber = new Map(set.items.map((item) => [item.number, item]));
    for (const input of inputs) {
        const existing = byNumber.get(input.number);
        const item = {
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
    const next = {
        ...set,
        items: Array.from(byNumber.values()).sort((a, b) => a.number - b.number),
        updatedAt: nowIso(),
    };
    await writeState(next);
    return next;
}
/** Patch a single item's status and/or proof fields by item id. */
export async function updateAuditItemStatus(auditId, itemId, patch) {
    const set = await getAuditItemSet(auditId);
    if (!set) {
        return null;
    }
    const index = set.items.findIndex((item) => item.id === itemId);
    if (index === -1) {
        return set;
    }
    const current = set.items[index];
    const updated = {
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
export function countByStatus(set) {
    const counts = {
        pending: 0, in_progress: 0, blocked: 0, failed: 0, fixed: 0, unverified: 0, verified: 0,
    };
    for (const item of set.items) {
        counts[item.status] += 1;
    }
    return counts;
}
export async function listAuditItemSets(limit = 25) {
    let entries = [];
    try {
        entries = await readdir(ITEMS_ROOT);
    }
    catch {
        return [];
    }
    const sets = await Promise.all(entries.map((entry) => getAuditItemSet(entry)));
    return sets
        .filter((set) => set !== null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, Math.min(Math.max(1, limit), 100));
}
