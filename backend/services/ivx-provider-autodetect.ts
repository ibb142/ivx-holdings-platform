/**
 * Shared provider auto-detection utility.
 *
 * The key prefix determines the correct AI provider endpoint:
 *   vck_  → Vercel AI Gateway (https://ai-gateway.vercel.sh/v1)
 *   sk-   → OpenAI direct API (https://api.openai.com/v1)
 *
 * This module is imported by all secondary AI service files (multimodal,
 * transcription, embeddings, image generation, global intelligence) so they
 * all route to the correct endpoint based on whichever key is loaded on the
 * host — without each file duplicating the detection logic.
 */

export const VERCEL_AI_GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';
export const OPENAI_DIRECT_BASE = 'https://api.openai.com/v1';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

import { isBlockedDomain } from './ivx-domain-blocklist';

/** Returns the API key from OPENAI_API_KEY or IVX_AI_GATEWAY_KEY (fallback). */
export function getIVXApiKey(): string {
  return readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.IVX_AI_GATEWAY_KEY);
}

/** Detect the provider type from the key prefix. */
export function detectIVXProviderType(): 'vercel_gateway' | 'openai_direct' | 'unknown' {
  const key = getIVXApiKey();
  if (!key) return 'unknown';
  if (key.startsWith('vck_')) return 'vercel_gateway';
  if (key.startsWith('sk-')) return 'openai_direct';
  return 'unknown';
}

/**
 * Returns the correct base URL for the loaded API key.
 * If IVX_AI_GATEWAY_URL (or IVX_AI_BASE_URL) is explicitly set and not a blocked
 * external domain, it takes priority. Otherwise, the key prefix determines the endpoint.
 */
export function autoDetectGatewayBaseUrl(): string {
  const configured = readTrimmed(process.env.IVX_AI_GATEWAY_URL) || readTrimmed(process.env.IVX_AI_BASE_URL);
  if (configured && !isBlockedDomain(configured)) {
    return configured.replace(/\/+$/, '');
  }
  const key = getIVXApiKey();
  if (key && key.startsWith('vck_')) {
    return VERCEL_AI_GATEWAY_BASE;
  }
  return OPENAI_DIRECT_BASE;
}

/**
 * Normalize a model name for the active provider.
 * Vercel AI Gateway requires the `openai/` prefix (e.g. `openai/gpt-4o`).
 * OpenAI direct API uses bare model names (e.g. `gpt-4o`).
 */
export function normalizeModelForGateway(model: string): string {
  const bare = model.replace(/^openai\//, '');
  const providerType = detectIVXProviderType();
  if (providerType === 'vercel_gateway') {
    return `openai/${bare}`;
  }
  return bare;
}
