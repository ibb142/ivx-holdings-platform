/**
 * IVX Supabase data_vault table — captures every pre-mutation record to a
 * dedicated Supabase table BEFORE any UPDATE/DELETE touches it, so the owner
 * can restore individual records from inside Supabase itself (not only from
 * the file-based vault).
 *
 * Schema (created via ensureDataVaultTable):
 *   CREATE TABLE IF NOT EXISTS public.data_vault (
 *     id BIGSERIAL PRIMARY KEY,
 *     vault_id TEXT NOT NULL,
 *     table_name TEXT NOT NULL,
 *     record_id TEXT,
 *     action TEXT NOT NULL,            -- 'UPDATE' | 'DELETE' | 'TRUNCATE'
 *     old_data JSONB,
 *     new_data JSONB,
 *     user_id TEXT,
 *     reason TEXT,
 *     hash TEXT,
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 *
 * @module ivx-vault-table
 */
import { createHash } from 'node:crypto';
export const IVX_VAULT_TABLE_MARKER = 'ivx-vault-table-2026-07-06';
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
function makeVaultId() {
    return `vault-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function hashVaultEntry(input) {
    return createHash('sha256')
        .update(JSON.stringify({
        table: input.table,
        recordId: input.recordId,
        action: input.action,
        oldData: input.oldData,
        newData: input.newData ?? null,
        ts: Date.now(),
    }))
        .digest('hex');
}
/**
 * Capture a record into the data_vault Supabase table. This should be called
 * BEFORE any destructive or mutating operation on protected tables.
 */
export async function captureToVault(input) {
    const vaultId = makeVaultId();
    const table = input.table.toLowerCase();
    if (!SAFE_TABLE_RE.test(table)) {
        return { ok: false, vaultId, status: 400, error: 'invalid_table_name' };
    }
    if (!input.reason.trim()) {
        return { ok: false, vaultId, status: 400, error: 'reason_required' };
    }
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return { ok: false, vaultId, status: 500, error: `not_configured: ${supa.missing.join(', ')}` };
    }
    const hash = hashVaultEntry(input);
    try {
        const res = await fetch(`${supa.url}/rest/v1/data_vault`, {
            method: 'POST',
            headers: {
                apikey: supa.key,
                Authorization: `Bearer ${supa.key}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
            },
            body: JSON.stringify({
                vault_id: vaultId,
                table_name: table,
                record_id: input.recordId === null ? null : String(input.recordId),
                action: input.action,
                old_data: input.oldData,
                new_data: input.newData ?? null,
                user_id: input.userId,
                reason: input.reason.slice(0, 1000),
                hash,
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { ok: false, vaultId, status: res.status, error: `HTTP_${res.status}: ${body.slice(0, 200)}` };
        }
        return { ok: true, vaultId, status: 201, error: null };
    }
    catch (err) {
        return { ok: false, vaultId, status: 0, error: err instanceof Error ? err.message : 'network_error' };
    }
}
/**
 * List data_vault entries, optionally filtered by table.
 */
export async function listVaultEntries(opts = {}) {
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return { ok: false, entries: [], count: 0, status: 500, error: `not_configured: ${supa.missing.join(', ')}` };
    }
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    let query = `${supa.url}/rest/v1/data_vault?order=created_at.desc&limit=${limit}`;
    if (opts.table) {
        const t = opts.table.toLowerCase();
        if (!SAFE_TABLE_RE.test(t)) {
            return { ok: false, entries: [], count: 0, status: 400, error: 'invalid_table_name' };
        }
        query += `&table_name=eq.${encodeURIComponent(t)}`;
    }
    try {
        const res = await fetch(query, {
            headers: { apikey: supa.key, Authorization: `Bearer ${supa.key}`, Accept: 'application/json' },
        });
        if (res.status === 404)
            return { ok: false, entries: [], count: 0, status: 404, error: 'data_vault_table_not_found' };
        if (!res.ok)
            return { ok: false, entries: [], count: 0, status: res.status, error: `HTTP_${res.status}` };
        const rows = (await res.json());
        return { ok: true, entries: rows, count: rows.length, status: 200, error: null };
    }
    catch (err) {
        return { ok: false, entries: [], count: 0, status: 0, error: err instanceof Error ? err.message : 'network_error' };
    }
}
/**
 * Restore a single record from a vault entry back into its original table.
 * Uses upsert (merge-duplicates) so the PK row is restored to its old_data state.
 */
export async function restoreFromVault(vaultId) {
    const supa = resolveSupabase();
    if (supa.missing.length > 0) {
        return { ok: false, status: 500, error: `not_configured: ${supa.missing.join(', ')}`, restoredTable: null, recordId: null };
    }
    try {
        const fetchRes = await fetch(`${supa.url}/rest/v1/data_vault?vault_id=eq.${encodeURIComponent(vaultId)}&limit=1`, { headers: { apikey: supa.key, Authorization: `Bearer ${supa.key}`, Accept: 'application/json' } });
        if (!resOk(fetchRes))
            return { ok: false, status: fetchRes.status, error: `fetch_failed_${fetchRes.status}`, restoredTable: null, recordId: null };
        const entries = (await fetchRes.json());
        if (entries.length === 0)
            return { ok: false, status: 404, error: 'vault_entry_not_found', restoredTable: null, recordId: null };
        const entry = entries[0];
        if (!entry.old_data)
            return { ok: false, status: 409, error: 'no_old_data_to_restore', restoredTable: entry.table_name, recordId: entry.record_id };
        const restoreRes = await fetch(`${supa.url}/rest/v1/${entry.table_name}`, {
            method: 'POST',
            headers: {
                apikey: supa.key,
                Authorization: `Bearer ${supa.key}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal,resolution=merge-duplicates',
            },
            body: JSON.stringify([entry.old_data]),
        });
        if (!resOk(restoreRes)) {
            const body = await restoreRes.text().catch(() => '');
            return { ok: false, status: restoreRes.status, error: `HTTP_${restoreRes.status}: ${body.slice(0, 200)}`, restoredTable: entry.table_name, recordId: entry.record_id };
        }
        return { ok: true, status: 200, error: null, restoredTable: entry.table_name, recordId: entry.record_id };
    }
    catch (err) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : 'network_error', restoredTable: null, recordId: null };
    }
}
function resOk(r) {
    return r.status >= 200 && r.status < 300;
}
