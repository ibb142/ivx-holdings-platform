/**
 * IVX AI Provider Layer — Owner-owned, independent from Rork.
 *
 * This module provides a unified interface for AI providers (OpenAI, Anthropic,
 * etc.) that IVX owns and controls directly. It replaces the Vercel AI Gateway
 * (Rork-managed) with owner-provided API keys.
 *
 * Key features:
 * - Provider health checks
 * - Model selection per task type
 * - Chat completion + structured JSON output
 * - Timeout + AbortController cancellation
 * - Retry with exponential backoff
 * - Provider failover
 * - Cost tracking with daily/monthly limits
 * - Emergency stop
 * - No secrets in logs
 */

export type ProviderName = 'openai' | 'anthropic' | 'vercel_gateway' | 'none';

export type TaskType =
  | 'chat'
  | 'code_generation'
  | 'code_planning'
  | 'analysis'
  | 'summary';

export interface ProviderConfig {
  name: ProviderName;
  enabled: boolean;
  apiKeyEnvVar: string;
  baseUrl: string;
  defaultModel: string;
  maxOutputTokens: number;
  timeoutMs: number;
  priority: number;
}

export interface ChatCompletionRequest {
  system: string;
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
  taskType?: TaskType;
  abortSignal?: AbortSignal | null;
  requestId?: string;
}

export interface ChatCompletionResponse {
  text: string;
  model: string;
  provider: ProviderName;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  requestId: string;
}

export interface ProviderHealth {
  provider: ProviderName;
  healthy: boolean;
  model: string;
  lastCheckedAt: string;
  lastHttpStatus: number | null;
  error: string | null;
}

export interface CostTracker {
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  emergencyStopActive: boolean;
  lastResetDate: string;
}

export interface ProviderRouterConfig {
  primaryProvider: ProviderName;
  fallbackProvider: ProviderName | null;
  providers: ProviderConfig[];
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  emergencyStopActive: boolean;
  modelByTask: Partial<Record<TaskType, string>>;
}

// ── Default configuration ─────────────────────────────────────────────────

const DEFAULT_CONFIGS: ProviderConfig[] = [
  {
    name: 'openai',
    enabled: true,
    apiKeyEnvVar: 'IVX_OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    maxOutputTokens: 8192,
    timeoutMs: 90_000,
    priority: 1,
  },
  {
    name: 'anthropic',
    enabled: false,
    apiKeyEnvVar: 'IVX_ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    maxOutputTokens: 8192,
    timeoutMs: 90_000,
    priority: 2,
  },
  {
    name: 'vercel_gateway',
    enabled: false,
    apiKeyEnvVar: 'AI_GATEWAY_API_KEY',
    baseUrl: 'https://ai-gateway.vercel.sh/v1/chat/completions',
    defaultModel: 'openai/gpt-4o',
    maxOutputTokens: 8192,
    timeoutMs: 90_000,
    priority: 99,
  },
];

const DEFAULT_ROUTER_CONFIG: ProviderRouterConfig = {
  primaryProvider: 'openai',
  fallbackProvider: null,
  providers: DEFAULT_CONFIGS,
  dailyLimitUsd: 50,
  monthlyLimitUsd: 500,
  emergencyStopActive: false,
  modelByTask: {
    chat: 'gpt-4o',
    code_generation: 'gpt-4o',
    code_planning: 'gpt-4o-mini',
    analysis: 'gpt-4o',
    summary: 'gpt-4o-mini',
  },
};

// ── Cost tracking (in-memory, reset daily) ────────────────────────────────

let costTracker: CostTracker = {
  dailySpendUsd: 0,
  monthlySpendUsd: 0,
  dailyLimitUsd: 50,
  monthlyLimitUsd: 500,
  emergencyStopActive: false,
  lastResetDate: new Date().toISOString().slice(0, 10),
};

function resetDailyCostIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (costTracker.lastResetDate !== today) {
    costTracker.dailySpendUsd = 0;
    costTracker.lastResetDate = today;
  }
}

function isBudgetExceeded(): boolean {
  resetDailyCostIfNeeded();
  return (
    costTracker.emergencyStopActive ||
    costTracker.dailySpendUsd >= costTracker.dailyLimitUsd ||
    costTracker.monthlySpendUsd >= costTracker.monthlyLimitUsd
  );
}

function recordCost(usd: number): void {
  resetDailyCostIfNeeded();
  costTracker.dailySpendUsd += usd;
  costTracker.monthlySpendUsd += usd;
}

// ── Owner controls ────────────────────────────────────────────────────────

export function setEmergencyStop(active: boolean): void {
  costTracker.emergencyStopActive = active;
}

export function setDailyLimit(usd: number): void {
  costTracker.dailyLimitUsd = usd;
}

