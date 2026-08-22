import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { invalidateIVXSystemSecretCache, resolveActiveIVXSystemSecret } from '../services/ivx-system-secret';

describe('ivx-system-secret resolver', () => {
  const originalSystemSecret = process.env.IVX_AI_SYSTEM_SECRET;
  const originalOwnerToken = process.env.IVX_OWNER_TOKEN;

  beforeEach(() => {
    invalidateIVXSystemSecretCache();
    delete process.env.IVX_AI_SYSTEM_SECRET;
    delete process.env.IVX_OWNER_TOKEN;
  });

  afterEach(() => {
    if (originalSystemSecret === undefined) delete process.env.IVX_AI_SYSTEM_SECRET;
    else process.env.IVX_AI_SYSTEM_SECRET = originalSystemSecret;
    if (originalOwnerToken === undefined) delete process.env.IVX_OWNER_TOKEN;
    else process.env.IVX_OWNER_TOKEN = originalOwnerToken;
    invalidateIVXSystemSecretCache();
  });

  test('falls back to the IVX_AI_SYSTEM_SECRET environment value', async () => {
    process.env.IVX_AI_SYSTEM_SECRET = 'env-system-secret-value';
    expect(await resolveActiveIVXSystemSecret()).toBe('env-system-secret-value');
  });

  test('falls back to legacy IVX_OWNER_TOKEN when the system secret is absent', async () => {
    process.env.IVX_OWNER_TOKEN = 'legacy-owner-token';
    expect(await resolveActiveIVXSystemSecret()).toBe('legacy-owner-token');
  });

  test('returns empty string when no source is configured', async () => {
    expect(await resolveActiveIVXSystemSecret()).toBe('');
  });

  test('caches the resolved value until the cache is invalidated', async () => {
    process.env.IVX_AI_SYSTEM_SECRET = 'first-value';
    expect(await resolveActiveIVXSystemSecret()).toBe('first-value');

    process.env.IVX_AI_SYSTEM_SECRET = 'second-value';
    expect(await resolveActiveIVXSystemSecret()).toBe('first-value');

    invalidateIVXSystemSecretCache();
    expect(await resolveActiveIVXSystemSecret()).toBe('second-value');
  });

  test('prefers the IVX_AI_SYSTEM_SECRET over the legacy owner token', async () => {
    process.env.IVX_AI_SYSTEM_SECRET = 'system-value';
    process.env.IVX_OWNER_TOKEN = 'legacy-value';
    expect(await resolveActiveIVXSystemSecret()).toBe('system-value');
  });
});
