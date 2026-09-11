import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAStartupPendingError, requireStartupSha, validateHATopology, waitForHAStartup } from './ivx-fleet-ha-startup.ts';

const target = '78b8c1564de850b57861b1cf701f07b1ec29303d';
const prior = '7747f61d13efb1daddaabe1f043fd30592594399';
const now = Date.parse('2026-09-11T21:44:40Z');
const sample = (sha = target, time = now) => ({ marker: 'ivx-api-worker-ha-2026-09-08-v1', commitSha: sha, measuredAt: new Date(time).toISOString() });

test('the observed prior-replica SHA waits until a fresh exact-SHA sample arrives', async () => {
  const samples = [sample(prior), sample()];
  let reads = 0, sleeps = 0;
  const result = await waitForHAStartup(async () => {
    const value = samples[reads++];
    validateHATopology(value, target, now);
    return value;
  }, { attempts: 2, sleep: async () => { sleeps++; } });
  assert.equal(result.commitSha, target);
  assert.equal(reads, 2);
  assert.equal(sleeps, 1);
});

test('a prior live Render deployment is pending and never passes as the target', () => {
  assert.throws(() => requireStartupSha(prior, target, 'Render'), HAStartupPendingError);
  assert.doesNotThrow(() => requireStartupSha(target, target, 'Render'));
});

test('stale observations stay pending; malformed and future observations fail', () => {
  assert.throws(() => validateHATopology(sample(target, now - 15_001), target, now), HAStartupPendingError);
  for (const value of [sample(target, now + 10_000), { ...sample(), measuredAt: 'invalid' }, { ...sample(), marker: 'wrong' }, { ...sample(), commitSha: 'unknown' }]) {
    assert.throws(() => validateHATopology(value, target, now), error => !(error instanceof HAStartupPendingError));
  }
});

test('persistent old SHA exhausts the bounded window without issuing a certificate', async () => {
  let reads = 0;
  await assert.rejects(waitForHAStartup(async () => {
    reads++;
    requireStartupSha(prior, target, 'Render');
  }, { attempts: 3, sleep: async () => {} }), /did not converge after 3 probes/);
  assert.equal(reads, 3);
});

test('authentication failures and malformed SHA are not retried as startup delay', async () => {
  for (const failure of [new Error('HTTP 401'), new Error('HTTP 403'), new assert.AssertionError({ message: 'Malformed SHA' })]) {
    let reads = 0;
    await assert.rejects(waitForHAStartup(async () => { reads++; throw failure; }, { attempts: 3, sleep: async () => {} }), error => error === failure);
    assert.equal(reads, 1);
  }
});