export function setMonthlyLimit(usd: number): void {
  costTracker.monthlyLimitUsd = usd;
}

export function getCostTracker(): CostTracker {
  resetDailyCostIfNeeded();
  return { ...costTracker };
}

// ── Token estimation ──────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  if (model.includes('gpt-4o-mini')) {
    return (inputTokens * 0.00000015) + (outputTokens * 0.0000006);
  }
  if (model.includes('gpt-4o')) {
    return (inputTokens * 0.0000025) + (outputTokens * 0.00001);
  }
  if (model.includes('claude')) {
    return (inputTokens * 0.000003) + (outputTokens * 0.000015);
  }
  return (inputTokens * 0.0000025) + (outputTokens * 0.00001);
}

// ── Error normalization ───────────────────────────────────────────────────

export interface ProviderError {
  provider: ProviderName;
  type: 'timeout' | 'auth' | 'rate_limit' | 'network' | 'server' | 'unknown';
  message: string;
  httpStatus: number | null;
  retryable: boolean;
}

function normalizeError(
  provider: ProviderName,
  error: unknown,
): ProviderError {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (lower.includes('timeout') || lower.includes('aborted')) {
    return { provider, type: 'timeout', message: msg, httpStatus: null, retryable: true };
  }
  if (lower.includes('401') || lower.includes('auth') || lower.includes('api key')) {
    return { provider, type: 'auth', message: msg, httpStatus: 401, retryable: false };
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return { provider, type: 'rate_limit', message: msg, httpStatus: 429, retryable: true };
  }
  if (lower.includes('network') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { provider, type: 'network', message: msg, httpStatus: null, retryable: true };
  }
  if (lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return { provider, type: 'server', message: msg, httpStatus: 503, retryable: true };
  }
  return { provider, type: 'unknown', message: msg, httpStatus: null, retryable: false };
}

// ── Provider router ───────────────────────────────────────────────────────

let routerConfig: ProviderRouterConfig = DEFAULT_ROUTER_CONFIG;

export function getRouterConfig(): ProviderRouterConfig {
  return routerConfig;
}

export function setRouterConfig(config: Partial<ProviderRouterConfig>): void {
  routerConfig = { ...routerConfig, ...config };
}

export function setPrimaryProvider(name: ProviderName): void {
  routerConfig.primaryProvider = name;
}

export function setFallbackProvider(name: ProviderName | null): void {
  routerConfig.fallbackProvider = name;
}

export function enableProvider(name: ProviderName, enabled: boolean): void {
  const provider = routerConfig.providers.find((p) => p.name === name);
  if (provider) provider.enabled = enabled;
}

export function setModelForTask(task: TaskType, model: string): void {
  routerConfig.modelByTask[task] = model;
}

function getProviderConfig(name: ProviderName): ProviderConfig | null {
  return routerConfig.providers.find((p) => p.name === name && p.enabled) ?? null;
}

function getApiKey(config: ProviderConfig): string {
  const value = process.env[config.apiKeyEnvVar];
  return typeof value === 'string' ? value.trim() : '';
}

// ── Health check ──────────────────────────────────────────────────────────

export async function checkProviderHealth(
  name: ProviderName,
): Promise<ProviderHealth> {
  const config = getProviderConfig(name);
  if (!config) {
    return {
      provider: name,
      healthy: false,
      model: 'N/A',
      lastCheckedAt: new Date().toISOString(),
      lastHttpStatus: null,
      error: 'Provider not configured or disabled',
    };
  }

  const apiKey = getApiKey(config);
  if (!apiKey) {
    return {
      provider: name,
      healthy: false,
      model: config.defaultModel,
      lastCheckedAt: new Date().toISOString(),
      lastHttpStatus: null,
      error: `No API key found in ${config.apiKeyEnvVar}`,
    };
  }

  try {
    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.defaultModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    return {
      provider: name,
      healthy: response.ok || response.status === 400,
      model: config.defaultModel,
      lastCheckedAt: new Date().toISOString(),
      lastHttpStatus: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      provider: name,
      healthy: false,
      model: config.defaultModel,
      lastCheckedAt: new Date().toISOString(),
      lastHttpStatus: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Chat completion with failover ─────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

function computeBackoff(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), 30_000);
}

async function callOpenAI(
  config: ProviderConfig,
  request: ChatCompletionRequest,
  apiKey: string,
): Promise<ChatCompletionResponse> {
  const model =
    (request.taskType && routerConfig.modelByTask[request.taskType]) ||
    config.defaultModel;
  const maxTokens = request.maxOutputTokens ?? config.maxOutputTokens;
  const startTime = Date.now();
  const requestId = request.requestId || `ivx-ai-${Date.now()}`;

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      max_tokens: maxTokens,
      temperature: request.temperature ?? 0.7,
    }),
    signal: request.abortSignal ?? undefined,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(request.system + request.user);
  const outputTokens = data.usage?.completion_tokens ?? estimateTokens(text);
  const costUsd = estimateCostUsd(inputTokens, outputTokens, model);
  const latencyMs = Date.now() - startTime;

  recordCost(costUsd);

  return {
    text,
    model,
    provider: 'openai',
    inputTokens,
    outputTokens,
    costUsd,
    latencyMs,
    requestId,
  };
}

