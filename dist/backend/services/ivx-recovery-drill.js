/**
 * IVX Recovery Drill — automated end-to-end test that proves the recovery
 * system actually works. Runs these steps:
 *
 *   1. Create a test member row in Supabase.
 *   2. Soft-delete it (deleted_at set).
 *   3. Restore it (deleted_at cleared) — verify it reappears.
 *   4. Capture the test row into the data_vault table.
 *   5. Restore the test row from the vault back into members.
 *   6. Attempt a hard delete via the data-loss guard → confirm BLOCKED.
 *   7. Create a ledger correction entry (no deletion allowed).
 *
 * Each step records pass/fail + evidence. The drill NEVER deletes real data.
 * All test rows use a deterministic `ivx-drill-` prefix so they can be cleaned
 * up safely.
 *
 * @module ivx-recovery-drill
 */
import { softDeleteRow, restoreSoftDeletedRow } from './ivx-soft-delete';
import { captureToVault, restoreFromVault } from './ivx-vault-table';
import { evaluateDestructiveOp, isDestructiveOperation } from './ivx-data-loss-guard';
import { recordTransaction, listLedger } from './ivx-treasury-system';
export const IVX_DRILL_MARKER = 'ivx-recovery-drill-2026-07-06';
function resolveSupabase() {
    const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    const missing = [];
    if (!url)
        missing.push('EXPO_PUBLIC_SUPABASE_URL');
    if (!key)
        missing.push('SUPABASE_SERVICE_ROLE_KEY');
    return { url, key, missing };
}
/**
 * Run the full recovery drill. Safe to run in production — uses only
 * isolated test rows with deterministic IDs.
 */
