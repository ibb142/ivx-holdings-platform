/**
 * IVX Owner Investor Ordering + Block Review system.
 *
 * Gives the owner a single, ordered, reviewable view over every capital-relationship
 * record (buyers, investors, JV partners, tokenized buyers) and every opportunity:
 *
 *   1. NUMERIC ORDER — every record gets a stable, sequential order number starting
 *      at 1 (scales to 1,000,000+). The number + its created timestamp form a
 *      sortableKey so the board sorts deterministically regardless of record source.
 *   2. TRANSACTION STATUS — active / pending / no_transaction / expired / blocked /
 *      owner_review. Derived honestly from the record's lifecycle stage + activity,
 *      with persistent owner overrides.
 *   3. AUTO-MOVE — records with no transaction past the review window move to the
 *      owner_review list with a concrete reason. NEVER auto-deleted.
 *   4. VIP TIER — VIP 1..4 computed from capital signal (lead/relationship score +
 *      transaction state), plus a Blocked / Delete-Review bucket.
 *   5. OWNER ACTIONS — approve, archive, block, queue-delete, delete (explicit),
 *      return-to-active, set transaction status, move to review.
 *
 * HONESTY RULE (inherited platform-wide): nothing here fabricates records. It only
 * ORDERS, CLASSIFIES, and lets the owner ACT on records that already exist in the
 * durable CRM / opportunity stores. Owner decisions are persisted in an overlay so
 * they survive restarts and never mutate the source records destructively.
 *
 * Durable layout (mirrors the proven ivx-investor-crm-store pattern):
 *   logs/audit/record-ordering/overlay.json   materialised owner overlay (orders + actions)
 *   logs/audit/record-ordering/overlay.jsonl  append-only owner-action event log
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
import { listInvestors } from './ivx-investor-crm-store';
import { listOpportunities } from './ivx-opportunity-store';
export const IVX_RECORD_ORDERING_MARKER = 'ivx-record-ordering-2026-06-14';
/** How long a record can sit with no transaction/activity before auto-moving to owner_review. */
export const REVIEW_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TRANSACTION_STATUSES = [
    'active_transaction',
    'pending_transaction',
    'no_transaction',
    'expired',
    'blocked',
    'owner_review',
];
export const REVIEW_REASONS = [
    'no_transaction',
    'no_response',
    'low_score',
    'duplicate',
    'invalid_contact',
    'blocked_source',
];
export const OWNER_ACTION_TYPES = [
    'approve',
    'archive',
    'block',
    'queue_delete',
    'delete',
    'return_to_active',
    'move_to_review',
    'set_transaction_status',
];
const ROOT = auditDir('record-ordering');
const OVERLAY_STATE = path.join(ROOT, 'overlay.json');
const OVERLAY_LOG = path.join(ROOT, 'overlay.jsonl');
function nowIso() {
    return new Date().toISOString();
}
function emptyOverlay() {
    return {
        marker: IVX_RECORD_ORDERING_MARKER,
        counter: 1,
        orders: {},
        overrides: {},
        deleted: [],
        updatedAt: nowIso(),
    };
}
async function readOverlay() {
    const fallback = emptyOverlay();
    let raw;
    if (isDurableStoreConfigured()) {
        raw = await readDurableJson(OVERLAY_STATE, fallback);
    }
    else {
        try {
            raw = JSON.parse(await readFile(OVERLAY_STATE, 'utf8'));
        }
        catch {
            raw = fallback;
        }
    }
    return {
        marker: IVX_RECORD_ORDERING_MARKER,
        counter: Number.isFinite(raw?.counter) && raw.counter >= 1 ? Math.floor(raw.counter) : 1,
        orders: raw?.orders && typeof raw.orders === 'object' ? raw.orders : {},
        overrides: raw?.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
        deleted: Array.isArray(raw?.deleted) ? raw.deleted : [],
        updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    };
}
async function writeOverlay(overlay) {
    overlay.updatedAt = nowIso();
    if (isDurableStoreConfigured()) {
        await writeDurableJson(OVERLAY_STATE, overlay);
        return;
    }
    await mkdir(ROOT, { recursive: true });
    await writeFile(OVERLAY_STATE, JSON.stringify(overlay, null, 2), 'utf8');
}
async function appendEvent(event) {
    if (isDurableStoreConfigured()) {
        try {
            await appendDurableEvent(OVERLAY_LOG, event);
        }
        catch {
            // Forensic log is best-effort; never break an owner action on log failure.
        }
        return;
    }
    try {
        await mkdir(ROOT, { recursive: true });
        await appendFile(OVERLAY_LOG, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // Best-effort.
    }
}
// ── Pure classification helpers (unit-testable, no I/O) ──────────────────────
/** Format an order number to a zero-padded, owner-readable string (min 6 digits). */
export function formatOrderNumber(orderNumber) {
    return String(Math.max(1, Math.floor(orderNumber))).padStart(6, '0');
}
/** Build the deterministic sort key: created timestamp + zero-padded order number. */
export function buildSortableKey(createdAt, orderNumber) {
    return `${createdAt}#${String(Math.max(0, Math.floor(orderNumber))).padStart(12, '0')}`;
}
/** A normalized capital signal score (0–100) used for VIP tiering. */
export function combinedScore(leadScore, relationshipScore) {
    const lead = Number.isFinite(leadScore) ? leadScore : 0;
    const rel = Number.isFinite(relationshipScore) ? relationshipScore : 0;
    return Math.max(0, Math.min(100, Math.round(lead * 0.6 + rel * 0.4)));
}
/** True when the record's activity is older than the review window. */
function isStale(lastActivityAt, now) {
    const t = Date.parse(lastActivityAt);
    if (!Number.isFinite(t))
        return false;
    return now - t > REVIEW_WINDOW_DAYS * DAY_MS;
}
/**
 * Derive the default transaction status from an investor's lifecycle stage + activity.
 * Honest: an owner override always wins over this.
 */
export function deriveTransactionStatus(investorStatus, lastActivityAt, now = Date.now()) {
    if (investorStatus === 'invested')
        return 'active_transaction';
    if (investorStatus === 'meeting_scheduled' || investorStatus === 'active')
        return 'pending_transaction';
    if (investorStatus === 'contacted') {
        return isStale(lastActivityAt, now) ? 'expired' : 'pending_transaction';
    }
    // prospect
    return isStale(lastActivityAt, now) ? 'expired' : 'no_transaction';
}
/** Compute the VIP tier from transaction state + capital signal score. */
export function computeVipTier(transactionStatus, score, reviewState) {
    if (reviewState === 'blocked' || reviewState === 'delete_queue')
        return 'blocked_review';
    if (transactionStatus === 'blocked')
        return 'blocked_review';
    if (transactionStatus === 'active_transaction' || score >= 80)
        return 'vip1';
    if (score >= 60)
        return 'vip2';
    if (score >= 35)
        return 'vip3';
    return 'vip4';
}
/** Map an investor record to the owner-facing record type. */
function investorType(rec) {
    if (rec.partyType === 'buyer') {
        return rec.investmentType.toLowerCase().includes('token') ? 'tokenized_buyer' : 'buyer';
    }
    if (rec.partyType === 'investor')
        return 'investor';
    if (rec.partyType === 'partner')
        return 'jv';
    return 'other';
}
/** Which actions make sense from a given review state. */
function actionsFor(reviewState) {
    const base = ['set_transaction_status'];
    switch (reviewState) {
        case 'active':
            return [...base, 'move_to_review', 'archive', 'block'];
        case 'owner_review':
            return [...base, 'approve', 'return_to_active', 'archive', 'block', 'queue_delete'];
        case 'archived':
            return [...base, 'return_to_active', 'queue_delete'];
        case 'blocked':
            return [...base, 'return_to_active', 'queue_delete'];
        case 'delete_queue':
            return ['return_to_active', 'delete'];
        default:
            return base;
    }
}
/** Pull every source record (investors + opportunities) into one normalized list. */
async function collectRawRecords() {
    const [investors, opportunities] = await Promise.all([
        listInvestors().catch(() => []),
        listOpportunities().catch(() => []),
    ]);
    const rows = [];
    for (const inv of investors) {
        rows.push({
            recordId: `inv:${inv.id}`,
            name: inv.name,
            company: inv.company,
            type: investorType(inv),
            leadScore: inv.leadScore,
            relationshipScore: inv.relationshipScore,
            investorStatus: inv.status,
            lastContactAt: inv.lastContactDate,
            lastActivityAt: inv.updatedAt || inv.createdAt,
            createdAt: inv.createdAt,
            source: inv.source,
            sourceDetail: inv.sourceDetail,
        });
    }
    for (const opp of opportunities) {
        const overall = typeof opp.overall === 'number' ? opp.overall : 0;
        rows.push({
            recordId: `opp:${opp.id}`,
            name: opp.title ?? 'Opportunity',
            company: opp.category ?? '',
            type: 'opportunity',
            leadScore: overall,
            relationshipScore: overall,
            investorStatus: null,
            lastContactAt: null,
            lastActivityAt: opp.updatedAt ?? opp.createdAt ?? nowIso(),
            createdAt: opp.createdAt ?? nowIso(),
            source: 'opportunity_engine',
            sourceDetail: opp.evidence ?? '',
        });
    }
    return rows;
}
/**
 * Build the full ordered board. This is the single source of truth the API serves.
 * It assigns order numbers to any new records, applies the auto-move rule, and
 * persists both back to the overlay so the assignment is stable across calls.
 */
export async function buildOrderingBoard(now = Date.now()) {
    const overlay = await readOverlay();
    const raw = await collectRawRecords();
    const deleted = new Set(overlay.deleted);
    // Stable order assignment: assign new records by created date, then by id, so the
    // numbering is deterministic and append-only (existing numbers never change).
    const unassigned = raw
        .filter((r) => !deleted.has(r.recordId) && !overlay.orders[r.recordId])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.recordId.localeCompare(b.recordId));
    let dirty = false;
    for (const r of unassigned) {
        overlay.orders[r.recordId] = { orderNumber: overlay.counter, createdAt: r.createdAt };
        overlay.counter += 1;
        dirty = true;
    }
    const board = [];
    for (const r of raw) {
        if (deleted.has(r.recordId))
            continue;
        const assigned = overlay.orders[r.recordId];
        if (!assigned)
            continue; // Should not happen — every non-deleted record was assigned above.
        const override = overlay.overrides[r.recordId] ?? {};
        let reviewState = override.reviewState ?? 'active';
        let reason = override.reason ?? null;
        let autoMoved = override.autoMoved ?? false;
        const score = combinedScore(r.leadScore, r.relationshipScore);
        const derived = r.investorStatus
            ? deriveTransactionStatus(r.investorStatus, r.lastActivityAt, now)
            : score >= 60
                ? 'pending_transaction'
                : 'no_transaction';
        const transactionStatus = override.transactionStatus ?? derived;
        // AUTO-MOVE RULE: a record still in the active pipeline with no transaction past
        // the review window is moved to owner_review automatically (never deleted).
        if (reviewState === 'active' &&
            transactionStatus !== 'active_transaction' &&
            isStale(r.lastActivityAt, now)) {
            reviewState = 'owner_review';
            reason = score < 35 ? 'low_score' : r.investorStatus === 'contacted' ? 'no_response' : 'no_transaction';
            autoMoved = true;
            overlay.overrides[r.recordId] = {
                ...override,
                reviewState,
                reason,
                autoMoved: true,
                movedAt: override.movedAt ?? nowIso(),
                updatedAt: nowIso(),
            };
            dirty = true;
        }
        const effectiveTx = reviewState === 'owner_review'
            ? 'owner_review'
            : reviewState === 'blocked'
                ? 'blocked'
                : transactionStatus;
        const vipTier = override.vipTierOverride ?? computeVipTier(effectiveTx, score, reviewState);
        board.push({
            recordId: r.recordId,
            orderNumber: assigned.orderNumber,
            orderNumberFormatted: formatOrderNumber(assigned.orderNumber),
            createdAt: assigned.createdAt,
            sortableKey: buildSortableKey(assigned.createdAt, assigned.orderNumber),
            name: r.name,
            company: r.company,
            type: r.type,
            vipTier,
            score,
            leadScore: r.leadScore,
            relationshipScore: r.relationshipScore,
            transactionStatus: effectiveTx,
            reviewState,
            reason,
            autoMoved,
            lastContactAt: r.lastContactAt,
            lastActivityAt: r.lastActivityAt,
            source: r.source,
            sourceDetail: r.sourceDetail,
            availableActions: actionsFor(reviewState),
        });
    }
    if (dirty)
        await writeOverlay(overlay);
    board.sort((a, b) => a.orderNumber - b.orderNumber);
    return board;
}
// ── Owner actions ────────────────────────────────────────────────────────────
const REVIEW_STATE_FOR_ACTION = {
    approve: 'active',
    return_to_active: 'active',
    archive: 'archived',
    block: 'blocked',
    queue_delete: 'delete_queue',
    move_to_review: 'owner_review',
};
/**
 * Apply an owner decision to a record. Persists into the overlay (source records are
 * never mutated). `delete` only fully removes a record that the owner already moved
 * to the delete queue — nothing is ever deleted automatically.
 */