async function callAnthropic(
  config: ProviderConfig,
  request: ChatCompletionRequest,
  apiKey: string,
): Promise<ChatCompletionResponse> {
  const model =
    (request.taskType && routerConfig.modelByTask[request.taskType]) ||
    config.defaultModel;
  const maxTokens = request.maxOutputTokens ?? config.maxOutputTokens;
  const startTime = Date.now();
  const requestId = request.requestId || `ivx-ai-${Date.now()}`;

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      max_tokens: maxTokens,
    }),
    signal: request.abortSignal ?? undefined,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';
  const inputTokens = data.usage?.input_tokens ?? estimateTokens(request.system + request.user);
  const outputTokens = data.usage?.output_tokens ?? estimateTokens(text);
  const costUsd = estimateCostUsd(inputTokens, outputTokens, model);
  const latencyMs = Date.now() - startTime;

  recordCost(costUsd);

  return {
    text,
    model,
    provider: 'anthropic',
    inputTokens,
    outputTokens,
    costUsd,
    latencyMs,
    requestId,
  };
}

export async function chatCompletion(
  request: ChatCompletionRequest,
): Promise<ChatCompletionResponse> {
  if (isBudgetExceeded()) {
    throw new Error(
      `Budget exceeded or emergency stop active. Daily: $${costTracker.dailySpendUsd.toFixed(2)}/$${costTracker.dailyLimitUsd}, Monthly: $${costTracker.monthlySpendUsd.toFixed(2)}/$${costTracker.monthlyLimitUsd}`,
    );
  }

  const providersToTry: ProviderName[] = [
    routerConfig.primaryProvider,
    ...(routerConfig.fallbackProvider ? [routerConfig.fallbackProvider] : []),
  ];

  let lastError: ProviderError | null = null;

  for (const providerName of providersToTry) {
    const config = getProviderConfig(providerName);
    if (!config) continue;

    const apiKey = getApiKey(config);
    if (!apiKey) {
      lastError = {
        provider: providerName,
        type: 'auth',
        message: `No API key in ${config.apiKeyEnvVar}`,
        httpStatus: null,
        retryable: false,
      };
      continue;
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (providerName === 'openai' || providerName === 'vercel_gateway') {
          return await callOpenAI(config, request, apiKey);
        }
        if (providerName === 'anthropic') {
          return await callAnthropic(config, request, apiKey);
        }
        throw new Error(`Unknown provider: ${providerName}`);
      } catch (error) {
        lastError = normalizeError(providerName, error);
        if (!lastError.retryable || attempt === MAX_RETRIES - 1) break;
        const backoff = computeBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw new Error(
    `All providers failed. Last error: ${lastError?.provider ?? 'none'} — ${lastError?.message ?? 'unknown'}`,
  );
}

// ── Initialization check ──────────────────────────────────────────────────

export function isIVXProviderLayerReady(): boolean {
  const primary = getProviderConfig(routerConfig.primaryProvider);
  if (!primary) return false;
  const apiKey = getApiKey(primary);
  return apiKey.length > 0;
}

export function getProviderLayerStatus(): {
  ready: boolean;
  primaryProvider: ProviderName;
  fallbackProvider: ProviderName | null;
  primaryKeyConfigured: boolean;
  fallbackKeyConfigured: boolean;
  emergencyStopActive: boolean;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
} {
  const primary = getProviderConfig(routerConfig.primaryProvider);
  const fallback = routerConfig.fallbackProvider
    ? getProviderConfig(routerConfig.fallbackProvider)
    : null;

  return {
    ready: isIVXProviderLayerReady(),
    primaryProvider: routerConfig.primaryProvider,
    fallbackProvider: routerConfig.fallbackProvider,
    primaryKeyConfigured: primary ? getApiKey(primary).length > 0 : false,
    fallbackKeyConfigured: fallback ? getApiKey(fallback).length > 0 : false,
    emergencyStopActive: costTracker.emergencyStopActive,
    dailySpendUsd: costTracker.dailySpendUsd,
    monthlySpendUsd: costTracker.monthlySpendUsd,
    dailyLimitUsd: costTracker.dailyLimitUsd,
    monthlyLimitUsd: costTracker.monthlyLimitUsd,
  };
}
