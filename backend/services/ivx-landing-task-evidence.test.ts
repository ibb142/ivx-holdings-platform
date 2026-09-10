import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { landingTaskEvidence } from './ivx-landing-task-evidence';
import { successfulEvidence } from './ivx-fleet-slo';
import { decodeLandingResult, type LandingResultRecord } from './ivx-landing-p0-backlog';

const sha = 'a'.repeat(40);

test('one-shot Landing execution persists verifiable history without claiming current RUNNING', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ivx-evidence-contract-'));
  const moduleUrl = (name: string) => JSON.stringify(new URL(`./${name}.ts`, import.meta.url).href);
  try {
    // A separate Node process isolates the real file store and module caches.
    // No production endpoint or database is used by this integration test.
    const script = `
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { isDurableStoreConfigured } from ${moduleUrl('ivx-durable-store')};
    import { postgresAtomicQueueSelected } from ${moduleUrl('ivx-postgres-autonomous-task-store')};
    import { createTask, getAllTasks, leaseNextTask, transitionTaskState } from ${moduleUrl('ivx-autonomous-task-engine')};
    import { runRealEngineeringCycle } from ${moduleUrl('ivx-agent-real-engineering-cycle')};
    import { decodeLandingResult, landingTaskKey } from ${moduleUrl('ivx-landing-p0-backlog')};
    import { successfulEvidence, fleetTaskSignals } from ${moduleUrl('ivx-fleet-slo')};
    assert.equal(isDurableStoreConfigured(), false, 'An isolated local store is required');
    assert.equal(postgresAtomicQueueSelected(), false, 'A production queue must never be used by this test');
    const sha = ${JSON.stringify(sha)};
    process.env.RENDER_GIT_COMMIT = sha;
    globalThis.fetch = async input => {
      assert.ok(String(input).endsWith('/health'), 'Only the health probe is permitted in this test');
      await new Promise(resolve => setTimeout(resolve, 65));
      return Response.json({ ok: true, status: 'ok' });
    };
    const created = await createTask({ title: 'Health evidence integration', description: 'Synthetic health endpoint',
      taskType: 'qa', priority: 'high', assignedAgentNumber: 73, idempotencyKey: landingTaskKey(sha, 'api.health') });
    assert.ok(created.task);
    const leased = await leaseNextTask('agent:ivx_holdings_73', 73);
    assert.equal(leased.task?.taskId, created.task.taskId);
    assert.equal((await transitionTaskState(created.task.taskId, 'RUNNING')).ok, true);
    const preparedTask = (await getAllTasks()).find(task => task.taskId === created.task.taskId);
    const result = await runRealEngineeringCycle({ agentId: 'ivx_holdings_73', agentNumber: 73, sourceSha: sha, preparedTask });
    assert.equal(result.ok, true, result.error ?? 'cycle failed');
    const stored = (await getAllTasks()).find(task => task.taskId === created.task.taskId);
    assert.equal(stored.state, 'VERIFIED');
    assert.equal(stored.evidence.length, 1);
    const evidence = stored.evidence[0];
    assert.equal(evidence.commitSha, sha);
    assert.equal(evidence.contentHash, createHash('sha256').update(evidence.summary, 'utf8').digest('hex'));
    assert.equal(decodeLandingResult(evidence.summary)?.agent_number, 73);
    assert.equal(successfulEvidence(evidence, 73, sha, Date.now()), true);
    assert.equal(fleetTaskSignals(stored, Date.now(), sha).running, false);
    assert.equal(fleetTaskSignals(stored, Date.now(), sha).evidence, null, 'Historical observation does not imply RUNNING now');
    `;
    await promisify(execFile)('node', ['--import', createRequire(import.meta.url).resolve('tsx'), '--input-type=module', '-e', script],
      { cwd: root, timeout: 20000 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('FAIL, BLOCKED and zero-time PASS are preserved without productive-time certification', () => {
  const now = Date.now();
  for (const status of ['FAIL', 'BLOCKED', 'PASS'] as const) {
    const record: LandingResultRecord = { v: 1, unit_id: 'api.health', agent_number: 73, status,
      production_sha: sha, started_at: new Date(now - 1000).toISOString(), completed_at: new Date(now).toISOString(),
      productive_seconds: 0, api_checks: 1, browser_checks: 0, bugs_found: [], fixes_applied: [], blocked_reason: null,
      evidence: ['synthetic result'], repair: false };
    const evidence = { ...landingTaskEvidence(record, 'continuous-patrol:api.health', 'production_verification'),
      evidenceId: 'synthetic', createdAt: new Date(now).toISOString() };
    assert.equal(decodeLandingResult(evidence.summary)?.status, status);
    assert.equal(successfulEvidence(evidence, 73, sha, now), false);
    assert.throws(() => landingTaskEvidence({ ...record, production_sha: null }, 'api.health', 'test_result'), /SOURCE_REQUIRED/);
  }
});
