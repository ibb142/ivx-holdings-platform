import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as engine from './ivx-autonomous-task-engine';
import * as executor from './ivx-landing-p0-executor';
import { landingPatrolKey } from './ivx-landing-p0-backlog';
import { runLandingPatrolSession } from './ivx-landing-continuous-patrol';

const sha = 'a'.repeat(40);
const owner = 'agent:ivx_holdings_53';
const restore: Array<() => void> = [];
let task: engine.Task;
let persist: ReturnType<typeof spyOn<typeof engine, 'recordLeasedTaskEvidence'>>;
let release: ReturnType<typeof spyOn<typeof engine, 'releaseLease'>>;
let observe: ReturnType<typeof spyOn<typeof executor, 'executeLandingUnit'>>;
beforeEach(() => {
  const at = new Date().toISOString();
  task = { taskId: 'patrol-53', idempotencyKey: landingPatrolKey(sha, 53),
    state: 'RUNNING', leaseHolder: owner, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    startedAt: at, evidence: [], recordsChanged: 4, retryCount: 2 } as engine.Task;
  observe = spyOn(executor, 'executeLandingUnit').mockResolvedValue({
    record: { v: 1, unit_id: 'registration.required-cell', agent_number: 53, status: 'PASS',
      started_at: at, completed_at: at, productive_seconds: 0.03, production_sha: sha,
      api_checks: 1, browser_checks: 0, bugs_found: [], fixes_applied: [], blocked_reason: null,
      evidence: ['isolated probe'], repair: false },
    full: { productive_seconds: 0.03 } as executor.LandingEvidenceObject,
  });
  persist = spyOn(engine, 'recordLeasedTaskEvidence').mockRejectedValue(new Error('canceling statement due to statement timeout'));
  release = spyOn(engine, 'releaseLease').mockResolvedValue({ ok: true, error: null });
  restore.push(() => observe.mockRestore(), () => persist.mockRestore(), () => release.mockRestore());
});
afterEach(() => { restore.splice(0).forEach(fn => fn()); });
const run = () => runLandingPatrolSession({ task, agentId: 'ivx_holdings_53', agentNumber: 53,
  sourceSha: sha, shouldContinue: () => true });

test('a failed observation write relinquishes its lease and remains a failed result', async () => {
  const result = await run();
  expect(release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith('patrol-53', owner);
  expect(result.ok).toBe(false);
  expect(result.action).toBe('PATROL_SESSION_LOST');
  expect(result.error).toBe('canceling statement due to statement timeout');
  expect(result.evidenceIds).toEqual([]);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(task.retryCount).toBe(2);
  expect(task.evidence).toEqual([]);
});

test('lease authority rejection is retained and cleanup never forces release', async () => {
  persist.mockResolvedValue({ ok: false, task: null, evidenceId: null, error: 'Worker lease lost or expired.' });
  release.mockResolvedValue({ ok: false, error: 'Not the lease holder.' });
  const result = await run();
  expect(release).toHaveBeenCalledWith('patrol-53', owner);
  expect(release).toHaveBeenCalledTimes(1);
  expect(result.ok).toBe(false);
  expect(result.error).toBe('Worker lease lost or expired.');
  expect(result.evidenceIds).toEqual([]);
  expect(persist).toHaveBeenCalledTimes(1);
});

test('a lost acknowledgement cannot turn into a successful proof or another observation', async () => {
  persist.mockRejectedValue(new Error('response lost after commit'));
  // The existing releaseLease reads current durable state and rejects a row
  // already queued by the completed write; the patrol must honor that result.
  release.mockResolvedValue({ ok: false, error: 'Not the lease holder.' });
  const result = await run();
  expect(result.ok).toBe(false);
  expect(result.error).toBe('response lost after commit');
  expect(result.evidenceIds).toEqual([]);
  expect(release).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(persist).toHaveBeenCalledTimes(1);
});

test('unavailable cleanup preserves the original failure without a retry loop', async () => {
  release.mockRejectedValue(new Error('database still unavailable'));
  const result = await run();
  expect(result.ok).toBe(false);
  expect(result.error).toBe('canceling statement due to statement timeout');
  expect(release).toHaveBeenCalledTimes(1);
  expect(persist).toHaveBeenCalledTimes(1);
});

test('a durably queued observation needs no extra lease write', async () => {
  persist.mockResolvedValue({ ok: true, task: { ...task, state: 'QUEUED', leaseHolder: null,
    leaseExpiresAt: null, recordsChanged: 5 }, evidenceId: 'real-fixture-evidence', error: null });
  const result = await run();
  expect(result.ok).toBe(true);
  expect(result.action).toBe('PATROL_SESSION_ENDED');
  expect(result.evidenceIds).toEqual(['real-fixture-evidence']);
  expect(release).not.toHaveBeenCalled();
});
