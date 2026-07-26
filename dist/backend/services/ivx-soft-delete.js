/**
 * IVX Soft-Delete Module — never hard-delete production data.
 *
 * Instead of DELETE, every protected table row is marked with:
 *   deleted_at   ISO timestamp of deletion
 *   deleted_by   user id / system id that performed the delete
 *   delete_reason  written reason (required)
 *
 * Soft-deleted rows are hidden from normal UI queries (filters that
 * exclude deleted_at IS NOT NULL) but remain in the table and can be
 * restored by the owner at any time via the Restore Center.
 *
 * @module ivx-soft-delete
 */
export const IVX_SOFT_DELETE_MARKER = 'ivx-soft-delete-2026-07-06';
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
const SAFE_TABLE_RE = /^[a-z_][a-z0-9_]*$/;
const SAFE_PK_RE = /^[a-z_][a-z0-9_]*$/;
/**
 * Soft-delete a single row by setting deleted_at/deleted_by/delete_reason.
 * The row is NOT removed from the table — it is only marked deleted.
 */
export async function softDeleteRow(req) {
    const timestamp = new Date().toISOString();
    const table = req.table.toLowerCase();
    const pk = (req.pkColumn ?? 'id').toLowerCase();
    if (!SAFE_TABLE_RE.test(table)) {
        return { ok: false, table: req.table, recordId: req.recordId, status: 400, error: 'invalid_table_name', timestamp };
    }
    if (!SAFE_PK_RE.test(pk)) {
        return { ok: false, table, recordId: req.recordId, status: 400, error: 'invalid_pk_column', timestamp };
    }
    if (!req.reason.trim()) {
        return { ok: false, table, recordId: req.recordId, status: 400, error: 'reason_required', timestamp };
    }
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return { ok: false, table, recordId: req.recordId, status: 500, error: `not_configured: ${supa.missing.join(', ')}`, timestamp };
    }
    try {
        const res = await fetch(`${supa.url}/rest/v1/${table}?${pk}=eq.${encodeURIComponent(String(req.recordId))}`, {
            method: 'PATCH',
            headers: {
                apikey: supa.key,
                Authorization: `Bearer ${supa.key}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
            },
            body: JSON.stringify({
                deleted_at: timestamp,
                deleted_by: req.deletedBy,
                delete_reason: req.reason.slice(0, 1000),
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { ok: false, table, recordId: req.recordId, status: res.status, error: `HTTP_${res.status}: ${body.slice(0, 200)}`, timestamp };
        }
        return { ok: true, table, recordId: req.recordId, status: 200, error: null, timestamp };
    }
    catch (err) {
        return { ok: false, table, recordId: req.recordId, status: 0, error: err instanceof Error ? err.message : 'network_error', timestamp };
    }
}
/**
 * Restore a soft-deleted row by clearing deleted_at/deleted_by/delete_reason.
 */
export async function restoreSoftDeletedRow(req) {
    const timestamp = new Date().toISOString();
    const table = req.table.toLowerCase();
    const pk = (req.pkColumn ?? 'id').toLowerCase();
    if (!SAFE_TABLE_RE.test(table)) {
        return { ok: false, table: req.table, recordId: req.recordId, status: 400, error: 'invalid_table_name', timestamp };
    }
    if (!SAFE_PK_RE.test(pk)) {
        return { ok: false, table, recordId: req.recordId, status: 400, error: 'invalid_pk_column', timestamp };
    }
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return { ok: false, table, recordId: req.recordId, status: 500, error: `not_configured: ${supa.missing.join(', ')}`, timestamp };
    }
    try {
        const res = await fetch(`${supa.url}/rest/v1/${table}?${pk}=eq.${encodeURIComponent(String(req.recordId))}`, {
            method: 'PATCH',
            headers: {
                apikey: supa.key,
                Authorization: `Bearer ${supa.key}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
            },
            body: JSON.stringify({
                deleted_at: null,
                deleted_by: null,
                delete_reason: null,
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { ok: false, table, recordId: req.recordId, status: res.status, error: `HTTP_${res.status}: ${body.slice(0, 200)}`, timestamp };
        }
        return { ok: true, table, recordId: req.recordId, status: 200, error: null, timestamp };
    }
    catch (err) {
        return { ok: false, table, recordId: req.recordId, status: 0, error: err instanceof Error ? err.message : 'network_error', timestamp };
    }
}
/**
 * List all soft-deleted rows in a table (deleted_at IS NOT NULL).
 */
export async function listSoftDeleted(table, limit = 200) {
    const t = table.toLowerCase();
    if (!SAFE_TABLE_RE.test(t)) {
        return { table, records: [], count: 0, error: 'invalid_table_name' };
    }
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return { table: t, records: [], count: 0, error: `not_configured: ${supa.missing.join(', ')}` };
    }
    try {
        const cap = Math.max(1, Math.min(1000, limit));
        const res = await fetch(`${supa.url}/rest/v1/${t}?deleted_at=not.is.null&order=deleted_at.desc&limit=${cap}`, {
            headers: { apikey: supa.key, Authorization: `Bearer ${supa.key}`, Accept: 'application/json' },
        });
        if (res.status === 404)
            return { table: t, records: [], count: 0, error: 'TABLE_NOT_FOUND' };
        if (!res.ok)
            return { table: t, records: [], count: 0, error: `HTTP_${res.status}` };
        const rows = (await res.json());
        return { table: t, records: rows, count: rows.length, error: null };
    }
    catch (err) {
        return { table: t, records: [], count: 0, error: err instanceof Error ? err.message : 'network_error' };
    }
}
