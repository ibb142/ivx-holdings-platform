import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveChatRead } from '../expo/lib/chat-read-fallback.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a successful history read never starts recovery later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rows = [{ id: 'saved-message' }];
  const result = await resolveChatRead(Promise.resolve(rows), async () => assert.fail('Unexpected recovery'));
  assert.deepEqual(result, { value: rows, source: 'primary', fallbackCode: null });
  t.mock.timers.tick(8_000);
});

test('a pending read uses the existing local rows at the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const remote = deferred();
  let calls = 0;
  const result = resolveChatRead(remote.promise, async () => { calls++; return [{ id: 'saved-local-message' }]; });
  t.mock.timers.tick(7_999);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(await result, { value: [{ id: 'saved-local-message' }], source: 'fallback', fallbackCode: 'CLIENT_GATEWAY_TIMEOUT' });
  remote.resolve([{ id: 'late-remote-message' }]);
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('a rejected fallback settles the read instead of hanging or rejecting unhandled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const fallback of [
    async () => { throw new Error('local storage unavailable'); },
    () => { throw new Error('local storage unavailable'); },
  ]) {
    const result = resolveChatRead(new Promise(() => {}), fallback);
    const failure = assert.rejects(result, /local storage unavailable/);
    t.mock.timers.tick(8_000);
    await failure;
  }
});

test('a gateway rejection before the deadline recovers saved rows once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const error of [
    { status: 503 }, { statusCode: 504 }, { code: 'CLIENT_GATEWAY_TIMEOUT' },
    new DOMException('request timed out', 'TimeoutError'), new TypeError('Failed to fetch'),
  ]) {
    let calls = 0;
    const result = await resolveChatRead(Promise.reject(error), async () => { calls++; return ['saved']; });
    assert.deepEqual(result, { value: ['saved'], source: 'fallback', fallbackCode: 'CLIENT_GATEWAY_UNAVAILABLE' });
    t.mock.timers.tick(8_000);
    assert.equal(calls, 1);
  }
});

test('overlapping deadline and gateway failure share one local read', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const remote = deferred(), local = deferred();
  let calls = 0;
  const result = resolveChatRead(remote.promise, () => { calls++; return local.promise; });
  t.mock.timers.tick(8_000);
  remote.reject({ status: 503 });
  await Promise.resolve();
  local.resolve(['saved']);
  assert.deepEqual(await result, { value: ['saved'], source: 'fallback', fallbackCode: 'CLIENT_GATEWAY_TIMEOUT' });
  assert.equal(calls, 1);
});

test('authentication and non-transient failures never recover through the local fallback', async () => {
  for (const error of [
    { status: 401, message: 'gateway timeout' }, { status: 403, name: 'TimeoutError' },
    { code: 'OWNER_SESSION_REQUIRED', name: 'TimeoutError' },
    new Error('HTTP 403: gateway timeout'), { status: 400, message: 'Failed to fetch' },
    new Error('invalid conversation'),
  ]) {
    await assert.rejects(resolveChatRead(Promise.reject(error), async () => assert.fail('Auth/error hidden')), value => value === error);
  }
});

test('a failed local read creates no synthetic chat messages', async () => {
  const failure = new Error('cache unavailable');
  await assert.rejects(resolveChatRead(Promise.reject({ status: 503 }), async () => { throw failure; }), error => error === failure);
});
