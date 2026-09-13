import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { Client, Pool, type PoolClient } from 'pg';
import { getApiPool, getWorkerPool, resetDatabasePoolsForTests } from './ivx-database-pools';
import { publicFeedRead } from './ivx-public-feed-postgres';
import { readPostgresFleetSloTasks, readPostgresFleetProcessObservation } from './ivx-postgres-autonomous-task-store';
const saved = { ...process.env };
afterEach(() => { resetDatabasePoolsForTests(); process.env = { ...saved }; });
function configure() {
  process.env.NODE_ENV = 'production'; process.env.CI = 'false';
  process.env.SUPABASE_DB_URL = 'postgresql://postgres:test@db.example.supabase.co:5432/postgres';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
}
test('API and worker have distinct singleton pools with independent ceilings', () => {
  configure(); const api = getApiPool(), worker = getWorkerPool();
  expect(api).not.toBe(worker);
  expect(getApiPool()).toBe(api); expect(getWorkerPool()).toBe(worker);
  expect((api as any).options.max).toBe(12); expect((worker as any).options.max).toBe(5);
  expect((worker as any).options.connectionTimeoutMillis).toBe(1500);
});
test('saturated worker checkout cannot delay an API read; reads retain anon role and JSON data', async () => {
  configure(); const api = getApiPool(), worker = getWorkerPool();
  const calls: string[] = []; const released: boolean[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => { calls.push(sql); return { rows: [{ value: { id: 'public', created_at: '2026-09-12' } }] }; },
    release: (destroy: boolean) => released.push(destroy),
  });
  const ap = spyOn(api, 'connect').mockResolvedValue(client as any);
  const wp = spyOn(worker, 'connect').mockRejectedValue(new Error('worker pool full'));
  try {
    await expect(worker.query('select queue', [])).rejects.toThrow('worker pool full');
    const result = await publicFeedRead('select id from public.jv_deals', [], () => { throw new Error('REST must not run'); }, 'anon');
    expect(result.data).toEqual([{ id: 'public', created_at: '2026-09-12' }]);
    expect(calls[0]).toContain('SET LOCAL ROLE anon');
    expect(calls[0]).toContain('SET TRANSACTION READ ONLY');
    expect(calls[0]).toContain('"role":"anon"');
    expect(released).toEqual([false]);
  } finally { ap.mockRestore(); wp.mockRestore(); }
});
test('worker convenience query preserves server limits and reuses a confirmed rollback without replay', async () => {
  configure(); const worker = getWorkerPool(); const calls: string[] = [], released: boolean[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => { calls.push(sql); if (sql === 'select queue') throw Object.assign(new Error('cancelled'), { code: '57014' }); return { command: sql === 'ROLLBACK' ? 'ROLLBACK' : 'SELECT', rows: [] }; },
    release: (destroy: boolean) => released.push(destroy),
  });
  const mock = spyOn(worker, 'connect').mockResolvedValue(client as any);
  try {
    await expect(worker.query('select queue')).rejects.toThrow('cancelled');
    expect(calls[0]).toContain("statement_timeout = '2500ms'");
    expect(calls[0]).toContain("lock_timeout = '1000ms'");
    expect(calls.filter(x => x === 'select queue')).toHaveLength(1);
    expect(calls.at(-1)).toBe('ROLLBACK'); expect(released).toEqual([false]);
  } finally { mock.mockRestore(); }
});
test('native feed errors propagate; mismatched projects never read through SQL or REST', async () => {
  configure(); const mock = spyOn(Pool.prototype, 'connect').mockRejectedValue(new Error('offline'));
  let rest = 0;
  try {
    await expect(publicFeedRead('select 1', [], async () => { rest++; return { data: [] }; })).rejects.toThrow('offline');
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://another.supabase.co';
    await expect(publicFeedRead('select 1', [], async () => { rest++; return { data: [] }; })).rejects.toThrow('project_mismatch');
    expect(rest).toBe(0);
  } finally { mock.mockRestore(); }
});

for (const flag of ['CI', 'NODE_ENV']) test(`reduced CI pool ceilings via ${flag}`, () => {
  configure(); process.env[flag] = flag === 'CI' ? 'true' : 'test';
  expect((getApiPool() as any).options.max).toBe(6);
  expect((getWorkerPool() as any).options.max).toBe(1);
});

test('API saturation cannot block fleet telemetry or process presence', async () => {
  configure(); process.env.CI = 'true'; process.env.IVX_AUTONOMOUS_QUEUE_BACKEND = 'postgres_atomic';
  const api = getApiPool(), observed = new Map<string, Pool>();
  const originalConnect = Pool.prototype.connect;
  const checkout = spyOn(Pool.prototype, 'connect').mockImplementation(function (this: Pool) {
    observed.set(this.options.application_name!, this);
    return originalConnect.call(this) as never;
  });
  // Real pg.Pool queues, limits and timers; only network I/O is substituted.
  const connect = spyOn(Client.prototype, 'connect').mockImplementation((callback: (error: Error | null) => void) => {
    queueMicrotask(() => callback(null)); return undefined as never;
  });
  const query = spyOn(Client.prototype, 'query').mockImplementation((async (sql: string) => ({
    rows: sql.includes('as instances') ? [{ measuredAt: new Date(), instances: [] }] : [],
  })) as never);
  const held: PoolClient[] = [];
  try {
    held.push(...await Promise.all(Array.from({ length: 6 }, () => api.connect())));
    expect(api.totalCount).toBe(6); expect(api.idleCount).toBe(0);
    const started = performance.now();
    expect(await readPostgresFleetSloTasks()).toEqual([]);
    const telemetry = observed.get('ivx_telemetry')!;
    expect(telemetry).not.toBe(api);
    held.push(await telemetry.connect());
    expect(telemetry.idleCount).toBe(0);
    const presence = await readPostgresFleetProcessObservation();
    expect(presence.instances).toEqual([]);
    expect(observed.get('ivx_presence')).not.toBe(api);
    expect(observed.get('ivx_presence')).not.toBe(telemetry);
    expect(api.idleCount).toBe(0); expect(api.waitingCount).toBe(0);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(1500);
    console.log(JSON.stringify({ proof: 'local-pg-api-and-telemetry-saturation',
      occupiedApiConnections: 6, occupiedTelemetryConnections: 1,
      presenceAvailable: true, elapsedMs, productionRowsTouched: 0 }));
  } finally {
    for (const client of held) client.release();
    await Promise.all([...new Set([api, ...observed.values()])].map(pool => pool.end()));
    query.mockRestore(); connect.mockRestore(); checkout.mockRestore();
  }
}, 5000);

test('worker lane allocations sum to 8 in production and 4 in CI', () => {
  for (const ci of ['false', 'true']) {
    resetDatabasePoolsForTests(); configure(); process.env.CI = ci;
    const lanes = ['tasks','assignment','heartbeat','repair'] as const;
    const pools = lanes.map(lane => getWorkerPool(process.env, lane));
    expect(new Set(pools).size).toBe(4);
    expect(pools.reduce((sum,pool) => sum + (pool as any).options.max,0)).toBe(ci === 'true' ? 4 : 8);
  }
});
