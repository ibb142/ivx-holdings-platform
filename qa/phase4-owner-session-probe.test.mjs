import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlightTask } from '../expo/lib/single-flight-task.ts';
import { readVerifiedSession } from '../expo/lib/verified-session-restore.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('slow capability probes share one request across overlapping timer ticks', async () => {
  const completion = deferred();
  let calls = 0;
  const probe = createSingleFlightTask(async () => { calls += 1; return completion.promise; });
  const first = probe();
  await Promise.resolve();
  const ticks = Array.from({ length: 20 }, () => probe());
  assert.equal(calls, 1);
  assert.ok(ticks.every((pending) => pending === first));
  completion.resolve({ health: 'active' });
  assert.deepEqual(await first, { health: 'active' });
  await probe();
  assert.equal(calls, 2);
});

test('a failed probe releases its slot and the next interval can recover', async () => {
  const completion = deferred();
  let calls = 0;
  const probe = createSingleFlightTask(async () => ++calls === 1 ? completion.promise : 'recovered');
  const first = probe();
  const nextTick = probe();
  const failure = assert.rejects(first, /capacity unavailable/);
  completion.reject(new Error('capacity unavailable'));
  await failure;
  assert.equal(first, nextTick);
  assert.equal(await probe(), 'recovered');
  assert.equal(calls, 2);
});

test('a synchronous task failure does not permanently block later probes', async () => {
  let calls = 0;
  const probe = createSingleFlightTask(() => {
    if (++calls === 1) throw new Error('probe setup failed');
    return Promise.resolve('ready');
  });
  await assert.rejects(probe(), /probe setup failed/);
  assert.equal(await probe(), 'ready');
});

const stored = { access_token: 'fixture-access', user: { id: 'fixture-owner', app_metadata: { role: 'stale' } } };
const verifiedUser = { id: 'fixture-owner', app_metadata: { role: 'owner' } };

test('reload restores the current session with the authority-provided identity', async () => {
  let reads = 0;
  const restored = await readVerifiedSession({
    getSession: async () => { reads += 1; return { data: { session: stored }, error: null }; },
    getUser: async (token) => {
      assert.equal(token, stored.access_token);
      return { data: { user: verifiedUser }, error: null };
    },
  });
  assert.equal(reads, 2);
  assert.deepEqual(restored, { ...stored, user: verifiedUser });
});

for (const [name, changed] of [
  ['logout', null],
  ['another account', { access_token: 'different-access', user: { id: 'another-user' } }],
  ['token rotation', { ...stored, access_token: 'rotated-access' }],
  ['inconsistent identity', { ...stored, user: { id: 'another-user' } }],
]) {
  test(`a delayed verification cannot undo ${name}`, async () => {
    const verificationStarted = deferred();
    const verification = deferred();
    let current = stored;
    const restoration = readVerifiedSession({
      getSession: async () => ({ data: { session: current }, error: null }),
      getUser: () => { verificationStarted.resolve(); return verification.promise; },
    });
    await verificationStarted.promise;
    current = changed;
    verification.resolve({ data: { user: verifiedUser }, error: null });
    assert.equal(await restoration, null);
  });
}

test('missing and rejected sessions never grant access', async () => {
  assert.equal(await readVerifiedSession({
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => { assert.fail('No identity lookup without a token'); },
  }), null);
  for (const result of [
    { data: { user: verifiedUser }, error: new Error('rejected') },
    { data: { user: null }, error: null },
    { data: { user: { id: 'another-user' } }, error: null },
  ]) {
    assert.equal(await readVerifiedSession({
      getSession: async () => ({ data: { session: stored }, error: null }),
      getUser: async () => result,
    }), null);
  }
});

test('a failed final storage read does not restore an older session', async () => {
  let reads = 0;
  assert.equal(await readVerifiedSession({
    getSession: async () => ({ data: { session: stored }, error: ++reads === 2 ? new Error('storage unavailable') : null }),
    getUser: async () => ({ data: { user: verifiedUser }, error: null }),
  }), null);
});
