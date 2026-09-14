import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { buildFleetDashboardSignals } from './ivx-fleet-dashboard-signals';
import { buildFleetSloSnapshot } from './ivx-fleet-slo';
import { visibleFleetSignals } from '../../expo/shared/ivx/fleet-signals';
import { autonomousWorkerInstanceId } from './ivx-postgres-autonomous-task-store';
import type { Task } from './ivx-autonomous-task-engine';
import { latestFleetFileObservation } from './ivx-fleet-file-observation';
import { visibleFleetFileObservation } from '../../expo/shared/ivx/fleet-signals';

const now = Date.parse('2026-09-08T20:00:00Z');
const sha = 'a'.repeat(40);
const iso = (offset = 0) => new Date(now + offset).toISOString();
function observation() {
  return { measuredAt: iso(), states: [{ agentNumber: 1, lastHeartbeatAt: iso(-1000) }],
    assignments: [{ agentNumber: 2, taskCount: 8 }], activeTasks: [] as Task[], instances: [] };
}
function runningTask(): Task {
  const summary = 'LANDING_P0_RESULT ' + JSON.stringify({ v: 1, agent_number: 3, status: 'PASS', production_sha: sha,
    started_at: iso(-2000), completed_at: iso(-1000), productive_seconds: 1, api_checks: 1, browser_checks: 0, evidence: ['GET /health 200'] });
  return { taskId: 'task-3', assignedAgentNumber: 2, leaseHolder: 'agent:ivx_holdings_3', state: 'RUNNING', leaseExpiresAt: iso(60_000),
    lastHeartbeatAt: iso(-1000), evidence: [{ evidenceId: 'proof-3', source: 'api.health', contentHash: createHash('sha256').update(summary).digest('hex'),
      createdAt: iso(-1000), commitSha: sha, summary, evidenceType: 'production_verification', deploymentId: null }] } as Task;
}
describe('shared fleet observation', () => {
  test('heartbeat only and eight pending assignments yield zero running/productive agents', () => {
    const result = buildFleetDashboardSignals(observation(), sha, now);
    expect(result.counts).toEqual({ heartbeat: 1, assigned: 1, running: 0, productive: 0, observed: null });
    expect(result.agents).toHaveLength(112);
    expect(result.agents[0].assignedTasks).toBe(0);
    expect(result.agents[1].heartbeatFresh).toBe(false);
    expect(result.agents[1].assignedTasks).toBe(8);
  });
  test('uses exactly the SLO proof and attributes work stealing to the lease holder', () => {
    const raw = observation(); raw.activeTasks = [runningTask()];
    const result = buildFleetDashboardSignals(raw, sha, now);
    expect(result.counts.productive).toBe(buildFleetSloSnapshot(raw.activeTasks, now, sha).productive_agents);
    expect(result.agents[1].productive).toBe(false);
    expect(result.agents[2].productive).toBe(true);
    expect(result.agents[2].evidence?.taskId).toBe('task-3');
    raw.activeTasks[0].evidence[0].contentHash = 'b'.repeat(64);
    expect(buildFleetDashboardSignals(raw, sha, now).counts.productive).toBe(0);
  });
  test('expired lease, future heartbeat and a new production SHA cannot certify work', () => {
    const raw = observation(); raw.activeTasks = [runningTask()];
    expect(buildFleetDashboardSignals(raw, 'b'.repeat(40), now).counts.productive).toBe(0);
    raw.activeTasks[0].leaseExpiresAt = iso(-1);
    expect(buildFleetDashboardSignals(raw, sha, now).counts.running).toBe(0);
    raw.states[0].lastHeartbeatAt = iso(30_000);
    expect(buildFleetDashboardSignals(raw, sha, now).counts.heartbeat).toBe(0);
  });
  test('RUNNING with a stale heartbeat is not live execution even while its lease is valid', () => {
    const raw = observation(); raw.activeTasks = [runningTask()];
    raw.activeTasks[0].lastHeartbeatAt = iso(-60_001);
    const result = buildFleetDashboardSignals(raw, sha, now);
    expect(result.counts.running).toBe(0);
    expect(result.agents[2].productive).toBe(false);
    expect(buildFleetSloSnapshot(raw.activeTasks, now, sha).running_agents).toBe(0);
  });
  test('file and line observations come from current-attempt tool evidence and expire', () => {
    const task = runningTask(); task.startedAt = iso(-4000);
    const summary = 'Inspected backend/hono.ts lines 50–52';
    task.evidence = [{ ...task.evidence[0], evidenceId: 'file-observed', evidenceType: 'source_file_inspected',
      source: 'backend/hono.ts#L50-L52', summary, contentHash: createHash('sha256').update(summary).digest('hex') }];
    const raw = observation(); raw.activeTasks = [task];
    const result = buildFleetDashboardSignals(raw, sha, now);
    expect(result.agents[2].fileObservation).toMatchObject({ taskId: task.taskId, filePath: 'backend/hono.ts', lineStart: 50, lineEnd: 52 });
    expect(result.counts.productive).toBe(0);
    expect(visibleFleetFileObservation(result.agents[2], now + 60_001)).toBeNull();
    task.attemptStartedAt = iso();
    expect(latestFleetFileObservation(task, now)).toBeNull();
  });
  test('absent line numbers stay unknown; invalid paths and line numbers never become code locations', () => {
    const task = runningTask(); task.startedAt = iso(-4000);
    task.evidence = [{ ...task.evidence[0], evidenceType: 'source_file_changed', source: 'backend/hono.ts' }];
    expect(latestFleetFileObservation(task, now)?.lineStart).toBeNull();
    for (const source of ['../private.ts:4', '/etc/private.ts:2', 'backend/hono.ts:abc', 'backend/hono.ts:0', 'backend/hono.ts:5-2']) {
      task.evidence[0].source = source;
      expect(latestFleetFileObservation(task, now)).toBeNull();
    }
  });
  test('database truncation and stale evidence fail closed in server and disconnected UI', () => {
    const raw = observation();
    const signals = buildFleetDashboardSignals(raw, sha, now);
    expect(visibleFleetSignals(signals, now)).not.toBeNull();
    expect(visibleFleetSignals(signals, now + 15_001)).toBeNull();
    expect(visibleFleetSignals({ ...signals, counts: { ...signals.counts, productive: 112 } }, now)).toBeNull();
    expect(() => buildFleetDashboardSignals(raw, sha, now + 15_001)).toThrow('Stale');
    raw.activeTasks = Array.from({ length: 1001 }, runningTask);
    expect(() => buildFleetDashboardSignals(raw, sha, now)).toThrow('Incomplete');
  });
  test('replicas sharing a configured worker label have different fenced identities', () => {
    const base = { IVX_INTERNAL_WORKER_ID: 'shared-worker', RENDER_SERVICE_ID: 'service' };
    const a = autonomousWorkerInstanceId({ ...base, RENDER_INSTANCE_ID: 'replica-a' });
    const b = autonomousWorkerInstanceId({ ...base, RENDER_INSTANCE_ID: 'replica-b' });
    expect(a).not.toBe(b);
    expect(a).toBe(autonomousWorkerInstanceId({ ...base, RENDER_INSTANCE_ID: 'replica-a' }));
    expect(autonomousWorkerInstanceId({ ...base, IVX_INTERNAL_WORKER_ID: 'x'.repeat(400) }).length).toBeLessThan(240);
  });
});
