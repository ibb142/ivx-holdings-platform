/**
 * IVX AI Multi-Provider Fallback Chain
 *
 * Adds a safe, opt-in fallback abstraction around `requestIVXAIText`. The
 * primary provider stays the existing Vercel AI Gateway path
 * (`IVX_AI_GATEWAY_KEY`). Fallbacks are ONLY registered when their
 * provider-specific env var is set; otherwise the chain is a no-op and the
 * caller still sees the original primary failure.
 *
 * Hard rules:
 *   - never log API keys, never log prompt content, never echo bodies
 *   - never return secret values from the status endpoint (name + status only)
 *   - never invoke a fallback unless its env key exists
 *   - never use a fallback for streaming (yet) — only for completion replies
 *   - classified failures (auth/quota/timeout/network/unknown) so callers can
 *     decide policy; only retryable classes trigger fallback
 */

export type IVXProviderName = 'ivx_ai_gateway' | 'openai_direct' | 'anthropic_direct';

/** External toolkit fallback was permanently removed on 2026-07-16 by owner directive.
 * The IVX provider chain is exclusively owner-controlled: OpenAI direct + Anthropic direct.
 * No external proxy, no external credits, no external AI Cloud dependency. */
export type IVXProviderFailureClass =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'server_error'
  | 'unknown';

export type IVXProviderStatus = {
  name: IVXProviderName;
  role: 'primary' | 'fallback';
  configured: boolean;
  /** Which env var(s) gate this provider. Never returns the actual value. */
  envGates: string[];
};

