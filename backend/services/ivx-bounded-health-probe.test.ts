import { afterEach, expect, test } from 'bun:test';
import { boundedHealthProbe } from './ivx-bounded-health-probe';
import { checkAuthHealth, checkDatabaseHealth, checkQueueHealth, ensureTaskTable, __resetBootstrapStateForTests } from './ivx-owner-ai-task-queue';
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; __resetBootstrapStateForTests(); });
const array = (body: unknown): body is unknown[] => Array.isArray(body);
function configure() {
  process.env.IVX_SUPABASE_URL = 'https://readiness-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'readiness-test-placeholder';
}

for (const stage of ['headers', 'body']) {
  test(`one deadline cancels a stalled ${stage} without waiting for the response`, async () => {
    let aborted = false, calls = 0;
    globalThis.fetch = (async (_url, init) => {
      calls++;
      init!.signal!.addEventListener('abort', () => { aborted = true; });
      if (stage === 'headers') return new Promise(() => {});
      return new Response(new ReadableStream({ start() {} }));
    }) as typeof fetch;
    const started = Date.now();
    const result = await boundedHealthProbe('https://readiness-test.supabase.co/rest/v1/table', {}, array, 25);
    expect(result.ok).toBe(false); expect(result.error).toBe('Dependency probe timed out');
    expect(aborted).toBe(true); expect(calls).toBe(1); expect(Date.now() - started).toBeLessThan(500);
  });
}

test('a successful HTTP status with an invalid body is not healthy and errors disclose no payload', async () => {
  globalThis.fetch = (async () => Response.json({ private: 'DO_NOT_REPORT' })) as typeof fetch;
  const result = await boundedHealthProbe('https://readiness-test.supabase.co/rest/v1/table', {}, array);
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('DO_NOT_REPORT');
});

test('database health reads one identity and Auth is checked independently', async () => {
  configure(); const urls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    urls.push(String(url)); expect(init?.method).toBe('GET');
    return String(url).includes('/auth/') ? Response.json({ error: 'PRIVATE_AUTH_ERROR' }, { status: 503 }) : Response.json([{ id: 'task-id' }]);
  }) as typeof fetch;
  expect((await checkDatabaseHealth()).ok).toBe(true);
  expect((await checkAuthHealth()).ok).toBe(false);
  expect(urls).toEqual(['https://readiness-test.supabase.co/rest/v1/ivx_owner_ai_tasks?select=id&limit=1', 'https://readiness-test.supabase.co/auth/v1/health']);
});

test('timeouts, authorization failures and ambiguous 404s never attempt schema bootstrap', async () => {
  configure(); process.env.SUPABASE_ACCESS_TOKEN = 'management-test-placeholder';
  for (const status of [401, 403, 404, 503]) {
    let calls = 0;
    globalThis.fetch = (async (url, init) => {
      calls++; expect(String(url)).toContain('/rest/v1/ivx_owner_ai_tasks?select=id&limit=1'); expect(init?.method).toBe('GET');
      return Response.json({ error: 'transient_or_unclassified' }, { status });
    }) as typeof fetch;
    expect(await ensureTaskTable()).toBe(false); expect(calls).toBe(1);
  }
});

test('an invalid queue observation keeps counts unknown and performs no retry', async () => {
  configure(); let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ private: 'DO_NOT_REPORT' }); }) as typeof fetch;
  const result = await checkQueueHealth();
  expect(result.ok).toBe(false); expect(result.detail.depth).toBeNull(); expect(result.detail.deadLetterCount).toBeNull();
  expect(result.detail.telemetryAvailable).toBe(false); expect(calls).toBe(2); expect(JSON.stringify(result)).not.toContain('DO_NOT_REPORT');
});
