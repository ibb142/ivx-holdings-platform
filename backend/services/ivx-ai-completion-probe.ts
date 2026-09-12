import { getProviderHealth, markAIUnavailable, markProviderFailed, markProviderReady } from './ivx-provider-state-machine';

export type CompletionProbeResult = {
  ok: boolean;
  status: number | null;
  code: string | null;
  reason: string;
  latencyMs: number;
};

/** One bounded, non-streaming completion. HTTP success alone is not generation evidence. */
export async function probeGatewayCompletion(options: {
  url: string; apiKey: string; model: string; provider: string;
  fetchImpl?: typeof fetch; timeoutMs?: number;
}): Promise<CompletionProbeResult> {
  const started = Date.now();
  const initialHealth = JSON.stringify(getProviderHealth());
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let status: number | null = null;
  const fail = (code: string, reason: string): CompletionProbeResult => ({ ok: false, status, code, reason, latencyMs: Date.now() - started });
  const request = async (): Promise<CompletionProbeResult> => {
    const response = await (options.fetchImpl ?? fetch)(options.url, {
      method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: options.model, messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 16, stream: false }),
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      return fail('AI_PROBE_TIMEOUT', 'Gateway completion probe timed out');
    }
    status = response.status;
    reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65536) return fail('AI_PROBE_INVALID_RESPONSE', 'Gateway completion exceeded the probe response limit');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (status === 402) {
      try {
        if (JSON.parse(text)?.error?.code === 'IVX_GLOBAL_AI_BUDGET_BLOCKED') {
          return fail('AI_GLOBAL_BUDGET_BLOCKED', 'Global AI budget admission blocked or unconfirmed; the provider was not contacted');
        }
      } catch { /* An upstream non-JSON 402 retains its billing classification. */ }
    }
    if (status === 402 || /insufficient_quota|billing_hard_limit|positive credit balance/i.test(text)) {
      return fail('AI_CREDITS_REQUIRED', 'The AI provider requires a positive credit balance');
    }
    if (status !== 200) return fail('AI_PROBE_HTTP_ERROR', `Gateway returned HTTP ${status}`);
    let body: any;
    try { body = JSON.parse(text); } catch { return fail('AI_PROBE_INVALID_RESPONSE', 'Gateway did not return a JSON completion'); }
    const choice = body?.choices?.[0];
    if (body?.error || !Array.isArray(body?.choices) || choice?.message?.role !== 'assistant'
      || typeof choice.message.content !== 'string' || !choice.message.content.trim()
      || !['stop', 'length'].includes(choice.finish_reason)) {
      return fail('AI_PROBE_INVALID_RESPONSE', 'Gateway response did not contain a completed nonempty assistant message');
    }
    return { ok: true, status, code: null, reason: 'Gateway generation verified (nonempty assistant completion)', latencyMs: Date.now() - started };
  };
  let result: CompletionProbeResult;
  try {
    result = await Promise.race([request(), new Promise<CompletionProbeResult>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(fail('AI_PROBE_TIMEOUT', 'Gateway completion probe timed out')); }, options.timeoutMs ?? 10000);
    })]);
  } catch {
    result = fail(controller.signal.aborted ? 'AI_PROBE_TIMEOUT' : 'AI_PROBE_NETWORK_ERROR', 'Gateway completion could not be read');
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
  // A late probe must not overwrite a newer observation from a real request.
  const current = getProviderHealth();
  if (JSON.stringify(current) === initialHealth) {
    if (result.ok) markProviderReady(options.provider, options.model);
    else if (current.state !== 'FALLBACK_READY') {
      const trace = `gateway-probe-${started}`;
      markProviderFailed(result.status ?? 0, result.reason, trace);
      markAIUnavailable(trace, result.reason);
    }
  }
  return result;
}
