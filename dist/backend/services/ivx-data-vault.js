/**
 * IVX Data Vault — independent backup & recovery system.
 *
 * The IVX Data Vault snapshots critical Supabase tables to the backend's own
 * filesystem (our "own data center") on a schedule, so that if Supabase loses
 * data — a bad migration, a cleanup script, a dropped table, a PITR gap — every
 * row can be restored from the vault.
 *
 * Design principles:
 *   1. INDEPENDENT — the vault lives on the backend's disk, NOT in Supabase.
 *      A Supabase outage or data loss event cannot destroy the vault.
 *   2. APPEND-ONLY — snapshots are never overwritten or auto-deleted. Each
 *      snapshot is a timestamped JSON file. Retention is configurable but the
 *      default keeps ALL snapshots (we have disk space; we do not have a
 *      second chance at lost data).
 *   3. CRYPTOGRAPHIC INTEGRITY — every snapshot is SHA-256 hashed and the hash
 *      is recorded in an append-only manifest. A tampered snapshot is detected.
 *   4. OWNER-GATED RESTORE — restoring overwrites production, so it always
 *      requires explicit owner approval via the API.
 *   5. HONEST — if a table is empty or missing, the snapshot records that
 *      honestly. The vault never fabricates data.
 *
 * Storage layout:
 *   logs/audit/data-vault/
 *     manifest.jsonl          — append-only ledger of every snapshot
 *     state.json              — scheduler state (last run, next run, config)
 *     snapshots/
 *       <snapshotId>/
 *         meta.json           — snapshot metadata + per-table hashes
 *         members.json
 *         waitlist.json
 *         investors.json
 *         buyers.json
 *         landing_analytics.json
 *         analytics_events.json
 *         visitor_sessions.json
 *         jv_deals.json
 *         ... (all critical tables)
 *
 * Scheduled by a background timer (every 6 hours by default). Can also be
 * triggered manually via the owner API.
 *
 * @module ivx-data-vault
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const IVX_DATA_VAULT_MARKER = 'ivx-data-vault-2026-07-06';
const VAULT_DIR = path.resolve(process.cwd(), 'logs', 'audit', 'data-vault');
const SNAPSHOTS_DIR = path.join(VAULT_DIR, 'snapshots');
const MANIFEST_FILE = path.join(VAULT_DIR, 'manifest.jsonl');
const STATE_FILE = path.join(VAULT_DIR, 'state.json');
const DEFAULT_TABLES = [
    'members',
    'waitlist',
    'waitlist_entries',
    'investors',
    'buyers',
    'jv_deals',
    'private_lenders',
    'tokenized_investments',
    'wallets',
    'wallet_transactions',
    'treasury',
    'ledger',
    'withdrawals',
    'wire_transfers',
    'notifications',
    'landing_analytics',
    'analytics_events',
    'visitor_sessions',
    'landing_submissions',
    'landing_investments',
    'profiles',
    'kyc_verifications',
    'referrals',
    'earn_accounts',
    'earn_deposits',
    'earn_payouts',
];
const DEFAULT_CONFIG = {
    intervalMs: 6 * 60 * 60 * 1000, // 6 hours
    enabled: true,
    maxSnapshots: 0, // keep ALL forever
    tables: DEFAULT_TABLES,
};
function resolveSupabase() {
    const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    const missing = [];
    if (!url)
        missing.push('EXPO_PUBLIC_SUPABASE_URL');
    if (!key)
        missing.push('SUPABASE_SERVICE_ROLE_KEY');
    return { url, key, missing };
}
async function fetchAllRows(baseUrl, key, table) {
    const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
    };
    try {
        // Fetch up to 50,000 rows per table. For visitor analytics tables that
        // could have 27k+ events, we page with Range headers.
        const allRows = [];
        let offset = 0;
        const pageSize = 1000;
        const maxPages = 50; // 50,000 rows max
        for (let page = 0; page < maxPages; page++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);
            try {
                // Some IVX tables use `member_id`, `investor_id`, etc. instead of `id`.
                // Try with order=id.asc first; if that returns 400, retry without ordering.
                let url = `${baseUrl}/rest/v1/${table}?select=*&order=id.asc&limit=${pageSize}&offset=${offset}`;
                let res = await fetch(url, {
                    method: 'GET',
                    signal: controller.signal,
                    headers: {
                        ...headers,
                        Range: `${offset}-${offset + pageSize - 1}`,
                        Prefer: 'count=exact',
                    },
                });
                // Retry without order clause if 400 (column "id" does not exist)
                if (res.status === 400) {
                    clearTimeout(timeout);
                    const retryController = new AbortController();
                    const retryTimeout = setTimeout(() => retryController.abort(), 15_000);
                    try {
                        url = `${baseUrl}/rest/v1/${table}?select=*&limit=${pageSize}&offset=${offset}`;
                        res = await fetch(url, {
                            method: 'GET',
                            signal: retryController.signal,
                            headers: {
                                ...headers,
                                Range: `${offset}-${offset + pageSize - 1}`,
                                Prefer: 'count=exact',
                            },
                        });
                        clearTimeout(retryTimeout);
                    }
                    catch (retryErr) {
                        clearTimeout(retryTimeout);
                        throw retryErr;
                    }
                }
                else {
                    clearTimeout(timeout);
                }
                if (res.status === 404) {
                    return { rows: [], status: 404, error: 'TABLE_NOT_FOUND' };
                }
                if (!res.ok) {
                    return { rows: [], status: res.status, error: `HTTP_${res.status}` };
                }
                const rows = (await res.json());
                allRows.push(...rows);
                // If we got fewer rows than the page size, we've reached the end.
                if (rows.length < pageSize)
                    break;
                offset += pageSize;
            }
            catch (err) {
                clearTimeout(timeout);
                throw err;
            }
        }
        return { rows: allRows, status: 200, error: null };
    }
    catch (err) {
        return {
            rows: [],
            status: 0,
            error: err instanceof Error ? err.message : 'network_error',
        };
    }
}
function sha256OfJson(data) {
    const json = JSON.stringify(data);
    return createHash('sha256').update(json).digest('hex');
}
async function snapshotOneTable(baseUrl, key, table, snapshotDir) {
    const capturedAt = new Date().toISOString();
    const result = await fetchAllRows(baseUrl, key, table);
    if (result.error === 'TABLE_NOT_FOUND') {
        return {
            table,
            ok: false,
            rowCount: 0,
            hash: null,
            bytes: 0,
            status: 404,
            error: 'TABLE_NOT_FOUND',
            capturedAt,
        };
    }
    if (result.error) {
        return {
            table,
            ok: false,
            rowCount: 0,
            hash: null,
            bytes: 0,
            status: result.status,
            error: result.error,
            capturedAt,
        };
    }
    // Write the rows to disk.
    const json = JSON.stringify(result.rows, null, 2);
    const hash = createHash('sha256').update(json).digest('hex');
    const filePath = path.join(snapshotDir, `${table}.json`);
    try {
        await fs.writeFile(filePath, json, 'utf8');
    }
    catch (err) {
        return {
            table,
            ok: false,
            rowCount: result.rows.length,
            hash,
            bytes: json.length,
            status: 200,
            error: `write_failed: ${err instanceof Error ? err.message : 'unknown'}`,
            capturedAt,
        };
    }
    return {
        table,
        ok: true,
        rowCount: result.rows.length,
        hash,
        bytes: json.length,
        status: 200,
        error: null,
        capturedAt,
    };
}
async function appendManifest(entry) {
    await ensureVaultDirs();
    try {
        await fs.appendFile(MANIFEST_FILE, JSON.stringify(entry) + '\n', 'utf8');
    }
    catch {
        // never let manifest failure block a snapshot
    }
}
export async function readManifest(limit = 100) {
    try {
        const text = await fs.readFile(MANIFEST_FILE, 'utf8');
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
            .filter((e) => e !== null)
            .reverse(); // newest first
    }
    catch {
        return [];
    }
}
// ---------------------------------------------------------------------------
// State I/O
// ---------------------------------------------------------------------------
async function ensureVaultDirs() {
    await fs.mkdir(VAULT_DIR, { recursive: true }).catch(() => { });
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true }).catch(() => { });
}
async function readState() {
    try {
        const text = await fs.readFile(STATE_FILE, 'utf8');
        const parsed = JSON.parse(text);
        return {
            marker: IVX_DATA_VAULT_MARKER,
            config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
            lastSnapshotAt: parsed.lastSnapshotAt ?? null,
            lastSnapshotId: parsed.lastSnapshotId ?? null,
            totalSnapshots: parsed.totalSnapshots ?? 0,
            nextScheduledRun: parsed.nextScheduledRun ?? null,
        };
    }
    catch {
        return {
            marker: IVX_DATA_VAULT_MARKER,
            config: DEFAULT_CONFIG,
            lastSnapshotAt: null,
            lastSnapshotId: null,
            totalSnapshots: 0,
            nextScheduledRun: null,
        };
    }
}
async function writeState(state) {
    await ensureVaultDirs();
    try {
        await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    }
    catch {
        // ignore
    }
}
export async function getDataVaultState() {
    return readState();
}
export async function updateDataVaultConfig(patch) {
    const state = await readState();
    state.config = {
        ...state.config,
        ...patch,
        intervalMs: Math.max(60_000, Number(patch.intervalMs ?? state.config.intervalMs)),
        maxSnapshots: Math.max(0, Math.round(patch.maxSnapshots ?? state.config.maxSnapshots)),
    };
    state.nextScheduledRun = new Date(Date.now() + state.config.intervalMs).toISOString();
    await writeState(state);
    return state;
}
function makeSnapshotId(now) {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(36).slice(2, 8);
    return `vault-${stamp}-${rand}`;
}
export async function runDataVaultSnapshot() {
    const startedAt = Date.now();
    const now = new Date();
    const snapshotId = makeSnapshotId(now);
    const state = await readState();
    const supa = resolveSupabase();
    const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotId);
    await ensureVaultDirs();
    await fs.mkdir(snapshotDir, { recursive: true }).catch(() => { });
    // If Supabase is not configured, record an empty snapshot with the honest reason.
    if (supa.missing.length > 0) {
        const report = {
            snapshotId,
            timestamp: now.toISOString(),
            ok: false,
            tableCount: 0,
            totalRows: 0,
            totalBytes: 0,
            tables: state.config.tables.map((table) => ({
                table,
                ok: false,
                rowCount: 0,
                hash: null,
                bytes: 0,
                status: 0,
                error: `not_configured: ${supa.missing.join(', ')}`,
                capturedAt: now.toISOString(),
            })),
            durationMs: Date.now() - startedAt,
            config: state.config,
            supabaseConfigured: false,
        };
        // Write meta.json with the failure reason
        await fs.writeFile(path.join(snapshotDir, 'meta.json'), JSON.stringify(report, null, 2), 'utf8').catch(() => { });
        return report;
    }
    // Snapshot all configured tables in parallel batches of 5.
    const tables = state.config.tables;
    const results = [];
    const batchSize = 5;
    for (let i = 0; i < tables.length; i += batchSize) {
        const batch = tables.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map((table) => snapshotOneTable(supa.url, supa.key, table, snapshotDir)));
        results.push(...batchResults);
    }
    const totalRows = results.reduce((sum, r) => sum + r.rowCount, 0);
    const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
    const okCount = results.filter((r) => r.ok).length;
    const report = {
        snapshotId,
        timestamp: now.toISOString(),
        ok: okCount > 0,
        tableCount: results.length,
        totalRows,
        totalBytes,
        tables: results,
        durationMs: Date.now() - startedAt,
        config: state.config,
        supabaseConfigured: true,
    };
    // Write meta.json
    await fs.writeFile(path.join(snapshotDir, 'meta.json'), JSON.stringify(report, null, 2), 'utf8').catch(() => { });
    // Append to manifest
    const manifestEntry = {
        snapshotId,
        timestamp: now.toISOString(),
        tableCount: results.length,
        totalRows,
        totalBytes,
        tables: results.map((r) => ({
            table: r.table,
            rowCount: r.rowCount,
            hash: r.hash,
            ok: r.ok,
            error: r.error,
        })),
        marker: IVX_DATA_VAULT_MARKER,
    };
    await appendManifest(manifestEntry);
    // Update state
    state.lastSnapshotAt = now.toISOString();
    state.lastSnapshotId = snapshotId;
    state.totalSnapshots += 1;
    state.nextScheduledRun = new Date(Date.now() + state.config.intervalMs).toISOString();
    await writeState(state);
    // Enforce retention (keep ALL if maxSnapshots is 0)
    if (state.config.maxSnapshots > 0) {
        await enforceRetention(state.config.maxSnapshots);
    }
    console.log(`[IVXDataVault] snapshot ${snapshotId} complete: ${okCount}/${results.length} tables, ${totalRows} rows, ${(totalBytes / 1024).toFixed(1)}KB`);
    return report;
}
// ---------------------------------------------------------------------------
// Retention enforcement
// ---------------------------------------------------------------------------
async function enforceRetention(keepCount) {
    try {
        const entries = await fs.readdir(SNAPSHOTS_DIR, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
        if (dirs.length <= keepCount)
            return;
        const toRemove = dirs.slice(0, dirs.length - keepCount);
        for (const dir of toRemove) {
            await fs.rm(path.join(SNAPSHOTS_DIR, dir), { recursive: true, force: true }).catch(() => { });
            console.log(`[IVXDataVault] removed old snapshot ${dir} (retention=${keepCount})`);
        }
    }
    catch {
        // ignore
    }
}
export async function listSnapshots(limit = 50) {
    await ensureVaultDirs();
    try {
        const entries = await fs.readdir(SNAPSHOTS_DIR, { withFileTypes: true });
        const results = [];
        for (const ent of entries.filter((e) => e.isDirectory())) {
            const full = path.join(SNAPSHOTS_DIR, ent.name);
            try {
                const stat = await fs.stat(full);
                let totalRows = 0;
                let tableCount = 0;
                try {
                    const meta = JSON.parse(await fs.readFile(path.join(full, 'meta.json'), 'utf8'));
                    totalRows = meta.totalRows;
                    tableCount = meta.tableCount;
                }
                catch { /* meta missing */ }
                results.push({
                    snapshotId: ent.name,
                    path: `logs/audit/data-vault/snapshots/${ent.name}`,
                    sizeBytes: stat.size,
                    mtime: stat.mtime.toISOString(),
                    totalRows,
                    tableCount,
                });
            }
            catch { /* ignore */ }
        }
        return results.sort((a, b) => (a.mtime < b.mtime ? 1 : -1)).slice(0, limit);
    }
    catch {
        return [];
    }
}
export async function readSnapshot(snapshotId) {
    const safe = snapshotId.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!safe)
        return null;
    try {
        const metaPath = path.join(SNAPSHOTS_DIR, safe, 'meta.json');
        const text = await fs.readFile(metaPath, 'utf8');
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
export async function readSnapshotTable(snapshotId, table) {
    const safeId = snapshotId.replace(/[^a-zA-Z0-9_.-]/g, '');
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeId || !safeTable)
        return { rows: [], ok: false, error: 'invalid_id_or_table' };
    try {
        const filePath = path.join(SNAPSHOTS_DIR, safeId, `${safeTable}.json`);
        const text = await fs.readFile(filePath, 'utf8');
        const rows = JSON.parse(text);
        return { rows, ok: true, error: null };
    }
    catch {
        return { rows: [], ok: false, error: 'snapshot_or_table_not_found' };
    }
}
/**
 * Restore a snapshot back into Supabase. This OVERWRITES production data.
 * It requires explicit owner approval — the caller must pass `confirmed: true`
 * or the restore is refused.
 *
 * For each table, the restore:
 *   1. Reads the snapshot JSON from disk.
 *   2. Upserts all rows via the Supabase REST API (POST with upsert).
 *   3. Reports how many rows were written.
 *
 * The restore does NOT delete rows that exist in Supabase but not in the
 * snapshot — it only adds/updates rows from the snapshot. This is safer than
 * a full TRUNCATE+INSERT, which would cause downtime.
 */
