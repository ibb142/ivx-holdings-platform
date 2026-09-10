/**
 * PostgreSQL row store for the 112-agent autonomous queue.
 *
 * Every mutating operation is performed by a database RPC. The claim RPC uses
 * FOR UPDATE SKIP LOCKED, so overlapping Render processes cannot lease the same
 * task. A configured same-project PostgreSQL connection is selected before
 * execution; otherwise PostgREST is used. Mutations never replay across transports.
 */
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { EventEmitter } from 'node:events';
import { queryWithPostgresDeadline } from './ivx-postgres-deadline';
import { emergencyStopPostgresConfig } from './ivx-emergency-stop-postgres';
import { supabasePostgresTls, withoutPostgresUrlTlsOptions } from './ivx-supabase-postgres-tls';
import { decideRetry, isTransientFailure, retryAfterMs, RetryQuota } from './ivx-retry-policy';
import type { FleetLeaseRequest, FleetLeaseResult, FleetTaskLeaseIdentity, FleetTaskMutationResult, Task, TaskState } from './ivx-autonomous-task-engine';

export const IVX_POSTGRES_AUTONOMOUS_TASK_STORE_MARKER = 'ivx-postgres-autonomous-task-store-2026-09-08-current-work-v3-direct-failover';
const DEFAULT_TIMEOUT_MS = 30_000;
const TRUTH_TIMEOUT_MS = 8_000;
const DEFAULT_LEASE_SECONDS = 120;
const TASK_READ_CACHE_TTL_MS = 1_500;
const BOOT_NONCE = randomUUID().slice(0, 12);
let taskReadCache: { value: Task[]; at: number } | null = null;
let taskReadInFlight: Promise<Task[]> | null = null;
const currentReadsInFlight = new Map<string, Promise<Task[]>>();
let taskMutationRevision = 0;
let directPool: Pool | null = null;
let telemetryPool: Pool | null = null;
let presencePool: Pool | null = null;
let repairPool: Pool | null = null;
const upstreamRetryQuota = new RetryQuota();

type AtomicCreateResult = { ok: boolean; task: Task | null; duplicate: boolean; error: string | null };
type AtomicCasResult = { ok: boolean; task: Task | null; error: string | null };
type RestTaskRow = { payload: Task };
export type AtomicFleetLeaseRow = { taskId: string; idempotencyKey: string; state: TaskState; assignedAgentNumber: number | null; leaseHolder: string; workerInstanceId: string | null; lastHeartbeatAt: string; leaseExpiresAt: string | null };

