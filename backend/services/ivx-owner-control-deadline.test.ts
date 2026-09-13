import { afterEach, expect, test } from 'bun:test';
import { DurableStore } from './ivx-durable-store';

const originalFetch = globalThis.fetch;
const environment = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...environment }; });

function configure() {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://control.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
}

test('bounded private reads cancel the HTTP request and never bootstrap schema or retry', async () => {
  configure();
  const controller = new AbortController();
  let requests = 0, aborted = false;
  globalThis.fetch = (async (input, init) => {
    requests++;
    expect(new URL(String(input)).searchParams.get('doc_key')).toBe('eq.app-completion/campaign-state.json');
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBe(controller.signal);
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { aborted = true; reject(init!.signal!.reason); }, { once: true });
    });
  }) as typeof fetch;
  const read = new DurableStore().readJson('app-completion/campaign-state.json', null, { signal: controller.signal });
  const outcome = read.then(() => null, error => error as Error);
  controller.abort(new Error('control deadline'));
  expect((await outcome)?.message).toBe('control deadline');
  expect(aborted).toBe(true);
  expect(requests).toBe(1);
});

for (const status of [404, 503]) test(`bounded control HTTP ${status} cannot create schema, retry, or use a fallback permission`, async () => {
  configure();
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return Response.json({ code: 'PGRST205', message: 'Control unavailable' }, { status });
  }) as typeof fetch;
  await expect(new DurableStore().readJson('control', { enabled: true }, { signal: new AbortController().signal }))
    .rejects.toThrow('Control unavailable');
  expect(requests).toBe(1);
});

test('owner control observes fresh pauses and cancels slow reads before the outer truth deadline', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import { strict as assert } from 'node:assert';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://control.example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    let requests = 0, paused = false, mode = 'valid', aborted = false;
    globalThis.fetch = async (input, init) => {
      requests++;
      assert.equal(new URL(String(input)).searchParams.get('doc_key'), 'eq.app-completion/campaign-state.json');
      assert.equal(init.method, 'GET');
      assert(init.signal);
      if (mode === 'slow') return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }, { once: true });
      });
      if (mode === 'missing') return Response.json([]);
      return Response.json([{ value: { control: { paused, stopped: false, pausedAgents: [], stoppedAgents: mode === 'malformed' ? 'all' : [] } } }]);
    };
    const { loadControlState, OWNER_CONTROL_READ_TIMEOUT_MS } = await import('./backend/services/ivx-app-completion-campaign.ts');
    assert.equal(OWNER_CONTROL_READ_TIMEOUT_MS, 2000);
    assert.equal((await loadControlState({ required: true })).paused, false);
    paused = true;
    assert.equal((await loadControlState({ required: true })).paused, true);
    for (mode of ['missing', 'malformed']) await assert.rejects(loadControlState({ required: true }), /missing or malformed/);
    mode = 'slow';
    await assert.rejects(loadControlState({ required: true }), /owner_control_read_timeout_2000ms/);
    assert.equal(aborted, true);
    assert.equal(requests, 5);
  `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 8000 });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(stderr || `Owner control child exited ${code}`);
  expect(code).toBe(0);
});
