/**
 * IVX Zero Data Loss Migration Runner — 2026-07-06
 *
 * One-shot endpoint that executes the ivx-zero-data-loss-migration.sql
 * against the live Supabase database. Creates:
 *   - data_vault table
 *   - snapshot_metadata table
 *   - soft-delete columns (deleted_at, deleted_by, delete_reason) on all protected tables
 *   - immutable ledger trigger
 *
 * Owner-only. Idempotent — safe to run multiple times.
 *
 * @module ivx-zero-data-loss-migration
 */
import { ownerOnlyJson, ownerOnlyOptions, assertIVXOwnerOnly } from './owner-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const DEPLOYMENT_MARKER = 'ivx-zero-data-loss-migration-2026-07-06';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getOwnerTokenFromHeader(request) {
    return readTrimmed(request.headers.get('X-IVX-Owner-Token'));
}
function isMigrationAuthorized(request) {
    const token = getOwnerTokenFromHeader(request);
    if (!token)
        return false;
    const serviceToken = readTrimmed(process.env.IVX_OWNER_TOKEN);
    if (serviceToken && token === serviceToken)
        return true;
    // Also accept standard owner auth
    return false;
}
function getSupabaseProjectRef() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) || readTrimmed(process.env.SUPABASE_URL);
    if (!url)
        return '';
    const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
    return match ? match[1] ?? '' : '';
}
function getSupabaseDatabaseUrl() {
    const direct = readTrimmed(process.env.SUPABASE_DB_URL)
        || readTrimmed(process.env.DATABASE_URL)
        || readTrimmed(process.env.POSTGRES_URL);
    if (direct)
        return direct;
    const password = readTrimmed(process.env.SUPABASE_DB_PASSWORD);
    if (!password) {
        throw new Error('SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or SUPABASE_DB_PASSWORD is required.');
    }
    const projectRef = getSupabaseProjectRef();
    if (!projectRef) {
        throw new Error('Could not determine Supabase project ref from SUPABASE_URL.');
    }
    const dbHost = `db.${projectRef}.supabase.co`;
    const dbPort = '5432';
    const dbName = 'postgres';
    const dbUser = 'postgres';
    return `postgres://${encodeURIComponent(dbUser)}:${encodeURIComponent(password)}@${dbHost}:${dbPort}/${encodeURIComponent(dbName)}?sslmode=require&application_name=ivx_zero_data_loss_migration`;
}
const MIGRATION_SQL_PATH = path.resolve(process.cwd(), 'expo', 'supabase', 'ivx-zero-data-loss-migration.sql');
async function loadMigrationSql() {
    try {
        return await fs.readFile(MIGRATION_SQL_PATH, 'utf8');
    }
    catch {
        // Fallback: inline SQL (compact version)
        return `
CREATE TABLE IF NOT EXISTS public.data_vault (
  id BIGSERIAL PRIMARY KEY,
  vault_id TEXT NOT NULL UNIQUE,
  table_name TEXT NOT NULL,
  record_id TEXT,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  user_id TEXT,
  reason TEXT,
  hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_data_vault_table_name ON public.data_vault (table_name);
CREATE INDEX IF NOT EXISTS idx_data_vault_created_at ON public.data_vault (created_at DESC);
ALTER TABLE public.data_vault ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "data_vault_service_role_all" ON public.data_vault
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.snapshot_metadata (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE,
  tables JSONB NOT NULL,
  total_rows BIGINT NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  triggered_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.snapshot_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "snapshot_metadata_service_role_all" ON public.snapshot_metadata
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
`;
    }
}
export async function handleZeroDataLossMigration(request) {
    const timestamp = new Date().toISOString();
    const startedAt = Date.now();
    const steps = [];
    // Auth: owner token header OR standard owner auth
    const headerToken = getOwnerTokenFromHeader(request);
    const serviceToken = readTrimmed(process.env.IVX_OWNER_TOKEN);
    const headerAuthed = headerToken && serviceToken && headerToken === serviceToken;
    if (!headerAuthed) {
        try {
            await assertIVXOwnerOnly(request);
        }
        catch (err) {
            return new Response(JSON.stringify({ ok: false, error: 'owner_auth_required', detail: err instanceof Error ? err.message : 'auth_failed' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
    }
    // Step 1: Load migration SQL
    const step1Start = Date.now();
    let sqlContent;
    try {
        sqlContent = await loadMigrationSql();
        steps.push({ step: 'load_migration_sql', ok: true, detail: `Loaded ${sqlContent.length} chars`, durationMs: Date.now() - step1Start });
    }
    catch (err) {
        steps.push({ step: 'load_migration_sql', ok: false, detail: err instanceof Error ? err.message : 'failed', durationMs: Date.now() - step1Start });
        const result = { marker: DEPLOYMENT_MARKER, timestamp, ok: false, steps, error: 'load_failed', durationMs: Date.now() - startedAt };
        return ownerOnlyJson(result, 500);
    }
    // Step 2: Connect to Postgres
    const step2Start = Date.now();
    let connectionString;
    try {
        connectionString = getSupabaseDatabaseUrl();
        steps.push({ step: 'resolve_db_url', ok: true, detail: 'Database URL resolved', durationMs: Date.now() - step2Start });
    }
    catch (err) {
        steps.push({ step: 'resolve_db_url', ok: false, detail: err instanceof Error ? err.message : 'failed', durationMs: Date.now() - step2Start });
        const result = { marker: DEPLOYMENT_MARKER, timestamp, ok: false, steps, error: 'no_db_url', durationMs: Date.now() - startedAt };
        return ownerOnlyJson(result, 500);
    }
    // Step 3: Execute migration
    const step3Start = Date.now();
    let pool = null;
    try {
        const pgModule = (await import('pg'));
        pool = new pgModule.Pool({
            connectionString,
            ssl: { rejectUnauthorized: false },
            application_name: 'ivx_zero_data_loss_migration',
            max: 1,
            idleTimeoutMillis: 5_000,
            connectionTimeoutMillis: 15_000,
        });
        const client = await pool.connect();
        try {
            await client.query(sqlContent);
            steps.push({ step: 'execute_migration', ok: true, detail: 'All SQL statements executed successfully', durationMs: Date.now() - step3Start });
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : 'unknown error';
        steps.push({ step: 'execute_migration', ok: false, detail: errMsg.slice(0, 500), durationMs: Date.now() - step3Start });
        const result = { marker: DEPLOYMENT_MARKER, timestamp, ok: false, steps, error: errMsg.slice(0, 500), durationMs: Date.now() - startedAt };
        if (pool) {
            try {
                await pool.end();
            }
            catch { /* ignore */ }
        }
        return ownerOnlyJson(result, 500);
    }
    finally {
        if (pool) {
            try {
                await pool.end();
            }
            catch { /* ignore */ }
        }
    }
    // Step 4: Verify tables exist
    const step4Start = Date.now();
    try {
        const pgModule = (await import('pg'));
        pool = new pgModule.Pool({
            connectionString,
            ssl: { rejectUnauthorized: false },
            application_name: 'ivx_zero_data_loss_verify',
            max: 1,
            idleTimeoutMillis: 5_000,
            connectionTimeoutMillis: 10_000,
        });
        const client = await pool.connect();
        try {
            const verifyRes = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('data_vault','snapshot_metadata')
        ORDER BY table_name
      `);
            const found = verifyRes.rows.map((r) => r.table_name);
            const expected = ['data_vault', 'snapshot_metadata'];
            const allFound = expected.every((t) => found.includes(t));
            steps.push({
                step: 'verify_tables',
                ok: allFound,
                detail: allFound ? `Verified: ${found.join(', ')}` : `Missing: ${expected.filter((t) => !found.includes(t)).join(', ')}`,
                durationMs: Date.now() - step4Start,
            });
            // Check soft-delete columns on members
            const colRes = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'members'
        AND column_name IN ('deleted_at','deleted_by','delete_reason')
      `);
            const cols = colRes.rows.map((r) => r.column_name);
            const expectedCols = ['deleted_at', 'deleted_by', 'delete_reason'];
            const colsOk = expectedCols.every((c) => cols.includes(c));
            steps.push({
                step: 'verify_soft_delete_columns',
                ok: colsOk,
                detail: colsOk ? 'members has deleted_at, deleted_by, delete_reason' : `Missing: ${expectedCols.filter((c) => !cols.includes(c)).join(', ')}`,
                durationMs: 0,
            });
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        steps.push({ step: 'verify_tables', ok: false, detail: err instanceof Error ? err.message : 'verify failed', durationMs: Date.now() - step4Start });
    }
    finally {
        if (pool) {
            try {
                await pool.end();
            }
            catch { /* ignore */ }
        }
    }
    const allOk = steps.every((s) => s.ok);
    const result = {
        marker: DEPLOYMENT_MARKER,
        timestamp,
        ok: allOk,
        steps,
        error: allOk ? null : 'some_steps_failed',
        durationMs: Date.now() - startedAt,
    };
    return ownerOnlyJson(result, allOk ? 200 : 500);
}
export function zeroDataLossMigrationOptions() {
    return ownerOnlyOptions();
}
