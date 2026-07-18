/**
 * Provider + cost selection for the IVX multimodal stack.
 *
 * Grounded in the live Vercel AI Gateway model catalog (verified via
 * listAvailableModels / getModelUsage on 2026-06-06). Pure + deterministic so
 * the selection logic and cost estimates are unit-testable without the network.
 *
 * Pricing is the published gateway list price at selection time and is recorded
 * with the snapshot date so a future price drift is visible rather than silent.
 */

export type MultimodalCapability =
  | 'image_understanding'
  | 'video_understanding'
  | 'image_generation'
  | 'model3d_generation';

export type MediaProviderSelection = {
  capability: MultimodalCapability;
  /** Gateway model id (or Meshy endpoint family for 3D). */
  modelId: string;
  providerName: string;
  /** Which provider endpoint the call uses (owner-controlled only). */
  endpoint: string;
  /** Owner-held auth source the backend uses for this endpoint. Never a Rork toolkit secret. */
  authSource: 'AI_GATEWAY_API_KEY' | 'OPENAI_API_KEY' | 'MESHY_API_KEY' | 'TRIPO_API_KEY' | 'PROCEDURAL';
  /** Plain-English unit the cost is measured in. */
  costUnit: string;
  /** Estimated USD cost for one typical unit of work. */
  estimatedUnitCostUsd: number;
  /** Catalog snapshot date the price was read. */
  pricedAt: string;
  /** Why this model was chosen over the alternatives. */
  rationale: string;
  /** One or two alternative ids considered. */
  alternatives: string[];
};

const PRICED_AT = '2026-06-06';

/**
 * Canonical selections per capability.
 *
 * - image_understanding: reuse the proven runtime vision model (gpt-4o-mini)
 *   already wired in `ivx-ai-runtime.ts` + `owner-multimodal.ts`. Cheapest
 *   vision-capable path; no new dependency.
 * - video_understanding: a video-capable vision LLM (Gemini 3 Flash accepts
 *   long video + is on the proven gateway path). Frames are sent as the
 *   model's file/image input.
 * - image_generation: gpt-image-2 (image-only endpoint) for prompt-only work;
 *   Gemini 3.1 Flash Image (Nano Banana 2) for edits/reference via chat.
 * - model3d_generation: owner-controlled Meshy direct API (MESHY_API_KEY) or
 *   Tripo direct API (TRIPO_API_KEY); falls back to a deterministic procedural
 *   Three.js preview when no owner 3D provider key is present. No Rork toolkit.
 */
type StaticCapability = Exclude<MultimodalCapability, 'model3d_generation'>;

