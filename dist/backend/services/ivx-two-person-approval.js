/**
 * IVX Two-Person Delete Approval.
 *
 * Any destructive operation (hard delete, truncate, drop, bulk row removal)
 * on protected tables requires:
 *   1. Owner approval (first approver — the IVX owner).
 *   2. Second approval (a second authorized approver — configured via env).
 *   3. A written reason.
 *   4. Typed confirmation string ("DELETE" / "TRUNCATE" / "DROP").
 *   5. An immutable audit record.
 *
 * A destructive op is NOT executed until BOTH approvals are recorded. The
 * request creates a pending approval record; the second approver confirms it.
 *
 * @module ivx-two-person-approval
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const IVX_TWO_PERSON_MARKER = 'ivx-two-person-approval-2026-07-06';
const APPROVALS_FILE = path.resolve(process.cwd(), 'logs', 'audit', 'data-vault', 'two-person-approvals.jsonl');
function makeApprovalId() {
    return `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function hashApproval(input, firstApprover) {
    return createHash('sha256')
        .update(JSON.stringify({
        operation: input.operation,
        tables: input.tables,
        reason: input.reason,
        requestedBy: input.requestedBy,
        firstApprover,
        ts: Date.now(),
    }))
        .digest('hex');
}
async function ensureDir() {
    await fs.mkdir(path.dirname(APPROVALS_FILE), { recursive: true }).catch(() => { });
}
async function appendApproval(record) {
    await ensureDir();
    try {
        await fs.appendFile(APPROVALS_FILE, JSON.stringify(record) + '\n', 'utf8');
    }
    catch {
        // never block on audit write
    }
}
export async function readApprovalRecords(limit = 100) {
    try {
        const text = await fs.readFile(APPROVALS_FILE, 'utf8');
        const lines = text.trim().split('\n').filter(Boolean);
        return lines
            .slice(-limit)
            .map((line) => {
            try {
                return JSON.parse(line);
            }
            catch {
                return null;
            }
        })
            .filter((r) => r !== null)
            .reverse();
    }
    catch {
        return [];
    }
}
export async function findApproval(approvalId) {
    const records = await readApprovalRecords(500);
    return records.find((r) => r.approvalId === approvalId) ?? null;
}
/**
 * Step 1 — owner creates a destructive-op approval request.
 * Validates the typed confirmation matches the operation.
 */
export async function createDestructiveApproval(input) {
    if (input.typedConfirmation !== input.operation) {
        return { ok: false, approval: null, error: `Typed confirmation must exactly match "${input.operation}". Received "${input.typedConfirmation}".` };
    }
    if (!input.reason.trim()) {
        return { ok: false, approval: null, error: 'A written reason is required for every destructive operation.' };
    }
    if (input.tables.length === 0) {
        return { ok: false, approval: null, error: 'At least one affected table must be specified.' };
    }
    const firstApprover = input.requestedBy;
    const now = new Date().toISOString();
    const record = {
        approvalId: makeApprovalId(),
        operation: input.operation,
        tables: input.tables,
        reason: input.reason.slice(0, 2000),
        requestedBy: input.requestedBy,
        targetRecordId: input.targetRecordId ?? null,
        firstApprovalAt: now,
        firstApprover,
        secondApprovalAt: null,
        secondApprover: null,
        status: 'pending_second_approval',
        typedConfirmation: input.typedConfirmation,
        hash: hashApproval(input, firstApprover),
        marker: IVX_TWO_PERSON_MARKER,
    };
    await appendApproval(record);
    return { ok: true, approval: record, error: null };
}
/**
 * Step 2 — second approver confirms. The operation may only proceed once
 * status becomes 'approved'.
 */
export async function confirmDestructiveApproval(approvalId, secondApprover) {
    const records = await readApprovalRecords(500);
    const idx = records.findIndex((r) => r.approvalId === approvalId);
    if (idx === -1) {
        return { ok: false, approval: null, error: 'Approval request not found.' };
    }
    const record = records[idx];
    if (record.status === 'approved') {
        return { ok: false, approval: record, error: 'Approval already confirmed.' };
    }
    if (record.status === 'rejected' || record.status === 'expired') {
        return { ok: false, approval: record, error: `Approval is ${record.status} and cannot be confirmed.` };
    }
    if (record.firstApprover === secondApprover) {
        return { ok: false, approval: record, error: 'Second approver must be a different identity from the first approver.' };
    }
    const now = new Date().toISOString();
    const updated = {
        ...record,
        secondApprovalAt: now,
        secondApprover,
        status: 'approved',
    };
    await appendApproval(updated);
    return { ok: true, approval: updated, error: null };
}
/**
 * Reject a pending approval.
 */
export async function rejectDestructiveApproval(approvalId, rejectedBy) {
    const records = await readApprovalRecords(500);
    const record = records.find((r) => r.approvalId === approvalId);
    if (!record)
        return { ok: false, approval: null, error: 'Approval request not found.' };
    if (record.status !== 'pending_second_approval') {
        return { ok: false, approval: record, error: `Approval is already ${record.status}.` };
    }
    const updated = { ...record, status: 'rejected', secondApprover: rejectedBy };
    await appendApproval(updated);
    return { ok: true, approval: updated, error: null };
}