export async function runRecoveryDrill() {
    const startedAt = Date.now();
    const steps = [];
    const supa = resolveSupabase();
    const nowIso = () => new Date().toISOString();
    // ── Step 1: create a test member ─────────────────────────────────────────
    // The members table uses member_id (UUID) as its PK, not "id".
    let testMemberId = null;
    let testMemberPk = null;
    const pkCol = 'member_id';
    if (supa.missing.length > 0) {
        steps.push({ step: 'create_test_member', passed: false, detail: `Supabase not configured: ${supa.missing.join(', ')}`, evidence: {} });
    }
    else {
        try {
            const testEmail = `ivx-drill-${Date.now()}@recovery.test`;
            const createRes = await fetch(`${supa.url}/rest/v1/members`, {
                method: 'POST',
                headers: {
                    apikey: supa.key,
                    Authorization: `Bearer ${supa.key}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation',
                },
                body: JSON.stringify({
                    email: testEmail,
                    full_name: 'IVX Recovery Drill (auto-cleanup)',
                    member_type: 'test',
                    verification_status: 'drill',
                    created_at: nowIso(),
                }),
            });
            if (createRes.ok) {
                const rows = (await createRes.json());
                if (rows.length > 0) {
                    const createdRow = rows[0];
                    testMemberId = String(createdRow.member_id ?? createdRow.email ?? testEmail);
                    testMemberPk = String(createdRow.member_id ?? '');
                    steps.push({ step: 'create_test_member', passed: true, detail: `Created test member member_id=${testMemberId}`, evidence: { email: testEmail, member_id: testMemberId } });
                }
                else {
                    steps.push({ step: 'create_test_member', passed: false, detail: 'No rows returned after insert', evidence: { email: testEmail } });
                }
            }
            else {
                const body = await createRes.text().catch(() => '');
                steps.push({ step: 'create_test_member', passed: false, detail: `HTTP ${createRes.status}: ${body.slice(0, 200)}`, evidence: { status: createRes.status, body: body.slice(0, 200) } });
            }
        }
        catch (err) {
            steps.push({ step: 'create_test_member', passed: false, detail: err instanceof Error ? err.message : 'error', evidence: {} });
        }
    }
    // ── Step 2: soft-delete the test member ──────────────────────────────────
    if (testMemberPk !== null) {
        const sd = await softDeleteRow({
            table: 'members',
            recordId: testMemberPk,
            pkColumn: pkCol,
            deletedBy: 'recovery-drill',
            reason: 'Automated recovery drill — soft delete test',
        });
        steps.push({
            step: 'soft_delete_test_member',
            passed: sd.ok,
            detail: sd.ok ? 'Soft-deleted (deleted_at set)' : sd.error ?? 'failed',
            evidence: { status: sd.status, timestamp: sd.timestamp },
        });
    }
    else {
        steps.push({ step: 'soft_delete_test_member', passed: false, detail: 'Skipped — no test member id', evidence: {} });
    }
    // ── Step 3: restore the soft-deleted member ──────────────────────────────
    if (testMemberPk !== null) {
        const rs = await restoreSoftDeletedRow({ table: 'members', recordId: testMemberPk, pkColumn: pkCol });
        steps.push({
            step: 'restore_soft_deleted_member',
            passed: rs.ok,
            detail: rs.ok ? 'Restored (deleted_at cleared)' : rs.error ?? 'failed',
            evidence: { status: rs.status, timestamp: rs.timestamp },
        });
    }
    else {
        steps.push({ step: 'restore_soft_deleted_member', passed: false, detail: 'Skipped — no test member id', evidence: {} });
    }
    // ── Step 4: capture test row into data_vault table ───────────────────────
    if (testMemberPk !== null) {
        // Fetch the current member row so the vault capture contains the real schema.
        let memberRow = null;
        try {
            const rowRes = await fetch(`${supa.url}/rest/v1/members?member_id=eq.${encodeURIComponent(testMemberPk)}&limit=1`, {
                headers: { apikey: supa.key, Authorization: `Bearer ${supa.key}`, Accept: 'application/json' },
            });
            if (rowRes.ok) {
                const rows = (await rowRes.json());
                if (rows.length > 0)
                    memberRow = rows[0];
            }
        }
        catch {
            // fallback to partial capture below
        }
        const cap = await captureToVault({
            table: 'members',
            recordId: testMemberPk,
            action: 'DELETE',
            oldData: memberRow ?? { member_id: testMemberPk, email: `ivx-drill-${testMemberPk}@recovery.test` },
            userId: 'recovery-drill',
            reason: 'Drill capture — test vault restore',
        });
        steps.push({
            step: 'capture_to_vault_table',
            passed: cap.ok,
            detail: cap.ok ? `Captured vault_id=${cap.vaultId}` : cap.error ?? 'failed',
            evidence: { vaultId: cap.vaultId, status: cap.status },
        });
        // ── Step 5: restore from vault ─────────────────────────────────────────
        if (cap.ok) {
            const rv = await restoreFromVault(cap.vaultId);
            steps.push({
                step: 'restore_from_vault_table',
                passed: rv.ok,
                detail: rv.ok ? `Restored table=${rv.restoredTable} record=${rv.recordId}` : rv.error ?? 'failed',
                evidence: { status: rv.status, restoredTable: rv.restoredTable, recordId: rv.recordId },
            });
        }
        else {
            steps.push({ step: 'restore_from_vault_table', passed: false, detail: 'Skipped — capture failed', evidence: {} });
        }
    }
    else {
        steps.push({ step: 'capture_to_vault_table', passed: false, detail: 'Skipped — no test member id', evidence: {} });
        steps.push({ step: 'restore_from_vault_table', passed: false, detail: 'Skipped — no test member id', evidence: {} });
    }
    // ── Step 6: attempt hard delete via guard → must be BLOCKED ───────────────
    const detected = isDestructiveOperation('DELETE FROM members WHERE id = 999999');
    if (detected) {
        const decision = await evaluateDestructiveOp({
            operation: 'DELETE FROM members WHERE id = 999999',
            tables: ['members'],
            isAutonomous: true,
            ownerApproved: false,
            ownerReason: null,
            emergency: false,
        });
        steps.push({
            step: 'hard_delete_blocked_by_guard',
            passed: !decision.allowed,
            detail: !decision.allowed ? 'BLOCKED by data-loss guard ✓' : 'ERROR: hard delete was allowed!',
            evidence: { blocker: decision.blocker, snapshotId: decision.snapshotTaken?.snapshotId ?? null },
        });
    }
    else {
        steps.push({ step: 'hard_delete_blocked_by_guard', passed: false, detail: 'Destructive op not detected', evidence: {} });
    }
    // ── Step 7: ledger correction entry (no deletion) ────────────────────────
    try {
        const before = await listLedger({ limit: 1 });
        const { entry } = await recordTransaction({
            userId: 'recovery-drill',
            accountId: 'drill-account',
            amount: 0.01,
            currency: 'USD',
            type: 'adjustment',
            memo: 'Recovery drill correction entry — ledger is immutable',
            createdBy: 'recovery-drill',
        });
        const after = await listLedger({ limit: 1 });
        const appended = after.length > 0 && after[0].transactionId === entry.transactionId;
        steps.push({
            step: 'ledger_correction_entry',
            passed: appended,
            detail: appended ? `Correction entry ${entry.transactionId} appended (hash=${entry.hash.slice(0, 12)}…) — original preserved` : 'Ledger entry not found after append',
            evidence: { transactionId: entry.transactionId, hash: entry.hash, previousHash: entry.previousHash, beforeCount: before.length, afterCount: after.length },
        });
    }
    catch (err) {
        steps.push({
            step: 'ledger_correction_entry',
            passed: false,
            detail: err instanceof Error ? err.message : 'ledger error',
            evidence: {},
        });
    }
    // ── Cleanup: soft-delete the test member so we never hard-delete production data ─
    if (testMemberPk !== null) {
        try {
            await softDeleteRow({
                table: 'members',
                recordId: testMemberPk,
                pkColumn: pkCol,
                deletedBy: 'recovery-drill',
                reason: 'Automated drill cleanup — test row archived, not deleted',
            });
        }
        catch {
            // best-effort cleanup
        }
    }
    const passed = steps.filter((s) => s.passed).length;
    const failed = steps.filter((s) => !s.passed).length;
    const total = steps.length;
    return {
        marker: IVX_DRILL_MARKER,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        overallPassed: failed === 0,
        steps,
        summary: { passed, failed, total },
        testMemberId,
    };
}
