import { Pool } from 'pg';
import { observePostgresPoolErrors, queryWithPostgresDeadline } from './ivx-postgres-deadline';
import { supabasePostgresTls, withoutPostgresUrlTlsOptions } from './ivx-supabase-postgres-tls';

let apiPool: Pool | null = null;
export type WorkerLane = 'tasks' | 'assignment' | 'heartbeat' | 'repair';
const workerPools = new Map<WorkerLane, Pool>();
type ObserverLane = 'telemetry' | 'presence';
const observerPools = new Map<ObserverLane, Pool>();
let initializedBudget: ReturnType<typeof getDatabasePoolBudget> | null = null;

function positiveLimit(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`invalid_postgres_pool_limit:${key}`);
  }
  return Number(raw);
}

/** Configured client ceilings for this manager only, not a database-wide quota.
 * Keep five independent slots for assignment, heartbeat, repair and observers.
 * Account separately for replicas, other pool owners and Supabase services. */
export function getDatabasePoolBudget(env: NodeJS.ProcessEnv = process.env) {
  const isTest = env.NODE_ENV === 'test' || env.CI === 'true';
  const api = positiveLimit(env, 'IVX_PG_API_MAX_CONNECTIONS', isTest ? 6 : 12);
  const tasks = positiveLimit(env, 'IVX_PG_TASKS_MAX_CONNECTIONS', isTest ? 1 : 5);
  const processLimit = positiveLimit(env, 'IVX_PG_PROCESS_CONNECTION_LIMIT', isTest ? 12 : 22);
  const isolatedLanes = 5;
  const total = api + tasks + isolatedLanes;
  if (!Number.isSafeInteger(total) || total > processLimit) {
    throw new Error('postgres_pool_budget_exceeded');
  }
  return { api, tasks, isolatedLanes, total, processLimit };
}

/** Separate process-local budgets, not a reservation of server/pooler slots.
 * Across replicas the provider must accommodate the sum of these ceilings. */
function createPool(kind: 'api' | `worker_${WorkerLane}` | ObserverLane, env: NodeJS.ProcessEnv): Pool {
  const connectionString = (env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_POOLER_URL || '').trim();
  if (!connectionString) throw new Error('direct_postgres_not_configured');
  const isTestEnvironment = env.NODE_ENV === 'test' || env.CI === 'true';
  const budget = getDatabasePoolBudget(env);
  if (initializedBudget && JSON.stringify(initializedBudget) !== JSON.stringify(budget)) {
    throw new Error('postgres_pool_budget_changed_restart_required');
  }
  const max = kind === 'api' ? budget.api : kind === 'worker_tasks' ? budget.tasks : 1;
  const pool = new Pool({
    connectionString: withoutPostgresUrlTlsOptions(connectionString), ssl: supabasePostgresTls(),
    application_name: `ivx_${kind}`, max,
    idleTimeoutMillis: 3000, connectionTimeoutMillis: 1500,
    query_timeout: 3500, statement_timeout: 2500,
  });
  initializedBudget = budget;
  observePostgresPoolErrors(pool, kind);
  console.info('[IVX POOL INITIALIZED]', { pool: kind, context: isTestEnvironment ? 'CI_SANDBOX' : 'PRODUCTION', max,
    managedProcessCeiling: budget.total });
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
  apiPool = null; workerPools.clear(); observerPools.clear(); initializedBudget = null;
  for (const pool of previous) if (pool) void pool.end().catch(() => {});
}
