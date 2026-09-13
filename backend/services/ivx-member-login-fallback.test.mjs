import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBoundedMemberFallback } from './ivx-auth-attempt.ts';

test('a stalled credential lookup aborts its transport and reports unknown', async () => {
  let signal;
  const started = performance.now();
  const result = await readBoundedMemberFallback(s => { signal = s; return new Promise(() => {}); }, 25);
  assert.deepEqual(result, { available: false, userId: null });
  assert.equal(signal.aborted, true);
  assert.ok(performance.now() - started < 500);
});

test('lookup failure remains distinct from an authoritative credential miss', async () => {
  const failed = await readBoundedMemberFallback(async () => { throw new Error('private transport error'); });
  const missing = await readBoundedMemberFallback(async () => null);
  assert.deepEqual(failed, { available: false, userId: null });
  assert.deepEqual(missing, { available: true, userId: null });
});

test('verified fallback credentials retain their identity without a late abort', async () => {
  let signal;
  const result = await readBoundedMemberFallback(async s => { signal = s; return 'fallback-member-id'; }, 10);
  assert.deepEqual(result, { available: true, userId: 'fallback-member-id' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(signal.aborted, false);
});

test('a late result cannot turn an expired lookup into verified credentials', async () => {
  let finish;
  const result = await readBoundedMemberFallback(() => new Promise(resolve => { finish = resolve; }), 10);
  finish('late-member-id');
  await Promise.resolve();
  assert.deepEqual(result, { available: false, userId: null });
});