const SELECTIONS: Record<StaticCapability, MediaProviderSelection> = {
  image_understanding: {
    capability: 'image_understanding',
    modelId: 'gpt-4o-mini',
    providerName: 'openai',
    endpoint: '/chat/completions (multimodal)',
    authSource: 'AI_GATEWAY_API_KEY',
    costUnit: 'per image analysis (~1 image + 1k prompt tokens)',
    // gpt-4o-mini: $0.15/M input, $0.60/M output. ~1.5k in + 0.5k out ≈ $0.0005.
    estimatedUnitCostUsd: 0.0005,
    pricedAt: PRICED_AT,
    rationale:
      'Already the live runtime vision model (ivx-ai-runtime + owner-multimodal); cheapest vision-capable option, zero new dependency.',
    alternatives: ['gemini-3-flash', 'qwen3-vl-instruct'],
  },
  video_understanding: {
    capability: 'video_understanding',
    modelId: 'gemini-3-flash',
    providerName: 'google',
    endpoint: '/chat/completions (video/frame input)',
    authSource: 'AI_GATEWAY_API_KEY',
    costUnit: 'per ~8 extracted frames + timeline prompt',
    // gemini-3-flash: $0.50/M in, $3/M out. ~8 frames (~6k img tokens) + 2k text
    // in, 1k out ≈ $0.007.
    estimatedUnitCostUsd: 0.007,
    pricedAt: PRICED_AT,
    rationale:
      'Long-video-capable vision LLM on the proven AI_GATEWAY path; analyzes extracted frames + a timeline without a separate video service.',
    alternatives: ['qwen3-vl-235b-a22b-instruct', 'gpt-4o-mini'],
  },
  image_generation: {
    capability: 'image_generation',
    modelId: 'openai/gpt-image-2',
    providerName: 'openai',
    endpoint: '/images/generations',
    authSource: 'OPENAI_API_KEY',
    costUnit: 'per generated image (1024px)',
    // gpt-image-2 standard 1024 image ≈ $0.04.
    estimatedUnitCostUsd: 0.04,
    pricedAt: PRICED_AT,
    rationale:
      'Default prompt-only generator per the AI skill; flexible sizes, high-fidelity, on the proven gateway path. Gemini Flash Image used for edits/reference.',
    alternatives: ['gemini-3.1-flash-image', 'imagen-4.0-generate-001'],
  },
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** True when the owner Meshy direct-API key is configured. */
export function hasMeshyKey(): boolean {
  return readTrimmed(process.env.MESHY_API_KEY).length > 0;
}

/** True when the owner Tripo direct-API key is configured. */
export function hasTripoKey(): boolean {
  return readTrimmed(process.env.TRIPO_API_KEY).length > 0;
}

/**
 * Resolve the 3D provider from owner-held env only. Prefers Meshy direct, then
 * Tripo direct, else a deterministic procedural Three.js preview. Never routes
 * through the Rork toolkit proxy.
 */
export function selectModel3DProvider(): MediaProviderSelection {
  if (hasMeshyKey()) {
    return {
      capability: 'model3d_generation',
      modelId: 'meshy/text-to-3d',
      providerName: 'meshy',
      endpoint: 'https://api.meshy.ai/openapi/v2/text-to-3d',
      authSource: 'MESHY_API_KEY',
      costUnit: 'per preview model (credits)',
      estimatedUnitCostUsd: 0,
      pricedAt: PRICED_AT,
      rationale: 'Owner-controlled Meshy direct API (MESHY_API_KEY). Credit-metered; no flat USD list price. No Rork toolkit.',
      alternatives: ['meshy/image-to-3d', 'meshy/multi-image-to-3d'],
    };
  }
  if (hasTripoKey()) {
    return {
      capability: 'model3d_generation',
      modelId: 'tripo/text-to-3d',
      providerName: 'tripo',
      endpoint: 'https://api.tripo3d.ai/v2/openapi/task',
      authSource: 'TRIPO_API_KEY',
      costUnit: 'per task (credits)',
      estimatedUnitCostUsd: 0,
      pricedAt: PRICED_AT,
      rationale: 'Owner-controlled Tripo direct API (TRIPO_API_KEY). Credit-metered; no flat USD list price. No Rork toolkit.',
      alternatives: ['tripo/image-to-3d'],
    };
  }
  return {
    capability: 'model3d_generation',
    modelId: 'procedural/three-js-preview',
    providerName: 'procedural',
    endpoint: 'in-process (deterministic Three.js scene spec)',
    authSource: 'PROCEDURAL',
    costUnit: 'per preview (free, in-process)',
    estimatedUnitCostUsd: 0,
    pricedAt: PRICED_AT,
    rationale: 'No owner 3D provider key (MESHY_API_KEY / TRIPO_API_KEY) set; falls back to a deterministic procedural Three.js preview. No Rork toolkit.',
    alternatives: ['meshy/text-to-3d (set MESHY_API_KEY)', 'tripo/text-to-3d (set TRIPO_API_KEY)'],
  };
}

/** Resolve the canonical provider + cost selection for a capability. */
export function selectMediaProvider(capability: MultimodalCapability): MediaProviderSelection {
  if (capability === 'model3d_generation') {
    return selectModel3DProvider();
  }
  return SELECTIONS[capability];
}

/** All selections (for the status surface). */
export function listMediaProviderSelections(): MediaProviderSelection[] {
  return [...Object.values(SELECTIONS), selectModel3DProvider()];
}

/**
 * Estimate the USD cost for a batch of work. 3D returns null (credit-metered,
 * no flat USD list price) so callers never present a fabricated dollar figure.
 */
export function estimateMediaCostUsd(capability: MultimodalCapability, units: number): number | null {
  const safeUnits = Number.isFinite(units) && units > 0 ? Math.floor(units) : 0;
  if (capability === 'model3d_generation') {
    return null;
  }
  const selection = SELECTIONS[capability];
  return Math.round(selection.estimatedUnitCostUsd * safeUnits * 1e6) / 1e6;
}
