import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { emitFleetHeartbeat, FleetDatabase, type FleetLease, type FleetTaskStore } from './multi-agent-framework';

const lease: FleetLease = {
  taskId: 'test-task', agentNumber: 1, token: '00000000-0000-4000-8000-000000000001',
  resourceKeys: ['agent/001', 'capacity/001', 'file/repo/file.txt'],
  fences: { 'agent/001': '1', 'capacity/001': '1', 'file/repo/file.txt': '1' }, attempt: 1,
  mission: { idempotencyKey: 'test', baseCommit: 'a'.repeat(40), priority: 'low',
    files: [{ path: 'file.txt', beforeSha256: null, content: 'test' }] },
};

function harness(failAt?: 'connect' | 'setup' | 'heartbeat' | 'commit' | 'rollback') {
  const calls: string[] = [], releases: boolean[] = [];
  let connects = 0;
  const failure = Object.assign(new Error(failAt === 'commit' ? 'Query read timeout' : 'cancelled'), { code: failAt === 'commit' ? undefined : '57014' });
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => {
      calls.push(sql);
      if ((failAt === 'setup' && sql.includes('set_config'))
        || (['heartbeat', 'rollback'].includes(failAt ?? '') && sql === 'HEARTBEAT')
        || (failAt === 'commit' && sql === 'COMMIT')) throw failure;
      if (failAt === 'rollback' && sql === 'ROLLBACK') throw new Error('connection ended');
      return { rows: [], rowCount: 1 };
    },
    release: (destroy = false) => releases.push(destroy),
  });
  const database = new FleetDatabase({ connect: async () => {
    connects++;
    if (failAt === 'connect') throw failure;
    return client;
  } }, () => {});
  const store = { heartbeat: async (_lease: FleetLease, signal?: AbortSignal) => {
    await database.transaction(c => c.query('HEARTBEAT'), signal);
  } } as FleetTaskStore;
  return { calls, releases, store, failure, connects: () => connects, client };
}

test('heartbeat returns true only after commit and releases the connection', async () => {
  const h = harness();
  expect(await emitFleetHeartbeat(h.store, lease)).toBe(true);
  expect(h.connects()).toBe(1);
  expect(h.calls[0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
  expect(h.calls[1]).toContain("set_config('statement_timeout','2500',true)");
  expect(h.calls.at(-1)).toBe('COMMIT');
  expect(h.releases).toEqual([false]); expect(h.client.listenerCount('error')).toBe(0);
});
for (const phase of ['setup', 'heartbeat'] as const) test(`${phase} timeout rolls back and releases without reporting success`, async () => {
  const h = harness(phase);
  await expect(emitFleetHeartbeat(h.store, lease)).rejects.toBe(h.failure);
  expect(h.calls.at(-1)).toBe('ROLLBACK'); expect(h.calls).not.toContain('COMMIT');
  expect(h.releases).toEqual([false]); expect(h.connects()).toBe(1);
});
test('failed rollback discards its connection', async () => {
  const h = harness('rollback');
  await expect(emitFleetHeartbeat(h.store, lease)).rejects.toBe(h.failure);
  expect(h.releases).toEqual([true]); expect(h.connects()).toBe(1);
});
test('uncertain commit is not success and is never replayed', async () => {
  const h = harness('commit');
  await expect(emitFleetHeartbeat(h.store, lease)).rejects.toThrow('FLEET_COMMIT_OUTCOME_UNKNOWN');
  expect(h.calls.filter(sql => sql === 'HEARTBEAT')).toHaveLength(1);
  expect(h.releases).toEqual([true]); expect(h.connects()).toBe(1);
});
test('checkout failure leaves no client to release', async () => {
  const h = harness('connect');
  await expect(emitFleetHeartbeat(h.store, lease)).rejects.toBe(h.failure);
  expect(h.calls).toEqual([]); expect(h.releases).toEqual([]);
});
test('cancelled heartbeat and ID-only calls cannot open a connection', async () => {
  const h = harness();
  await expect(emitFleetHeartbeat(h.store, lease, AbortSignal.abort())).rejects.toThrow();
  await expect(emitFleetHeartbeat('agent-1' as never, 'task-1' as never)).rejects.toThrow('OWNED_FLEET_LEASE_REQUIRED');
  expect(h.connects()).toBe(0);
});
