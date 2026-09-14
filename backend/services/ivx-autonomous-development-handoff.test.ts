import { expect, test } from 'bun:test';
import { runDevelopmentHandoff, type DevelopmentHandoffDependencies } from './ivx-autonomous-development-handoff';
import { developmentJobId, developmentOwnerLane } from './ivx-development-job-identity';
import type { Task } from './ivx-autonomous-task-engine';

function fixture() {
  const task: Task = {
    taskId: 'task-handoff', title: 'Fix App Guide', description: 'Repair native navigation.', taskType: 'development',
    state: 'RUNNING', objectiveId: null, parentTaskId: null, idempotencyKey: 'app-guide', assignedAgentNumber: 1,
    assignedEngine: 'ivx_mobile_lead', priority: 'critical', dependencies: [], executionOrder: 0,
    acceptanceCriteria: [{ id: 'device', description: 'Navigation passes', verificationMethod: 'test_pass', met: false, evidence: null }],
    leaseHolder: 'worker-1', leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(), lastHeartbeatAt: null,
    retryCount: 0, maxRetries: 3, error: null, blocker: null, evidence: [], filesChanged: [], recordsChanged: 0,
    commitSha: null, deploymentId: null, approvalId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    startedAt: null, completedAt: null, traceId: null,
  };
  type Job = NonNullable<Awaited<ReturnType<DevelopmentHandoffDependencies['readJob']>>>;
  let job: Job | null = null;
  const writes: Array<Parameters<DevelopmentHandoffDependencies['checkpoint']>[0]> = [];
  let enqueues = 0, heartbeats = 0, waits = 0, reads = 0;
  const deps: DevelopmentHandoffDependencies = {
    mayPrepareCode: () => true, now: Date.now,
    checkpoint: async input => { writes.push(input); return { ok: true, task, error: null }; },
    heartbeat: async () => { heartbeats++; return { ok: true, error: null }; },
    readJob: async () => { reads++; return job; },
    enqueue: async input => { enqueues++; job = { jobId: developmentJobId(task.taskId), input, status: 'queued', result: null }; return { job }; },
    wait: async () => { waits++; if (job) job = { ...job, status: 'completed', result: { commitSha: 'a'.repeat(40), deployId: null, changedFiles: ['expo/app/app-guide.tsx'] } }; },
  };
  return { task, deps, writes, counts: () => ({ enqueues, heartbeats, waits, reads }), setJob: (value: Job | null) => { job = value; } };
}

test('persists identity before enqueue, renews the lease and retains acceptance pending', async () => {
  const f = fixture();
  const result = await runDevelopmentHandoff(f.task, 'worker-1', undefined, f.deps);
  expect(result.ok).toBe(true);
  expect(result.error).toContain('DEVELOPER_ACCEPTANCE_PENDING');
  expect(f.writes[0]).toMatchObject({ state: 'RUNNING', jobId: developmentJobId(f.task.taskId) });
  expect(f.counts()).toMatchObject({ enqueues: 1, waits: 1, heartbeats: 2 });
  expect(f.writes.at(-1)).toMatchObject({ state: 'BLOCKED', commitSha: 'a'.repeat(40), filesChanged: ['expo/app/app-guide.tsx'] });
  expect(f.task.acceptanceCriteria[0]?.met).toBe(false);
});

test('112 identities keep distinct existing agent lanes without creating another lane per retry', () => {
  const lanes = Array.from({ length: 112 }, (_, i) => developmentOwnerLane(i + 1));
  expect(new Set(lanes).size).toBe(112);
  expect(lanes[0]).toBe('campaign-agent-1');
  expect(developmentOwnerLane(1)).toBe(lanes[0]);
  expect(() => developmentOwnerLane(null)).toThrow('assigned fleet agent');
});

test('lost enqueue acknowledgement and a restarted observer reuse a terminal job', async () => {
  const f = fixture(); const enqueue = f.deps.enqueue;
  f.deps.enqueue = async input => { const { job } = await enqueue(input); f.setJob({ ...job, status: 'blocked' }); throw new Error('ack lost'); };
  expect((await runDevelopmentHandoff(f.task, 'worker-1', undefined, f.deps)).error).toContain('DEVELOPER_JOB_BLOCKED');
  expect((await runDevelopmentHandoff(f.task, 'worker-1', undefined, f.deps)).error).toContain('DEVELOPER_JOB_BLOCKED');
  expect(f.counts().enqueues).toBe(1);
});

test('cannot enqueue without the current lease or explicitly enabled repair policy', async () => {
  const f = fixture();
  f.deps.checkpoint = async () => ({ ok: false, task: null, error: 'lease lost' });
  expect((await runDevelopmentHandoff(f.task, 'worker-1', undefined, f.deps)).ok).toBe(false);
  expect(f.counts()).toMatchObject({ enqueues: 0, reads: 0 });
  const g = fixture(); g.deps.mayPrepareCode = () => false;
  expect((await runDevelopmentHandoff(g.task, 'worker-1', undefined, g.deps)).error).toContain('OWNER_POLICY_REQUIRED');
  expect(g.counts().enqueues).toBe(0);
});

test('protected operations and owner stop do not create developer work', async () => {
  const f = fixture(); f.task.description = 'DROP TABLE production_data';
  expect((await runDevelopmentHandoff(f.task, 'worker-1', undefined, f.deps)).error).toContain('OWNER_GATE');
  expect(f.counts().enqueues).toBe(0);
  const g = fixture();
  expect((await runDevelopmentHandoff(g.task, 'worker-1', () => false, g.deps)).ok).toBe(false);
  expect(g.writes).toHaveLength(0);
});

test('cannot accept a foreign job or turn unreadable storage into another execution', async () => {
  const f = fixture(); const enqueue = f.deps.enqueue;
  f.deps.enqueue = async input => { const { job } = await enqueue(input); return { job: { ...job, input: { ...input, taskId: 'other-task' } } }; };
  expect((await runDevelopmentHandoff(f.task, 'worker-1', undefined, f.deps)).error).toContain('IDENTITY_MISMATCH');
  const g = fixture(); g.deps.readJob = async () => { throw new Error('storage unavailable'); };
  expect((await runDevelopmentHandoff(g.task, 'worker-1', undefined, g.deps)).ok).toBe(false);
  expect(g.counts().enqueues).toBe(0);
});