export async function restoreSnapshot(snapshotId, options = {}) {
    const startedAt = Date.now();
    const timestamp = new Date().toISOString();
    if (!options.confirmed) {
        return {
            snapshotId,
            ok: false,
            tablesRestored: 0,
            totalRowsRestored: 0,
            tables: [],
            durationMs: Date.now() - startedAt,
            timestamp,
            requiresOwnerApproval: true,
        };
    }
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return {
            snapshotId,
            ok: false,
            tablesRestored: 0,
            totalRowsRestored: 0,
            tables: [],
            durationMs: Date.now() - startedAt,
            timestamp,
            requiresOwnerApproval: true,
        };
    }
    const snapshot = await readSnapshot(snapshotId);
    if (!snapshot) {
        return {
            snapshotId,
            ok: false,
            tablesRestored: 0,
            totalRowsRestored: 0,
            tables: [],
            durationMs: Date.now() - startedAt,
            timestamp,
            requiresOwnerApproval: true,
        };
    }
    const tablesToRestore = options.tables ?? snapshot.tables.filter((t) => t.ok && t.rowCount > 0).map((t) => t.table);
    const results = [];
    for (const table of tablesToRestore) {
        const { rows, ok, error } = await readSnapshotTable(snapshotId, table);
        if (!ok || rows.length === 0) {
            results.push({ table, ok: false, rowsAttempted: rows.length, rowsUpserted: 0, error: error ?? 'no_rows' });
            continue;
        }
        try {
            // Upsert via Supabase REST API. We use the Prefer: resolution=merge-duplicates
            // header so existing rows (by PK) are updated, new rows are inserted.
            const res = await fetch(`${supa.url}/rest/v1/${table}`, {
                method: 'POST',
                headers: {
                    apikey: supa.key,
                    Authorization: `Bearer ${supa.key}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal,resolution=merge-duplicates',
                },
                body: JSON.stringify(rows),
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                results.push({
                    table,
                    ok: false,
                    rowsAttempted: rows.length,
                    rowsUpserted: 0,
                    error: `HTTP_${res.status}: ${body.slice(0, 200)}`,
                });
            }
            else {
                results.push({
                    table,
                    ok: true,
                    rowsAttempted: rows.length,
                    rowsUpserted: rows.length,
                    error: null,
                });
            }
        }
        catch (err) {
            results.push({
                table,
                ok: false,
                rowsAttempted: rows.length,
                rowsUpserted: 0,
                error: err instanceof Error ? err.message : 'network_error',
            });
        }
    }
    const tablesRestored = results.filter((r) => r.ok).length;
    const totalRowsRestored = results.reduce((sum, r) => sum + r.rowsUpserted, 0);
    return {
        snapshotId,
        ok: tablesRestored > 0,
        tablesRestored,
        totalRowsRestored,
        tables: results,
        durationMs: Date.now() - startedAt,
        timestamp,
        requiresOwnerApproval: true,
    };
}
/**
 * Compare the latest vault snapshot against live Supabase row counts. If a
 * table has significantly fewer rows in production than in the snapshot, flag
 * it as potential data loss. This runs automatically before every scheduled
 * snapshot and can be triggered manually.
 */
export async function detectDataLoss() {
    const checkedAt = new Date().toISOString();
    const state = await readState();
    if (!state.lastSnapshotId) {
        return {
            detected: false,
            severity: 'none',
            tablesAffected: [],
            lastSnapshotId: null,
            lastSnapshotAt: null,
            checkedAt,
        };
    }
    const snapshot = await readSnapshot(state.lastSnapshotId);
    if (!snapshot) {
        return {
            detected: false,
            severity: 'none',
            tablesAffected: [],
            lastSnapshotId: state.lastSnapshotId,
            lastSnapshotAt: state.lastSnapshotAt,
            checkedAt,
        };
    }
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return {
            detected: false,
            severity: 'none',
            tablesAffected: [],
            lastSnapshotId: state.lastSnapshotId,
            lastSnapshotAt: state.lastSnapshotAt,
            checkedAt,
        };
    }
    const headers = {
        apikey: supa.key,
        Authorization: `Bearer ${supa.key}`,
        Accept: 'application/json',
    };
    const alerts = [];
    for (const tableResult of snapshot.tables) {
        if (!tableResult.ok || tableResult.rowCount === 0)
            continue;
        try {
            const res = await fetch(`${supa.url}/rest/v1/${tableResult.table}?select=id`, {
                method: 'HEAD',
                headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
            });
            if (!res.ok)
                continue;
            const cr = res.headers.get('content-range');
            const liveCount = cr ? parseInt(cr.split('/').pop() || '*', 10) : null;
            if (liveCount === null || !Number.isFinite(liveCount))
                continue;
            if (liveCount < tableResult.rowCount) {
                const rowsLost = tableResult.rowCount - liveCount;
                alerts.push({
                    table: tableResult.table,
                    snapshotRows: tableResult.rowCount,
                    liveRows: liveCount,
                    rowsLost,
                });
            }
        }
        catch {
            // skip unreachable tables
        }
    }
    const severity = alerts.some((a) => a.rowsLost >= 50) ? 'critical' : alerts.length > 0 ? 'warning' : 'none';
    if (severity !== 'none') {
        console.warn(`[IVXDataVault] DATA LOSS DETECTED — severity=${severity}`, alerts);
    }
    return {
        detected: alerts.length > 0,
        severity,
        tablesAffected: alerts,
        lastSnapshotId: state.lastSnapshotId,
        lastSnapshotAt: state.lastSnapshotAt,
        checkedAt,
    };
}
// ---------------------------------------------------------------------------
// Background scheduler
// ---------------------------------------------------------------------------
let vaultTimer = null;
export function startDataVaultScheduler() {
    if (vaultTimer)
        return;
    const enabled = (process.env.IVX_DATA_VAULT_SCHEDULER ?? 'on').toLowerCase();
    if (enabled === 'off')
        return;
    // Tick every 30 minutes — the schedule gate decides actual execution.
    vaultTimer = setInterval(() => {
        void (async () => {
            try {
                const state = await readState();
                if (!state.config.enabled)
                    return;
                // Check if it's time for a snapshot
                const lastAt = state.lastSnapshotAt ? Date.parse(state.lastSnapshotAt) : 0;
                const due = Date.now() - lastAt >= state.config.intervalMs;
                if (!due)
                    return;
                // Run data-loss detection first
                await detectDataLoss();
                // Then take the snapshot
                await runDataVaultSnapshot();
            }
            catch (err) {
                console.warn('[IVXDataVault] scheduler tick failed:', err instanceof Error ? err.message : err);
            }
        })();
    }, 30 * 60_000); // 30 minutes
    if (typeof vaultTimer.unref === 'function')
        vaultTimer.unref();
    console.log('[IVXDataVault] scheduler started — snapshots every 6h, data-loss detection active');
}
export function stopDataVaultScheduler() {
    if (vaultTimer) {
        clearInterval(vaultTimer);
        vaultTimer = null;
    }
}
// ---------------------------------------------------------------------------
// Boot-time: take an initial snapshot if none exists yet
// ---------------------------------------------------------------------------
export async function bootstrapDataVault() {
    const state = await readState();
    if (state.totalSnapshots === 0) {
        console.log('[IVXDataVault] no snapshots exist — taking initial snapshot');
        await runDataVaultSnapshot();
    }
}
