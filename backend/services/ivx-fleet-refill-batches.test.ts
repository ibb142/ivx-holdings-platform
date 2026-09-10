import { expect, test } from 'bun:test';
import { refillFleetBatches, preparedContinuityAllowed, POSTGRES_FLEET_CLAIM_BATCH_SIZE } from './ivx-fleet-refill-batches';
import type { FleetLeaseRequest, Task } from './ivx-autonomous-task-engine';

const requests = Array.from({ length: 112 }, (_, i) => ({ workerId: `agent:${i + 1}`, agentNumber: i + 1 }));
const leased = (rows: readonly FleetLeaseRequest[]) => rows.map(row => ({ ...row, agentNumber: row.agentNumber ?? null,
  ok: true, task: { taskId: row.workerId, state: 'LEASED' } as Task, error: null, stolen: false }));
const unexpectedRelease = async () => { throw new Error('An accepted executor must keep its lease'); };

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
    onStarted: row => { started.push(row.taskId); return true; }, release: unexpectedRelease,
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
    onStarted: row => { started.push(row.taskId); return true; }, release: unexpectedRelease,
  })).rejects.toThrow('statement timeout');
  expect(claims).toBe(2); expect(started).toEqual(requests.slice(0, 4).map(row => row.workerId));
});

test('shutdown after a claim releases unaccepted leases without dispatch', async () => {
  let stopping = false, starts = 0;
  const released: string[] = [];
  await refillFleetBatches(requests, {
    batchSize: 4, shouldStop: () => stopping,
    lease: async rows => { stopping = true; return leased(rows); },
    start: async () => { starts++; return []; }, onStarted: () => { throw new Error('Must not dispatch'); },
    release: async row => { released.push(row.taskId); },
  });
  expect(starts).toBe(0);
  expect(released).toEqual(requests.slice(0,4).map(row => row.workerId));
});

test('contended lanes and rejected starts are never dispatched as running', async () => {
  const dispatched: string[] = []; let starts = 0;
  const released: string[] = [];
  await refillFleetBatches(requests.slice(0, 8), {
    batchSize: 4, shouldStop: () => false,
    lease: async rows => rows[0].agentNumber === 1 ? [] : leased(rows),
    start: async rows => { starts++; return rows.map(row => ({ ...row, ok: false, error: 'Lease lost', task: null })); },
    onStarted: row => { dispatched.push(row.taskId); return true; },
    release: async row => { released.push(row.taskId); },
  });
  expect(starts).toBe(1); expect(dispatched).toEqual([]);
  expect(released).toEqual(requests.slice(4,8).map(row => row.workerId));
});

test('physical prepared work ignores a stale display task, preserving owner and local execution gates', () => {
  const input = { enabled: true, stopping: false, hasLocalRun: false, atCapacity: false,
    state: { pauseState: false, disabledState: false, health: 'healthy', activeTaskId: 'previous-completed-task' } };
  expect(preparedContinuityAllowed(input)).toBe(true);
  for (const patch of [{ enabled: false }, { stopping: true }, { hasLocalRun: true }, { atCapacity: true }, { state: undefined }]) {
    expect(preparedContinuityAllowed({ ...input, ...patch })).toBe(false);
  }
  for (const patch of [{ pauseState: true }, { disabledState: true }, { health: 'failed' }]) {
    expect(preparedContinuityAllowed({ ...input, state: { ...input.state, ...patch } })).toBe(false);
  }
});
