import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { acquireAIQueueSlot, classifyRequestLane, type IVXAIQueueLane } from './services/ivx-ai-queue';
import { estimatePromptTokens, recordProviderTelemetry } from './services/ivx-provider-telemetry';
import { attemptProviderFallback, classifyProviderFailure, isFailureRetryable } from './services/ivx-ai-provider-fallback';
import {
  initProviderStateMachine,
  markProviderFailed,
  markProviderReady,
  markFallbackReady,
  markAIUnavailable,
  shouldTryPrimary,
  shouldTryFallback,
  getProviderHealth,
  type IVXProviderHealth,
} from './services/ivx-provider-state-machine';

export { getProviderHealth, type IVXProviderHealth };
import { randomUUID } from 'crypto';

export type IVXAIModule = 'owner-room' | 'p0-ai-assistant' | 'p1-plan-creator' | 'public-chat' | string;
export type IVXAIMessageRole = 'user' | 'assistant';

export type IVXAITextMessage = {
  role: IVXAIMessageRole;
  content: string;
};

export type IVXAIImageAttachment = {
  url: string;
  mimeType?: string | null;
};

/**
 * A non-image binary attachment (PDF for OCR, video for understanding) passed to
 * a multimodal model as a `file` content part. `data` may be a URL, a base64
 * string, or raw bytes.
 */
export type IVXAIFileAttachment = {
  data: string | Uint8Array | ArrayBuffer;
  mediaType: string;
  filename?: string | null;
};

export type IVXAIProviderMetadata = {
  provider: 'chatgpt';
  source: 'remote_api';
  model: string;
  endpoint: string | null;
  runtime: 'ivx_ai_gateway';
  ivxAI: {
    architecture: 'ivx-ai';
    phase: 'agent_runtime_v2';
    layer: 'ivx_ai_runtime_wrapper';
    module: string;
    providerDependency: 'chatgpt_current_baseline';
    requestId: string | null;
    generatedAt: string;
  };
};

export type IVXAITextResult = {
  text: string;
  usage: unknown;
  providerMetadata: IVXAIProviderMetadata;
};

type IVXAIGatewayFailureContext = {
  module: string;
  requestId: string | null;
  model: string;
  endpoint: string | null;
  status?: number | null;
  responseBody?: unknown;
  traceId?: string | null;
};

export type IVXAIConfigurationSnapshot = {
  configured: boolean;
  hasGatewayUrl: boolean;
  hasGatewayApiKey: boolean;
  model: string;
  endpoint: string | null;
  runtime: 'ivx_ai_gateway';
  layer: 'ivx_ai_runtime_wrapper';
  phase: 'agent_runtime_v2';
};