export function resetPostgresAutonomousTaskStoreForTests(): void { taskReadCache = null; taskReadInFlight = null; currentReadsInFlight.clear(); taskMutationRevision = 0; directPool = null; telemetryPool = null; presencePool = null; repairPool = null; }
function trimmed(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function supabaseUrl(env: NodeJS.ProcessEnv = process.env): string { return trimmed(env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL).replace(/\/+$/, ''); }
function serviceRoleKey(env: NodeJS.ProcessEnv = process.env): string { return trimmed(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY); }
function directDbUrl(env: NodeJS.ProcessEnv = process.env): string { return trimmed(env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_POOLER_URL); }
export function postgresAtomicQueueSelected(env: NodeJS.ProcessEnv = process.env): boolean { return trimmed(env.IVX_AUTONOMOUS_QUEUE_BACKEND).toLowerCase() === 'postgres_atomic'; }
export function postgresAtomicQueueConfigured(env: NodeJS.ProcessEnv = process.env): boolean { return postgresAtomicQueueSelected(env) && Boolean((supabaseUrl(env) && serviceRoleKey(env)) || directDbUrl(env)); }
export function autonomousWorkerInstanceId(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = trimmed(env.IVX_AUTONOMOUS_WORKER_INSTANCE_ID || env.IVX_INTERNAL_WORKER_ID);
  const service = trimmed(env.RENDER_SERVICE_ID || env.RENDER_SERVICE_NAME) || 'local';
  const instance = trimmed(env.RENDER_INSTANCE_ID || env.HOSTNAME) || hostname() || 'unknown-host';
  // A configured name identifies a fleet, never a process. Preserve the unique
  // suffix even when a long prefix is configured on every Render replica.
  return `${(explicit || service).slice(0, 100)}:${instance.slice(0, 90)}:${process.pid}:${BOOT_NONCE}`;
}
export function preferDirectTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  try { emergencyStopPostgresConfig(env); return true; } catch { return false; }
}
function autonomousLeaseSeconds(env: NodeJS.ProcessEnv = process.env): number { const configured = Number.parseInt(env.IVX_AUTONOMOUS_LEASE_SECONDS ?? '', 10); return Number.isFinite(configured) ? Math.max(60, Math.min(300, configured)) : DEFAULT_LEASE_SECONDS; }
function headers(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const key = serviceRoleKey(env); if (!key || !supabaseUrl(env)) throw new Error('postgres_atomic queue is missing Supabase URL or service-role credentials');
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' };
}
function externalError(payload: unknown, fallback: string): string { if (payload && typeof payload === 'object') { const record = payload as Record<string, unknown>; const candidate = record.message ?? record.error ?? record.details; if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 320); } return fallback; }
async function parsePayload(response: Response): Promise<unknown> { const text = await response.text(); if (!text) return null; try { return JSON.parse(text) as unknown; } catch { return { message: text.slice(0, 320) }; } }
type PoolPurpose = 'tasks' | 'telemetry' | 'presence' | 'repair';
function getDirectPool(env: NodeJS.ProcessEnv = process.env, purpose: PoolPurpose = 'tasks'): Pool {
  const connectionString = directDbUrl(env);
  if (!connectionString) throw new Error('direct_postgres_not_configured');
  const existing = purpose === 'repair' ? repairPool : purpose === 'presence' ? presencePool : purpose === 'telemetry' ? telemetryPool : directPool;
  if (existing) return existing;
  // Both mutations and aggregate monitoring can occupy their entire pool.
  // Reserve a separate connection for compact process reads and sample writes.
  const pool = new Pool({ connectionString: withoutPostgresUrlTlsOptions(connectionString), ssl: supabasePostgresTls(),
    max: purpose === 'tasks' ? 4 : 1, application_name: `ivx_${purpose}`,
    idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000, query_timeout: 5_000, statement_timeout: 5_000 });
  if (purpose === 'repair') {
    // Observe both idle and checked-out connection errors. Query promises still
    // reject, destroy their failed connection, and never replay a mutation.
    const events = pool as Pool & EventEmitter;
    events.on('error', () => console.error('[IVX repair queue] PostgreSQL connection unavailable'));
    events.on('connect', (client: EventEmitter) => client.on('error', () => {}));
    repairPool = pool;
  } else if (purpose === 'presence') presencePool = pool; else if (purpose === 'telemetry') telemetryPool = pool; else directPool = pool;
  return pool;
}
const DIRECT_RPC_ARGS: Record<string, string[]> = {
  ivx_autonomous_tasks_create_batch: ['p_tasks'],
  ivx_autonomous_tasks_claim_batch: ['p_requests', 'p_worker_instance_id', 'p_lease_seconds'],
  ivx_autonomous_tasks_start_batch: ['p_leases', 'p_worker_instance_id', 'p_lease_seconds'],
  ivx_autonomous_tasks_heartbeat_batch: ['p_leases', 'p_worker_instance_id', 'p_lease_seconds'],
  ivx_autonomous_tasks_release_worker: ['p_worker_instance_id'],
  ivx_autonomous_task_compare_and_set: ['p_task', 'p_expected_states', 'p_lease_holder', 'p_worker_instance_id', 'p_event_type'],
  ivx_autonomous_tasks_link_objective: ['p_objective_id'],
  ivx_fleet_dashboard_observation: [],
  ivx_senior_queue_patch: ['p_changes'],
  ivx_senior_queue_claim: ['p_job_id', 'p_worker_instance_id', 'p_resume'],
  ivx_senior_ledger_put: ['p_result'],
};
async function directRpc<T>(name: string, body: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const args = DIRECT_RPC_ARGS[name];
  if (!args) throw new Error(`direct_postgres_rpc_not_allowed:${name}`);
  const casts: Record<string, string> = {
    p_tasks: 'jsonb', p_requests: 'jsonb', p_leases: 'jsonb', p_task: 'jsonb', p_expected_states: 'jsonb',
    p_changes: 'jsonb', p_result: 'jsonb', p_resume: 'boolean',
    p_worker_instance_id: 'text', p_lease_holder: 'text', p_event_type: 'text', p_objective_id: 'text', p_lease_seconds: 'integer',
  };
  const placeholders = args.map((key, index) => `$${index + 1}::${casts[key] ?? 'text'}`).join(', ');
  const values = args.map((key) => {
    const value = body[key];
    if (casts[key] === 'jsonb' && value !== null && value !== undefined) return JSON.stringify(value);
    return value ?? null;
  });
  const pool = getDirectPool(env, name.startsWith('ivx_senior_') ? 'repair' : name === 'ivx_fleet_dashboard_observation' ? 'telemetry' : 'tasks');
  const result = await queryWithPostgresDeadline<{ result: T }>(pool, `select public.${name}(${placeholders}) as result`, values);
  if (!result.rows?.length) throw new Error(`direct_postgres_rpc_empty:${name}`);
  return result.rows[0].result as T;
}