export async function applyOwnerAction(input) {
    if (!input.recordId || typeof input.recordId !== 'string') {
        return { ok: false, error: 'recordId is required.' };
    }
    if (!OWNER_ACTION_TYPES.includes(input.action)) {
        return { ok: false, error: `Unknown action '${input.action}'.` };
    }
    const overlay = await readOverlay();
    // The record must exist on the current board (or already have an assignment).
    if (!overlay.orders[input.recordId] && !overlay.deleted.includes(input.recordId)) {
        // Lazily ensure ordering is built so a fresh record can be acted on.
        await buildOrderingBoard();
        const refreshed = await readOverlay();
        overlay.orders = refreshed.orders;
        overlay.counter = refreshed.counter;
        overlay.overrides = refreshed.overrides;
        overlay.deleted = refreshed.deleted;
    }
    if (!overlay.orders[input.recordId]) {
        return { ok: false, error: `Record '${input.recordId}' not found on the board.` };
    }
    const prior = overlay.overrides[input.recordId] ?? {};
    if (input.action === 'set_transaction_status') {
        if (!input.transactionStatus || !TRANSACTION_STATUSES.includes(input.transactionStatus)) {
            return { ok: false, error: 'A valid transactionStatus is required for set_transaction_status.' };
        }
        overlay.overrides[input.recordId] = {
            ...prior,
            transactionStatus: input.transactionStatus,
            updatedAt: nowIso(),
        };
    }
    else if (input.action === 'delete') {
        if (prior.reviewState !== 'delete_queue') {
            return { ok: false, error: 'A record must be in the delete queue before it can be deleted. Use queue_delete first.' };
        }
        if (!overlay.deleted.includes(input.recordId))
            overlay.deleted.push(input.recordId);
        delete overlay.overrides[input.recordId];
    }
    else {
        const nextState = REVIEW_STATE_FOR_ACTION[input.action];
        if (!nextState)
            return { ok: false, error: `Action '${input.action}' is not applicable.` };
        const clearsReview = nextState === 'active';
        overlay.overrides[input.recordId] = {
            ...prior,
            reviewState: nextState,
            reason: clearsReview ? undefined : input.reason ?? prior.reason,
            autoMoved: false,
            movedAt: nowIso(),
            updatedAt: nowIso(),
        };
    }
    await writeOverlay(overlay);
    await appendEvent({
        type: 'owner_action',
        recordId: input.recordId,
        action: input.action,
        reason: input.reason ?? null,
        transactionStatus: input.transactionStatus ?? null,
        at: nowIso(),
    });
    return { ok: true, recordId: input.recordId, action: input.action };
}
function zeroVip() {
    return { vip1: 0, vip2: 0, vip3: 0, vip4: 0, blocked_review: 0 };
}
function zeroTx() {
    return {
        active_transaction: 0, pending_transaction: 0, no_transaction: 0, expired: 0, blocked: 0, owner_review: 0,
    };
}
function zeroReview() {
    return { active: 0, owner_review: 0, archived: 0, blocked: 0, delete_queue: 0 };
}
function zeroType() {
    return { buyer: 0, investor: 0, jv: 0, tokenized_buyer: 0, opportunity: 0, other: 0 };
}
/** Read-only roll-up over the ordered board (powers the dashboard header + daily report). */
export async function summarizeOrdering(now = Date.now()) {
    const board = await buildOrderingBoard(now);
    const byVipTier = zeroVip();
    const byTransactionStatus = zeroTx();
    const byReviewState = zeroReview();
    const byType = zeroType();
    let highest = 0;
    let movedAuto = 0;
    for (const row of board) {
        byVipTier[row.vipTier] += 1;
        byTransactionStatus[row.transactionStatus] += 1;
        byReviewState[row.reviewState] += 1;
        byType[row.type] += 1;
        if (row.orderNumber > highest)
            highest = row.orderNumber;
        if (row.autoMoved)
            movedAuto += 1;
    }
    return {
        marker: IVX_RECORD_ORDERING_MARKER,
        generatedAt: nowIso(),
        total: board.length,
        highestOrderNumber: highest,
        byVipTier,
        byTransactionStatus,
        byReviewState,
        byType,
        ownerReview: byReviewState.owner_review,
        blocked: byReviewState.blocked,
        deleteQueue: byReviewState.delete_queue,
        activeTransactions: byTransactionStatus.active_transaction,
        noTransaction: byTransactionStatus.no_transaction,
        movedToReviewAuto: movedAuto,
    };
}
