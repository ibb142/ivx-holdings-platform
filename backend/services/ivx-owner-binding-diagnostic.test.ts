import { test, expect } from 'bun:test';
import { ownerRuntimeBindingDrift } from './ivx-owner-binding-diagnostic';

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
