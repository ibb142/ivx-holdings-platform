/**
 * IVX AI multi-provider fallback chain.
 *
 * This module is intentionally independent from the primary AI SDK path. When
 * the primary model call fails, it performs direct HTTP calls with owner-owned
 * credentials only. No prompt or credential values are logged.
 */

export type IVXProviderName = 'ivx_ai_gateway' | 'openai_direct' | 'anthropic_direct';

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
  envGates: string[];
};

export type IVXProviderInvocationResult = {
  text: string;
  provider: IVXProviderName;
  model: string;
  latencyMs: number;
};

type FallbackInput = {
  module: string;
  requestId: string | null;
  system: string;
  prompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxOutputTokens: number | null | undefined;
  timeoutMs: number;
};

type Candidate = {
  name: IVXProviderName;
  key: string;
  run: (input: FallbackInput, key: string) => Promise<IVXProviderInvocationResult>;
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function env(name: string): string {
  return readTrimmed(process.env[name]);
}

function isOpenAIKey(value: string): boolean {
  return value.startsWith('sk-');
}

function isVercelKey(value: string): boolean {
  return value.startsWith('vck_');
}

function firstOpenAIKey(): string {
  const candidates = [
    env('IVX_OPENAI_DIRECT_API_KEY'),
    env('IVX_OPENAI_API_KEY'),
    env('OPENAI_API_KEY'),
  ];
  return candidates.find(isOpenAIKey) ?? '';
}

function firstVercelKey(): string {
  const candidates = [
    env('IVX_VERCEL_GATEWAY_API_KEY'),
    env('IVX_AI_GATEWAY_KEY'),
    env('AI_GATEWAY_API_KEY'),
    env('OPENAI_API_KEY'),
  ];
  return candidates.find(isVercelKey) ?? '';
}

function anthropicKey(): string {
  return env('IVX_ANTHROPIC_API_KEY') || env('ANTHROPIC_API_KEY');
}

export function getIVXProviderChainSnapshot(): {
  primary: IVXProviderStatus;
  fallbacks: IVXProviderStatus[];
  fallbackEnabled: boolean;
} {
  const openaiConfigured = Boolean(firstOpenAIKey());
  const vercelConfigured = Boolean(firstVercelKey());
  const anthropicConfigured = Boolean(anthropicKey());

  const primary: IVXProviderStatus = {
    name: openaiConfigured ? 'openai_direct' : 'ivx_ai_gateway',
    role: 'primary',
    configured: openaiConfigured || vercelConfigured,
    envGates: openaiConfigured
      ? ['IVX_OPENAI_API_KEY', 'IVX_OPENAI_DIRECT_API_KEY', 'OPENAI_API_KEY']
      : ['IVX_AI_GATEWAY_KEY', 'AI_GATEWAY_API_KEY', 'IVX_VERCEL_GATEWAY_API_KEY'],
  };

  const fallbacks: IVXProviderStatus[] = [
    {
      name: 'openai_direct',
      role: 'fallback',
      configured: openaiConfigured,
      envGates: ['IVX_OPENAI_DIRECT_API_KEY', 'IVX_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    },
    {
      name: 'ivx_ai_gateway',
      role: 'fallback',
      configured: vercelConfigured,
      envGates: ['IVX_VERCEL_GATEWAY_API_KEY', 'IVX_AI_GATEWAY_KEY', 'AI_GATEWAY_API_KEY'],
    },
    {
      name: 'anthropic_direct',
      role: 'fallback',
      configured: anthropicConfigured,
      envGates: ['IVX_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
    },
  ];

  return {
    primary,
    fallbacks,
    fallbackEnabled: fallbacks.some((provider) => provider.configured),
  };
}

export function classifyProviderFailure(error: unknown): IVXProviderFailureClass {
  if (!error) return 'unknown';
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const statusMatch = message.match(/status=(\d{3})/);
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;

  if (name === 'AbortError' || name === 'IVXAIGatewayTimeoutError' || message.includes('timed out') || message.includes('etimedout')) {
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
  if (status !== null && status >= 500) return 'server_error';
  if (status === 400 || status === 422) return 'bad_request';
  if (
    message.includes('econnreset')
    || message.includes('econnrefused')
    || message.includes('fetch failed')
    || message.includes('network')
  ) {
    return 'network';
  }
  return 'unknown';
}

export function isFailureRetryable(cls: IVXProviderFailureClass): boolean {
  return cls === 'timeout'
    || cls === 'rate_limit'
    || cls === 'quota'
    || cls === 'server_error'
    || cls === 'network'
    || cls === 'auth';
}

function buildChatMessages(input: FallbackInput): { role: string; content: string }[] {
  const output: { role: string; content: string }[] = [];
  if (input.system) output.push({ role: 'system', content: input.system });
  if (input.messages.length > 0) {
    for (const message of input.messages) {
      output.push({ role: message.role, content: message.content });
    }
  } else if (input.prompt) {
    output.push({ role: 'user', content: input.prompt });
  }
  return output;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAIDirect(input: FallbackInput, apiKey: string): Promise<IVXProviderInvocationResult> {
  if (!isOpenAIKey(apiKey)) throw new Error('openai_direct invalid key');
  const model = env('IVX_OPENAI_FALLBACK_MODEL') || 'gpt-4o-mini';
  const startedAt = Date.now();
  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildChatMessages(input),
        max_tokens: input.maxOutputTokens ?? undefined,
      }),
    },
    input.timeoutMs,
  );
  if (!response.ok) throw new Error(`openai_direct status=${response.status}`);
  const json = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = readTrimmed(json.choices?.[0]?.message?.content);
  if (!text) throw new Error('openai_direct empty response');
  return { text, provider: 'openai_direct', model, latencyMs: Date.now() - startedAt };
}

async function callVercelGateway(input: FallbackInput, apiKey: string): Promise<IVXProviderInvocationResult> {
  if (!isVercelKey(apiKey)) throw new Error('ivx_ai_gateway invalid key');
  const bareModel = env('IVX_OPENAI_FALLBACK_MODEL') || 'gpt-4o-mini';
  const model = bareModel.startsWith('openai/') ? bareModel : `openai/${bareModel}`;
  const startedAt = Date.now();
  const response = await fetchWithTimeout(
    'https://ai-gateway.vercel.sh/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildChatMessages(input),
        max_tokens: input.maxOutputTokens ?? undefined,
      }),
    },
    input.timeoutMs,
  );
  if (!response.ok) throw new Error(`ivx_ai_gateway status=${response.status}`);
  const json = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = readTrimmed(json.choices?.[0]?.message?.content);
  if (!text) throw new Error('ivx_ai_gateway empty response');
  return { text, provider: 'ivx_ai_gateway', model, latencyMs: Date.now() - startedAt };
}

