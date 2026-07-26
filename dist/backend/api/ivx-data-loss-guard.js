/**
 * IVX Data-Loss Guard API handlers — destructive operation interception.
 *
 * @module ivx-data-loss-guard-api
 */
import { evaluateDestructiveOp, readDestructiveOpAudit, isDestructiveOperation, extractTableNames, PROTECTED_TABLES, } from '../services/ivx-data-loss-guard';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
};
function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}
/**
 * POST /api/ivx/data-guard/evaluate
 * Evaluate a destructive operation. Returns allowed/blocked decision.
 * If allowed AND targeting a protected table, a pre-snapshot is taken.
 */
export async function handleDataGuardEvaluate(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    let body = {};
    try {
        body = await request.json();
    }
    catch {
        return json({ ok: false, error: 'invalid_json' }, 400);
    }
    if (!body.operation) {
        return json({ ok: false, error: 'operation_required' }, 400);
    }
    const decision = await evaluateDestructiveOp({
        operation: body.operation,
        tables: body.tables ?? [],
        isAutonomous: body.isAutonomous ?? false,
        ownerApproved: body.ownerApproved ?? false,
        ownerReason: body.ownerReason ?? null,
        emergency: body.emergency ?? false,
    });
    return ownerOnlyJson({ ok: true, decision });
}
/**
 * GET /api/ivx/data-guard/audit
 * Read the immutable destructive-operations audit trail.
 */
export async function handleDataGuardAudit(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    const entries = await readDestructiveOpAudit(200);
    return ownerOnlyJson({ ok: true, audit: entries, count: entries.length });
}
/**
 * GET /api/ivx/data-guard/protected-tables
 * List the tables protected from autonomous bulk deletion.
 */
export async function handleDataGuardProtectedTables(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    return ownerOnlyJson({
        ok: true,
        protectedTables: Array.from(PROTECTED_TABLES).sort(),
        count: PROTECTED_TABLES.size,
    });
}
/**
 * POST /api/ivx/data-guard/check
 * Check whether an operation string is destructive without executing anything.
 * Pure inspection — no snapshot, no audit entry, no side effects.
 */
export async function handleDataGuardCheck(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    let body = {};
    try {
        body = await request.json();
    }
    catch {
        return json({ ok: false, error: 'invalid_json' }, 400);
    }
    if (!body.operation) {
        return json({ ok: false, error: 'operation_required' }, 400);
    }
    const destructive = isDestructiveOperation(body.operation);
    const tables = extractTableNames(body.operation);
    const protectedHit = tables.find((t) => PROTECTED_TABLES.has(t.toLowerCase()));
    return ownerOnlyJson({
        ok: true,
        destructive,
        tables,
        protectedTableHit: protectedHit ?? null,
        wouldBeBlocked: destructive && Boolean(protectedHit),
    });
}
export function dataGuardOptions() {
    return ownerOnlyOptions();
}
