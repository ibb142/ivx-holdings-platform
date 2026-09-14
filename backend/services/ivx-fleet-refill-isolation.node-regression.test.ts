import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refillFleetBatches } from './ivx-fleet-refill-batches';
import type { FleetLeaseRequest, FleetTaskMutationResult, Task } from './ivx-autonomous-task-engine';

const requests = Array.from({ length: 8 }, (_, index) => ({ workerId: `agent:${index + 1}`, agentNumber: index + 1 }));
const task = (workerId: string, state = 'RUNNING') => ({ taskId: `task:${workerId}`, idempotencyKey: `mission:${workerId}`, leaseHolder: workerId, state } as Task);
const lease = async (rows: readonly FleetLeaseRequest[]) => rows.map(row => ({ ...row, agentNumber: row.agentNumber ?? null,
  ok: true, task: task(row.workerId, 'LEASED'), error: null, stolen: false }));
const result = (row: { taskId: string; workerId: string }): FleetTaskMutationResult => ({ ...row, ok: true, task: task(row.workerId), error: null });

test('a dispatch exception releases only that lease and the other seven lanes still start', async () => {
  const started: string[] = [], released: string[] = [];
  await assert.rejects(refillFleetBatches(requests, { batchSize: 4, shouldStop: () => false, lease,
    start: async rows => rows.map(result),
    onStarted: row => {
      if (row.workerId === 'agent:2') throw new TypeError("Cannot read properties of undefined (reading 'startsWith')");
      started.push(row.workerId); return true;
    }, release: async row => { released.push(row.workerId); },
  }));
  assert.deepEqual(started, ['agent:1', 'agent:3', 'agent:4', 'agent:5', 'agent:6', 'agent:7', 'agent:8']);
  assert.deepEqual(released, ['agent:2']);
});

test('missing mission identity never reaches either executor and does not block valid work', async () => {
  const started: string[] = [], released: string[] = [];
  await assert.rejects(refillFleetBatches(requests, { batchSize: 4, shouldStop: () => false, lease,
    start: async rows => rows.map(row => {
      const receipt = result(row);
      if (row.workerId === 'agent:2') delete (receipt.task as Partial<Task>).idempotencyKey;
      return receipt;
    }),
    onStarted: row => { started.push(row.workerId); return true; },
    release: async row => { released.push(row.workerId); },
  }), /FLEET_DISPATCH_FAILED/);
  assert.equal(started.includes('agent:2'), false);
  assert.equal(started.length, 7);
  assert.deepEqual(released, ['agent:2']);
});

test('duplicate and mismatched start receipts cannot dispatch a second or unrelated task', async () => {
  const started: string[] = [], released: string[] = [];
  await assert.rejects(refillFleetBatches(requests.slice(0, 4), { batchSize: 4, shouldStop: () => false, lease,
    start: async rows => [result(rows[0]), result(rows[0]),
      { ...result(rows[1]), task: task('agent:99') }, result(rows[2]), result(rows[3])],
    onStarted: row => { started.push(row.workerId); return true; },
    release: async row => { released.push(row.workerId); },
  }), /FLEET_DISPATCH_FAILED/);
  assert.deepEqual(started, ['agent:1', 'agent:3', 'agent:4']);
  assert.deepEqual(released, ['agent:2']);
});