type SeniorRpc = 'ivx_senior_queue_patch' | 'ivx_senior_queue_claim' | 'ivx_senior_ledger_put';
type SeniorDocumentKey = 'senior-developer-worker/queue.json' | 'senior-developer-worker/proof-ledger.json';
export async function seniorQueuePostgresRpc<T>(name: SeniorRpc, body: Record<string, unknown>): Promise<T> {
  emergencyStopPostgresConfig(); // Reject cross-project bindings before any query.
  if (!['ivx_senior_queue_patch', 'ivx_senior_queue_claim', 'ivx_senior_ledger_put'].includes(name)) throw new Error('Repair RPC not allowed');
  return directRpc<T>(name, body);
}
export async function readSeniorQueuePostgresDocument<T>(key: SeniorDocumentKey): Promise<T | null> {
  emergencyStopPostgresConfig();
  if (!['senior-developer-worker/queue.json', 'senior-developer-worker/proof-ledger.json'].includes(key)) throw new Error('Repair document not allowed');
  const result = await queryWithPostgresDeadline<{ value: T }>(getDirectPool(process.env, 'repair'),
    'select value from public.ivx_durable_documents where doc_key = $1 limit 1', [key]);
  return result.rows[0]?.value ?? null;
}
export async function appendSeniorProofPostgresEvent(event: Record<string, unknown>): Promise<void> {
  emergencyStopPostgresConfig();
  await queryWithPostgresDeadline(getDirectPool(process.env, 'repair'),
    'insert into public.ivx_durable_events(doc_key,event) values ($1,$2::jsonb)',
    ['senior-developer-worker/proof-ledger.json', JSON.stringify(event)]);
}
async function restRequest<T>(path: string, init: RequestInit, options: { timeoutMs?: number; attempts?: number; env?: NodeJS.ProcessEnv } = {}): Promise<T> {
  const env = options.env ?? process.env;
  const readOnly = !init.method || init.method === 'GET' || init.method === 'HEAD';
  const attempts = readOnly ? Math.max(1, Math.min(options.attempts ?? 2, 3)) : 1;
  const budgetMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    let status: number | undefined;
    let retryAfter = 0;
    try {
      const remaining = budgetMs - (Date.now() - started);
      if (remaining <= 0) throw new Error('postgres_atomic request time budget exhausted');
      const response = await fetch(`${supabaseUrl(env)}/rest/v1/${path}`, { ...init, headers: { ...headers(env), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(remaining) });
      status = response.status;
      retryAfter = retryAfterMs(response.headers.get('retry-after'));
      const payload = await parsePayload(response);
      if (!response.ok) throw new Error(`postgres_atomic HTTP ${status}: ${externalError(payload, 'request failed')}`);
      return payload as T;
    } catch (error) {
      const decision = decideRetry({ retriesUsed: attempt, maxRetries: attempts - 1, startedAtMs: started, nowMs: Date.now(), maxElapsedMs: budgetMs, baseMs: 250, capMs: 2_000, retryAfterMs: retryAfter });
      if (!isTransientFailure(error, status) || !decision.retry || !upstreamRetryQuota.take()) throw error;
      await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
    }
  }
}
function mayFailoverRead(error: unknown): boolean {
  if (!directDbUrl()) return false;
  const message = error instanceof Error ? error.message : String(error);
  const status = /postgres_atomic HTTP (\d{3})/.exec(message)?.[1];
  // Auth, throttling and invalid/truncated evidence must retain their failure.
  return status ? ['502', '503', '504'].includes(status) : isTransientFailure(error);
}
async function rpc<T>(name: string, body: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  // Select direct transport before sending a mutation, never after an ambiguous
  // timeout: the REST request may already have committed its claim or CAS.
  if (preferDirectTransport() || ((!supabaseUrl() || !serviceRoleKey()) && directDbUrl())) return directRpc<T>(name, body);
  return restRequest<T>(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }, { timeoutMs });
}
export function readPostgresFleetDashboardObservation(): Promise<unknown> {
  if (!postgresAtomicQueueConfigured()) throw new Error('Shared fleet observation requires postgres_atomic');
  return rpc('ivx_fleet_dashboard_observation', {}, 5_000).catch((error) => {
    if (!mayFailoverRead(error)) throw error;
    return directRpc('ivx_fleet_dashboard_observation', {});
  });

}

export type FleetProcessObservation = {
  measuredAt: string;
  instances: Array<{ instanceId: string; role: string; commitSha: string; serviceId: string | null;
    lastSeenAt: string; processRole: string | null; sharedState: boolean; sharedWorkerQueue: boolean; draining: boolean }>;
};