// Direct OpenAI API — bare model names (no openai/ prefix, that was Vercel AI Gateway routing).
// gpt-4o gives real image + document analysis. Override with IVX_AI_MODEL if needed.
const DEFAULT_IVX_AI_MODEL = readTrimmed(process.env.IVX_AI_MODEL)?.replace(/^openai\//, '') || 'gpt-4o';

// Adaptive timeout floor / ceiling. Short prompts resolve fast (floor), large
// reports get more headroom (ceiling). Tuned so a 12k-token report has ~90s
// to complete instead of dying at the legacy 8s wall.
const IVX_AI_TIMEOUT_FLOOR_MS = (() => {
  const raw = Number.parseInt(readTrimmed(process.env.IVX_AI_GATEWAY_TIMEOUT_MS) || '15000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
})();
const IVX_AI_TIMEOUT_CEIL_MS = (() => {
  const raw = Number.parseInt(readTrimmed(process.env.IVX_AI_GATEWAY_TIMEOUT_CEIL_MS) || '120000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
})();

/**
 * Compute an adaptive hard timeout based on the size of the work.
 *
 * Budget heuristics:
 *  - Base latency: floor (covers handshake + first-token latency)
 *  - Output budget: ~50ms per maxOutputToken (gpt-4o-mini sustains ~20 tok/s)
 *  - Prompt budget: ~2ms per prompt char (covers large context ingestion)
 * Clamped to [floor, ceiling].
 */
export function computeAdaptiveTimeoutMs(input: {
  promptChars: number;
  maxOutputTokens: number | null | undefined;
}): number {
  const outputBudget = (input.maxOutputTokens ?? 1500) * 50;
  const promptBudget = input.promptChars * 2;
  const budget = IVX_AI_TIMEOUT_FLOOR_MS + outputBudget + promptBudget;
  return Math.min(IVX_AI_TIMEOUT_CEIL_MS, Math.max(IVX_AI_TIMEOUT_FLOOR_MS, budget));
}

function runWithHardTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: Error & { name?: string } = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.name = 'IVXAIGatewayTimeoutError';
      reject(err);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

// Provider auto-detection: the key prefix determines the correct endpoint.
//   vck_  → Vercel AI Gateway (https://ai-gateway.vercel.sh/v1)
//   sk-   → OpenAI direct API (https://api.openai.com/v1)
// This makes the runtime self-healing: whichever key is loaded on the host,
// it is routed to the matching provider. A vck_ key sent to api.openai.com
// fails with 401 invalid_api_key; an sk- key sent to ai-gateway.vercel.sh
// fails with 401. Auto-detection eliminates both failure modes.
const VERCEL_AI_GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';
const OPENAI_DIRECT_BASE = 'https://api.openai.com/v1';

function isVercelGatewayKey(key: string): boolean {
  return key.startsWith('vck_');
}

function isOpenAIDirectKey(key: string): boolean {
  return key.startsWith('sk-');
}

function getIVXAIGatewayApiKey(): string {
  return readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.AI_GATEWAY_API_KEY);
}

/**
 * Returns the AI provider type based on the loaded API key prefix.
 * 'vercel_gateway'  → vck_ key, routes to ai-gateway.vercel.sh/v1
 * 'openai_direct'   → sk- key, routes to api.openai.com/v1
 * 'unknown'         → key not loaded or unrecognized prefix
 */
export function getIVXAIProviderType(): 'vercel_gateway' | 'openai_direct' | 'unknown' {
  const key = getIVXAIGatewayApiKey();
  if (!key) return 'unknown';
  if (isVercelGatewayKey(key)) return 'vercel_gateway';
  if (isOpenAIDirectKey(key)) return 'openai_direct';
  return 'unknown';
}

/**
 * Returns the base URL for the AI provider, auto-detected from the key prefix.
 * If IVX_AI_GATEWAY_URL is explicitly set (and not a Rork domain), it takes
 * priority — this lets the operator override the auto-detection if needed.
 * Otherwise, the key prefix determines the endpoint.
 */
function getIVXAIGatewayRootUrl(): string {
  const configured = readTrimmed(process.env.IVX_AI_GATEWAY_URL);
  // Rork independence guard: never honor a gateway URL that points at a
  // Rork-hosted domain, even if a stale env var is still set on the host.
  if (configured && !isRorkDomain(configured)) {
    return configured;
  }
  // Auto-detect from key prefix
  const key = getIVXAIGatewayApiKey();
  if (key && isVercelGatewayKey(key)) {
    return VERCEL_AI_GATEWAY_BASE;
  }
  return OPENAI_DIRECT_BASE;
}

function buildGatewayBaseUrl(rootUrl: string): string | null {
  const trimmed = readTrimmed(rootUrl).replace(/\/+$/, '');
  return trimmed || null;
}

function getGatewayBaseUrl(): string | null {
  return buildGatewayBaseUrl(getIVXAIGatewayRootUrl());
}

function isRorkDomain(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('toolkit.rork.com')
    || lower.includes('api.rork.com')
    || lower.endsWith('.rork.com')
    || lower.includes('rork-direct.workers.dev');
}

function getGatewayBaseUrlCandidates(): string[] {
  const configured = getGatewayBaseUrl();
  // Auto-detect fallback candidate based on key prefix.
  // If the primary is a Vercel key (vck_), the fallback candidate is OpenAI direct.
  // If the primary is an OpenAI key (sk-), the fallback candidate is the Vercel gateway.
  // This ensures both endpoints are tried if the key/URL auto-detection mismatches.
  const key = getIVXAIGatewayApiKey();
  const fallbackCandidate = key && isVercelGatewayKey(key)
    ? buildGatewayBaseUrl(OPENAI_DIRECT_BASE)
    : buildGatewayBaseUrl(VERCEL_AI_GATEWAY_BASE);
  // Rork independence guard: any candidate that resolves to a Rork domain is
  // filtered out, so a stale env var cannot re-route through toolkit.rork.com.
  const candidates = [configured, fallbackCandidate].filter((c): c is string => c !== null && !isRorkDomain(c));
  return [...new Set(candidates)];
}

function ensureIVXAIGatewayEnvironment(): void {
  const apiKey = getIVXAIGatewayApiKey();
  if (!apiKey) {
    throw new Error(
      'IVX AI runtime is not configured. Set OPENAI_API_KEY on the backend host.',
    );
  }
  // 2026-07-18 emergency repair: the Vercel AI Gateway SDK (createGateway) was
  // removed from this runtime. The API key is now passed EXPLICITLY to a direct
  // OpenAI-compatible client for every request — no env-var bridging, no hidden
  // credential resolution, no gateway SDK dependency.
}

/** Failure classes that are safe to retry against the SAME provider with backoff. */
const TRANSIENT_RETRY_CLASSES: ReadonlySet<string> = new Set(['network', 'server_error', 'rate_limit']);

/** Max primary attempts per request: 1 initial + 2 exponential-backoff retries. */
const MAX_PRIMARY_ATTEMPTS = 3;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-flight request deduplication (idempotency protection).
 * Concurrent requests with the same module+requestId share one provider call
 * and one response — duplicate sends from the client can never produce
 * duplicate provider executions or duplicate answers.
 */
const inFlightAIRequests = new Map<string, Promise<IVXAITextResult>>();


function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function extractGatewayFailureContext(error: unknown): { status: number | null; responseBody: unknown } {
  const record = readRecord(error);
  const response = readRecord(record.response);
  const cause = readRecord(record.cause);
  const status = typeof record.statusCode === 'number'
    ? record.statusCode
    : typeof record.status === 'number'
      ? record.status
      : typeof record.responseStatus === 'number'
        ? record.responseStatus
        : typeof response.status === 'number'
          ? response.status
          : typeof cause.status === 'number'
            ? cause.status
            : null;
  const responseBody = record.responseBody
    ?? response.body
    ?? response.data
    ?? record.data
    ?? record.body
    ?? cause.responseBody
    ?? cause.body
    ?? null;
  return { status, responseBody };
}

function normalizeGatewayFailure(error: unknown, context: IVXAIGatewayFailureContext): Error {
  const traceId = context.traceId ?? generateTraceId();
  const message = error instanceof Error ? error.message : 'Gateway request failed';
  const body = typeof context.responseBody === 'string'
    ? context.responseBody.slice(0, 600)
    : context.responseBody && typeof context.responseBody === 'object'
      ? JSON.stringify(context.responseBody).slice(0, 600)
      : null;
  const detail = [
    `IVX AI gateway request failed for ${context.module}.`,
    `traceId=${traceId}`,
    `endpoint=${context.endpoint ?? 'unresolved'}`,
    `model=${context.model}`,
    context.status ? `status=${context.status}` : null,
    `providerError=${message}`,
    body ? `responseBody=${body}` : null,
  ].filter(Boolean).join(' ');
  const normalized = new Error(detail);
  normalized.name = 'IVXAIGatewayRequestError';
  // Attach traceId on the error object so callers can surface it to the user.
  Object.defineProperty(normalized, 'traceId', { value: traceId, enumerable: false });
  return normalized;
}

function normalizeMessages(messages: IVXAITextMessage[] | undefined): IVXAITextMessage[] {
  return (messages ?? [])
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: readTrimmed(message.content),
    }))
    .filter((message) => message.content.length > 0);
}

