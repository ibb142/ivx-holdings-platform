import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const env = { SERVICE_ID: 'srv-d7t9ivreo5us73ftose0', RENDER_API_KEY_RECOVERED: 'fixture-render', GITHUB_SHA: 'a'.repeat(40), BINDINGS_CHANGED: 'true' };
const now = Date.parse('2026-09-11T00:00:00Z');
const deploy = { id: 'dep-fixture', commit: { id: env.GITHUB_SHA }, trigger: 'api', createdAt: new Date(now).toISOString() };
async function run(options = {}) {
  const { requestOwnerRecoveryDeploy } = await import('./owner-recovery-deploy.mjs');
  return requestOwnerRecoveryDeploy({ env, now: () => now, wait: async () => {}, ...options });
}

test('unchanged bindings never trigger a duplicate deployment while automatic rollout is pending', () => {
  const yaml = readFileSync(new URL('../../.github/workflows/ivx-112-owner-variable-recovery.yml', import.meta.url), 'utf8');
  const step = yaml.split('      - name: Trigger Render deployment when recovery credentials exist')[1]?.split('      - name:')[0];
  assert.ok(step, 'Deployment step must remain reviewable');
  const expression = step.match(/if: \$\{\{ ([\s\S]*?) \}\}/)?.[1];
  assert.ok(expression);
  const shouldRun = new Function('steps', `return (${expression});`);
  const steps = { recover: { outputs: { recovered: 'true' } }, live: { outputs: { matched: 'false' } }, bind: { outputs: { changed: 'false' } } };
  assert.equal(shouldRun(steps), false, 'Unchanged credentials must observe the existing automatic rollout');
  steps.bind.outputs.changed = 'true';
  assert.equal(shouldRun(steps), true, 'A verified environment change still requires deployment');
  steps.recover.outputs.recovered = 'false';
  assert.equal(shouldRun(steps), false, 'Missing credentials must never authorize deployment');
});

test('the deployment client does no network work for unchanged bindings', async () => {
  const receipt = await run({ env: { ...env, BINDINGS_CHANGED: 'false' }, fetchImpl: async () => { throw Error('Unexpected network call'); } });
  assert.equal(receipt.requested, false);
});

test('a changed binding requests the exact commit once and records its returned deployment ID', async () => {
  const calls = [];
  const receipt = await run({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    assert.deepEqual(JSON.parse(init.body), { clearCache: 'do_not_clear', commitId: env.GITHUB_SHA });
    return Response.json(deploy, { status: 201 });
  } });
  assert.equal(calls.length, 1);
  assert.equal(receipt.deployId, deploy.id);
  assert.equal(JSON.stringify(receipt).includes(env.RENDER_API_KEY_RECOVERED), false);
});

test('a queued 202 without an ID is reconciled by a read, without a second POST', async () => {
  const methods = [];
  const receipt = await run({ fetchImpl: async (_url, init) => {
    methods.push(init.method);
    return init.method === 'POST' ? new Response(null, { status: 202 }) : Response.json([{ deploy }]);
  } });
  assert.deepEqual(methods, ['POST', 'GET']);
  assert.equal(receipt.deployId, deploy.id);
  assert.equal(receipt.identityRecoveredByRead, true);
});

test('a lost response is reconciled without replaying the accepted deployment', async () => {
  const methods = [];
  const receipt = await run({ fetchImpl: async (_url, init) => {
    methods.push(init.method);
    if (init.method === 'POST') throw Error('Response lost');
    return Response.json([{ deploy }]);
  } });
  assert.deepEqual(methods, ['POST', 'GET']);
  assert.equal(receipt.deployId, deploy.id);
});

test('old, wrong-SHA, or ambiguous deployments cannot resolve an uncertain request', async () => {
  for (const rows of [[{ deploy: { ...deploy, createdAt: '2026-09-10T00:00:00Z' } }], [{ deploy: { ...deploy, commit: { id: 'b'.repeat(40) } } }], [{ deploy }, { deploy: { ...deploy, id: 'dep-other' } }]]) {
    const methods = [];
    await assert.rejects(run({ fetchImpl: async (_url, init) => {
      methods.push(init.method);
      return init.method === 'POST' ? new Response(null, { status: 202 }) : Response.json(rows);
    } }), /identity remains uncertain/);
    assert.equal(methods.filter(method => method === 'POST').length, 1);
    assert.ok(methods.filter(method => method === 'GET').length <= 3);
  }
});

test('explicit rejection and invalid service identity fail without mutation replay', async () => {
  let calls = 0;
  await assert.rejects(run({ fetchImpl: async () => { calls++; return new Response(null, { status: 403 }); } }), /HTTP 403/);
  assert.equal(calls, 1);
  await assert.rejects(run({ env: { ...env, SERVICE_ID: 'srv-unrelated' }, fetchImpl: async () => { throw Error('Unexpected mutation'); } }), /identity mismatch/);
});
