/**
 * IVX Data Vault API handlers — backup, recovery, and data-loss detection.
 *
 * All endpoints are owner-only (require assertIVXOwnerOnly). The restore
 * endpoint additionally requires `confirmed: true` in the request body to
 * prevent accidental production overwrites.
 *
 * @module ivx-data-vault-api
 */
import { getDataVaultState, updateDataVaultConfig, runDataVaultSnapshot, listSnapshots, readSnapshot, readSnapshotTable, restoreSnapshot, detectDataLoss, readManifest, } from '../services/ivx-data-vault';
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
// ---------------------------------------------------------------------------
// GET /api/ivx/data-vault/status
// Returns vault state + config + last snapshot summary.
// ---------------------------------------------------------------------------
export async function handleDataVaultStatus(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    const state = await getDataVaultState();
    const manifest = await readManifest(5);
    return ownerOnlyJson({
        ok: true,
        state,
        recentSnapshots: manifest,
    });
}
// ---------------------------------------------------------------------------
// POST /api/ivx/data-vault/config
// Update vault config (interval, enabled, retention).
// ---------------------------------------------------------------------------
export async function handleDataVaultConfigUpdate(request) {
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
    const state = await updateDataVaultConfig(body);
    return ownerOnlyJson({ ok: true, state });
}
// ---------------------------------------------------------------------------
// POST /api/ivx/data-vault/snapshot
// Trigger a manual snapshot NOW.
// ---------------------------------------------------------------------------
export async function handleDataVaultSnapshotTrigger(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    const report = await runDataVaultSnapshot();
    return ownerOnlyJson({ ok: report.ok, report });
}
// ---------------------------------------------------------------------------
// GET /api/ivx/data-vault/snapshots
// List all available snapshots.
// ---------------------------------------------------------------------------
export async function handleDataVaultSnapshotsList(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    const snapshots = await listSnapshots(100);
    return ownerOnlyJson({ ok: true, snapshots, count: snapshots.length });
}
// ---------------------------------------------------------------------------
// GET /api/ivx/data-vault/snapshots/:snapshotId
// Get full metadata for a specific snapshot.
// ---------------------------------------------------------------------------
export async function handleDataVaultSnapshotGet(request, snapshotId) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    const snapshot = await readSnapshot(snapshotId);
    if (!snapshot) {
        return json({ ok: false, error: 'snapshot_not_found', snapshotId }, 404);
    }
    return ownerOnlyJson({ ok: true, snapshot });
}
// ---------------------------------------------------------------------------
// GET /api/ivx/data-vault/snapshots/:snapshotId/tables/:table
// Download the raw rows for one table from a snapshot.
// ---------------------------------------------------------------------------
export async function handleDataVaultSnapshotTable(request, snapshotId, table) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    const { rows, ok, error } = await readSnapshotTable(snapshotId, table);
    if (!ok) {
        return json({ ok: false, error, snapshotId, table }, 404);
    }
    return ownerOnlyJson({ ok: true, snapshotId, table, rowCount: rows.length, rows });
}
// ---------------------------------------------------------------------------
// POST /api/ivx/data-vault/restore
// Restore a snapshot back into Supabase. REQUIRES confirmed: true.
// ---------------------------------------------------------------------------
export async function handleDataVaultRestore(request) {
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
    if (!body.snapshotId) {
        return json({ ok: false, error: 'snapshotId_required' }, 400);
    }
    if (!body.confirmed) {
        return json({
            ok: false,
            error: 'confirmation_required',
            message: 'Restore overwrites production data. Send { "confirmed": true, "snapshotId": "..." } to proceed.',
            snapshotId: body.snapshotId,
        }, 409);
    }
    const report = await restoreSnapshot(body.snapshotId, { confirmed: true, tables: body.tables });
    return ownerOnlyJson({ ok: report.ok, report });
}
// ---------------------------------------------------------------------------
// GET /api/ivx/data-vault/loss-detection
// Compare latest snapshot vs live Supabase to detect data loss.
// ---------------------------------------------------------------------------
export async function handleDataVaultLossDetection(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    const alert = await detectDataLoss();
    return ownerOnlyJson({ ok: true, alert });
}
// ---------------------------------------------------------------------------
// GET /api/ivx/data-vault/manifest
// Read the append-only manifest ledger.
// ---------------------------------------------------------------------------
export async function handleDataVaultManifest(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return json({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }, 401);
    }
    const entries = await readManifest(200);
    return ownerOnlyJson({ ok: true, manifest: entries, count: entries.length });
}
export function dataVaultOptions() {
    return ownerOnlyOptions();
}