/** HA needs recent process rows, never the task ledger or assignment aggregates. */
export async function readPostgresFleetProcessObservation(): Promise<FleetProcessObservation> {
  if (!postgresAtomicQueueConfigured()) throw new Error('Shared process observation requires postgres_atomic');
  const directRead = async (): Promise<FleetProcessObservation> => {
    const result = await queryWithPostgresDeadline<{ measuredAt: Date; instances: FleetProcessObservation['instances'] }>(getDirectPool(process.env, 'presence'), `
      select statement_timestamp() as "measuredAt", coalesce((select jsonb_agg(i) from (
        select distinct on (worker_instance_id) worker_instance_id as "instanceId",
          event->>'instance_role' as role, event->>'commit_sha' as "commitSha",
          event->>'service_id' as "serviceId", created_at as "lastSeenAt",
          event->>'process_role' as "processRole",
          coalesce((event->>'shared_state')::boolean,false) as "sharedState",
          coalesce((event->>'shared_worker_queue')::boolean,false) as "sharedWorkerQueue",
          coalesce((event->>'draining')::boolean,false) as draining
        from public.ivx_autonomous_task_events
        where event_type='fleet_slo_sample' and created_at > statement_timestamp() - interval '60 seconds'
          and event->>'instance_role' in ('api','worker')
        order by worker_instance_id, created_at desc limit 1000
      ) i), '[]'::jsonb) as instances`, []);
    const row = result.rows[0];
    if (!row || !Array.isArray(row.instances) || row.instances.length >= 1000) throw new Error('Incomplete process observation');
    return { measuredAt: new Date(row.measuredAt).toISOString(), instances: row.instances };
  };
  if (preferDirectTransport()) return directRead();
  try {
    const query = new URLSearchParams({ select: 'worker_instance_id,created_at,event', event_type: 'eq.fleet_slo_sample',
      created_at: `gt.${new Date(Date.now() - 60_000).toISOString()}`, order: 'created_at.desc', limit: '1000' });
    const rows = await restRequest<Array<{ worker_instance_id: string; created_at: string; event: Record<string, unknown> }>>(
      `ivx_autonomous_task_events?${query}`, { method: 'GET' }, { timeoutMs: TRUTH_TIMEOUT_MS });
    if (!Array.isArray(rows) || rows.length >= 1000) throw new Error('Incomplete process observation');
    const latest = new Map<string, FleetProcessObservation['instances'][number]>();
    for (const row of rows) {
      if (latest.has(row.worker_instance_id)) continue;
      const event = row.event;
      if (!row.worker_instance_id || !event || !['api', 'worker'].includes(String(event.instance_role))) continue;
      latest.set(row.worker_instance_id, { instanceId: row.worker_instance_id, role: String(event.instance_role),
        commitSha: String(event.commit_sha ?? ''), serviceId: typeof event.service_id === 'string' ? event.service_id : null,
        lastSeenAt: row.created_at, processRole: typeof event.process_role === 'string' ? event.process_role : null,
        sharedState: event.shared_state === true, sharedWorkerQueue: event.shared_worker_queue === true, draining: event.draining === true });
    }
    return { measuredAt: new Date().toISOString(), instances: [...latest.values()] };
  } catch (error) {
    if (!mayFailoverRead(error)) throw error;
    return directRead();
  }
}
function cloneTasks(tasks: readonly Task[]): Task[] { return structuredClone(tasks) as Task[]; }
function mergeTaskResultsIntoCache(tasks: readonly (Task | null | undefined)[]): void { taskMutationRevision += 1; if (!taskReadCache) return; const next = [...taskReadCache.value]; const indexById = new Map(next.map((task, index) => [task.taskId, index])); for (const task of tasks) { if (!task) continue; const copy = structuredClone(task) as Task; const index = indexById.get(copy.taskId); if (index === undefined) { indexById.set(copy.taskId, next.length); next.push(copy); } else next[index] = copy; } taskReadCache = { value: next, at: Date.now() }; }
function invalidateTaskReadCache(): void { taskMutationRevision += 1; taskReadCache = null; }

async function fetchAllPostgresTasks(): Promise<Task[]> {
  const pageSize = 1_000; const maxRows = 20_000; const all: Task[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) { const rows = preferDirectTransport() ? (await getDirectPool().query<RestTaskRow>('select payload from public.ivx_autonomous_tasks order by created_at asc offset $1 limit $2', [offset, pageSize])).rows : await restRequest<RestTaskRow[]>(`ivx_autonomous_tasks?select=payload&order=created_at.asc&offset=${offset}&limit=${pageSize}`, { method: 'GET' }); if (!Array.isArray(rows)) throw new Error('postgres_atomic task response is not an array'); all.push(...rows.map((row) => structuredClone(row.payload))); if (rows.length < pageSize) return all; }
  throw new Error(`postgres_atomic task ledger exceeds safe pagination limit (${maxRows})`);
}

export async function readPostgresTaskById(taskId: string): Promise<Task | null> {
  if (!taskId.trim()) throw new Error('Task identity is required');
  const directRead = async () => {
    const result = await getDirectPool().query<RestTaskRow>('select payload from public.ivx_autonomous_tasks where task_id = $1 limit 1', [taskId]);
    return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : null;
  };
  if (preferDirectTransport()) return directRead();
  try {
    const query = new URLSearchParams({ select: 'payload', task_id: `eq.${taskId}`, limit: '1' });
    const rows = await restRequest<RestTaskRow[]>(`ivx_autonomous_tasks?${query}`, { method: 'GET' });
    if (!Array.isArray(rows) || rows.length > 1) throw new Error('postgres_atomic single-task response is invalid');
    if (!rows.length) return null;
    if (rows[0].payload?.taskId !== taskId) throw new Error('postgres_atomic task identity mismatch');
    return structuredClone(rows[0].payload);
  } catch (error) {
    if (!mayFailoverRead(error)) throw error;
    return directRead();
  }
}

