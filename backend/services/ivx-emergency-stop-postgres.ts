import { Pool, type ClientConfig } from 'pg';
import { createHash } from 'node:crypto';
import { supabasePostgresTls } from './ivx-supabase-postgres-tls';
import { observePostgresPoolErrors, queryWithPostgresDeadline } from './ivx-postgres-deadline';

let ownerReadPool: Pool | null = null;
let poolBinding: string | null = null;
let snapshotReadInFlight: Promise<OwnerControlSnapshot> | null = null;

type OwnerControlSnapshot = {
  emergencyRows: unknown[];
  campaignDocuments: unknown[];
};

type OwnerControlSnapshotRow = {
  emergency_rows: unknown;
  campaign_documents: unknown;
};

/** Only the same Supabase project may answer an owner-control read. */
export function emergencyStopPostgresConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const rest = new URL((env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').trim());
  const project = /^([a-z0-9]+)\.supabase\.co$/.exec(rest.hostname)?.[1];
  const raw = [env.SUPABASE_DB_URL, env.DATABASE_URL, env.POSTGRES_URL, env.SUPABASE_POOLER_URL]
    .find(value => value?.trim())?.trim();
  if (!project || !raw) throw new Error('owner_control_direct_postgres_not_configured');
  const db = new URL(raw);
  const user = decodeURIComponent(db.username);
  const sameProject = db.hostname === `db.${project}.supabase.co`
    || (db.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${project}`);
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !sameProject
    || !db.password || !user || db.pathname !== '/postgres') {
    throw new Error('owner_control_direct_postgres_project_mismatch');
  }
  // Explicit fields prevent URL sslmode parameters from overriding verified TLS.
  // The reader below has its own bounded pool, independent of task/feed traffic.
  return { host: db.hostname, port: Number(db.port || 5432), user,
    password: decodeURIComponent(db.password), database: 'postgres',
    ssl: supabasePostgresTls(), connectionTimeoutMillis: 20_000,
    query_timeout: 3_000, statement_timeout: 3_000,
    application_name: 'ivx_owner_stop_read' };
}

function getOwnerReadPool(): Pool {
  // Validate every request, including concurrent reads, before reusing a pool.
  const config = emergencyStopPostgresConfig();
  const binding = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if (ownerReadPool && binding !== poolBinding) throw new Error('owner_control_postgres_binding_changed');
  if (!ownerReadPool) {
    ownerReadPool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 1500, idleTimeoutMillis: 3000 });
    poolBinding = binding;
    observePostgresPoolErrors(ownerReadPool, 'owner_control');
  }
  return ownerReadPool;
}

async function readOwnerControlSnapshotPostgres(): Promise<OwnerControlSnapshot> {
  const pool = getOwnerReadPool();
  if (snapshotReadInFlight) return snapshotReadInFlight;
  // The truth snapshot requests campaign control and emergency stop in
  // parallel. A max:1 safety pool cannot service two independent fallbacks
  // within the same two-second deadline under connection pressure. Read both
  // small authoritative documents in one transaction and share only that
  // pending read; a settled permission is never cached or reused.
  const pending = (async () => {
    const result = await queryWithPostgresDeadline<OwnerControlSnapshotRow>(pool, `SELECT COALESCE((
          SELECT jsonb_agg(to_jsonb(control_rows))
          FROM (
            SELECT control_name, active, reason, updated_by, updated_at
            FROM public.ivx_agent_controls
            WHERE control_name = 'emergency_stop'
            LIMIT 2
          ) control_rows
        ), '[]'::jsonb) AS emergency_rows,
        COALESCE((
          SELECT jsonb_agg(document_rows.value)
          FROM (
            SELECT value
            FROM public.ivx_durable_documents
            WHERE doc_key = 'app-completion/campaign-state.json'
            LIMIT 2
          ) document_rows
        ), '[]'::jsonb) AS campaign_documents
    `, [], 'assignment');
    if (result.rows.length !== 1) throw new Error('owner_control_direct_postgres_snapshot_missing_or_duplicate');
    const row = result.rows[0];
    if (!Array.isArray(row.emergency_rows) || !Array.isArray(row.campaign_documents)) {
      throw new Error('owner_control_direct_postgres_snapshot_malformed');
    }
    return {
      emergencyRows: structuredClone(row.emergency_rows),
      campaignDocuments: structuredClone(row.campaign_documents),
    };
  })();
  snapshotReadInFlight = pending;
  try {
    return await pending;
  } finally {
    if (snapshotReadInFlight === pending) snapshotReadInFlight = null;
  }
}

export async function readEmergencyStopPostgres(): Promise<unknown> {
  const snapshot = await readOwnerControlSnapshotPostgres();
  if (snapshot.emergencyRows.length !== 1) {
    throw new Error('owner_control_direct_postgres_row_missing_or_duplicate');
  }
  return snapshot.emergencyRows;
}

/** Read only the canonical campaign control document; never create or repair it. */
export async function readCampaignControlPostgres(): Promise<unknown> {
  const snapshot = await readOwnerControlSnapshotPostgres();
  if (snapshot.campaignDocuments.length !== 1) {
    throw new Error('owner_control_direct_postgres_document_missing_or_duplicate');
  }
  return structuredClone(snapshot.campaignDocuments[0]);
}

export async function resetEmergencyStopPoolForTests(): Promise<void> {
  const previous = ownerReadPool;
  ownerReadPool = null; poolBinding = null; snapshotReadInFlight = null;
  if (previous) await previous.end();
}

export function emergencyStopReadCanFailOver(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = /HTTP (\d{3})/.exec(error.message)?.[1];
  if (status) return /^5\d\d$/.test(status);
  const cause = error.cause as { code?: unknown } | undefined;
  return /TimeoutError|AbortError/.test(error.name)
    || /timeout|timed out|fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED/i.test(error.message)
    || ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED'].includes(String(cause?.code));
}
