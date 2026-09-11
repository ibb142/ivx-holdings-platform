import { expect, spyOn, test } from 'bun:test';
import * as ai from 'ai';
import { checkQueueHealth, startOwnerAITaskWorker, stopOwnerAITaskWorker } from './ivx-owner-ai-task-queue';
import { getProviderHealth, initProviderStateMachine, resetProviderStateMachine } from './ivx-provider-state-machine';

test('a cold owner worker completes the provider probe before publishing readiness and claiming', async () => {
  const env = { ...process.env }, originalFetch = globalThis.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'https://queue.invalid', SUPABASE_SERVICE_ROLE_KEY: 'queue-fixture',
    IVX_AI_GATEWAY_KEY: 'vck_local_fixture', IVX_AI_GATEWAY_URL: 'https://gateway.invalid/v1',
    RENDER_GIT_COMMIT: 'a'.repeat(40), RENDER_INSTANCE_ID: 'cold-worker-fixture', IVX_PROCESS_ROLE: 'worker' });
  delete process.env.IVX_OPENAI_API_KEY;
  delete process.env.IVX_ANTHROPIC_API_KEY;
  initProviderStateMachine('vercel_ai_gateway', 'openai/gpt-4o', true, false);
  let worker: Record<string, unknown> | null = null, claims = 0, completions = 0;
  const pulses: string[] = [];
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const generation = spyOn(ai, 'generateText').mockImplementation(async options => {
    started();
    await released;
    // Provider contract observed in the failed production startup request.
    if ((options.maxOutputTokens ?? 0) < 16) throw Object.assign(new Error(
      "Invalid 'max_output_tokens': integer below minimum value. Expected a value >= 16"), { statusCode: 400 });
    completions++;
    return { text: 'OK', usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 } } as Awaited<ReturnType<typeof ai.generateText>>;
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.includes('/rpc/ivx_owner_ai_worker_pulse')) {
      pulses.push(body.p_state);
      worker = { worker_id: body.p_worker_id, source_sha: body.p_source_sha, instance_id: body.p_instance_id,
        state: body.p_state, last_seen_at: new Date().toISOString() };
      return Response.json({ authorized: true, state: body.p_state });
    }
    if (url.includes('/rpc/ivx_owner_ai_queue_claim')) {
      expect(pulses.at(-1)).toBe('ready');
      expect(completions).toBe(1);
      claims++;
      return Response.json({ authorized: true, tasks: [] });
    }
    if (url.includes('/rpc/ivx_owner_ai_queue_health')) {
      return Response.json({ authorized: true, pending: [], dead: [], workers: worker ? [worker] : [] });
    }
    throw new Error(`Unexpected external request in cold-start regression: ${new URL(url).pathname}`);
  }) as typeof fetch;
  try {
    startOwnerAITaskWorker(60_000);
    await entered;
    expect((await checkQueueHealth()).ok).toBe(false);
    expect(claims).toBe(0);
    release();
    for (let turn = 0; turn < 20 && claims === 0; turn++) await new Promise(resolve => setImmediate(resolve));
    expect((await checkQueueHealth()).ok).toBe(true);
    expect(getProviderHealth().state).toBe('PROVIDER_READY');
    expect(claims).toBe(1);
    expect(pulses.slice(0, 2)).toEqual(['degraded', 'ready']);
    expect(generation).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await stopOwnerAITaskWorker(0);
    await new Promise(resolve => setImmediate(resolve));
    generation.mockRestore();
    globalThis.fetch = originalFetch;
    process.env = env;
    resetProviderStateMachine();
  }
});