export async function readPostgresTaskIdentitiesByPrefix(prefix: string): Promise<Array<Pick<Task, 'taskId' | 'idempotencyKey' | 'state'>>> {
  if (!/^[a-z0-9-]+:[a-f0-9]{40}:$/.test(prefix)) throw new Error('Exact mission prefix is required');
  const directRead = async () => {
    const result = await getDirectPool().query<{ task_id: string; idempotency_key: string; state: TaskState }>('select task_id, idempotency_key, state from public.ivx_autonomous_tasks where idempotency_key like $1 order by created_at asc limit 1000', [`${prefix}%`]);
    if (result.rows.length >= 1000) throw new Error('postgres_atomic mission identities are incomplete');
    return result.rows.map((row) => ({ taskId: row.task_id, idempotencyKey: row.idempotency_key, state: row.state as TaskState }));
  };
  if (preferDirectTransport()) return directRead();
  try {
    const query = new URLSearchParams({ select: 'task_id,idempotency_key,state', idempotency_key: `like.${prefix}*`, limit: '1000' });
    const rows = await restRequest<Array<{ task_id: string; idempotency_key: string; state: TaskState }>>(`ivx_autonomous_tasks?${query}`, { method: 'GET' });
    if (!Array.isArray(rows) || rows.length >= 1000) throw new Error('postgres_atomic mission identities are incomplete');
    return rows.map(row => ({ taskId: row.task_id, idempotencyKey: row.idempotency_key, state: row.state }));
  } catch (error) {
    if (!mayFailoverRead(error)) throw error;
    return directRead();
  }
}

export async function readPostgresCurrentTasks(states: readonly TaskState[]): Promise<Task[]> {
  const unique = [...new Set(states)].sort(); if (unique.length === 0) return [];
  // Observers share only overlapping requests, never stale success or failure caches.
  const key = `${taskMutationRevision}:${unique.join(',')}`;
  const existing = currentReadsInFlight.get(key);
  if (existing) return cloneTasks(await existing);
  const pending = fetchPostgresCurrentTasks(unique);
  currentReadsInFlight.set(key, pending);
  try { return cloneTasks(await pending); }
  finally { if (currentReadsInFlight.get(key) === pending) currentReadsInFlight.delete(key); }
}

async function fetchPostgresCurrentTasks(unique: TaskState[], purpose: PoolPurpose = 'tasks'): Promise<Task[]> {
  const directRead = async () => {
    const pool = getDirectPool(process.env, purpose);
    const sql = 'select payload from public.ivx_autonomous_tasks where state = any($1::text[]) order by updated_at desc limit 1000';
    const result = purpose === 'telemetry'
      ? await queryWithPostgresDeadline<RestTaskRow>(pool, sql, [unique])
      : await pool.query<RestTaskRow>(sql, [unique]);
    if (result.rows.length >= 1000) throw new Error('postgres_atomic current-task response reached its safety limit; telemetry is incomplete');
    return result.rows.map((row) => structuredClone(row.payload));
  };
  if (preferDirectTransport()) return directRead();
  try {
    const stateFilter = `(${unique.join(',')})`;
    const rows = await restRequest<RestTaskRow[]>(`ivx_autonomous_tasks?select=payload&state=in.${stateFilter}&order=updated_at.desc&limit=1000`, { method: 'GET' }, { timeoutMs: TRUTH_TIMEOUT_MS, attempts: 3 });
    if (!Array.isArray(rows)) throw new Error('postgres_atomic current-task response is not an array');
    if (rows.length >= 1_000) throw new Error('postgres_atomic current-task response reached its safety limit; telemetry is incomplete');
    return rows.map((row) => structuredClone(row.payload));
  } catch (error) {
    if (!mayFailoverRead(error)) throw error;
    return directRead();
  }
}

/** Aggregate monitoring reads current work only; heartbeats cannot create proof. */
export async function readPostgresFleetSloTasks(): Promise<Task[]> {
  // The monitor coalesces its own samples. Do not join a task-pool read that
  // may already be queued behind blocked mutations.
  return fetchPostgresCurrentTasks(['LEASED', 'RUNNING', 'BLOCKED', 'RETRYING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS'], 'telemetry');
}

/** One latest observation per current patrol; never hydrate the historical task ledger. */
export async function readPostgresPatrolObservations(sha: string): Promise<import('./ivx-autonomous-recovery-health').PatrolObservation[]> {
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Invalid patrol source SHA');
  type Row = import('./ivx-autonomous-recovery-health').PatrolObservation;
  const prefix = `landing-p0-patrol:${sha}:`;
  const directRead = async () => (await getDirectPool().query<Row>(
    "select task_id, assigned_agent_number, payload->'evidence'->-1 as evidence from public.ivx_autonomous_tasks where idempotency_key like $1 order by assigned_agent_number limit 113", [prefix + '%'])).rows;
  let rows: Row[];
  if (preferDirectTransport()) rows = await directRead();
  else {
    try {
      rows = await restRequest<Row[]>(`ivx_autonomous_tasks?select=task_id,assigned_agent_number,evidence:payload->evidence->-1&idempotency_key=like.${prefix}*&order=assigned_agent_number&limit=113`, { method: 'GET' }, { timeoutMs: TRUTH_TIMEOUT_MS, attempts: 1 });
    } catch (error) { if (!mayFailoverRead(error)) throw error; rows = await directRead(); }
  }
  if (!Array.isArray(rows) || rows.length > 112) throw new Error('Patrol observation identities are ambiguous');
  return rows;
}

