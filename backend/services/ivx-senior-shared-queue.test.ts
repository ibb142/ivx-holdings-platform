import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { claimSharedSeniorJob, patchSharedSeniorQueue, putSharedSeniorResult, rememberSeniorQueue } from './ivx-senior-shared-queue';

const originalFetch = globalThis.fetch;
const names = ['SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
let originalEnv: Array<string | undefined>;
beforeEach(() => {
  originalEnv = names.map(name => process.env[name]);
  process.env.SUPABASE_URL = 'https://queue-test.supabase.co';
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  names.forEach((name, i) => { if (originalEnv[i] === undefined) delete process.env[name]; else process.env[name] = originalEnv[i]; });
});

describe('shared senior queue HTTP contracts', () => {
  it('accepts a void ledger acknowledgement without failing an already persisted result', async () => {
    let writes = 0;
    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toEndWith('/rpc/ivx_senior_ledger_put');
      expect(JSON.parse(String(init?.body))).toEqual({ p_result: { jobId: 'job-1', finalStatus: 'PASS' } });
      writes++;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await putSharedSeniorResult({ jobId: 'job-1', finalStatus: 'PASS' });
    expect(writes).toBe(1);
  });
  it('does not treat an empty claim response as a successful claim or replay it', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(null, { status: 204 }); }) as typeof fetch;
    await expect(claimSharedSeniorJob('job-1')).rejects.toThrow('ivx_senior_queue_claim: invalid JSON response');
    expect(calls).toBe(1);
  });
  it('preserves a valid null claim when another worker already owns the job', async () => {
    globalThis.fetch = (async () => Response.json(null)) as typeof fetch;
    expect(await claimSharedSeniorJob('job-1')).toBeNull();
  });
  it('rejects malformed queue snapshots without replacing durable state', async () => {
    const queue = rememberSeniorQueue({ jobs: [{ jobId: 'job-1', status: 'queued' }] });
    queue.jobs[0].status = 'running';
    globalThis.fetch = (async () => Response.json({ message: 'upstream unavailable' })) as typeof fetch;
    await expect(patchSharedSeniorQueue(queue, new Set())).rejects.toThrow('invalid snapshot');
  });
  it('preserves HTTP failure rather than claiming proof was saved', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    await expect(putSharedSeniorResult({ jobId: 'job-1' })).rejects.toThrow('ivx_senior_ledger_put: operation rejected (HTTP 503)');
  });
});