async function callAnthropicDirect(input: FallbackInput, apiKey: string): Promise<IVXProviderInvocationResult> {
  if (!apiKey) throw new Error('anthropic_direct invalid key');
  const model = env('IVX_ANTHROPIC_FALLBACK_MODEL') || 'claude-3-5-haiku-latest';
  const messages = input.messages.length > 0
    ? input.messages.map((message) => ({ role: message.role, content: message.content }))
    : [{ role: 'user' as const, content: input.prompt }];
  const startedAt = Date.now();
  const response = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
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
    },
    input.timeoutMs,
  );
  if (!response.ok) throw new Error(`anthropic_direct status=${response.status}`);
  const json = await response.json() as { content?: { type?: string; text?: string }[] };
  const text = readTrimmed(
    (json.content ?? [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('\n'),
  );
  if (!text) throw new Error('anthropic_direct empty response');
  return { text, provider: 'anthropic_direct', model, latencyMs: Date.now() - startedAt };
}

function buildCandidates(): Candidate[] {
  const candidates: Candidate[] = [];
  const seenKeys = new Set<string>();

  const add = (candidate: Candidate): void => {
    if (!candidate.key || seenKeys.has(candidate.key)) return;
    seenKeys.add(candidate.key);
    candidates.push(candidate);
  };

  const openAI = firstOpenAIKey();
  if (openAI) add({ name: 'openai_direct', key: openAI, run: callOpenAIDirect });

  const anthropic = anthropicKey();
  if (anthropic) add({ name: 'anthropic_direct', key: anthropic, run: callAnthropicDirect });

  const vercel = firstVercelKey();
  if (vercel) add({ name: 'ivx_ai_gateway', key: vercel, run: callVercelGateway });

  return candidates;
}

/**
 * Attempt all configured owner-controlled providers with distinct credentials,
 * bounded to three total fallback calls. This fixes the old single-attempt
 * behavior where a failing first fallback prevented recovery through another
 * configured provider.
 */
export async function attemptProviderFallback(input: FallbackInput): Promise<IVXProviderInvocationResult | null> {
  const chain = buildCandidates().slice(0, 3);
  if (chain.length === 0) return null;

  for (const candidate of chain) {
    try {
      const result = await candidate.run(input, candidate.key);
      console.log('[IVXAI][fallback] provider succeeded', {
        module: input.module,
        requestId: input.requestId,
        provider: candidate.name,
        model: result.model,
        latencyMs: result.latencyMs,
      });
      return result;
    } catch (error) {
      console.error('[IVXAI][fallback] provider failed', {
        module: input.module,
        requestId: input.requestId,
        provider: candidate.name,
        failureClass: classifyProviderFailure(error),
      });
    }
  }

  return null;
}
