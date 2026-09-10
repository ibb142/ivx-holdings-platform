import { expect, test } from 'bun:test';
import { refillFleetBatches, POSTGRES_FLEET_CLAIM_BATCH_SIZE } from './ivx-fleet-refill-batches';
import type { FleetLeaseRequest, Task } from './ivx-autonomous-task-engine';

const requests = Array.from({ length: 112 }, (_, i) => ({ workerId: `agent:${i + 1}`, agentNumber: i + 1 }));
const leased = (rows: readonly FleetLeaseRequest[]) => rows.map(row => ({ ...row, agentNumber: row.agentNumber ?? null,
  ok: true, task: { taskId: row.workerId, state: 'LEASED' } as Task, error: null, stolen: false }));

test('starts all 112 lanes incrementally without one fleet-sized claim transaction', async () => {
  const started: string[] = [], batches: number[] = [];
  await refillFleetBatches(requests, {
    batchSize: POSTGRES_FLEET_CLAIM_BATCH_SIZE,
    shouldStop: () => false,
    lease: async rows => {
      expect(started.length).toBe(batches.reduce((a, b) => a + b, 0));
      batches.push(rows.length); return leased(rows);
    },
    start: async rows => rows.map(row => ({ ...row, ok: true, error: null, task: { taskId: row.taskId, state: 'RUNNING' } as Task })),
    onStarted: row => { started.push(row.taskId); },
  });
  expect(Math.max(...batches)).toBe(4);
  expect(new Set(started).size).toBe(112);
});

test('a later database timeout preserves already dispatched work and never replays a claim', async () => {
  const started: string[] = []; let claims = 0;
  await expect(refillFleetBatches(requests, {
    batchSize: 4, shouldStop: () => false,
    lease: async rows => { if (++claims === 2) throw new Error('statement timeout'); return leased(rows); },
    start: async rows => rows.map(row => ({ ...row, ok: true, error: null, task: { taskId: row.taskId, state: 'RUNNING' } as Task })),
    onStarted: row => { started.push(row.taskId); },
  })).rejects.toThrow('statement timeout');
  expect(claims).toBe(2); expect(started).toEqual(requests.slice(0, 4).map(row => row.workerId));
});

test('shutdown after a claim leaves release to the fenced shutdown path', async () => {
  let stopping = false, starts = 0;
  await refillFleetBatches(requests, {
    batchSize: 4, shouldStop: () => stopping,
    lease: async rows => { stopping = true; return leased(rows); },
    start: async () => { starts++; return []; }, onStarted: () => { throw new Error('Must not dispatch'); },
  });
  expect(starts).toBe(0);
});

test('contended lanes and rejected starts are never dispatched as running', async () => {
  const dispatched: string[] = []; let starts = 0;
  await refillFleetBatches(requests.slice(0, 8), {
    batchSize: 4, shouldStop: () => false,
    lease: async rows => rows[0].agentNumber === 1 ? [] : leased(rows),
    start: async rows => { starts++; return rows.map(row => ({ ...row, ok: false, error: 'Lease lost', task: null })); },
    onStarted: row => { dispatched.push(row.taskId); },
  });
  expect(starts).toBe(1); expect(dispatched).toEqual([]);
});
