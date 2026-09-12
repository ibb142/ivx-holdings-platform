import { readOwnerRuntimeBindings } from './ivx-owner-binding-diagnostic';
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function mockRead(key: string) {
  return { ok: true, status: 500, body: { envVar: { value: 'test-value' } } };
}

test('should return error for non-200 status', async () => {
  const result = await readOwnerRuntimeBindings(mockRead);
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, []);
});
