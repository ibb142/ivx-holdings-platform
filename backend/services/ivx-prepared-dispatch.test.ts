import { expect, test } from 'bun:test';
import { refillFleetBatches } from './ivx-fleet-refill-batches';
import type { FleetLeaseRequest, Task } from './ivx-autonomous-task-engine';

const requests = Array.from({ length: 4 }, (_, i) => ({ workerId: `agent:${i + 1}`, agentNumber: i + 1 }));
const leased = (rows: readonly FleetLeaseRequest[]) => rows.map(row => ({ ...row, agentNumber: row.agentNumber ?? null,
  ok: true, task: { taskId: row.workerId, state: 'LEASED' } as Task, error: null, stolen: false }));

test('a refused local executor releases its RUNNING lease immediately', async () => {
  const rows = requests.slice(0,4);
  const state = new Map<string,string>();
  const executed: string[] = [];
  await refillFleetBatches(rows, {
    batchSize: 4, shouldStop: () => false, lease: async items => leased(items),
    start: async items => items.map(row => { state.set(row.taskId, 'RUNNING'); return { ...row, ok: true, error: null, task: { taskId: row.taskId, state: 'RUNNING', leaseHolder: row.workerId, idempotencyKey: `mission:${row.taskId}` } as Task }; }),
    onStarted: async row => { if (row.taskId === rows[1].workerId) return false; executed.push(row.taskId); return true; },
    release: async row => { expect(row.workerId).toBe(row.taskId); state.set(row.taskId, 'QUEUED'); },
  });
  expect(state.get(rows[1].workerId)).toBe('QUEUED');
  expect(executed).toHaveLength(3);
  expect(executed.every(id => state.get(id) === 'RUNNING')).toBe(true);
});

test('callback failure releases rejected work and still dispatches the remaining lanes', async () => {
  const released: string[] = [];
  const executed: string[] = [];
  const failure = new Error('local executor unavailable');
  const result = refillFleetBatches(requests.slice(0,4), {
    batchSize: 4, shouldStop: () => false, lease: async rows => leased(rows),
    start: async rows => rows.map(row => ({ ...row, ok: true, error: null, task: { taskId: row.taskId, state: 'RUNNING', leaseHolder: row.workerId, idempotencyKey: `mission:${row.taskId}` } as Task })),
    onStarted: row => { if (row.taskId === requests[1].workerId) throw failure; executed.push(row.taskId); return true; },
    release: async row => { released.push(row.taskId); },
  });
  await expect(result).rejects.toThrow('FLEET_DISPATCH_FAILED');
  await expect(result.catch(error => error.errors)).resolves.toEqual([failure]);
  expect(released).toEqual([requests[1].workerId]);
  expect(executed).toEqual([requests[0].workerId, requests[2].workerId, requests[3].workerId]);
});

test('shutdown after durable start releases every task before returning', async () => {
  let stopping = false;
  const released: string[] = [];
  await refillFleetBatches(requests.slice(0,4), {
    batchSize: 4, shouldStop: () => stopping, lease: async rows => leased(rows),
    start: async rows => { stopping = true; return rows.map(row => ({ ...row, ok: true, error: null, task: { taskId: row.taskId, state: 'RUNNING', leaseHolder: row.workerId, idempotencyKey: `mission:${row.taskId}` } as Task })); },
    onStarted: () => { throw new Error('Dispatch forbidden after stop'); },
    release: async row => { released.push(row.taskId); },
  });
  expect(released).toEqual(requests.slice(0,4).map(row => row.workerId));
});
