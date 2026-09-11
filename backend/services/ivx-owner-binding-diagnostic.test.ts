import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as diagnostics from './ivx-owner-binding-diagnostic';
import { ownerRuntimeBindingDrift, readOwnerRuntimeBindings } from './ivx-owner-binding-diagnostic';

test('detects stale process bindings without normalizing opaque passwords', () => {
  const result = ownerRuntimeBindingDrift([
    { envVar: { key: 'IVX_OWNER_PASSWORD', value: ' opaque-fixture ' } },
    { key: 'IVX_OWNER_EMAIL', value: 'owner@example.test' },
  ], { IVX_OWNER_PASSWORD: 'opaque-fixture', IVX_OWNER_EMAIL: 'owner@example.test' });
  expect(result.IVX_OWNER_PASSWORD.matchesRuntime).toBe(false);
  expect(result.IVX_OWNER_EMAIL.matchesRuntime).toBe(true);
  expect(result.OWNER_NEW_PASSWORD.matchesRuntime).toBeNull();
  expect(JSON.stringify(result)).not.toContain('opaque-fixture');
  expect(JSON.stringify(result)).not.toContain('owner@example.test');
});

test('missing or malformed configuration cannot report an authenticated binding', () => {
  for (const body of [null, {}, [{ envVar: null }], [{ key: 'IVX_OWNER_PASSWORD', value: 1 }]]) {
    const result = ownerRuntimeBindingDrift(body, { IVX_OWNER_PASSWORD: 'fixture' });
    expect(result.IVX_OWNER_PASSWORD.matchesRuntime).toBeNull();
    expect(result.IVX_OWNER_PASSWORD.present).toBe(false);
  }
  expect(ownerRuntimeBindingDrift([{ key: 'UNRELATED_SECRET', value: 'private-fixture' }], {})).not.toHaveProperty('UNRELATED_SECRET');
});

test('the API compares owner bindings beyond the first Render page', async () => {
  const source = readFileSync(new URL('../api/ivx-render-diagnostic.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const [serviceResult, deploysResult, envVarsResult]');
  const end = source.indexOf('const deploysArray', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // Execute the real API request block against Render's documented first-page
  // response. No production credentials or network calls are involved.
  const requestBindings = new (Object.getPrototypeOf(async () => {}).constructor)(
    'callRender', 'readOwnerRuntimeBindings', 'serviceId', 'limit', 'apiKey',
    `${source.slice(start, end)} return envVarsResult;`,
  );
  const firstPage = Array.from({ length: 20 }, (_, i) => ({ envVar: { key: `A_${i}`, value: 'irrelevant' } }));
  const read = async (path: string) => {
    if (path.endsWith('/env-vars')) return { ok: true, status: 200, body: firstPage };
    if (path.endsWith('/env-vars/IVX_OWNER_PASSWORD')) return { ok: true, status: 200, body: { key: 'IVX_OWNER_PASSWORD', value: 'configured-fixture' } };
    if (path.includes('/env-vars/')) return { ok: false, status: 404, body: null };
    return { ok: true, status: 200, body: [] };
  };
  const response = await requestBindings(read, (diagnostics as Record<string, unknown>).readOwnerRuntimeBindings, 'service-fixture', 1, 'key-fixture');
  const bindings = ownerRuntimeBindingDrift(response.body, { IVX_OWNER_PASSWORD: 'stale-fixture' });
  expect(response.ok).toBe(true);
  expect(bindings.IVX_OWNER_PASSWORD.present).toBe(true);
  expect(bindings.IVX_OWNER_PASSWORD.matchesRuntime).toBe(false);
  expect(JSON.stringify(bindings)).not.toContain('configured-fixture');
});

test('uncertain and malformed Render reads cannot certify partial bindings', async () => {
  for (const failed of [
    { ok: false, status: 403, body: null },
    { ok: false, status: 503, body: null },
    { ok: true, status: 200, body: { key: 'WRONG_KEY', value: 'private-fixture' } },
  ]) {
    const result = await readOwnerRuntimeBindings(async key => key === 'IVX_OWNER_PASSWORD'
      ? failed : { ok: false, status: 404, body: null });
    expect(result.ok).toBe(false);
    expect(result.body).toEqual([]);
  }
  const result = await readOwnerRuntimeBindings(async () => { throw new Error('private-fixture'); });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private-fixture');
});