export function resolveIVXAIModel(explicitModel?: string | null, envCandidates: string[] = []): string {
  const explicit = readTrimmed(explicitModel);
  if (explicit) {
    return normalizeModelForProvider(stripOpenaiPrefix(explicit));
  }

  for (const envName of envCandidates) {
    const candidate = readTrimmed(process.env[envName]);
    if (candidate) {
      return normalizeModelForProvider(stripOpenaiPrefix(candidate));
    }
  }

  return normalizeModelForProvider(DEFAULT_IVX_AI_MODEL);
}

/**
 * Normalize the model name for the active provider.
 * Vercel AI Gateway requires the `openai/` prefix (e.g. `openai/gpt-4o`).
 * OpenAI direct API uses bare model names (e.g. `gpt-4o`).
 */
function normalizeModelForProvider(model: string): string {
  const providerType = getIVXAIProviderType();
  const bare = model.replace(/^openai\//, '');
  if (providerType === 'vercel_gateway') {
    return bare.startsWith('openai/') ? bare : `openai/${bare}`;
  }
  return bare;
}

/** Strip the openai/ prefix used by the old Vercel AI Gateway routing. */
function stripOpenaiPrefix(model: string): string {
  return model.replace(/^openai\//, '');
}

// Initialize provider state machine at module load — after all helper functions are defined
initProviderStateMachine(
  getIVXAIProviderType() === 'vercel_gateway' ? 'vercel_ai_gateway' : 'openai',
  normalizeModelForProvider(DEFAULT_IVX_AI_MODEL),
  getIVXAIGatewayApiKey().length > 0,
  false,
);

/**
 * Returns the API base URL (e.g. https://api.openai.com/v1). The model name is
 * NOT embedded in the endpoint path — the @ai-sdk/openai provider handles
 * model-to-route routing internally (chat/completions or responses). Embedding
 * the model name produced invalid URLs like https://api.openai.com/v1/gpt-4o.
 */
export function getIVXAIEndpoint(model: string = DEFAULT_IVX_AI_MODEL): string | null {
  void model; // model is NOT part of the endpoint URL
  return getGatewayBaseUrl();
}

/**
 * Startup validation — verifies the AI provider/model configuration is sound.
 * Exposes only safe metadata (never the key value). Called at boot so
 * misconfigurations surface immediately instead of on the first request.
 */
export type IVXAIStartupValidation = {
  ok: boolean;
  provider: string;
  providerType: 'vercel_gateway' | 'openai_direct' | 'unknown';
  model: string;
  adapterVersion: string;
  keyLoaded: boolean;
  keyPrefix: string;
  baseUrl: string | null;
  endpoint: string | null;
  errors: string[];
};

let cachedAdapterVersion: string | null = null;
function getAdapterVersion(): string {
  if (cachedAdapterVersion) return cachedAdapterVersion;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('@ai-sdk/openai/package.json');
    cachedAdapterVersion = typeof pkg?.version === 'string' ? pkg.version : 'unknown';
  } catch {
    cachedAdapterVersion = 'unknown';
  }
  return cachedAdapterVersion!;
}

export function validateIVXAIStartup(): IVXAIStartupValidation {
  const errors: string[] = [];
  const model = normalizeModelForProvider(DEFAULT_IVX_AI_MODEL);
  const rootUrl = getIVXAIGatewayRootUrl();
  const apiKey = getIVXAIGatewayApiKey();
  const keyLoaded = apiKey.length > 0;
  const keyPrefix = keyLoaded ? `${apiKey.slice(0, 4)}***` : 'none';
  const providerType = getIVXAIProviderType();
  const baseUrl = getGatewayBaseUrl();
  const adapterVersion = getAdapterVersion();

  if (!keyLoaded) {
    errors.push('OPENAI_API_KEY is not set');
  }
  if (!rootUrl) {
    errors.push('AI gateway root URL is empty');
  }
  if (rootUrl && isRorkDomain(rootUrl)) {
    errors.push('AI gateway URL points to a blocked Rork domain');
  }
  // Verify the adapter is spec v3 compatible (v4 is rejected by ai@6)
  const majorVersion = Number.parseInt(adapterVersion.split('.')[0] ?? '0', 10);
  if (majorVersion > 3) {
    errors.push(`@ai-sdk/openai@${adapterVersion} uses spec v4, incompatible with ai@6 — downgrade to @ai-sdk/openai@3.x`);
  }
  // Warn if key prefix doesn't match any known provider
  if (keyLoaded && providerType === 'unknown') {
    errors.push(`API key prefix ${keyPrefix} is not recognized (expected sk- for OpenAI or vck_ for Vercel AI Gateway)`);
  }

  return {
    ok: errors.length === 0,
    provider: providerType === 'vercel_gateway' ? 'vercel_ai_gateway' : 'openai',
    providerType,
    model,
    adapterVersion,
    keyLoaded,
    keyPrefix,
    baseUrl,
    endpoint: getIVXAIEndpoint(model),
    errors,
  };
}

/** Generate a short trace ID for request correlation. */
export function generateTraceId(): string {
  return `ivx-trace-${randomUUID().split('-')[0]}`;
}

export function isIVXAIConfigured(): boolean {
  return getIVXAIGatewayRootUrl().length > 0 && getIVXAIGatewayApiKey().length > 0;
}

export function getIVXAIConfigurationSnapshot(model: string = DEFAULT_IVX_AI_MODEL): IVXAIConfigurationSnapshot {
  const hasGatewayUrl = getIVXAIGatewayRootUrl().length > 0;
  const hasGatewayApiKey = getIVXAIGatewayApiKey().length > 0;
  return {
    configured: hasGatewayUrl && hasGatewayApiKey,
    hasGatewayUrl,
    hasGatewayApiKey,
    model,
    endpoint: getIVXAIEndpoint(model),
    runtime: 'ivx_ai_gateway',
    layer: 'ivx_ai_runtime_wrapper',
    phase: 'agent_runtime_v2',
  };
}

export async function requestIVXAIText(input: {
  module: IVXAIModule;
  requestId?: string | null;
  model?: string | null;
  system?: string | null;
  prompt?: string | null;
  messages?: IVXAITextMessage[];
  images?: IVXAIImageAttachment[];
  files?: IVXAIFileAttachment[];
  maxOutputTokens?: number;
}): Promise<IVXAITextResult> {
  const dedupKey = readTrimmed(input.requestId) ? `${String(input.module)}::${readTrimmed(input.requestId)}` : null;
  if (dedupKey) {
    const existing = inFlightAIRequests.get(dedupKey);
    if (existing) {
      console.log('[IVXAI] Duplicate in-flight request deduplicated (idempotency guard):', {
        module: input.module,
        requestId: input.requestId ?? null,
      });
      return existing;
    }
  }
  const pending = requestIVXAITextInternal(input);
  if (dedupKey) {
    inFlightAIRequests.set(dedupKey, pending);
    pending.catch(() => undefined).finally(() => inFlightAIRequests.delete(dedupKey));
  }
  return pending;
}

async function requestIVXAITextInternal(input: {
  module: IVXAIModule;
  requestId?: string | null;
  model?: string | null;
  system?: string | null;
  prompt?: string | null;
  messages?: IVXAITextMessage[];
  images?: IVXAIImageAttachment[];
  files?: IVXAIFileAttachment[];
  maxOutputTokens?: number;
}): Promise<IVXAITextResult> {
  const model = resolveIVXAIModel(input.model);
  const endpoint = getIVXAIEndpoint(model);
  const messages = normalizeMessages(input.messages);
  const prompt = readTrimmed(input.prompt);
  const system = readTrimmed(input.system);
  const images = (input.images ?? [])
    .map((img) => ({ url: readTrimmed(img.url), mimeType: readTrimmed(img.mimeType ?? '') || null }))
    .filter((img) => img.url.length > 0);
  const files = (input.files ?? []).filter(
    (file) => readTrimmed(file.mediaType).length > 0 && file.data != null,
  );

  if (!prompt && messages.length === 0) {
    throw new Error('IVX AI request requires a prompt or messages.');
  }

  const baseUrlCandidates = getGatewayBaseUrlCandidates();
  if (baseUrlCandidates.length === 0) {
    throw new Error('IVX AI runtime is not configured.');
  }

  console.log('[IVXAI] Routing request through IVX AI Phase 1 wrapper:', {
    module: input.module,
    requestId: input.requestId ?? null,
    model,
    endpoint,
    baseUrlCandidates,
    hasSystem: system.length > 0,
    promptLength: prompt.length,
    messageCount: messages.length,
    authKeySource: 'OPENAI_API_KEY',
    requestShape: messages.length > 0 ? 'messages' : 'prompt',
    maxOutputTokens: input.maxOutputTokens ?? null,
    phase: 'agent_runtime_v2',
    layer: 'ivx_ai_runtime_wrapper',
  });

  // Adaptive timeout + queue gating: long prompts/reports get more time and a
  // dedicated lane so they cannot block normal chat under contention.
  const promptChars = prompt.length + system.length + messages.reduce((sum, m) => sum + m.content.length, 0);
  const adaptiveTimeoutMs = computeAdaptiveTimeoutMs({ promptChars, maxOutputTokens: input.maxOutputTokens });
  const queueLane: IVXAIQueueLane = classifyRequestLane({ promptChars, maxOutputTokens: input.maxOutputTokens });
  const queueSlot = await acquireAIQueueSlot(queueLane);
  const callStartedAt = Date.now();

  let result: Awaited<ReturnType<typeof generateText>> | null = null;
  let lastError: unknown = null;
  let lastFailure: { status: number | null; responseBody: unknown } = { status: null, responseBody: null };
  let successfulBaseUrl = baseUrlCandidates[0];
  let retryCount = 0;

  // === PROVIDER STATE MACHINE + BOUNDED RETRY ===
  // 2026-07-18 emergency repair:
  //  - Direct OpenAI-compatible client for BOTH key types. The Vercel AI
  //    Gateway SDK (createGateway) is removed — it resolved credentials via
  //    env vars and produced opaque "Unauthenticated" / "Gateway request
  //    failed" errors. The key is now injected explicitly per request.
  //  - Transient failures (network / 5xx / 429) retry against the SAME
  //    provider with exponential backoff (max 3 attempts). Auth failures
  //    (401/403) never retry the same key — they mark the provider FAILED
  //    and route to the controlled different-key fallback.
  //  - The failure latch is no longer permanent: the state machine re-opens
  //    a half-open probe after the recovery cooldown (see
  //    ivx-provider-state-machine.ts), so the runtime self-heals.
  if (shouldTryPrimary()) {
    const baseURL = baseUrlCandidates[0];
    ensureIVXAIGatewayEnvironment();
    const apiKey = getIVXAIGatewayApiKey();
    const isVercelKey = isVercelGatewayKey(apiKey);
    const gatewayProvider = createOpenAI({ apiKey, baseURL });
    const callTimeoutMs = adaptiveTimeoutMs;
    for (let attempt = 1; attempt <= MAX_PRIMARY_ATTEMPTS && !result; attempt += 1) {
      try {
        if (images.length > 0 || files.length > 0) {
          const baseMessages = messages.length > 0
            ? messages.slice(0, -1)
            : [];
          const lastTextMessage = messages.length > 0 ? messages[messages.length - 1] : null;
          const userText = readTrimmed(
            (lastTextMessage && lastTextMessage.role === 'user' ? lastTextMessage.content : '') || prompt
          ) || 'Describe the attached file(s).';
          const multimodalUser = {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: userText },
              ...images.map((img) => ({ type: 'image' as const, image: img.url })),
              ...files.map((file) => ({ type: 'file' as const, data: file.data, mediaType: file.mediaType })),
            ],
          };
          const finalMessages = lastTextMessage && lastTextMessage.role === 'user'
            ? [...baseMessages, multimodalUser]
            : [...messages, multimodalUser];
          result = await runWithHardTimeout('IVX AI direct (multimodal)', generateText({
            model: gatewayProvider(model),
            system: system.length > 0 ? system : undefined,
            maxOutputTokens: input.maxOutputTokens,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: finalMessages as any,
          }), callTimeoutMs);
        } else {
          result = messages.length > 0
            ? await runWithHardTimeout('IVX AI direct (messages)', generateText({
                model: gatewayProvider(model),
                system: system.length > 0 ? system : undefined,
                maxOutputTokens: input.maxOutputTokens,
                messages,
              }), callTimeoutMs)
            : await runWithHardTimeout('IVX AI direct (prompt)', generateText({
                model: gatewayProvider(model),
                system: system.length > 0 ? system : undefined,
                maxOutputTokens: input.maxOutputTokens,
                prompt,
              }), callTimeoutMs);
        }
        successfulBaseUrl = baseURL;
        markProviderReady(
          isVercelKey ? 'vercel_ai_gateway' : 'openai_direct',
          model,
        );
      } catch (error) {
        retryCount += 1;
        const failure = extractGatewayFailureContext(error);
        lastError = error;
        lastFailure = failure;
        const traceId = generateTraceId();
        const failureClass = classifyProviderFailure(error);
        const isAuthFailure = failureClass === 'auth' || failure.status === 401 || failure.status === 403;

        // Mark provider as FAILED for auth errors — never retry the same key
        if (isAuthFailure) {
          markProviderFailed(failure.status ?? 0, error instanceof Error ? error.message : 'auth failure', traceId);
        }

        const willRetry = !isAuthFailure
          && attempt < MAX_PRIMARY_ATTEMPTS
          && TRANSIENT_RETRY_CLASSES.has(failureClass);

        console.error('[IVXAI] Primary provider attempt failed:', {
          module: input.module,
          requestId: input.requestId ?? null,
          model,
          endpoint: baseURL,
          attempt,
          maxAttempts: MAX_PRIMARY_ATTEMPTS,
          willRetry,
          status: failure.status,
          failureClass,
          error: error instanceof Error ? error.message : 'Gateway request failed',
          errorName: error instanceof Error ? error.name : null,
          traceId,
        });

        if (!willRetry) {
          break;
        }
        // Exponential backoff: 600ms, then 1200ms.
        await sleepMs(600 * 2 ** (attempt - 1));
      }
    }
  } else {
    // Primary already marked as FAILED — skip directly to fallback
    console.log('[IVXAI] Primary provider already FAILED, skipping to fallback', {
      module: input.module,
      requestId: input.requestId ?? null,
    });
  }

  if (!result) {
    queueSlot.release();
    const failureMessage = lastError instanceof Error ? lastError.message : 'Gateway request failed';
    const isTimeout = lastError instanceof Error && lastError.name === 'IVXAIGatewayTimeoutError';

    // === CONTROLLED FALLBACK — maximum ONE attempt with a DIFFERENT key ===
    // The state machine ensures we only try fallback if the primary is FAILED.
    // The fallback module skips any provider using the same key as the primary.
    const failureClass = lastError ? classifyProviderFailure(lastError) : 'auth';
    if (shouldTryFallback() && isFailureRetryable(failureClass)) {
      const fallbackResult = await attemptProviderFallback({
        module: String(input.module),
        requestId: input.requestId ?? null,
        system,
        prompt,
        messages,
        maxOutputTokens: input.maxOutputTokens ?? null,
        timeoutMs: adaptiveTimeoutMs,
      });
      if (fallbackResult) {
        markFallbackReady(fallbackResult.provider, fallbackResult.model);
        const fallbackMetadata: IVXAIProviderMetadata = {
          provider: 'chatgpt',
          source: 'remote_api',
          model: fallbackResult.model,
          endpoint: null,
          runtime: 'ivx_ai_gateway',
          ivxAI: {
            architecture: 'ivx-ai',
            phase: 'agent_runtime_v2',
            layer: 'ivx_ai_runtime_wrapper',
            module: input.module,
            providerDependency: 'chatgpt_current_baseline',
            requestId: input.requestId ?? null,
            generatedAt: nowIso(),
          },
        };
        recordProviderTelemetry({
          traceId: input.requestId ?? null,
          module: String(input.module),
          model: fallbackResult.model,
          endpoint: null,
          promptChars,
          promptTokensEstimated: estimatePromptTokens(promptChars),
          completionTokens: null,
          totalTokens: null,
          latencyMs: Date.now() - callStartedAt,
          retryCount: Math.max(0, retryCount - 1),
          status: 'ok',
          httpStatus: 200,
          failureReason: `primary_failed_${failureClass}_fallback=${fallbackResult.provider}`,
          maxOutputTokens: input.maxOutputTokens ?? null,
          adaptiveTimeoutMs,
          queueWaitMs: queueSlot.waitMs,
        });
        console.log('[IVXAI] Recovered via fallback provider:', {
          module: input.module,
          requestId: input.requestId ?? null,
          primaryFailureClass: failureClass,
          fallbackProvider: fallbackResult.provider,
          fallbackModel: fallbackResult.model,
        });
        return {
          text: fallbackResult.text,
          usage: null,
          providerMetadata: fallbackMetadata,
        };
      }
    }

    recordProviderTelemetry({
      traceId: input.requestId ?? null,
      module: String(input.module),
      model,
      endpoint,
      promptChars,
      promptTokensEstimated: estimatePromptTokens(promptChars),
      completionTokens: null,
      totalTokens: null,
      latencyMs: Date.now() - callStartedAt,
      retryCount: Math.max(0, retryCount - 1),
      status: isTimeout ? 'timeout' : 'failed',
      httpStatus: lastFailure.status,
      failureReason: failureMessage,
      maxOutputTokens: input.maxOutputTokens ?? null,
      adaptiveTimeoutMs,
      queueWaitMs: queueSlot.waitMs,
    });
    const traceId = generateTraceId();
    markAIUnavailable(traceId, failureMessage);
    throw normalizeGatewayFailure(lastError, {
      module: input.module,
      requestId: input.requestId ?? null,
      model,
      endpoint,
      status: lastFailure.status,
      responseBody: lastFailure.responseBody,
      traceId,
    });
  }
  queueSlot.release();

  const text = readTrimmed(result.text);
  if (!text) {
    throw new Error('IVX AI runtime returned an empty response.');
  }

  const providerMetadata: IVXAIProviderMetadata = {
    provider: 'chatgpt',
    source: 'remote_api',
    model,
    endpoint: successfulBaseUrl,
    runtime: 'ivx_ai_gateway',
    ivxAI: {
      architecture: 'ivx-ai',
      phase: 'agent_runtime_v2',
      layer: 'ivx_ai_runtime_wrapper',
      module: input.module,
      providerDependency: 'chatgpt_current_baseline',
      requestId: input.requestId ?? null,
      generatedAt: nowIso(),
    },
  };

  const usageRecord = (result.usage ?? null) as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  recordProviderTelemetry({
    traceId: input.requestId ?? null,
    module: String(input.module),
    model,
    endpoint: successfulBaseUrl,
    promptChars,
    promptTokensEstimated: estimatePromptTokens(promptChars),
    completionTokens: typeof usageRecord?.outputTokens === 'number' ? usageRecord.outputTokens : null,
    totalTokens: typeof usageRecord?.totalTokens === 'number' ? usageRecord.totalTokens : null,
    latencyMs: Date.now() - callStartedAt,
    retryCount,
    status: 'ok',
    httpStatus: 200,
    failureReason: null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    adaptiveTimeoutMs,
    queueWaitMs: queueSlot.waitMs,
  });

  console.log('[IVXAI] Request completed through IVX AI wrapper:', {
    module: input.module,
    requestId: input.requestId ?? null,
    provider: providerMetadata.provider,
    source: providerMetadata.source,
    model,
    answerLength: text.length,
    latencyMs: Date.now() - callStartedAt,
    adaptiveTimeoutMs,
    queueLane,
    queueWaitMs: queueSlot.waitMs,
  });

  return {
    text,
    usage: result.usage ?? null,
    providerMetadata,
  };
}

