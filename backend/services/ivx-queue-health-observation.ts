import { boundedHealthProbe, type BoundedHealthProbe } from './ivx-bounded-health-probe';
import { getObserverPool } from './ivx-database-pools';
import { queryWithPostgresDeadline } from './ivx-postgres-deadline';
import { newReadTimings, readTimings } from './ivx-read-timings';

export type QueueHealthSnapshot = {
  authorized: boolean;
  pending: Array<{ id: string; status: string; created_at: string }>;
  dead: Array<{ id: string }>;
  workers: unknown[];
};
export function validQueueHealthSnapshot(body: unknown): body is QueueHealthSnapshot {
  if (!body || typeof body !== 'object') return false;
  const value = body as QueueHealthSnapshot;
  return typeof value.authorized === 'boolean' && Array.isArray(value.pending) && value.pending.length <= 200
    && value.pending.every(row => typeof row?.id === 'string' && ['QUEUED', 'RETRYING', 'RUNNING'].includes(row.status) && Number.isFinite(Date.parse(row.created_at)))
    && Array.isArray(value.dead) && value.dead.length <= 100 && value.dead.every(row => typeof row?.id === 'string')
    && Array.isArray(value.workers) && value.workers.length <= 10;
}

type Observation = BoundedHealthProbe<QueueHealthSnapshot> & { timing: {
  transport: 'postgres' | 'postgrest'; totalMs: number;
  poolAcquisitionMs: number | null; sqlRoundTripMs: number | null;
  // Neither the HTTP probe nor a client query timer measures raw server time.
  serverSqlMs: null;
} };
type Options = { sourceSha: string; url: string; headers: Record<string, string>; env?: NodeJS.ProcessEnv };
type ReadDirect = (sourceSha: string, env: NodeJS.ProcessEnv) => Promise<unknown>;
const directRead: ReadDirect = async (sha, env) => {
  const result = await queryWithPostgresDeadline<{ snapshot: unknown }>(
    getObserverPool(env, 'telemetry'),
    'select public.ivx_owner_ai_queue_health($1::text) as snapshot', [sha], 'service_role');
  return result.rows[0]?.snapshot;
};

/** Share only concurrent probes; the next probe must observe current Owner
 * authorization and worker leases. Never cache a previous PASS or retry a
 * failed direct query via REST. Keep the producer until it actually settles.
 */
export function createQueueHealthObserver(readDirect: ReadDirect = directRead, timeoutMs = 5000) {
  const inFlight = new Map<string, Promise<Observation>>();
  return function observe(options: Options): Promise<Observation> {
    const env = options.env ?? process.env;
    const direct = Boolean((env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_POOLER_URL || '').trim());
    const key = `${direct ? 'postgres' : 'postgrest'}:${options.url}:${options.sourceSha}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const started = performance.now(), metrics = newReadTimings();
    const timing = (): Observation['timing'] => ({
      transport: direct ? 'postgres' : 'postgrest', totalMs: Math.max(0, performance.now() - started),
      poolAcquisitionMs: direct ? metrics.poolMs : null,
      sqlRoundTripMs: direct && metrics.sqlPending === 0 ? metrics.sqlMs : null, serverSqlMs: null,
    });
    const failure = (reason: string): Observation => ({ ok: false, status: 0, latencyMs: performance.now() - started,
      error: reason, timing: timing() });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const producer = readTimings.run(metrics, async (): Promise<Observation> => {
      if (!direct) {
        const result = await boundedHealthProbe(options.url, options.headers, validQueueHealthSnapshot, timeoutMs);
        return { ...result, timing: timing() };
      }
      try {
        const value = await readDirect(options.sourceSha, env);
        if (!validQueueHealthSnapshot(value)) return failure('Queue observation invalid');
        return { ok: true, status: 200, latencyMs: performance.now() - started, value, timing: timing() };
      } catch { return failure('Queue database observation unavailable'); }
    });
    const observation = Promise.race([producer, new Promise<Observation>(resolve => {
      timer = setTimeout(() => resolve(failure('Queue observation timed out')), timeoutMs);
    })]);
    inFlight.set(key, observation);
    // After a caller timeout, the finite pg server/client deadlines still own
    // cancellation and connection disposal. Do not multiply pending queries.
    void producer.finally(() => { clearTimeout(timer); inFlight.delete(key); });
    return observation;
  };
}
export const observeQueueHealth = createQueueHealthObserver();
