import assert from 'node:assert/strict';
import test from 'node:test';
import { validateScope, reviewChecks, taskSummary, requireCheckpoint, requireRecovery, requireDuplicate, requireUnattempted, readonlyObserver, REPO, BRANCH, TARGET } from './phase1-controlled-recovery.mjs';

const scope = () => ({ GITHUB_REPOSITORY: REPO, GITHUB_ACTOR: 'ibb142', GITHUB_EVENT_NAME: 'pull_request',
  IVX_QA_HEAD_BRANCH: BRANCH, IVX_TARGET_SHA: TARGET, IVX_QA_SOURCE_SHA: 'a'.repeat(40), IVX_QA_PR: '1',
  IVX_PHASE1_RESTART_AUTHORIZATION: 'controlled-api-then-worker-once', IVX_SYSTEM_KEY: 'test', RENDER_API_KEY: 'test', GH_TOKEN: 'test',
  SUPABASE_URL: 'https://kvclcdjmjghndxsngfzb.supabase.co', SUPABASE_ACCESS_TOKEN: 'fixture' });
test('hosted actions require the exact actor, repository, branch, deployment and project', () => {
  validateScope(scope());
  for (const field of ['GITHUB_REPOSITORY','GITHUB_ACTOR','GITHUB_EVENT_NAME','IVX_QA_HEAD_BRANCH','IVX_TARGET_SHA',
    'IVX_QA_SOURCE_SHA','IVX_QA_PR','IVX_PHASE1_RESTART_AUTHORIZATION','IVX_SYSTEM_KEY','RENDER_API_KEY','GH_TOKEN','SUPABASE_URL','SUPABASE_ACCESS_TOKEN']) {
    assert.throws(() => validateScope({ ...scope(), [field]: '' }), field);
  }
  assert.throws(() => validateScope({ ...scope(), SUPABASE_URL: 'https://other.supabase.co' }));
});

test('any prior durable action reservation prevents replay before creating another fixture', () => {
  requireUnattempted([], '1');
  requireUnattempted([{ context: 'unrelated', state: 'pending' }], '1');
  for (const role of ['api','worker']) for (const state of ['pending','failure','success']) {
    assert.throws(() => requireUnattempted([{ context: `qa/phase1-controlled-restart-1-${role}`, state }], '1'));
  }
  assert.throws(() => requireUnattempted(null, '1'));
});

test('the observer sends bound values only to the same-project read-only endpoint', async () => {
  const calls = [];
  const db = readonlyObserver('fixture', async (url, init) => { calls.push({ url, init }); return new Response('[{"task_id":"original"}]', { status: 201 }); });
  const query = 'select task_id from public.ivx_autonomous_tasks where task_id=$1';
  const parameters = ["quote' and ; SQL remains a value"];
  assert.deepEqual((await db.query(query, parameters)).rows, [{ task_id: 'original' }]);
  assert.equal(calls[0].url, 'https://api.supabase.com/v1/projects/kvclcdjmjghndxsngfzb/database/query/read-only');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query, parameters });
  assert.equal(calls[0].init.redirect, 'error');
  await assert.rejects(db.query('delete from public.ivx_autonomous_tasks'));
  assert.equal(calls.length, 1);
  await assert.rejects(readonlyObserver('fixture', async () => new Response('{}', { status: 403 })).query(query, parameters));
  await assert.rejects(readonlyObserver('fixture', async () => new Response('{}', { status: 201 })).query(query, parameters));
});

const checks = () => ['Restart acceptance scope and verdict checks','qa-suite','scan-secrets'].map((name,i) => ({ id: i+1, name, status: 'completed', conclusion: 'success' }));
test('failed, missing and unfinished repository checks cannot authorize a restart', () => {
  assert.equal(reviewChecks(checks()), true);
  assert.throws(() => reviewChecks([]));
  assert.throws(() => reviewChecks(checks().slice(1)));
  assert.throws(() => reviewChecks([...checks(), { id: 4, name: 'browser', status: 'completed', conclusion: 'failure' }]));
  assert.equal(reviewChecks([...checks(), { id: 4, name: 'browser', status: 'in_progress', conclusion: null }]), false);
  assert.equal(reviewChecks([...checks(), { id: 4, name: 'Controlled API and worker restart acceptance', status: 'in_progress' }]), true);
  assert.equal(reviewChecks([...checks(), { id: 5, name: 'qa-suite', status: 'in_progress' }]), false);
});

