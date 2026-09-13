import test from 'node:test';
import assert from 'node:assert/strict';
import { readVerifiedJson, waitForOwnerRuntime } from './owner-runtime-verify.mjs';

const expectedSha = 'a'.repeat(40);
const expectedService = 'srv-d7t9ivreo5us73ftose0';
const good = () => ({ ok: true, service: { id: expectedService },
  runtime: { serviceId: expectedService, commitSha: expectedSha },
  latestDeploy: { commitSha: expectedSha, status: 'live' },
  ownerAuthEnvPresence: { IVX_OWNER_PASSWORD_BASE64: { matchesRuntime: true } } });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function harness(sequence) {
  let clock = 0;
  const calls = [];
  return { calls, run: (overrides = {}) => waitForOwnerRuntime({
    apiBase: 'https://api.ivxholding.com', token: 'test-only-token', expectedSha, expectedService,
    now: () => clock, wait: async ms => { clock += ms; },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const item = sequence[Math.min(calls.length - 1, sequence.length - 1)];
      if (item instanceof Error) throw item;
      return typeof item === 'function' ? item() : json(item);
    }, ...overrides,
  }) };
}

test('waits for a live deployment and stable current runtime after draining an old replica', async () => {
  const deploying = good(); deploying.latestDeploy.status = 'update_in_progress';
  const stale = good(); stale.runtime.commitSha = 'b'.repeat(40);
  const h = harness([deploying, stale, good(), good()]);
  assert.equal((await h.run()).runtime.commitSha, expectedSha);
  assert.equal(h.calls.length, 4);
  for (const { options } of h.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store'); assert.equal(options.body, undefined);
  }
});
test('a stale observation resets consecutive current observations', async () => {
  const stale = good(); stale.runtime.commitSha = 'b'.repeat(40);
  const h = harness([good(), stale, good(), good()]);
  await h.run(); assert.equal(h.calls.length, 4);
});
test('retries transport/upstream failures through reads and keeps a strict attempt bound', async () => {
  const h = harness([new Error('sensitive upstream body'), () => new Response('', { status: 503 }), good(), good()]);
  await h.run(); assert.equal(h.calls.length, 4);
  const never = harness([() => new Response('', { status: 503 })]);
  await assert.rejects(never.run(), /did not settle/);
  assert.equal(never.calls.length, 12);
});
test('authentication failures, wrong services and password drift fail immediately', async () => {
  for (const status of [401, 403]) {
    const h = harness([() => new Response('', { status })]);
    await assert.rejects(h.run(), new RegExp(`HTTP ${status}`)); assert.equal(h.calls.length, 1);
  }
  const foreign = good(); foreign.runtime.serviceId = 'other-service';
  await assert.rejects(harness([foreign]).run(), /identity mismatch/);
  const drift = good(); drift.ownerAuthEnvPresence.IVX_OWNER_PASSWORD_BASE64.matchesRuntime = false;
  await assert.rejects(harness([drift]).run(), /transport drift/);
});
test('failed target deployments do not receive more retries or a certificate', async () => {
  const failed = good(); failed.latestDeploy.status = 'update_failed';
  const h = harness([failed]); await assert.rejects(h.run(), /deployment failed/); assert.equal(h.calls.length, 1);
});
test('refuses HTML, malformed JSON and a response that arrives beyond the deadline', async () => {
  await assert.rejects(readVerifiedJson(new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } })), /content type/);
  await assert.rejects(readVerifiedJson(new Response('{', { headers: { 'Content-Type': 'application/json' } })), /body invalid/);
  let time = 0; const h = harness([good()]);
  await assert.rejects(h.run({ now: () => time, fetchImpl: async () => { time = 180_001; return json(good()); } }), /did not settle/);
});
test('rejects unexpected targets before sending the Owner token', async () => {
  const h = harness([good()]);
  await assert.rejects(h.run({ apiBase: 'https://example.com' }), /identity invalid/);
  assert.equal(h.calls.length, 0);
});
