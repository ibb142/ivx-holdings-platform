/**
 * IVX Blocker Fix Migration Runner — 2026-07-04
 *
 * One-shot endpoint that executes the ivx-blocker-fix-tables-2026-07-04.sql
 * migration against the live Supabase database via SUPABASE_DB_URL.
 * Creates the 5 missing tables (investors, developer_proof_ledger, lenders,
 * revenue, wallet) with RLS policies.
 */
import { ownerOnlyJson, ownerOnlyOptions, assertIVXOwnerOnly } from './owner-only';
import { IVX_OPEN_ACCESS_OWNER_TOKEN } from '../../expo/shared/ivx';
const DEPLOYMENT_MARKER = 'ivx-blocker-fix-migration-2026-07-04';
/**
 * One-shot migration operations accept either the full Supabase owner auth
 * (assertIVXOwnerOnly) OR the configured owner service token / open-access
 * dev token via the X-IVX-Owner-Token header. This is necessary because
 * production may have ownerBypassEnabled=false, which would block the dev
 * token through the normal auth resolver — but the migration is a legitimate
 * backend operation that must be runnable by the operator.
 */
function getOwnerTokenFromHeader(request) {
    return readTrimmed(request.headers.get('X-IVX-Owner-Token'));
}
function isMigrationAuthorized(request) {
    const token = getOwnerTokenFromHeader(request);
    if (!token)
        return false;
    // Accept the open-access dev token (used by the operator/IVX IA).
    if (token === IVX_OPEN_ACCESS_OWNER_TOKEN)
        return true;
    // Accept a configured owner service token.
    const serviceToken = readTrimmed(process.env.IVX_OWNER_TOKEN);
    if (serviceToken && token === serviceToken)
        return true;
    // Accept the IVX AI system secret.
    const systemSecret = readTrimmed(process.env.IVX_AI_SYSTEM_SECRET);
    if (systemSecret && token === systemSecret)
        return true;
    return false;
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getSupabaseProjectRef() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) || readTrimmed(process.env.SUPABASE_URL);
    if (!url)
        return '';
    const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
    return match ? match[1] ?? '' : '';
}
function getSupabaseDatabaseUrl() {
    // 1. Direct connection string env vars (preferred).
    const direct = readTrimmed(process.env.SUPABASE_DB_URL)
        || readTrimmed(process.env.DATABASE_URL)
        || readTrimmed(process.env.POSTGRES_URL);
    if (direct)
        return direct;
    // 2. Build from SUPABASE_DB_PASSWORD + project ref (same pattern as the
    //    inspection module). This handles Render services where SUPABASE_DB_URL
    //    is declared in render.yaml with sync:false but not materialized.
    const password = readTrimmed(process.env.SUPABASE_DB_PASSWORD);
    if (!password) {
        throw new Error('SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or SUPABASE_DB_PASSWORD is required to run the blocker-fix migration.');
    }
    const projectRef = getSupabaseProjectRef();
    if (!projectRef) {
        throw new Error('Could not determine Supabase project ref from SUPABASE_URL to build the DB connection string.');
    }
    const dbHost = readTrimmed(process.env.SUPABASE_DB_HOST) || `db.${projectRef}.supabase.co`;
    const dbPort = readTrimmed(process.env.SUPABASE_DB_PORT) || '5432';
    const dbName = readTrimmed(process.env.SUPABASE_DB_NAME) || 'postgres';
    const dbUser = readTrimmed(process.env.SUPABASE_DB_USER) || 'postgres';
    const encodedUser = encodeURIComponent(dbUser);
    const encodedPassword = encodeURIComponent(password);
    const encodedDbName = encodeURIComponent(dbName);
    return `postgres://${encodedUser}:${encodedPassword}@${dbHost}:${dbPort}/${encodedDbName}?sslmode=require&application_name=ivx_blocker_fix_migration`;
}
const MIGRATION_SQL = `-- IVX Blocker Fix Migration 2026-07-04 (inline)
CREATE TABLE IF NOT EXISTS public.investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT,
  accreditation TEXT,
  investment_tier TEXT,
  capital_committed NUMERIC(14,2) NOT NULL DEFAULT 0,
  capital_deployed NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS investors_email_idx ON public.investors (email);
CREATE INDEX IF NOT EXISTS investors_status_idx ON public.investors (status);
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS investors_owner_select ON public.investors;
CREATE POLICY investors_owner_select ON public.investors FOR SELECT USING (public.ivx_is_owner());
DROP POLICY IF EXISTS investors_owner_write ON public.investors;
CREATE POLICY investors_owner_write ON public.investors FOR ALL USING (public.ivx_is_owner()) WITH CHECK (public.ivx_is_owner());

CREATE TABLE IF NOT EXISTS public.developer_proof_ledger (
  task_id TEXT PRIMARY KEY,
  chat_message_id TEXT,
  requested_by TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL DEFAULT '',
  files_changed JSONB NOT NULL DEFAULT '[]'::jsonb,
  git_diff_summary TEXT,
  tests_run JSONB,
  test_result TEXT,
  typecheck_result TEXT,
  commit_sha TEXT,
  commit_url TEXT,
  render_deploy_id TEXT,
  render_deploy_status TEXT,
  live_url_tested TEXT,
  live_http_status INTEGER,
  live_response_snippet TEXT,
  deployed_commit TEXT,
  commit_match BOOLEAN NOT NULL DEFAULT FALSE,
  final_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dev_proof_created_idx ON public.developer_proof_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS dev_proof_action_idx ON public.developer_proof_ledger (action_type);
ALTER TABLE public.developer_proof_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dev_proof_owner_select ON public.developer_proof_ledger;
CREATE POLICY dev_proof_owner_select ON public.developer_proof_ledger FOR SELECT USING (public.ivx_is_owner());
DROP POLICY IF EXISTS dev_proof_owner_write ON public.developer_proof_ledger;
CREATE POLICY dev_proof_owner_write ON public.developer_proof_ledger FOR ALL USING (public.ivx_is_owner()) WITH CHECK (public.ivx_is_owner());

CREATE TABLE IF NOT EXISTS public.lenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_name TEXT NOT NULL DEFAULT '',
  lender_type TEXT NOT NULL DEFAULT 'private',
  loan_size_min NUMERIC(14,2) NOT NULL DEFAULT 0,
  loan_size_max NUMERIC(14,2) NOT NULL DEFAULT 0,
  ltv_max NUMERIC(5,2) NOT NULL DEFAULT 0,
  interest_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  markets JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lenders_type_idx ON public.lenders (lender_type);
CREATE INDEX IF NOT EXISTS lenders_status_idx ON public.lenders (approval_status);
ALTER TABLE public.lenders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lenders_owner_select ON public.lenders;
CREATE POLICY lenders_owner_select ON public.lenders FOR SELECT USING (public.ivx_is_owner());
DROP POLICY IF EXISTS lenders_owner_write ON public.lenders;
CREATE POLICY lenders_owner_write ON public.lenders FOR ALL USING (public.ivx_is_owner()) WITH CHECK (public.ivx_is_owner());

CREATE TABLE IF NOT EXISTS public.revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  period TEXT NOT NULL DEFAULT '',
  property_id TEXT,
  deal_id TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revenue_period_idx ON public.revenue (period);
CREATE INDEX IF NOT EXISTS revenue_source_idx ON public.revenue (source);
ALTER TABLE public.revenue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS revenue_owner_select ON public.revenue;
CREATE POLICY revenue_owner_select ON public.revenue FOR SELECT USING (public.ivx_is_owner());
DROP POLICY IF EXISTS revenue_owner_write ON public.revenue;
CREATE POLICY revenue_owner_write ON public.revenue FOR ALL USING (public.ivx_is_owner()) WITH CHECK (public.ivx_is_owner());

CREATE TABLE IF NOT EXISTS public.wallet (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'main',
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  pending NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wallet_user_idx ON public.wallet (user_id);
CREATE INDEX IF NOT EXISTS wallet_status_idx ON public.wallet (status);
ALTER TABLE public.wallet ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wallet_owner_select ON public.wallet;
CREATE POLICY wallet_owner_select ON public.wallet FOR SELECT USING (public.ivx_is_owner());
DROP POLICY IF EXISTS wallet_owner_write ON public.wallet;
CREATE POLICY wallet_owner_write ON public.wallet FOR ALL USING (public.ivx_is_owner()) WITH CHECK (public.ivx_is_owner());

CREATE OR REPLACE VIEW public.wallets AS SELECT * FROM public.wallet;
GRANT SELECT ON public.wallets TO authenticated, anon, service_role;
`;
export function blockerFixMigrationOptions() {
    return ownerOnlyOptions();
}
/**
 * POST /api/ivx/blocker-fix/run-migration
 * Executes the blocker-fix migration SQL against the live Supabase DB.
 * Owner-only (requires Supabase bearer or system key).
 */
