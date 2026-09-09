import { Client, type ClientConfig } from 'pg';
import { supabasePostgresTls } from './ivx-supabase-postgres-tls';

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
  // A dedicated, short-lived connection cannot wait behind the failed task pool.
  return { host: db.hostname, port: Number(db.port || 5432), user,
    password: decodeURIComponent(db.password), database: 'postgres',
    ssl: supabasePostgresTls(), connectionTimeoutMillis: 3_000,
    query_timeout: 3_000, statement_timeout: 3_000,
    application_name: 'ivx_owner_stop_read' };
}

export async function readEmergencyStopPostgres(): Promise<unknown> {
  const client = new Client(emergencyStopPostgresConfig());
  // A connection error may also arrive while the client is idle before teardown.
  client.on('error', () => {});
  try {
    await client.connect();
    const result = await client.query(
      'SELECT control_name, active, reason, updated_by, updated_at FROM public.ivx_agent_controls WHERE control_name = $1 LIMIT 2',
      ['emergency_stop'],
    );
    if (result.rows.length !== 1) throw new Error('owner_control_direct_postgres_row_missing_or_duplicate');
    return result.rows;
  } finally {
    await client.end();
  }
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
