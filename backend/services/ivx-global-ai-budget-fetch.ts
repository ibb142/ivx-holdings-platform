import { createHash } from 'node:crypto';
import { GlobalAIBudgetError, globalAIBudgetEnabled, reserveGlobalAIBudget, type BudgetLease, type BudgetUsage } from './ivx-global-ai-budget';

const PROVIDER_HOSTS = new Set(['ai-gateway.vercel.sh','api.openai.com','api.anthropic.com','api.elevenlabs.io']);
const KEY_NAMES = ['OPENAI_API_KEY','IVX_OPENAI_API_KEY','IVX_OPENAI_DIRECT_API_KEY','IVX_AI_GATEWAY_KEY',
  'AI_GATEWAY_API_KEY','IVX_VERCEL_GATEWAY_API_KEY','ANTHROPIC_API_KEY','IVX_ANTHROPIC_API_KEY','ELEVENLABS_API_KEY'];
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function providerRequest(request: Request): boolean {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return false;
  if (PROVIDER_HOSTS.has(new URL(request.url).hostname)) return true;
  const credentials = [request.headers.get('authorization')?.replace(/^Bearer\s+/i,''), request.headers.get('x-api-key'), request.headers.get('xi-api-key')].filter(Boolean);
  return KEY_NAMES.some(name => Boolean(process.env[name]?.trim()) && credentials.includes(process.env[name]!.trim()));
}
async function boundedBody(request: Request): Promise<string> {
  const reader = request.clone().body?.getReader();
  if (!reader) throw new GlobalAIBudgetError('missing provider body');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 8_000_000) throw new GlobalAIBudgetError('provider body exceeds verification bound');
      chunks.push(next.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
function modelForRequest(request: Request, body: Record<string, unknown>): string {
  const url = new URL(request.url);
  if (request.method !== 'POST' || !['/v4/ai/language-model','/v3/ai/language-model','/v1/chat/completions','/v1/messages'].includes(url.pathname)) {
    throw new GlobalAIBudgetError('unpriced provider operation');
  }
  // Paid tools, output modalities and custom gateway routing require their own
  // price envelopes. Do not let an unknown request spend through a text quote.
  if ((Array.isArray(body.tools) && body.tools.length) || body.web_search_options || body.modalities
      || (body.n !== undefined && body.n !== 1) || (body.best_of !== undefined && body.best_of !== 1)
      || (body.providerOptions && Object.keys(record(body.providerOptions)).length)
      || (body.provider_options && Object.keys(record(body.provider_options)).length)) {
    throw new GlobalAIBudgetError('unpriced provider options');
  }
  let model = url.pathname.includes('/ai/language-model')
    ? request.headers.get('ai-language-model-id') ?? request.headers.get('ai-model-id') ?? ''
    : typeof body.model === 'string' ? body.model : '';
  if (!model.includes('/')) {
    if (url.hostname === 'api.anthropic.com') model = `anthropic/${model}`;
    else if (url.hostname === 'api.openai.com' || url.pathname.endsWith('/chat/completions')) model = `openai/${model}`;
  }
  if (!/^[a-z0-9-]+\/[A-Za-z0-9._:-]+$/.test(model)) throw new GlobalAIBudgetError('unverified model identity');
  return model;
}
export function usageFromProvider(value: unknown): BudgetUsage | null {
  const obj = record(value), usage = record(obj.usage);
  let input = usage.prompt_tokens ?? usage.input_tokens ?? record(usage.inputTokens).total ?? usage.inputTokens;
  const output = usage.completion_tokens ?? usage.output_tokens ?? record(usage.outputTokens).total ?? usage.outputTokens;
  // Anthropic's input_tokens excludes cache reads and cache writes. OpenAI
  // prompt_tokens and the gateway total already include their cache tokens.
  if (usage.prompt_tokens === undefined && usage.input_tokens !== undefined) {
    const cached = [usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0];
    if (typeof input !== 'number' || !cached.every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return null;
    input += (cached[0] as number) + (cached[1] as number);
  }
  if (typeof input !== 'number' || typeof output !== 'number'
      || ![input,output].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  const metadata = record(record(obj.providerMetadata).gateway);
  const id = metadata.generationId ?? obj.generationId ?? obj.id;
  return { inputTokens: input, outputTokens: output, ...(typeof id === 'string' ? { generationId: id.slice(0,200) } : {}) };
}

export function createBudgetedFetch(nativeFetch: typeof fetch, dependencies: {
  enabled?: () => boolean;
  reserve?: (model: string, hash: string, fetcher: typeof fetch) => Promise<BudgetLease>;
} = {}): typeof fetch {
  const enabled = dependencies.enabled ?? globalAIBudgetEnabled;
  const reserve = dependencies.reserve ?? reserveGlobalAIBudget;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!enabled()) return nativeFetch(input, init);
    const request = new Request(input, init);
    if (!providerRequest(request)) return nativeFetch(input, init);
    let lease: BudgetLease;
    try {
      request.signal.throwIfAborted();
      const text = await boundedBody(request);
      const body = record(JSON.parse(text));
      const model = modelForRequest(request, body);
      lease = await reserve(model, createHash('sha256').update(text).digest('hex'), nativeFetch);
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason;
      const message = error instanceof GlobalAIBudgetError ? error.message : 'Global AI budget: admission unconfirmed';
      // A real 402 response crosses the SDK's error adapter without becoming a
      // retryable 500. No upstream request has been sent on this path.
      return Response.json({ error: { type: 'quota_for_entity_exceeded', code: 'IVX_GLOBAL_AI_BUDGET_BLOCKED', message } }, { status: 402 });
    }
    if (request.signal.aborted) { await lease.finish(null, true); throw request.signal.reason; }
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const deadline = setTimeout(() => controller.abort(new Error('Global AI provider request deadline exceeded')), 120_000);
    let response: Response;
    try { response = await nativeFetch(request, { signal, redirect: 'error' }); }
    catch (error) { clearTimeout(deadline); await lease.finish(null); throw error; }
    if (!response.body) { clearTimeout(deadline); await lease.finish(null); return response; }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const isSse = response.headers.get('content-type')?.includes('text/event-stream');
    let buffer = '', recordedBytes = 0, truncated = false, usage: BudgetUsage | null = null, finished = false, terminalUsage = false;
    let finishPending: Promise<void> | null = null;
    function capture(chunk: Uint8Array) {
      if (truncated) return;
      recordedBytes += chunk.byteLength;
      if (recordedBytes > 2_000_000) { truncated = true; buffer = ''; usage = null; return; }
      buffer += decoder.decode(chunk, { stream: true });
      if (isSse) {
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data === '[DONE]') { terminalUsage = usage !== null; continue; }
          try {
            const event = record(JSON.parse(data));
            const candidate = usageFromProvider(event);
            if (candidate) { usage = candidate; terminalUsage = event.type === 'finish'; }
          } catch { /* Malformed or non-JSON SSE data retains the full liability. */ }
        }
      }
    }
    async function finish(completed: boolean) {
      if (finished) { if (finishPending) await finishPending; return; } finished = true;
      clearTimeout(deadline);
      signal.removeEventListener('abort', onAbort);
      if (completed && !isSse && !truncated) {
        try { usage = usageFromProvider(JSON.parse(buffer)); } catch { usage = null; }
      }
      finishPending = lease.finish(completed && response.ok && !truncated && (!isSse || terminalUsage) ? usage : null);
      await finishPending;
    }
    function onAbort() {
      void reader.cancel(signal.reason).catch(() => {});
      void finish(false);
    }
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    if (!isSse) {
      // JSON callers such as health probes sometimes inspect only .ok. Drain a
      // bounded ordinary response now so an unread body cannot leak admission.
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 8_000_000) throw new GlobalAIBudgetError('provider response exceeds verification bound');
          capture(next.value); chunks.push(next.value);
        }
        await finish(!signal.aborted);
        signal.throwIfAborted();
        return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        controller.abort(error); await reader.cancel(error).catch(() => {}); await finish(false); throw error;
      }
    }
    // Hold global admission until the body completes or is cancelled. Never
    // clone/consume the model stream independently of the real consumer.
    const stream = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          const next = await reader.read();
          if (next.done) { await finish(!signal.aborted); target.close(); }
          else { capture(next.value); target.enqueue(next.value); }
        } catch (error) { await finish(false); target.error(error); }
      },
      async cancel(reason) {
        controller.abort(reason);
        try { await reader.cancel(reason); } finally { await finish(false); }
      },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  }) as typeof fetch;
}

const installed = Symbol.for('ivx.global-ai-budget-fetch.v1');
export function installGlobalAIBudgetFetch(): void {
  const state = globalThis as typeof globalThis & { [installed]?: boolean };
  if (state[installed]) return;
  globalThis.fetch = createBudgetedFetch(globalThis.fetch);
  state[installed] = true;
}
installGlobalAIBudgetFetch();
