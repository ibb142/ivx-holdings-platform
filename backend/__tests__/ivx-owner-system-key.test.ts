import { afterEach, beforeEach, expect, test } from 'bun:test';
import { checkIVXAISystemKey } from '../api/owner-only';
import { invalidateIVXSystemSecretCache } from '../services/ivx-system-secret';

const originalSecret = process.env.IVX_AI_SYSTEM_SECRET;
beforeEach(() => {
  invalidateIVXSystemSecretCache();
  process.env.IVX_AI_SYSTEM_SECRET = 'test-machine-secret-before';
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.IVX_AI_SYSTEM_SECRET;
  else process.env.IVX_AI_SYSTEM_SECRET = originalSecret;
  invalidateIVXSystemSecretCache();
});
const request = (key?: string) => new Request('https://ivx.example/api/owner', {
  headers: key === undefined ? {} : { 'X-IVX-System-Key': key },
});

for (const key of [undefined, '   ']) {
  test(`absent machine credential (${String(key)}) cannot authenticate or resolve/cache secrets`, async () => {
    expect(await checkIVXAISystemKey(request(key))).toBe(false);
    process.env.IVX_AI_SYSTEM_SECRET = 'test-machine-secret-after';
    // If the absent credential resolved the store, the old cached key would
    // incorrectly shadow the new one here.
    expect(await checkIVXAISystemKey(request('test-machine-secret-after'))).toBe(true);
  });
}
test('a provided incorrect machine credential is rejected', async () => {
  expect(await checkIVXAISystemKey(request('test-machine-secret-wrong'))).toBe(false);
});
test('a provided matching machine credential remains accepted', async () => {
  expect(await checkIVXAISystemKey(request('test-machine-secret-before'))).toBe(true);
});