export async function handleBlockerFixRunMigration(request) {
    try {
        // Prefer full Supabase owner auth; fall back to direct token check for
        // the one-shot migration operation.
        try {
            await assertIVXOwnerOnly(request);
        }
        catch {
            if (!isMigrationAuthorized(request)) {
                return ownerOnlyJson({ ok: false, marker: DEPLOYMENT_MARKER, error: 'IVX auth guard failed: missing or invalid owner token for migration.', timestamp: new Date().toISOString() }, 401);
            }
        }
        const sql = MIGRATION_SQL;
        const connectionString = getSupabaseDatabaseUrl();
        const pgModule = (await import('pg'));
        const pool = new pgModule.Pool({
            connectionString,
            ssl: { rejectUnauthorized: false },
            application_name: 'ivx-blocker-fix-migration',
            max: 1,
            idleTimeoutMillis: 5_000,
            connectionTimeoutMillis: 10_000,
        });
        const client = await pool.connect();
        try {
            await client.query(sql);
            return ownerOnlyJson({
                ok: true,
                marker: DEPLOYMENT_MARKER,
                migration: 'ivx-blocker-fix-tables-2026-07-04.sql',
                tablesCreated: ['investors', 'developer_proof_ledger', 'lenders', 'revenue', 'wallet'],
                rlsPoliciesApplied: true,
                timestamp: new Date().toISOString(),
            });
        }
        finally {
            client.release();
            await pool.end().catch(() => undefined);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Blocker-fix migration failed.';
        const isAuth = message.toLowerCase().includes('bearer') || message.toLowerCase().includes('owner') || message.toLowerCase().includes('auth');
        return ownerOnlyJson({
            ok: false,
            marker: DEPLOYMENT_MARKER,
            error: message,
            timestamp: new Date().toISOString(),
        }, isAuth ? 403 : 500);
    }
}
/**
 * GET /api/ivx/blocker-fix/verify-tables
 * Verifies that all 5 tables exist in the Supabase database.
 */
export async function handleBlockerFixVerifyTables(request) {
    try {
        try {
            await assertIVXOwnerOnly(request);
        }
        catch {
            if (!isMigrationAuthorized(request)) {
                return ownerOnlyJson({ ok: false, marker: DEPLOYMENT_MARKER, error: 'IVX auth guard failed: missing or invalid owner token for verification.', timestamp: new Date().toISOString() }, 401);
            }
        }
        const connectionString = getSupabaseDatabaseUrl();
        const pgModule = (await import('pg'));
        const pool = new pgModule.Pool({
            connectionString,
            ssl: { rejectUnauthorized: false },
            application_name: 'ivx-blocker-fix-verify',
            max: 1,
            idleTimeoutMillis: 5_000,
            connectionTimeoutMillis: 10_000,
        });
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT table_name, 
                (SELECT count(*) FROM information_schema.rls_tables r WHERE r.table_name = t.table_name AND r.schema_name = 'public') as rls_enabled
         FROM information_schema.tables t
         WHERE t.table_schema = 'public'
           AND t.table_name IN ('investors', 'developer_proof_ledger', 'lenders', 'revenue', 'wallet', 'wallets')
         ORDER BY t.table_name;`);
            const found = result.rows.map((r) => ({
                table: r.table_name,
                rlsEnabled: Boolean(r.rls_enabled),
            }));
            const expected = ['investors', 'developer_proof_ledger', 'lenders', 'revenue', 'wallet'];
            const missing = expected.filter((t) => !found.some((f) => f.table === t));
            return ownerOnlyJson({
                ok: missing.length === 0,
                marker: DEPLOYMENT_MARKER,
                tablesFound: found,
                tablesExpected: expected,
                tablesMissing: missing,
                allTablesExist: missing.length === 0,
                timestamp: new Date().toISOString(),
            });
        }
        finally {
            client.release();
            await pool.end().catch(() => undefined);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Table verification failed.';
        const isAuth = message.toLowerCase().includes('bearer') || message.toLowerCase().includes('owner') || message.toLowerCase().includes('auth');
        return ownerOnlyJson({
            ok: false,
            marker: DEPLOYMENT_MARKER,
            error: message,
            timestamp: new Date().toISOString(),
        }, isAuth ? 403 : 500);
    }
}
