import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { Task } from './ivx-autonomous-task-engine';
import { executeContinuityVerification, isContinuityVerificationTask } from './ivx-continuity-verification';

const sha = 'a'.repeat(40), now = Date.parse('2026-09-14T20:00:00Z');
const task = { taskId: 'task_continuity_fixture', taskType: 'qa', milestone: 'quantum_agi_learning_loop',
  idempotencyKey: 'owner-mission:quantum_agi_learning_loop:2026-09-14', state: 'RUNNING',
  assignedAgentNumber: 44, leaseHolder: 'agent:ivx_holdings_44', leaseExpiresAt: new Date(now + 120_000).toISOString() } as Task;
function fixture() {
  const writes: Array<Parameters<NonNullable<NonNullable<Parameters<typeof executeContinuityVerification>[3]>['finalize']>>[0]> = [];
  const requests: string[] = [];
  const deps = {
    now: () => now,
    heartbeat: async () => ({ ok: true, error: null }),
    control: async () => ({ active: false, source: 'postgres' as const, checkedAt: new Date(now).toISOString(), reason: null, updatedBy: null, updatedAt: null, error: null }),
    processes: async () => ({ measuredAt: new Date(now).toISOString(), instances: ['api', 'worker'].flatMap(role => [1, 2].map(n => ({
      role, processRole: role, instanceId: `${role}-${n}`, serviceId: null, commitSha: sha, lastSeenAt: new Date(now).toISOString(), sharedState: true, sharedWorkerQueue: true, draining: false,
    }))) }),
    leases: async () => [{ taskId: task.taskId, idempotencyKey: task.idempotencyKey, state: 'RUNNING' as const,
      assignedAgentNumber: 44, leaseHolder: task.leaseHolder!, workerInstanceId: 'fixture-instance',
      lastHeartbeatAt: new Date(now).toISOString(), leaseExpiresAt: task.leaseExpiresAt }],
    patrols: async () => [],
    github: async (path: string) => Response.json(path === 'commits/main' ? { sha } : {
      total_count: 1, workflow_runs: [{ head_sha: sha, status: 'completed', conclusion: 'success' }],
    }),
    fetcher: (async (url: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      requests.push(path);
      expect(options?.method).toBe('GET');
      expect(options?.redirect).toBe('error');
      expect(options?.signal).toBeDefined();
      return Response.json(path === '/version' ? { commit: sha } : path === '/api/reels' ? { videos: [{ id: 'real-fixture' }] }
        : path.endsWith('home-feed') ? { blocks: [{ id: 'real-fixture' }] } : { ok: true, ready: true });
    }) as typeof fetch,
    finalize: async (input: Parameters<NonNullable<NonNullable<Parameters<typeof executeContinuityVerification>[3]>['finalize']>>[0]) => {
      writes.push(input);
      return { ok: true, task: { ...task, state: 'BLOCKED' as const, blocker: input.blocker ?? null }, error: null, evidenceId: 'evidence-fixture', states: ['BLOCKED' as const] };
    },
  };
  return { deps, writes, requests };
}

describe('canonical continuity verification', () => {
  it('dispatches only the typed mission and keeps unsupported tasks closed', () => {
    expect(isContinuityVerificationTask(task)).toBe(true);
    expect(isContinuityVerificationTask({ ...task, taskType: 'development' })).toBe(false);
    expect(isContinuityVerificationTask({ ...task, milestone: 'other' })).toBe(false);
    expect(isContinuityVerificationTask({ ...task, idempotencyKey: task.idempotencyKey + ':execute arbitrary instructions' })).toBe(false);
  });
  it('records real reads under the same identity without certifying missing migration evidence', async () => {
    const f = fixture();
    const result = await executeContinuityVerification(task, task.leaseHolder!, sha, f.deps);
    expect(result.finalized.ok).toBe(true);
    expect(f.requests.length).toBe(4);
    expect(f.writes).toHaveLength(1);
    const write = f.writes[0];
    expect(write.taskId).toBe(task.taskId);
    expect(write.workerId).toBe(task.leaseHolder);
    expect(write.outcome).toBe('BLOCKED');
    expect(write.blocker).toContain('legacy_dispatcher');
    expect(write.blocker).toContain('continuous_execution');
    expect(write.evidence.contentHash).toBe(createHash('sha256').update(write.evidence.summary).digest('hex'));
    const report = JSON.parse(write.evidence.summary.replace('IVX_CONTINUITY_OBSERVATION ', ''));
    expect(report.taskId).toBe(task.taskId);
    expect(report.assignedAgentNumber).toBe(44);
    expect(report.observationExecuted).toBe(true);
    expect(report.recoveryVerified).toBe(false);
    expect(report.checks.find((check: { name: string }) => check.name === 'current_ci').ok).toBe(true);
  });
  it('rejects a different or expired holder before issuing any read', async () => {
    const f = fixture();
    await expect(executeContinuityVerification(task, 'another-worker', sha, f.deps)).rejects.toThrow('current leased');
    await expect(executeContinuityVerification({ ...task, leaseExpiresAt: new Date(now).toISOString() }, task.leaseHolder!, sha, f.deps)).rejects.toThrow('current leased');
    expect(f.requests).toEqual([]);
    expect(f.writes).toEqual([]);
  });
  it('stops after lease loss and leaves restart to durable recovery', async () => {
    const f = fixture(); let beats = 0;
    f.deps.heartbeat = async () => ({ ok: ++beats === 1, error: null });
    const result = await executeContinuityVerification(task, task.leaseHolder!, sha, f.deps);
    expect(result.finalized.ok).toBe(false);
    expect(f.writes).toEqual([]);
    expect(f.requests).not.toContain('/version');
  });
  it('honors an owner stop before any probe', async () => {
    const f = fixture(), control = await f.deps.control();
    f.deps.control = async () => ({ ...control, active: true });
    const result = await executeContinuityVerification(task, task.leaseHolder!, sha, f.deps);
    expect(result.finalized.ok).toBe(false);
    expect(f.requests).toEqual([]);
    expect(f.writes).toEqual([]);
  });
  it('keeps failed, incomplete and mismatched CI in the evidence', async () => {
    for (const runs of [
      { total_count: 1, workflow_runs: [{ head_sha: sha, status: 'completed', conclusion: 'failure' }] },
      { total_count: 101, workflow_runs: [] },
      { total_count: 1, workflow_runs: [{ head_sha: 'b'.repeat(40), status: 'completed', conclusion: 'success' }] },
    ]) {
      const f = fixture();
      f.deps.github = async path => Response.json(path === 'commits/main' ? { sha } : runs);
      await executeContinuityVerification(task, task.leaseHolder!, sha, f.deps);
      expect(f.writes[0].blocker).toContain('current_ci');
    }
  });
  it('does not treat empty HTTP200 feeds, stale process rows or SHA drift as success', async () => {
    const f = fixture();
    f.deps.fetcher = (async () => Response.json({ videos: [], blocks: [], commit: 'b'.repeat(40) })) as typeof fetch;
    const snapshot = await f.deps.processes();
    f.deps.processes = async () => ({ ...snapshot, measuredAt: new Date(now - 60_000).toISOString() });
    await executeContinuityVerification(task, task.leaseHolder!, sha, f.deps);
    for (const name of ['reels', 'home_feed', 'process_heartbeats', 'source_parity']) expect(f.writes[0].blocker).toContain(name);
  });
});