/** The reconciler only inspects queued tasks that still carry a lease. */
export async function readPostgresRecoveryTasks(): Promise<Task[]> {
  const key = `recovery:${taskMutationRevision}`;
  const existing = currentReadsInFlight.get(key);
  if (existing) return cloneTasks(await existing);
  const pending = fetchPostgresRecoveryTasks();
  currentReadsInFlight.set(key, pending);
  try { return cloneTasks(await pending); }
  finally { if (currentReadsInFlight.get(key) === pending) currentReadsInFlight.delete(key); }
}

async function fetchPostgresRecoveryTasks(): Promise<Task[]> {
  const directRead = async () => {
    const result = await getDirectPool().query<RestTaskRow>(
      'select payload from public.ivx_autonomous_tasks where state = any($1::text[]) or (state = $2 and lease_holder is not null) order by updated_at desc limit 1000',
      [['BLOCKED', 'RUNNING', 'RETRYING'], 'QUEUED']);
    if (result.rows.length >= 1000) throw new Error('postgres_atomic recovery-task response reached its safety limit; recovery is incomplete');
    return result.rows.map(row => structuredClone(row.payload));
  };
  if (preferDirectTransport()) return directRead();
  try {
    // Unleased QUEUED work is left to the atomic dispatcher. Reading its full
    // payload here can fill the 1,000-row cap and starve actual recovery work.
    const query = new URLSearchParams({ select: 'payload',
      or: '(state.in.(BLOCKED,RUNNING,RETRYING),and(state.eq.QUEUED,lease_holder.not.is.null))',
      order: 'updated_at.desc', limit: '1000' });
    const rows = await restRequest<RestTaskRow[]>(`ivx_autonomous_tasks?${query}`, { method: 'GET' }, { timeoutMs: TRUTH_TIMEOUT_MS, attempts: 3 });
    if (!Array.isArray(rows)) throw new Error('postgres_atomic recovery-task response is not an array');
    if (rows.length >= 1000) throw new Error('postgres_atomic recovery-task response reached its safety limit; recovery is incomplete');
    return rows.map(row => structuredClone(row.payload));
  } catch (error) {
    if (!mayFailoverRead(error)) throw error;
    return directRead();
  }
}

