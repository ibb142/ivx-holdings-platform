import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { runAbortableAuthAttempt } from './services/ivx-auth-attempt';

test('timeout aborts transport before a retry starts', async () => {
  let active = 0;
  let aborted = false;
  await assert.rejects(runAbortableAuthAttempt((signal) => new Promise((_resolve, reject) => {
    active += 1;
    signal.addEventListener('abort', () => {
      active -= 1;
      aborted = true;
      reject(new Error('SDK translated abort'));
    }, { once: true });
  }), 10, 'auth-timeout'), /auth-timeout/);
  const result = await runAbortableAuthAttempt(async (signal) => {
    assert.equal(aborted, true);
    assert.equal(active, 0);
    assert.equal(signal.aborted, false);
    return 'recovered';
  }, 100, 'auth-timeout');
  assert.equal(result, 'recovered');
});

test('completed authentication retains the response and clears its timer', async () => {
  let signal: AbortSignal | undefined;
  const result = { error: { code: 'invalid_credentials' }, data: { session: null } };
  assert.equal(await runAbortableAuthAttempt(async (value) => {
    signal = value;
    return result;
  }, 10, 'auth-timeout'), result);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(signal?.aborted, false);
});

test('an operation failure is preserved instead of becoming a timeout', async () => {
  const failure = new Error('network unavailable');
  await assert.rejects(runAbortableAuthAttempt(async () => { throw failure; }, 100, 'auth-timeout'),
    error => error === failure);
});

test('Supabase SDK receives cancellation and a fresh attempt preserves credential rejection', async () => {
  let aborted = false;
  const attempt = (stall: boolean) => runAbortableAuthAttempt(signal => {
    const client = createClient('https://auth-test.invalid', 'test-public-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => {
        if (stall) return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(signal.reason);
          }, { once: true });
        });
        assert.equal(aborted, true);
        assert.equal(signal.aborted, false);
        return Response.json({ code: 'invalid_credentials', message: 'Invalid login credentials' }, { status: 400 });
      } },
    });
    return client.auth.signInWithPassword({ email: 'test@example.invalid', password: 'test-only' });
  }, 25, 'auth-timeout');
  await assert.rejects(attempt(true), /auth-timeout/);
  const rejected = await attempt(false);
  assert.equal(rejected.data.session, null);
  assert.equal(rejected.error?.status, 400);
  assert.equal(rejected.error?.message, 'Invalid login credentials');
});
