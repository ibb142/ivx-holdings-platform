import { expect, test } from 'bun:test';
import { handleWaitlistStats } from './ivx-waitlist-stats';

test('preserves real counts above the old member-list cap', async () => {
  const response = await handleWaitlistStats('test', async () => ({ total: 5001, waitlist: 2300 }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ total: 5001, waitlist: 2300, data_available: true, degraded: false });
});

test('read failures remain explicitly unavailable and never cache an empty registry', async () => {
  const response = await handleWaitlistStats('test', async () => { throw new Error('private transport detail'); });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body).toMatchObject({ total: 0, waitlist: 0, data_available: false, degraded: true });
  expect(JSON.stringify(body)).not.toContain('private transport detail');
});

test('aggregate reader requests exact HEAD counts and rejects unknown totals', async () => {
  const { readCanonicalWaitlistStats } = await import('../services/ivx-canonical-members');
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://waitlist-test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  try {
    globalThis.fetch = (async (url, options) => {
      expect(options?.method).toBe('HEAD');
      expect(new Headers(options?.headers).get('prefer')).toBe('count=exact');
      return new Response(null, { headers: { 'content-range': String(url).includes('member_type') ? '0-0/2300' : '0-0/5001' } });
    }) as typeof fetch;
    expect(await readCanonicalWaitlistStats()).toEqual({ total: 5001, waitlist: 2300 });
    globalThis.fetch = (async () => new Response(null, { headers: { 'content-range': '0-0/*' } })) as typeof fetch;
    await expect(readCanonicalWaitlistStats()).rejects.toThrow('temporarily unavailable');
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});