export async function persistPostgresFleetSloSample(sample: Record<string, unknown>): Promise<void> {
  const workerInstanceId = autonomousWorkerInstanceId();
  const event = { ...sample, instance_role: process.env.IVX_WORKER_MODE === 'true' ? 'worker' : 'api', service_id: process.env.RENDER_SERVICE_ID ?? null, process_role: process.env.IVX_PROCESS_ROLE ?? null, shared_worker_queue: process.env.IVX_WORKER_QUEUE_ATOMIC === 'true', shared_state: process.env.IVX_REQUIRE_SHARED_STATE === 'true', draining: process.env.IVX_INSTANCE_DRAINING === 'true' };
  const persistDirect = async () => {
    await queryWithPostgresDeadline(getDirectPool(process.env, 'presence'),
      'insert into public.ivx_autonomous_task_events(event_type,worker_instance_id,event) values ($1,$2,$3::jsonb)',
      ['fleet_slo_sample', workerInstanceId, JSON.stringify(event)],
    );
  };
  if (preferDirectTransport() || (directDbUrl() && trimmed(process.env.IVX_SUPABASE_RECOVERY_MODE).toLowerCase() === 'true')) {
    await persistDirect();
    return;
  }
  try {
    await restRequest('ivx_autonomous_task_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ event_type: 'fleet_slo_sample', worker_instance_id: workerInstanceId, event }) }, { timeoutMs: TRUTH_TIMEOUT_MS });
  } catch (error) {
    if (!mayFailoverRead(error)) throw error;
    // Telemetry samples are append-only observations. If PostgREST times out
    // after accepting one, a duplicate direct sample is harmless: the HA view
    // selects only the newest row per process identity.
    await persistDirect();
  }

}

export async function readPostgresAutonomousTasks(): Promise<Task[]> {
  const now = Date.now(); if (taskReadCache && now - taskReadCache.at <= TASK_READ_CACHE_TTL_MS) return cloneTasks(taskReadCache.value); if (taskReadInFlight) return cloneTasks(await taskReadInFlight);
  const pending = (async () => { for (let attempt = 0; attempt < 2; attempt += 1) { const readRevision = taskMutationRevision; const tasks = await fetchAllPostgresTasks(); if (taskMutationRevision === readRevision) { taskReadCache = { value: cloneTasks(tasks), at: Date.now() }; return tasks; } const updatedCache = taskReadCache as { value: Task[]; at: number } | null; if (updatedCache) return cloneTasks(updatedCache.value); } throw new Error('postgres_atomic task queue changed repeatedly during read'); })();
  taskReadInFlight = pending; try { return cloneTasks(await pending); } finally { if (taskReadInFlight === pending) taskReadInFlight = null; }
}
export async function createPostgresAutonomousTasks(tasks: readonly Task[]): Promise<AtomicCreateResult[]> { if (tasks.length === 0) return []; const results = await rpc<AtomicCreateResult[]>('ivx_autonomous_tasks_create_batch', { p_tasks: tasks }); if (!Array.isArray(results) || results.length !== tasks.length) throw new Error(`postgres_atomic create returned ${Array.isArray(results) ? results.length : 'invalid'} results for ${tasks.length} tasks`); mergeTaskResultsIntoCache(results.map((r) => r.task)); return results; }
export async function claimPostgresAutonomousTasks(requests: readonly FleetLeaseRequest[]): Promise<FleetLeaseResult[]> { if (requests.length === 0) return []; const results = await rpc<FleetLeaseResult[]>('ivx_autonomous_tasks_claim_batch', { p_requests: requests, p_worker_instance_id: autonomousWorkerInstanceId(), p_lease_seconds: autonomousLeaseSeconds() }); if (!Array.isArray(results) || results.length !== requests.length) throw new Error(`postgres_atomic claim returned ${Array.isArray(results) ? results.length : 'invalid'} results for ${requests.length} lanes`); mergeTaskResultsIntoCache(results.map((r) => r.task)); return results; }
export async function startPostgresAutonomousTasks(leases: readonly FleetTaskLeaseIdentity[]): Promise<FleetTaskMutationResult[]> { if (leases.length === 0) return []; const results = await rpc<FleetTaskMutationResult[]>('ivx_autonomous_tasks_start_batch', { p_leases: leases, p_worker_instance_id: autonomousWorkerInstanceId(), p_lease_seconds: autonomousLeaseSeconds() }); if (!Array.isArray(results) || results.length !== leases.length) throw new Error(`postgres_atomic start returned ${Array.isArray(results) ? results.length : 'invalid'} results for ${leases.length} leases`); mergeTaskResultsIntoCache(results.map((r) => r.task)); return results; }
export async function heartbeatPostgresAutonomousTasks(leases: readonly FleetTaskLeaseIdentity[]): Promise<{ ok: boolean; refreshed: number; rejected: Array<{ taskId: string; error: string }> }> {
  if (leases.length === 0) return { ok: true, refreshed: 0, rejected: [] }; const result = await rpc<{ ok: boolean; refreshed: number; rejected: Array<{ taskId: string; error: string }>; at?: string }>('ivx_autonomous_tasks_heartbeat_batch', { p_leases: leases, p_worker_instance_id: autonomousWorkerInstanceId(), p_lease_seconds: autonomousLeaseSeconds() }); if (!result || typeof result.refreshed !== 'number' || !Array.isArray(result.rejected)) throw new Error('postgres_atomic heartbeat returned an invalid response');
  if (result.refreshed > 0 && taskReadCache && result.at) { const rejected = new Set(result.rejected.map((entry) => entry.taskId)); const atMs = Date.parse(result.at); const at = Number.isFinite(atMs) ? new Date(atMs).toISOString() : new Date().toISOString(); const expiresAt = new Date((Number.isFinite(atMs) ? atMs : Date.now()) + autonomousLeaseSeconds() * 1000).toISOString(); const leaseIds = new Set(leases.filter((lease) => !rejected.has(lease.taskId)).map((lease) => lease.taskId)); const next = cloneTasks(taskReadCache.value); for (const task of next) { if (!leaseIds.has(task.taskId)) continue; task.lastHeartbeatAt = at; task.leaseExpiresAt = expiresAt; task.updatedAt = at; } taskMutationRevision += 1; taskReadCache = { value: next, at: Date.now() }; } else if (result.refreshed > 0) taskMutationRevision += 1;
  return { ok: Boolean(result.ok), refreshed: result.refreshed, rejected: result.rejected };
}
export async function releasePostgresWorkerInstanceTasks(): Promise<number> { const result = await rpc<{ ok: boolean; released: number; workerInstanceId: string }>('ivx_autonomous_tasks_release_worker', { p_worker_instance_id: autonomousWorkerInstanceId() }, 10_000); if (!result || result.ok !== true || !Number.isFinite(result.released) || result.released < 0) throw new Error('postgres_atomic worker lease release returned an invalid response'); if (result.released > 0) invalidateTaskReadCache(); return result.released; }
export async function compareAndSetPostgresAutonomousTask(input: { task: Task; expectedStates: readonly TaskState[]; leaseHolder?: string | null; eventType: string }): Promise<AtomicCasResult> { const result = await rpc<AtomicCasResult>('ivx_autonomous_task_compare_and_set', { p_task: input.task, p_expected_states: input.expectedStates, p_lease_holder: input.leaseHolder ?? null, p_worker_instance_id: input.leaseHolder ? autonomousWorkerInstanceId() : null, p_event_type: input.eventType }); if (!result || typeof result.ok !== 'boolean') throw new Error('postgres_atomic compare-and-set returned an invalid response'); if (result.ok) mergeTaskResultsIntoCache([result.task]); return result; }
export async function linkPostgresAutonomousOrphans(objectiveId: string): Promise<number> { const result = await rpc<number>('ivx_autonomous_tasks_link_objective', { p_objective_id: objectiveId }); if (!Number.isFinite(result) || result < 0) throw new Error('postgres_atomic orphan link returned an invalid count'); if (result > 0) invalidateTaskReadCache(); return result; }
export async function readPostgresFleetLeaseRows(): Promise<AtomicFleetLeaseRow[]> {
  const directRead = async () => {
    const activeStates = ['LEASED','RUNNING','EXECUTION_COMPLETED','QA_IN_PROGRESS','READY_FOR_DEPLOYMENT','DEPLOYING','DEPLOYED','PRODUCTION_VERIFYING'];
    const result = await getDirectPool().query<{ task_id: string; idempotency_key: string; state: TaskState; assigned_agent_number: number | null; lease_holder: string; worker_instance_id: string | null; last_heartbeat_at: string | Date; lease_expires_at: string | Date | null }>('select task_id, idempotency_key, state, assigned_agent_number, lease_holder, worker_instance_id, last_heartbeat_at, lease_expires_at from public.ivx_autonomous_tasks where state = any($1::text[]) and lease_holder is not null order by updated_at desc limit 1000', [activeStates]);
    return result.rows.filter((row) => row.task_id && row.lease_holder && row.last_heartbeat_at).map((row) => ({ taskId: row.task_id, idempotencyKey: row.idempotency_key, state: row.state as TaskState, assignedAgentNumber: row.assigned_agent_number, leaseHolder: row.lease_holder, workerInstanceId: row.worker_instance_id, lastHeartbeatAt: new Date(row.last_heartbeat_at).toISOString(), leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null }));
  };
  if (preferDirectTransport()) return directRead();
  try {
    const activeStates = '(LEASED,RUNNING,EXECUTION_COMPLETED,QA_IN_PROGRESS,READY_FOR_DEPLOYMENT,DEPLOYING,DEPLOYED,PRODUCTION_VERIFYING)';
    const rows = await restRequest<Array<{ task_id: string; idempotency_key: string; state: TaskState; assigned_agent_number: number | null; lease_holder: string | null; worker_instance_id: string | null; last_heartbeat_at: string | null; lease_expires_at: string | null }>>(`ivx_autonomous_tasks?select=task_id,idempotency_key,state,assigned_agent_number,lease_holder,worker_instance_id,last_heartbeat_at,lease_expires_at&state=in.${activeStates}&lease_holder=not.is.null&limit=1000`, { method: 'GET' }, { timeoutMs: TRUTH_TIMEOUT_MS, attempts: 2 });
    if (!Array.isArray(rows)) throw new Error('postgres_atomic fleet truth response is not an array');
    return rows.filter((row): row is typeof row & { lease_holder: string; last_heartbeat_at: string } => Boolean(row.task_id && row.lease_holder && row.last_heartbeat_at)).map((row) => ({ taskId: row.task_id, idempotencyKey: row.idempotency_key, state: row.state, assignedAgentNumber: row.assigned_agent_number, leaseHolder: row.lease_holder, workerInstanceId: row.worker_instance_id, lastHeartbeatAt: row.last_heartbeat_at, leaseExpiresAt: row.lease_expires_at }));
  } catch (error) {
    if (!mayFailoverRead(error)) throw error;
    return directRead();
  }
}

/** Planning needs identities and states, never historical evidence payloads. */
export type AutonomousTaskIndex = Pick<Task, 'taskId' | 'idempotencyKey' | 'assignedAgentNumber' | 'state' | 'title'>;
export async function readPostgresAutonomousTaskIndex(): Promise<AutonomousTaskIndex[]> {
  const all: AutonomousTaskIndex[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20000; offset += pageSize) {
    type IndexRow = { task_id: string; idempotency_key: string; assigned_agent_number: number | null; state: TaskState; title: string };
    const rows = preferDirectTransport()
      ? (await getDirectPool().query<IndexRow>(
        "select task_id, idempotency_key, assigned_agent_number, state, payload->>'title' as title from public.ivx_autonomous_tasks order by created_at asc, task_id asc offset $1 limit $2",
        [offset, pageSize])).rows
      : await restRequest<IndexRow[]>(
        `ivx_autonomous_tasks?select=task_id,idempotency_key,assigned_agent_number,state,title:payload->>title&order=created_at.asc,task_id.asc&offset=${offset}&limit=${pageSize}`,
        { method: 'GET' });
    if (!Array.isArray(rows)) throw new Error('postgres_atomic planning index is invalid');
    all.push(...rows.map(row => ({ taskId: row.task_id, idempotencyKey: row.idempotency_key,
      assignedAgentNumber: row.assigned_agent_number, state: row.state, title: row.title })));
    if (rows.length < pageSize) return all;
  }
  throw new Error('postgres_atomic planning index exceeds safe pagination limit');
}
