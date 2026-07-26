/**
 * IVX Daily Recovery Report — generated every day and on-demand.
 *
 * Produces:
 *   - backup status (file vault + Supabase reachability)
 *   - row counts for every critical table
 *   - soft-deleted records count
 *   - restored records (from vault manifest)
 *   - vault size on disk
 *   - last snapshot timestamp + id
 *   - recovery risk score (low / medium / high)
 *
 * @module ivx-recovery-report
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDataVaultState, listSnapshots, readManifest, detectDataLoss } from './ivx-data-vault';
import { readDestructiveOpAudit } from './ivx-data-loss-guard';
import { readApprovalRecords } from './ivx-two-person-approval';
import { checkPitrStatus } from './ivx-pitr-status';
import { listSoftDeleted } from './ivx-soft-delete';
export const IVX_REPORT_MARKER = 'ivx-recovery-report-2026-07-06';
const REPORTS_DIR = path.resolve(process.cwd(), 'logs', 'audit', 'data-vault', 'reports');
const CRITICAL_TABLES = [
    'members', 'waitlist', 'investors', 'buyers', 'wallets', 'ledger',
    'jv_deals', 'transactions', 'messages', 'analytics_events', 'landing_analytics',
];
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
async function dirSize(dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        let total = 0;
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                total += await dirSize(full);
            }
            else if (ent.isFile()) {
                const stat = await fs.stat(full);
                total += stat.size;
            }
        }
        return total;
    }
    catch {
        return 0;
    }
}
async function countTable(baseUrl, key, table) {
    try {
        const res = await fetch(`${baseUrl}/rest/v1/${table}?select=id`, {
            method: 'GET',
            headers: { apikey: key, Authorization: `Bearer ${key}`, Range: '0-0', Prefer: 'count=exact' },
        });
        if (res.status === 404)
            return { table, count: null, exists: false, error: 'TABLE_NOT_FOUND' };
        if (!res.ok)
            return { table, count: null, exists: true, error: `HTTP_${res.status}` };
        const cr = res.headers.get('content-range');
        const count = cr ? parseInt(cr.split('/').pop() || '*', 10) : null;
        return { table, count: Number.isFinite(count) ? count : null, exists: true, error: null };
    }
    catch (err) {
        return { table, count: null, exists: false, error: err instanceof Error ? err.message : 'network_error' };
    }
}
/**
 * Generate a full daily recovery report and persist it to disk.
 */
export async function generateDailyReport() {
    const generatedAt = new Date().toISOString();
    const date = generatedAt.slice(0, 10);
    const supa = resolveSupabase();
    const state = await getDataVaultState();
    const snapshots = await listSnapshots(1000);
    const manifest = await readManifest(200);
    const destructiveAudit = await readDestructiveOpAudit(200);
    const approvals = await readApprovalRecords(200);
    const dataLossAlert = await detectDataLoss();
    // Row counts
    const rowCounts = [];
    if (supa.missing.length === 0) {
        for (const table of CRITICAL_TABLES) {
            rowCounts.push(await countTable(supa.url, supa.key, table));
        }
    }
    else {
        for (const table of CRITICAL_TABLES) {
            rowCounts.push({ table, count: null, exists: false, error: `not_configured: ${supa.missing.join(', ')}` });
        }
    }
    // Soft-deleted counts (best-effort, may fail if tables lack deleted_at)
    const softDeletedCounts = [];
    for (const table of ['members', 'investors', 'buyers', 'waitlist']) {
        try {
            const result = await listSoftDeleted(table, 1000);
            softDeletedCounts.push({ table, count: result.count, error: result.error });
        }
        catch (err) {
            softDeletedCounts.push({ table, count: 0, error: err instanceof Error ? err.message : 'error' });
        }
    }
    // Vault size on disk
    const vaultDir = path.resolve(process.cwd(), 'logs', 'audit', 'data-vault');
    const vaultSizeBytes = await dirSize(vaultDir);
    // Restored records from manifest (count snapshots that restored data)
    const restoredRecords = manifest.length;
    const pendingApprovals = approvals.filter((a) => a.status === 'pending_second_approval').length;
    const destructiveOpsLogged = destructiveAudit.length;
    const pitr = await checkPitrStatus(snapshots.length, state.lastSnapshotAt);
    // Risk assessment
    const riskReasons = [];
    if (state.totalSnapshots === 0)
        riskReasons.push('No file-vault snapshots exist yet.');
    if (!pitr.supabaseReachable)
        riskReasons.push('Supabase is not reachable.');
    if (dataLossAlert.detected)
        riskReasons.push(`Data loss detected on ${dataLossAlert.tablesAffected.length} table(s).`);
    if (destructiveOpsLogged > 0 && destructiveAudit.filter((d) => !d.allowed).length > 5)
        riskReasons.push('Multiple destructive ops were blocked recently — investigate autonomous cleanup attempts.');
    if (vaultSizeBytes === 0)
        riskReasons.push('Vault directory is empty — no backups on disk.');
    const recoveryRisk = riskReasons.length >= 3 ? 'high' : riskReasons.length >= 1 ? 'medium' : 'low';
    const recommendation = recoveryRisk === 'low'
        ? 'All recovery systems healthy. Continue daily snapshots.'
        : recoveryRisk === 'medium'
            ? `Address: ${riskReasons.join('; ')}. Run a manual snapshot and confirm PITR in the Supabase Dashboard.`
            : `CRITICAL: ${riskReasons.join('; ')}. Immediate action required — run a snapshot now, enable Supabase PITR, and run the recovery drill.`;
    const report = {
        marker: IVX_REPORT_MARKER,
        generatedAt,
        date,
        backupStatus: {
            fileVaultEnabled: state.config.enabled,
            fileVaultLastSnapshotAt: state.lastSnapshotAt,
            fileVaultLastSnapshotId: state.lastSnapshotId,
            fileVaultTotalSnapshots: state.totalSnapshots,
            supabaseReachable: pitr.supabaseReachable,
        },
        rowCounts,
        softDeletedCounts,
        vaultSizeBytes,
        vaultSizeNote: vaultSizeBytes === 0 ? 'Vault directory is empty.' : `${(vaultSizeBytes / 1024).toFixed(1)} KB on disk`,
        restoredRecords,
        destructiveOpsLogged,
        pendingApprovals,
        pitr,
        dataLossAlert,
        recoveryRisk,
        riskReasons,
        recommendation,
    };
    // Persist to disk
    try {
        await fs.mkdir(REPORTS_DIR, { recursive: true });
        const filename = `report-${date}-${Date.now()}.json`;
        await fs.writeFile(path.join(REPORTS_DIR, filename), JSON.stringify(report, null, 2), 'utf8');
    }
    catch {
        // never fail the report because of persistence
    }
    return report;
}
/**
 * Read the most recent N daily reports from disk.
 */
export async function listDailyReports(limit = 10) {
    try {
        const files = await fs.readdir(REPORTS_DIR);
        const reports = [];
        for (const file of files.slice(-limit * 2)) {
            if (!file.endsWith('.json'))
                continue;
            try {
                const raw = JSON.parse(await fs.readFile(path.join(REPORTS_DIR, file), 'utf8'));
                reports.push({ filename: file, generatedAt: raw.generatedAt, date: raw.date, recoveryRisk: raw.recoveryRisk });
            }
            catch { /* skip corrupt */ }
        }
        return reports.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1)).slice(0, limit);
    }
    catch {
        return [];
    }
}
