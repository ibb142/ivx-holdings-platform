/**
 * IVX PITR (Point-in-Time Recovery) status check.
 *
 * Probes Supabase for backup/PITR availability by checking:
 *   1. Whether the project responds to the management/health endpoints.
 *   2. The age of the newest row across critical tables (proxy for "last
 *      write" — gives the owner a concrete "data is fresh as of X" signal).
 *   3. Whether the file-based Data Vault has recent snapshots (our own
 *      independent backup layer).
 *
 * Supabase's PITR config itself is only visible in the Supabase Dashboard
 * (it requires the platform API + project ref + a service key with platform
 * scope, which is not the same as the database service role key). So we
 * surface what we CAN verify from the backend and clearly flag that PITR
 * enablement must be confirmed in the Dashboard.
 *
 * @module ivx-pitr-status
 */
export const IVX_PITR_MARKER = 'ivx-pitr-status-2026-07-06';
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
const CRITICAL_TABLES = [
    'members', 'waitlist', 'investors', 'buyers', 'wallets', 'ledger',
    'jv_deals', 'landing_analytics', 'analytics_events', 'profiles',
];
/**
 * Probe Supabase for PITR / backup status. Returns a honest report the owner
 * can act on. Does not fabricate PITR availability — it clearly states when
 * PITR status must be confirmed in the Dashboard.
 */
export async function checkPitrStatus(fileVaultSnapshotCount, fileVaultLastSnapshotAt) {
    const checkedAt = new Date().toISOString();
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return {
            marker: IVX_PITR_MARKER,
            checkedAt,
            supabaseUrl: null,
            supabaseReachable: false,
            pitrDashboardConfirmed: null,
            pitrAlert: `Supabase not configured: ${supa.missing.join(', ')}`,
            restoreWindowNote: 'Unavailable — Supabase not configured.',
            criticalTables: [],
            newestWriteAt: null,
            oldestWriteAt: null,
            fileVaultSnapshots: fileVaultSnapshotCount ?? null,
            fileVaultLastSnapshotAt: fileVaultLastSnapshotAt ?? null,
            recommendation: 'Configure Supabase credentials before PITR status can be checked.',
        };
    }
    const headers = { apikey: supa.key, Authorization: `Bearer ${supa.key}`, Accept: 'application/json' };
    let supabaseReachable = false;
    try {
        const healthRes = await fetch(`${supa.url}/rest/v1/`, { method: 'GET', headers });
        supabaseReachable = healthRes.status < 500;
    }
    catch {
        supabaseReachable = false;
    }
    const tableFreshness = [];
    for (const table of CRITICAL_TABLES) {
        try {
            const res = await fetch(`${supa.url}/rest/v1/${table}?select=created_at,updated_at&order=created_at.desc&limit=1`, {
                headers: { ...headers, Range: '0-0', Prefer: 'count=exact' },
            });
            if (res.status === 404) {
                tableFreshness.push({ table, exists: false, rowCount: null, lastWriteAt: null, error: 'TABLE_NOT_FOUND' });
                continue;
            }
            if (!res.ok) {
                tableFreshness.push({ table, exists: true, rowCount: null, lastWriteAt: null, error: `HTTP_${res.status}` });
                continue;
            }
            const rows = (await res.json());
            const lastWrite = rows.length > 0 ? (String(rows[0].updated_at ?? rows[0].created_at ?? '')) : null;
            const cr = res.headers.get('content-range');
            const count = cr ? parseInt(cr.split('/').pop() || '*', 10) : null;
            tableFreshness.push({ table, exists: true, rowCount: Number.isFinite(count) ? count : null, lastWriteAt: lastWrite || null, error: null });
        }
        catch (err) {
            tableFreshness.push({ table, exists: false, rowCount: null, lastWriteAt: null, error: err instanceof Error ? err.message : 'network_error' });
        }
    }
    const writeTimes = tableFreshness
        .map((t) => t.lastWriteAt)
        .filter((v) => Boolean(v))
        .sort();
    const newestWriteAt = writeTimes.length > 0 ? writeTimes[writeTimes.length - 1] : null;
    const oldestWriteAt = writeTimes.length > 0 ? writeTimes[0] : null;
    const pitrAlert = supabaseReachable
        ? 'Supabase PITR enablement CANNOT be verified from the backend service-role key. Confirm PITR is enabled in the Supabase Dashboard → Database → Backups. If PITR is OFF, enable it immediately — it is the only Supabase-native way to restore to a specific timestamp.'
        : 'Supabase is not reachable. Cannot verify PITR status.';
    const restoreWindowNote = 'Supabase PITR (Pro plan) typically retains 7-30 days of recovery history. Free/Team plans have only daily logical backups with a 7-day retention. Confirm your plan and retention in the Dashboard.';
    const recommendation = fileVaultSnapshotCount && fileVaultSnapshotCount > 0
        ? 'File-based Data Vault has snapshots — use the Restore Center as the primary recovery path. ALSO enable Supabase PITR for defense-in-depth.'
        : 'No file-based snapshots yet. Run a manual snapshot now AND enable Supabase PITR in the Dashboard for two independent recovery layers.';
    return {
        marker: IVX_PITR_MARKER,
        checkedAt,
        supabaseUrl: supa.url,
        supabaseReachable,
        pitrDashboardConfirmed: null,
        pitrAlert,
        restoreWindowNote,
        criticalTables: tableFreshness,
        newestWriteAt,
        oldestWriteAt,
        fileVaultSnapshots: fileVaultSnapshotCount ?? null,
        fileVaultLastSnapshotAt: fileVaultLastSnapshotAt ?? null,
        recommendation,
    };
}