export type IVXAIStreamChunk = {
  type: 'delta' | 'done' | 'error';
  delta?: string;
  text?: string;
  error?: string;
  usage?: unknown;
  providerMetadata?: IVXAIProviderMetadata;
};

/**
 * Streaming variant of `requestIVXAIText`. Yields delta chunks as they arrive
 * from the gateway, then a final `done` chunk with full text + usage + provider
 * metadata. Records the same telemetry shape as the non-streaming path.
 *
 * Failures are yielded as a single `error` chunk (no throw) so SSE consumers
 * never see a half-open stream.
 */
export async function* streamIVXAIText(input: {
  module: IVXAIModule;
  requestId?: string | null;
  model?: string | null;
  system?: string | null;
  prompt?: string | null;
  messages?: IVXAITextMessage[];
  maxOutputTokens?: number;
}): AsyncGenerator<IVXAIStreamChunk, void, void> {
  const model = resolveIVXAIModel(input.model);
  const messages = normalizeMessages(input.messages);
  const prompt = readTrimmed(input.prompt);
  const system = readTrimmed(input.system);

  if (!prompt && messages.length === 0) {
    yield { type: 'error', error: 'IVX AI request requires a prompt or messages.' };
    return;
  }

  const baseUrlCandidates = getGatewayBaseUrlCandidates();
  if (baseUrlCandidates.length === 0) {
    yield { type: 'error', error: 'IVX AI runtime is not configured.' };
    return;
  }

  const promptChars = prompt.length + system.length + messages.reduce((sum, m) => sum + m.content.length, 0);
  const adaptiveTimeoutMs = computeAdaptiveTimeoutMs({ promptChars, maxOutputTokens: input.maxOutputTokens });
  const queueLane = classifyRequestLane({ promptChars, maxOutputTokens: input.maxOutputTokens });
  const queueSlot = await acquireAIQueueSlot(queueLane);
  const callStartedAt = Date.now();

  ensureIVXAIGatewayEnvironment();
  const baseURL = baseUrlCandidates[0];

  let accumulated = '';
  let lastError: string | null = null;
  let usage: unknown = null;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; }, adaptiveTimeoutMs);

  try {
    const apiKey = getIVXAIGatewayApiKey();
    // Direct OpenAI-compatible client for both key types (no gateway SDK).
    const gatewayProvider = createOpenAI({ apiKey, baseURL });
    const streamResult = streamText({
      model: gatewayProvider(model),
      system: system.length > 0 ? system : undefined,
      maxOutputTokens: input.maxOutputTokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(messages.length > 0 ? { messages } as any : { prompt }),
    });

    for await (const delta of streamResult.textStream) {
      if (timedOut) {
        lastError = `IVX AI stream timed out after ${adaptiveTimeoutMs}ms`;
        break;
      }
      accumulated += delta;
      yield { type: 'delta', delta };
    }

    if (!timedOut) {
      try {
        usage = await streamResult.usage;
      } catch {
        usage = null;
      }
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'IVX AI stream failed';
  } finally {
    clearTimeout(timer);
    queueSlot.release();
  }

  const usageRecord = usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  recordProviderTelemetry({
    traceId: input.requestId ?? null,
    module: String(input.module),
    model,
    endpoint: baseURL,
    promptChars,
    promptTokensEstimated: estimatePromptTokens(promptChars),
    completionTokens: typeof usageRecord?.outputTokens === 'number' ? usageRecord.outputTokens : null,
    totalTokens: typeof usageRecord?.totalTokens === 'number' ? usageRecord.totalTokens : null,
    latencyMs: Date.now() - callStartedAt,
    retryCount: 0,
    status: lastError ? (timedOut ? 'timeout' : 'failed') : 'ok',
    httpStatus: lastError ? null : 200,
    failureReason: lastError,
    maxOutputTokens: input.maxOutputTokens ?? null,
    adaptiveTimeoutMs,
    queueWaitMs: queueSlot.waitMs,
  });

  if (lastError && accumulated.length === 0) {
    yield { type: 'error', error: lastError };
    return;
  }

  const providerMetadata: IVXAIProviderMetadata = {
    provider: 'chatgpt',
    source: 'remote_api',
    model,
    endpoint: baseURL,
    runtime: 'ivx_ai_gateway',
    ivxAI: {
      architecture: 'ivx-ai',
      phase: 'agent_runtime_v2',
      layer: 'ivx_ai_runtime_wrapper',
      module: input.module,
      providerDependency: 'chatgpt_current_baseline',
      requestId: input.requestId ?? null,
      generatedAt: nowIso(),
    },
  };

  yield {
    type: 'done',
    text: accumulated,
    usage,
    providerMetadata,
    ...(lastError ? { error: lastError } : {}),
  };
}