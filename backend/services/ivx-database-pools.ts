import { Pool } from 'pg';
import { observePostgresPoolErrors, queryWithPostgresDeadline } from './ivx-postgres-deadline';
import { supabasePostgresTls, withoutPostgresUrlTlsOptions } from './ivx-supabase-postgres-tls';

let apiPool: Pool | null = null;
let workerPool: Pool | null = null;

/** Separate process-local budgets, not a reservation of server/pooler slots.
 * Across replicas the provider must accommodate the sum of these ceilings. */
function createPool(kind: 'api' | 'worker', env: NodeJS.ProcessEnv): Pool {
  const connectionString = (env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_POOLER_URL || '').trim();
  if (!connectionString) throw new Error('direct_postgres_not_configured');
  const pool = new Pool({
    connectionString: withoutPostgresUrlTlsOptions(connectionString), ssl: supabasePostgresTls(),
    application_name: `ivx_${kind}`, max: kind === 'api' ? 12 : 8,
    idleTimeoutMillis: 5000, connectionTimeoutMillis: 2000,
    query_timeout: 3500, statement_timeout: 2500,
  });
  observePostgresPoolErrors(pool, kind);
  // Even convenience reads must use a transaction-local server deadline when
  // connected through a transaction pooler. Mutations are never retried here.
  pool.query = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    queryWithPostgresDeadline<T>(pool, text, values);
  return pool;
}

export function getApiPool(env: NodeJS.ProcessEnv = process.env): Pool {
  return apiPool ??= createPool('api', env);
}
export function getWorkerPool(env: NodeJS.ProcessEnv = process.env): Pool {
  return workerPool ??= createPool('worker', env);
}
export function resetDatabasePoolsForTests(): void {
  const previous = [apiPool, workerPool];
  apiPool = null; workerPool = null;
  for (const pool of previous) if (pool) void pool.end().catch(() => {});
}
