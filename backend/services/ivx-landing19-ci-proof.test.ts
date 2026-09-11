import { test, afterEach, spyOn } from 'bun:test';
import assert from 'node:assert/strict';
import { executeLandingUnit, __resetLandingExecutorCachesForTests } from './ivx-landing-p0-executor';
import type { LandingUnit } from './ivx-landing-p0-backlog';
afterEach(__resetLandingExecutorCachesForTests);
const sha = 'a'.repeat(40), check = 'registration.optional-picture';
const unit: LandingUnit = { unitId: check, title: check, lane: 'registration', severity: 'P2', workstream: 'D_REGISTRATION', check: { kind: 'ci', workflow: 'IVX Landing 19 QA', check } };
const context = { agentId: 'synthetic-agent', agentNumber: 56, taskId: 'synthetic-task', sourceSha: sha, productionSha: sha, repair: false };
async function result(steps: unknown[], jobSha = sha) {
  return executeLandingUnit(unit, context, { fetchImpl: (async (url: RequestInfo | URL) => String(url).includes('/jobs?')
    ? Response.json({ jobs: [{ id: 2, head_sha: jobSha, html_url: 'https://github.com/example/jobs/2', steps }] })
    : Response.json({ workflow_runs: [{ id: 1, name: 'IVX Landing 19 QA', status: 'in_progress', conclusion: null, head_sha: sha, html_url: 'https://github.com/example/runs/1', updated_at: '2026-09-10T00:00:00Z' }] })) as typeof fetch });
}
test('an individually verified web step can pass while an unrelated job is still running', async () => {
  assert.equal((await result([{ name: check, status: 'completed', conclusion: 'success' }])).record.status, 'PASS');
});
test('missing, skipped, cancelled or unfinished evidence never passes', async () => {
  for (const steps of [[], [{ name: check, status: 'in_progress', conclusion: null }], [{ name: check, status: 'completed', conclusion: 'skipped' }], [{ name: check, status: 'completed', conclusion: 'cancelled' }]]) {
    __resetLandingExecutorCachesForTests();
    assert.equal((await result(steps)).record.status, 'BLOCKED');
  }
});
test('a successful step for another commit cannot certify production', async () => {
  assert.equal((await result([{ name: check, status: 'completed', conclusion: 'success' }], 'b'.repeat(40))).record.status, 'BLOCKED');
});
test('a failed named assertion remains FAIL', async () => {
  assert.equal((await result([{ name: check, status: 'completed', conclusion: 'failure' }])).record.status, 'FAIL');
});
test('ambiguous duplicated evidence cannot certify a unit', async () => {
  const step = { name: check, status: 'completed', conclusion: 'success' };
  assert.equal((await result([step, step])).record.status, 'BLOCKED');
});

test('cached CI preserves its source time and refreshes a completed run within 60 seconds', async () => {
  let clock = Date.parse('2026-09-11T12:00:00Z'), calls = 0, completed = false;
  const now = spyOn(Date, 'now').mockImplementation(() => clock);
  const ciUnit: LandingUnit = { ...unit, check: { kind: 'ci', workflow: 'Fleet CI', check: 'tests' } };
  const fetchImpl = (async () => {
    calls++;
    return Response.json({ workflow_runs: [{ id: 99, name: 'Fleet CI', status: completed ? 'completed' : 'in_progress',
      conclusion: completed ? 'success' : null, head_sha: sha, html_url: 'https://github.com/example/runs/99', updated_at: new Date(clock).toISOString() }] });
  }) as typeof fetch;
  try {
    const first = await executeLandingUnit(ciUnit, context, { fetchImpl });
    assert.equal(first.record.status, 'BLOCKED');
    completed = true; clock += 59_000;
    const cached = await executeLandingUnit(ciUnit, context, { fetchImpl });
    assert.equal(cached.record.status, 'BLOCKED');
    assert.equal(cached.record.source_observed_at, first.record.source_observed_at);
    assert.notEqual(cached.record.completed_at, first.record.completed_at);
    assert.equal(calls, 1);
    clock += 1_001;
    const refreshed = await executeLandingUnit(ciUnit, context, { fetchImpl });
    assert.equal(refreshed.record.status, 'PASS');
    assert.notEqual(refreshed.record.source_observed_at, first.record.source_observed_at);
    assert.equal(calls, 2);
    assert.equal(refreshed.record.activity?.category, 'qa');
    assert.deepEqual(refreshed.full.activity, refreshed.record.activity);
  } finally { now.mockRestore(); }
});