export type IVXProviderInvocationResult = {
  text: string;
  provider: IVXProviderName;
  model: string;
  latencyMs: number;
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasEnv(name: string): boolean {
  return readTrimmed(process.env[name]).length > 0;
}

/** Public, secret-free provider snapshot for the owner status route. */
export function getIVXProviderChainSnapshot(): {
  primary: IVXProviderStatus;
  fallbacks: IVXProviderStatus[];
  fallbackEnabled: boolean;
} {
  const primary: IVXProviderStatus = {
    name: 'ivx_ai_gateway',
    role: 'primary',
    configured: hasEnv('IVX_AI_GATEWAY_KEY'),
    envGates: ['IVX_AI_GATEWAY_KEY'],
  };
  const fallbacks: IVXProviderStatus[] = [
    {
      name: 'openai_direct',
      role: 'fallback',
      configured: hasEnv('OPENAI_API_KEY'),
      envGates: ['OPENAI_API_KEY'],
    },
    {
      name: 'anthropic_direct',
      role: 'fallback',
      configured: hasEnv('ANTHROPIC_API_KEY'),
      envGates: ['ANTHROPIC_API_KEY'],
    },
    // External toolkit cutover (2026-07-07): the external_toolkit fallback has been
    // removed. The IVX provider chain is now exclusively IVX-owned:
    // Vercel AI Gateway (primary) + OpenAI direct + Anthropic direct.
  ];
  const fallbackEnabled = fallbacks.some((p) => p.configured);
  return { primary, fallbacks, fallbackEnabled };
}

/** Map a thrown gateway error into a coarse class. */
export function classifyProviderFailure(error: unknown): IVXProviderFailureClass {
  if (!error) return 'unknown';
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const statusMatch = message.match(/status=(\d{3})/);
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;

  if (name === 'IVXAIGatewayTimeoutError' || message.includes('timed out') || message.includes('etimedout')) {
    return 'timeout';
  }
  if (status === 401 || status === 403 || message.includes('unauthor') || message.includes('forbidden')) {
    return 'auth';
  }
  if (status === 429 || message.includes('rate-limit') || message.includes('rate limit')) {
    return 'rate_limit';
  }
  if (message.includes('insufficient_quota') || message.includes('quota')) {
    return 'quota';
  }
  if (status && status >= 500) {
    return 'server_error';
  }
  if (status === 400 || status === 422) {
    return 'bad_request';
  }
  if (message.includes('econnreset') || message.includes('fetch failed') || message.includes('network')) {
    return 'network';
  }
  return 'unknown';
}

/** Failure classes safe to retry against a different provider.
 * Auth failures are included because the primary (Vercel AI Gateway) and the
 * direct OpenAI/Anthropic fallbacks use completely different keys/endpoints;
 * a primary auth failure should still let a direct fallback attempt serve
 * the request.
 */
export function isFailureRetryable(cls: IVXProviderFailureClass): boolean {
  return cls === 'timeout'
    || cls === 'rate_limit'
    || cls === 'quota'
    || cls === 'server_error'
    || cls === 'network'
    || cls === 'auth';
}

type FallbackInput = {
  module: string;
  requestId: string | null;
  system: string;
  prompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxOutputTokens: number | null | undefined;
  timeoutMs: number;
};

async function callOpenAIDirect(input: FallbackInput): Promise<IVXProviderInvocationResult> {
  const apiKey = readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.IVX_AI_GATEWAY_KEY);
  if (!apiKey) throw new Error('openai_direct fallback not configured');
  // Skip if the key is a Vercel AI Gateway key (vck_) — it won't work against
  // the OpenAI direct API. The vercel_gateway fallback handles that key.
  if (apiKey.startsWith('vck_')) throw new Error('openai_direct fallback skipped: key is a Vercel AI Gateway key (vck_), not an OpenAI key');
  // Model routing policy:
  //   Primary  = gpt-4o (direct OpenAI API, the configured default everywhere).
  //   Fallback = gpt-4o-mini, used ONLY when the primary gpt-4o path fails with a
  //   retryable error class and OPENAI_API_KEY is set. Override via IVX_OPENAI_FALLBACK_MODEL.
  const model = readTrimmed(process.env.IVX_OPENAI_FALLBACK_MODEL) || 'gpt-4o-mini';
  const url = 'https://api.openai.com/v1/chat/completions';
  const chatMessages: { role: string; content: string }[] = [];
  if (input.system) chatMessages.push({ role: 'system', content: input.system });
  if (input.messages.length > 0) {
    for (const m of input.messages) chatMessages.push({ role: m.role, content: m.content });
  } else if (input.prompt) {
    chatMessages.push({ role: 'user', content: input.prompt });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Never logged anywhere in this module.
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        max_tokens: input.maxOutputTokens ?? undefined,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`openai_direct status=${response.status}`);
    }
    const json = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = readTrimmed(json.choices?.[0]?.message?.content ?? '');
    if (!text) throw new Error('openai_direct empty response');
    return { text, provider: 'openai_direct', model, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vercel AI Gateway direct fallback.
 * Uses the vck_ key against https://ai-gateway.vercel.sh/v1/chat/completions
 * with the openai/ model prefix (e.g. openai/gpt-4o-mini).
 * This is the correct endpoint for Vercel AI Gateway keys.
 */
async function callVercelGatewayDirect(input: FallbackInput): Promise<IVXProviderInvocationResult> {
  const apiKey = readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.IVX_AI_GATEWAY_KEY);
  if (!apiKey) throw new Error('ivx_ai_gateway fallback not configured');
  // Skip if the key is NOT a Vercel key — it won't work against the gateway.
  if (!apiKey.startsWith('vck_')) throw new Error('ivx_ai_gateway fallback skipped: key is not a Vercel AI Gateway key (vck_)');
  const bareModel = readTrimmed(process.env.IVX_OPENAI_FALLBACK_MODEL) || 'gpt-4o-mini';
  const model = bareModel.startsWith('openai/') ? bareModel : `openai/${bareModel}`;
  const url = 'https://ai-gateway.vercel.sh/v1/chat/completions';
  const chatMessages: { role: string; content: string }[] = [];
  if (input.system) chatMessages.push({ role: 'system', content: input.system });
  if (input.messages.length > 0) {
    for (const m of input.messages) chatMessages.push({ role: m.role, content: m.content });
  } else if (input.prompt) {
    chatMessages.push({ role: 'user', content: input.prompt });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        max_tokens: input.maxOutputTokens ?? undefined,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ivx_ai_gateway status=${response.status}`);
    }
    const json = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = readTrimmed(json.choices?.[0]?.message?.content ?? '');
    if (!text) throw new Error('ivx_ai_gateway empty response');
    return { text, provider: 'ivx_ai_gateway', model, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OpenAI direct fallback with an explicit key override.
 * Used when a separate sk- key is available via IVX_OPENAI_DIRECT_API_KEY.
 */
async function callOpenAIDirectWithKey(input: FallbackInput, apiKey: string): Promise<IVXProviderInvocationResult> {
  if (!apiKey || !apiKey.startsWith('sk-')) throw new Error('openai_direct_with_key: invalid key prefix');
  const model = readTrimmed(process.env.IVX_OPENAI_FALLBACK_MODEL) || 'gpt-4o-mini';
  const url = 'https://api.openai.com/v1/chat/completions';
  const chatMessages: { role: string; content: string }[] = [];
  if (input.system) chatMessages.push({ role: 'system', content: input.system });
  if (input.messages.length > 0) {
    for (const m of input.messages) chatMessages.push({ role: m.role, content: m.content });
  } else if (input.prompt) {
    chatMessages.push({ role: 'user', content: input.prompt });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: chatMessages, max_tokens: input.maxOutputTokens ?? undefined }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`openai_direct_with_key status=${response.status}`);
    const json = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = readTrimmed(json.choices?.[0]?.message?.content ?? '');
    if (!text) throw new Error('openai_direct_with_key empty response');
    return { text, provider: 'openai_direct', model, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vercel AI Gateway direct fallback with an explicit key override.
 * Used when a separate vck_ key is available via IVX_VERCEL_GATEWAY_API_KEY.
 */
async function callVercelGatewayDirectWithKey(input: FallbackInput, apiKey: string): Promise<IVXProviderInvocationResult> {
  if (!apiKey || !apiKey.startsWith('vck_')) throw new Error('ivx_ai_gateway_with_key: invalid key prefix');
  const bareModel = readTrimmed(process.env.IVX_OPENAI_FALLBACK_MODEL) || 'gpt-4o-mini';
  const model = bareModel.startsWith('openai/') ? bareModel : `openai/${bareModel}`;
  const url = 'https://ai-gateway.vercel.sh/v1/chat/completions';
  const chatMessages: { role: string; content: string }[] = [];
  if (input.system) chatMessages.push({ role: 'system', content: input.system });
  if (input.messages.length > 0) {
    for (const m of input.messages) chatMessages.push({ role: m.role, content: m.content });
  } else if (input.prompt) {
    chatMessages.push({ role: 'user', content: input.prompt });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: chatMessages, max_tokens: input.maxOutputTokens ?? undefined }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ivx_ai_gateway_with_key status=${response.status}`);
    const json = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = readTrimmed(json.choices?.[0]?.message?.content ?? '');
    if (!text) throw new Error('ivx_ai_gateway_with_key empty response');
    return { text, provider: 'ivx_ai_gateway', model, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropicDirect(input: FallbackInput): Promise<IVXProviderInvocationResult> {
  const apiKey = readTrimmed(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) throw new Error('anthropic_direct fallback not configured');
  const model = readTrimmed(process.env.IVX_ANTHROPIC_FALLBACK_MODEL) || 'claude-3-5-haiku-latest';
  const url = 'https://api.anthropic.com/v1/messages';
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  if (input.messages.length > 0) {
    for (const m of input.messages) messages.push({ role: m.role, content: m.content });
  } else if (input.prompt) {
    messages.push({ role: 'user', content: input.prompt });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: input.system || undefined,
        messages,
        max_tokens: input.maxOutputTokens ?? 1024,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`anthropic_direct status=${response.status}`);
    }
    const json = await response.json() as { content?: { type?: string; text?: string }[] };
    const text = readTrimmed(
      (json.content ?? [])
        .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n'),
    );
    if (!text) throw new Error('anthropic_direct empty response');
    return { text, provider: 'anthropic_direct', model, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try configured fallback providers in order. Returns the first success.
 * Returns `null` if no fallback is configured OR all configured fallbacks
 * failed. Never throws — caller stays in control of the original error.
 *
 * CRITICAL: This function tries at most ONE fallback provider with a DIFFERENT
 * credential. It does NOT retry the same expired key. The primary provider's
 * key is excluded from the fallback chain — only providers with their own
 * separate env var key are candidates.
 *
 * Logs are intentionally low-fidelity: provider name + failure class only.
 * No prompt text, no API keys, no response bodies.
 */
export async function attemptProviderFallback(input: FallbackInput): Promise<IVXProviderInvocationResult | null> {
  const chain: { name: IVXProviderName; run: (i: FallbackInput) => Promise<IVXProviderInvocationResult> }[] = [];

  // Determine the primary key type so we can skip it in the fallback chain.
  const primaryKey = readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.IVX_AI_GATEWAY_KEY);
  const primaryIsVercelKey = primaryKey.startsWith('vck_');
  const primaryIsOpenAIKey = primaryKey.startsWith('sk-');

  // Only add fallback providers that use a DIFFERENT key than the primary.
  // This prevents retrying the same expired credential.

  // OpenAI direct fallback — only if the primary key is NOT an sk- key
  // (if primary is sk-, it already failed against api.openai.com).
  if (primaryIsVercelKey && hasEnv('OPENAI_API_KEY')) {
    // Primary is vck_ (Vercel), so OPENAI_API_KEY is the same vck_ key.
    // Skip — it would fail the same way.
    // Only add openai_direct if there's a separate sk- key somewhere.
    const openaiDirectKey = readTrimmed(process.env.IVX_OPENAI_DIRECT_API_KEY);
    if (openaiDirectKey && openaiDirectKey.startsWith('sk-')) {
      // Override the key for this call using the separate direct key
      chain.push({ name: 'openai_direct', run: (i) => callOpenAIDirectWithKey(i, openaiDirectKey) });
    }
  } else if (!primaryIsOpenAIKey && hasEnv('OPENAI_API_KEY')) {
    chain.push({ name: 'openai_direct', run: callOpenAIDirect });
  }

  // Vercel gateway fallback — only if the primary key is NOT a vck_ key
  // (if primary is vck_, it already failed against ai-gateway.vercel.sh).
  if (primaryIsOpenAIKey && hasEnv('OPENAI_API_KEY')) {
    // Primary is sk- (OpenAI direct), so the fallback to Vercel gateway
    // would use the same sk- key — skip it.
    // Only add if there's a separate vck_ key.
    const vercelKey = readTrimmed(process.env.IVX_VERCEL_GATEWAY_API_KEY);
    if (vercelKey && vercelKey.startsWith('vck_')) {
      chain.push({ name: 'ivx_ai_gateway', run: (i) => callVercelGatewayDirectWithKey(i, vercelKey) });
    }
  } else if (!primaryIsVercelKey && (hasEnv('OPENAI_API_KEY') || hasEnv('IVX_AI_GATEWAY_KEY'))) {
    // Only if there's a vck_ key that's different from the primary
    const vercelKey = readTrimmed(process.env.IVX_AI_GATEWAY_KEY) || readTrimmed(process.env.OPENAI_API_KEY);
    if (vercelKey.startsWith('vck_') && vercelKey !== primaryKey) {
      chain.push({ name: 'ivx_ai_gateway', run: callVercelGatewayDirect });
    }
  }

  // Anthropic direct fallback — always a different key/endpoint
  if (hasEnv('ANTHROPIC_API_KEY')) chain.push({ name: 'anthropic_direct', run: callAnthropicDirect });

  // External toolkit fallback: PERMANENTLY REMOVED by owner directive 2026-07-16.
  // No external AI Cloud, no external proxy, no external credits.

  if (chain.length === 0) return null;

  // MAXIMUM ONE fallback attempt — not a loop through all providers.
  // This prevents the endless provider-selection loop.
  const link = chain[0];
  try {
    const result = await link.run(input);
    console.log('[IVXAI][fallback] provider succeeded', {
      module: input.module,
      requestId: input.requestId,
      provider: link.name,
      model: result.model,
      latencyMs: result.latencyMs,
    });
    return result;
  } catch (error) {
    const cls = classifyProviderFailure(error);
    console.error('[IVXAI][fallback] provider failed (single attempt, no loop)', {
      module: input.module,
      requestId: input.requestId,
      provider: link.name,
      failureClass: cls,
    });
    return null;
  }
}
