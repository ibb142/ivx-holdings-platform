/**
 * IVX Restore Center API — the unified owner admin endpoint surface for the
 * entire zero-data-loss system.
 *
 * All endpoints are owner-only (assertIVXOwnerOnly).
 *
 * Routes:
 *   GET    /api/ivx/restore-center/overview          — full dashboard state
 *   GET    /api/ivx/restore-center/deleted            — soft-deleted records
 *   POST   /api/ivx/restore-center/soft-delete        — soft-delete a row
 *   POST   /api/ivx/restore-center/restore-soft       — restore a soft-deleted row
 *   GET    /api/ivx/restore-center/vault-entries      — data_vault table entries
 *   POST   /api/ivx/restore-center/restore-vault      — restore from vault entry
 *   GET    /api/ivx/restore-center/pitr               — PITR / backup status
 *   GET    /api/ivx/restore-center/snapshots          — file-vault snapshots
 *   POST   /api/ivx/restore-center/restore-snapshot   — restore a full snapshot
 *   GET    /api/ivx/restore-center/approvals          — two-person approvals
 *   POST   /api/ivx/restore-center/approvals/create   — create approval request
 *   POST   /api/ivx/restore-center/approvals/confirm  — second approver confirms
 *   POST   /api/ivx/restore-center/approvals/reject   — reject pending approval
 *   GET    /api/ivx/restore-center/guard-audit        — destructive-op audit trail
 *   GET    /api/ivx/restore-center/protected-tables   — protected table list
 *   POST   /api/ivx/restore-center/drill              — run recovery drill
 *   GET    /api/ivx/restore-center/report             — generate daily report
 *   GET    /api/ivx/restore-center/reports            — list past reports
 *   POST   /api/ivx/restore-center/export             — emergency backup export
 *
 * @module ivx-restore-center-api
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { softDeleteRow, restoreSoftDeletedRow, listSoftDeleted } from '../services/ivx-soft-delete';
import { listVaultEntries, restoreFromVault, captureToVault } from '../services/ivx-vault-table';
import { checkPitrStatus } from '../services/ivx-pitr-status';
import { createDestructiveApproval, confirmDestructiveApproval, rejectDestructiveApproval, readApprovalRecords, } from '../services/ivx-two-person-approval';
import { readDestructiveOpAudit, PROTECTED_TABLES } from '../services/ivx-data-loss-guard';
import { getDataVaultState, listSnapshots, restoreSnapshot, runDataVaultSnapshot, readManifest, } from '../services/ivx-data-vault';
import { runRecoveryDrill } from '../services/ivx-recovery-drill';
import { generateDailyReport, listDailyReports } from '../services/ivx-recovery-report';
const H = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
};
function fail(status, error, detail) {
    return new Response(JSON.stringify({ ok: false, error, detail: detail ?? null }), { status, headers: H });
}
async function ownerGuard(request) {
    try {
        await assertIVXOwnerOnly(request);
        return null;
    }
    catch (err) {
        return fail(401, 'owner_auth_required', err instanceof Error ? err.message : 'auth_failed');
    }
}
async function readBody(request) {
    try {
        return await request.json();
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// GET /overview
// ---------------------------------------------------------------------------
export async function handleRestoreCenterOverview(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const state = await getDataVaultState();
    const snapshots = await listSnapshots(20);
    const manifest = await readManifest(5);
    const approvals = await readApprovalRecords(10);
    const guardAudit = await readDestructiveOpAudit(10);
    const protectedTables = Array.from(PROTECTED_TABLES).sort();
    const pitr = await checkPitrStatus(snapshots.length, state.lastSnapshotAt);
    return ownerOnlyJson({
        ok: true,
        overview: {
            marker: 'ivx-restore-center-2026-07-06',
            generatedAt: new Date().toISOString(),
            fileVault: {
                enabled: state.config.enabled,
                totalSnapshots: state.totalSnapshots,
                lastSnapshotAt: state.lastSnapshotAt,
                lastSnapshotId: state.lastSnapshotId,
                nextScheduledRun: state.nextScheduledRun,
                intervalMs: state.config.intervalMs,
                recentSnapshots: snapshots.slice(0, 5),
                recentManifest: manifest,
            },
            pitr,
            twoPersonApprovals: {
                recent: approvals,
                pendingCount: approvals.filter((a) => a.status === 'pending_second_approval').length,
            },
            guardAudit: {
                recent: guardAudit,
                totalLogged: guardAudit.length,
            },
            protectedTables,
            protectedTableCount: protectedTables.length,
        },
    });
}
// ---------------------------------------------------------------------------
// GET /deleted — list soft-deleted records
// ---------------------------------------------------------------------------
export async function handleRestoreCenterDeleted(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const table = url.searchParams.get('table') ?? 'members';
    const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);
    const result = await listSoftDeleted(table, limit);
    return ownerOnlyJson({ ok: result.error === null, ...result });
}
// ---------------------------------------------------------------------------
// POST /soft-delete
// ---------------------------------------------------------------------------
export async function handleRestoreCenterSoftDelete(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const body = await readBody(request);
    if (!body || !body.table || body.recordId === undefined || !body.reason) {
        return fail(400, 'missing_fields', 'table, recordId, reason are required');
    }
    // Capture to vault before soft-delete
    await captureToVault({
        table: body.table,
        recordId: body.recordId,
        action: 'DELETE',
        oldData: { softDeleteRequested: true, reason: body.reason },
        userId: 'owner',
        reason: `Pre soft-delete capture: ${body.reason}`,
    }).catch(() => { });
    const result = await softDeleteRow({
        table: body.table,
        recordId: body.recordId,
        deletedBy: 'owner',
        reason: body.reason,
        pkColumn: body.pkColumn,
    });
    return ownerOnlyJson({ ok: result.ok, result });
}
// ---------------------------------------------------------------------------
// POST /restore-soft
// ---------------------------------------------------------------------------
export async function handleRestoreCenterRestoreSoft(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const body = await readBody(request);
    if (!body || !body.table || body.recordId === undefined) {
        return fail(400, 'missing_fields', 'table, recordId are required');
    }
    const result = await restoreSoftDeletedRow({
        table: body.table,
        recordId: body.recordId,
        pkColumn: body.pkColumn,
    });
    return ownerOnlyJson({ ok: result.ok, result });
}
// ---------------------------------------------------------------------------
// GET /vault-entries
// ---------------------------------------------------------------------------
export async function handleRestoreCenterVaultEntries(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const table = url.searchParams.get('table') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
    const result = await listVaultEntries({ table, limit });
    return ownerOnlyJson({ ...result });
}
// ---------------------------------------------------------------------------
// POST /restore-vault
// ---------------------------------------------------------------------------
export async function handleRestoreCenterRestoreVault(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const body = await readBody(request);
    if (!body || !body.vaultId) {
        return fail(400, 'missing_fields', 'vaultId is required');
    }
    const result = await restoreFromVault(body.vaultId);
    return ownerOnlyJson({ ok: result.ok, result });
}
// ---------------------------------------------------------------------------
// GET /pitr
// ---------------------------------------------------------------------------
export async function handleRestoreCenterPitr(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const snapshots = await listSnapshots(1000);
    const state = await getDataVaultState();
    const pitr = await checkPitrStatus(snapshots.length, state.lastSnapshotAt);
    return ownerOnlyJson({ ok: true, pitr });
}
// ---------------------------------------------------------------------------
// GET /snapshots
// ---------------------------------------------------------------------------
export async function handleRestoreCenterSnapshots(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const snapshots = await listSnapshots(100);
    return ownerOnlyJson({ ok: true, snapshots, count: snapshots.length });
}
// ---------------------------------------------------------------------------
// POST /restore-snapshot
// ---------------------------------------------------------------------------
export async function handleRestoreCenterRestoreSnapshot(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const body = await readBody(request);
    if (!body || !body.snapshotId) {
        return fail(400, 'missing_fields', 'snapshotId is required');
    }
    if (!body.confirmed) {
        return fail(409, 'confirmation_required', 'Send { "confirmed": true, "snapshotId": "..." } to proceed. This overwrites production data.');
    }
    const report = await restoreSnapshot(body.snapshotId, { confirmed: true, tables: body.tables });
    return ownerOnlyJson({ ok: report.ok, report });
}
// ---------------------------------------------------------------------------
// POST /snapshot — trigger a manual snapshot now
// ---------------------------------------------------------------------------
export async function handleRestoreCenterSnapshotNow(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const report = await runDataVaultSnapshot();
    return ownerOnlyJson({ ok: report.ok, report });
}
// ---------------------------------------------------------------------------
// GET /approvals
// ---------------------------------------------------------------------------
export async function handleRestoreCenterApprovals(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const records = await readApprovalRecords(100);
    return ownerOnlyJson({ ok: true, approvals: records, count: records.length });
}
// ---------------------------------------------------------------------------
// POST /approvals/create
// ---------------------------------------------------------------------------
export async function handleRestoreCenterApprovalCreate(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const body = await readBody(request);
    if (!body || !body.operation || !body.tables || !body.reason || !body.typedConfirmation || !body.requestedBy) {
        return fail(400, 'missing_fields', 'operation, tables, reason, typedConfirmation, requestedBy are required');
    }
    const result = await createDestructiveApproval({
        operation: body.operation,
        tables: body.tables,
        reason: body.reason,
        typedConfirmation: body.typedConfirmation,
        requestedBy: body.requestedBy,
        targetRecordId: body.targetRecordId,
    });
    return ownerOnlyJson({ ...result }, result.ok ? 201 : 400);
}
// ---------------------------------------------------------------------------
// POST /approvals/confirm
// ---------------------------------------------------------------------------
export async function handleRestoreCenterApprovalConfirm(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const body = await readBody(request);
    if (!body || !body.approvalId || !body.secondApprover) {
        return fail(400, 'missing_fields', 'approvalId, secondApprover are required');
    }
    const result = await confirmDestructiveApproval(body.approvalId, body.secondApprover);
    return ownerOnlyJson({ ...result }, result.ok ? 200 : 409);
}
// ---------------------------------------------------------------------------
// POST /approvals/reject
// ---------------------------------------------------------------------------
export async function handleRestoreCenterApprovalReject(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const body = await readBody(request);
    if (!body || !body.approvalId || !body.rejectedBy) {
        return fail(400, 'missing_fields', 'approvalId, rejectedBy are required');
    }
    const result = await rejectDestructiveApproval(body.approvalId, body.rejectedBy);
    return ownerOnlyJson({ ...result });
}
// ---------------------------------------------------------------------------
// GET /guard-audit
// ---------------------------------------------------------------------------
export async function handleRestoreCenterGuardAudit(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
    const entries = await readDestructiveOpAudit(limit);
    return ownerOnlyJson({ ok: true, entries, count: entries.length });
}
// ---------------------------------------------------------------------------
// GET /protected-tables
// ---------------------------------------------------------------------------
export async function handleRestoreCenterProtectedTables(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const tables = Array.from(PROTECTED_TABLES).sort();
    return ownerOnlyJson({ ok: true, protectedTables: tables, count: tables.length });
}
// ---------------------------------------------------------------------------
// POST /drill
// ---------------------------------------------------------------------------
export async function handleRestoreCenterDrill(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const report = await runRecoveryDrill();
    return ownerOnlyJson({ ok: report.overallPassed, report });
}
// ---------------------------------------------------------------------------
// GET /report
// ---------------------------------------------------------------------------
export async function handleRestoreCenterReport(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const report = await generateDailyReport();
    return ownerOnlyJson({ ok: true, report });
}
// ---------------------------------------------------------------------------
// GET /reports
// ---------------------------------------------------------------------------
export async function handleRestoreCenterReports(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
    const reports = await listDailyReports(limit);
    return ownerOnlyJson({ ok: true, reports, count: reports.length });
}
// ---------------------------------------------------------------------------
// POST /export — emergency backup (triggers a snapshot + returns summary)
// ---------------------------------------------------------------------------
export async function handleRestoreCenterExport(request) {
    const guard = await ownerGuard(request);
    if (guard)
        return guard;
    const snapshot = await runDataVaultSnapshot();
    return ownerOnlyJson({
        ok: snapshot.ok,
        export: {
            snapshotId: snapshot.snapshotId,
            timestamp: snapshot.timestamp,
            tables: snapshot.tables.length,
            totalRows: snapshot.totalRows,
            totalBytes: snapshot.totalBytes,
            path: `logs/audit/data-vault/snapshots/${snapshot.snapshotId}`,
            message: 'Emergency backup snapshot taken. All critical tables captured to the file vault.',
        },
    });
}
export function restoreCenterOptions() {
    return ownerOnlyOptions();
}
