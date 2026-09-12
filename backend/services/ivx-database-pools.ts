import { Pool } from 'pg';
import { observePostgresPoolErrors, queryWithPostgresDeadline } from './ivx-postgres-deadline';
import { supabasePostgresTls, withoutPostgresUrlTlsOptions } from './ivx-supabase-postgres-tls';

let apiPool: Pool | null = null;
export type WorkerLane = 'tasks' | 'assignment' | 'heartbeat' | 'repair';
const workerPools = new Map<WorkerLane, Pool>();
type ObserverLane = 'telemetry' | 'presence';
const observerPools = new Map<ObserverLane, Pool>();

/** Separate process-local budgets, not a reservation of server/pooler slots.
 * Across replicas the provider must accommodate the sum of these ceilings. */
function createPool(kind: 'api' | `worker_${WorkerLane}` | ObserverLane, env: NodeJS.ProcessEnv): Pool {
  const connectionString = (env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_POOLER_URL || '').trim();
  if (!connectionString) throw new Error('direct_postgres_not_configured');
  const isTestEnvironment = env.NODE_ENV === 'test' || env.CI === 'true';
  // Reserve assignment, heartbeat and repair slots within the worker ceiling.
  // Telemetry and presence each retain an additional independent connection:
  // maximum across all pools is 12 in CI and 22 in production per process.
  const max = kind === 'api' ? (isTestEnvironment ? 6 : 12)
    : kind === 'worker_tasks' ? (isTestEnvironment ? 1 : 5) : 1;
  const pool = new Pool({
    connectionString: withoutPostgresUrlTlsOptions(connectionString), ssl: supabasePostgresTls(),
    application_name: `ivx_${kind}`, max,
    idleTimeoutMillis: 3000, connectionTimeoutMillis: 1500,
    query_timeout: 3500, statement_timeout: 2500,
  });
  observePostgresPoolErrors(pool, kind);
  console.info('[IVX POOL INITIALIZED]', { pool: kind, context: isTestEnvironment ? 'CI_SANDBOX' : 'PRODUCTION', max });
  // Even convenience reads must use a transaction-local server deadline when
  // connected through a transaction pooler. Mutations are never retried here.
  pool.query = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    queryWithPostgresDeadline<T>(pool, text, values);
  return pool;
}

export function getApiPool(env: NodeJS.ProcessEnv = process.env): Pool {
  return apiPool ??= createPool('api', env);
}
export function getWorkerPool(env: NodeJS.ProcessEnv = process.env, lane: WorkerLane = 'tasks'): Pool {
  const existing = workerPools.get(lane);
  if (existing) return existing;
  const pool = createPool(`worker_${lane}`, env);
  workerPools.set(lane, pool);
  return pool;
}
export function getObserverPool(env: NodeJS.ProcessEnv = process.env, lane: ObserverLane): Pool {
  const existing = observerPools.get(lane);
  if (existing) return existing;
  const pool = createPool(lane, env);
  observerPools.set(lane, pool);
  return pool;
}
export function resetDatabasePoolsForTests(): void {
  const previous = [apiPool, ...workerPools.values(), ...observerPools.values()];
  apiPool = null; workerPools.clear(); observerPools.clear();
  for (const pool of previous) if (pool) void pool.end().catch(() => {});
}