function snapshots() {
  const first = { evidenceId: 'e-1', contentHash: 'digest-1', commitSha: TARGET, summary: 'committed native observation' };
  const row = { task_id: 'task-1', idempotency_key: 'key-1', state: 'RUNNING', worker_instance_id: 'old', version: 7,
    payload: { taskId: 'task-1', idempotencyKey: 'key-1', recordsChanged: 3, commitSha: TARGET, evidence: [first] } };
  const before = taskSummary(row), after = { ...before, observations: 4, version: 10 };
  const archive = [{ evidence_id: 'e-1', evidence: first, worker_instance_id: 'old', recorded_at: '2026-09-12T14:00:00Z', measurement: { identity: 'measurement-1' } },
    { evidence_id: 'e-2', evidence: { ...first, evidenceId: 'e-2', summary: 'next native observation' }, worker_instance_id: 'new', recorded_at: '2026-09-12T14:01:00Z', measurement: { identity: 'measurement-2', outcome: 'PASS' } }];
  return { row, before, after, archive };
}
test('a checkpoint stays verifiable after normal hot-payload retention using the immutable archive', () => {
  const { before, after, archive } = snapshots();
  requireCheckpoint(before, { ...after, evidence: [] }, archive);
  const results = requireRecovery(before, after, archive, id => id === 'new', '2026-09-12T14:00:30Z');
  assert.equal(results.length, 1); assert.equal(results[0].worker, 'new');
});
test('lost or changed identity, checkpoint, commit, cursor and duplicate effects fail acceptance', () => {
  const { before, after, archive } = snapshots();
  for (const change of [{ taskId: 'other' }, { key: 'other' }, { commitSha: 'b'.repeat(40) }, { observations: 2 }, { version: 6 }]) {
    assert.throws(() => requireCheckpoint(before, { ...after, ...change }, archive));
  }
  assert.throws(() => requireCheckpoint(before, after, archive.slice(1)));
  const changed = structuredClone(archive); changed[0].evidence.contentHash = 'tampered';
  assert.throws(() => requireCheckpoint(before, after, changed));
  assert.throws(() => requireCheckpoint(before, after, [...archive, archive[1]]));
  const duplicated = structuredClone(archive); duplicated[1].measurement.identity = duplicated[0].measurement.identity;
  assert.throws(() => requireCheckpoint(before, after, duplicated));
  assert.throws(() => taskSummary({ ...snapshots().row, task_id: 'other' }));
});
test('a topology change alone or an old worker result cannot certify checkpoint recovery', () => {
  const { before, after, archive } = snapshots();
  assert.throws(() => requireRecovery(before, before, archive, id => id === 'new', '2026-09-12T14:00:30Z'));
  assert.throws(() => requireRecovery(before, after, archive, id => id === 'old', '2026-09-12T14:00:30Z'));
  assert.throws(() => requireRecovery(before, after, archive, id => id === 'new', '2026-09-12T14:02:30Z'));
  const wrongSha = structuredClone(archive); wrongSha[1].evidence.commitSha = 'b'.repeat(40);
  assert.throws(() => requireRecovery(before, after, wrongSha, id => id === 'new', '2026-09-12T14:00:30Z'));
});
test('idempotent API traffic must return the original task with an explicit duplicate receipt', () => {
  requireDuplicate({ ok: true, duplicate: true, task: { taskId: 'original' } }, 'original');
  for (const reply of [{ ok: false }, { ok: true, duplicate: false, task: { taskId: 'original' } },
    { ok: true, duplicate: true, task: { taskId: 'different' } }]) assert.throws(() => requireDuplicate(reply, 'original'));
});
