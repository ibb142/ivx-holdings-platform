/**
 * IVX Model Gateway — Phase 1
 *
 * Provider-independent model gateway with intelligent routing.
 * Selects the right model for each task type: fast, reasoning, vision, embedding.
 * Falls back gracefully, tracks cost, and enforces per-task model policy.
 *
 * This EXTENDS the existing ivx-ai-runtime.ts — it does not replace it.
 * The runtime handles the actual API calls; this module decides WHICH model to use.
 */

import { getProviderHealth, type IVXProviderHealth } from '../ivx-ai-runtime';

// ─── Types ────────────────────────────────────────────────────────

export type IVXModelTier = 'fast' | 'reasoning' | 'vision' | 'embedding' | 'high_quality';

export type IVXTaskType =
  | 'simple_question'
  | 'architecture'
  | 'debugging'
  | 'screenshot_analysis'
  | 'file_analysis'
  | 'retrieval'
  | 'code_verification'
  | 'final_summary'
  | 'business_analysis'
  | 'content_generation'
  | 'code_generation'
  | 'test_generation'
  | 'security_audit'
  | 'performance_analysis';

export type IVXModelConfig = {
  tier: IVXModelTier;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  estimatedCostPer1kTokens: number;
};

export type IVXModelRoutingDecision = {
  taskType: IVXTaskType;
  tier: IVXModelTier;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  fallbackModel: string | null;
  reason: string;
  estimatedCost: number;
};

export type IVXProviderHealthInfo = {
  healthy: boolean;
  provider: string;
  lastChecked: string;
};

// ─── Model Registry ────────────────────────────────────────────────

const MODEL_REGISTRY: Record<IVXModelTier, IVXModelConfig> = {
  fast: {
    tier: 'fast',
    model: 'gpt-4o-mini',
    maxOutputTokens: 1000,
    timeoutMs: 15_000,
    estimatedCostPer1kTokens: 0.00015,
  },
  reasoning: {
    tier: 'reasoning',
    model: 'gpt-4o',
    maxOutputTokens: 4000,
    timeoutMs: 60_000,
    estimatedCostPer1kTokens: 0.005,
  },
  vision: {
    tier: 'vision',
    model: 'gpt-4o',
    maxOutputTokens: 2000,
    timeoutMs: 30_000,
    estimatedCostPer1kTokens: 0.005,
  },
  embedding: {
    tier: 'embedding',
    model: 'text-embedding-3-small',
    maxOutputTokens: 0,
    timeoutMs: 10_000,
    estimatedCostPer1kTokens: 0.00002,
  },
  high_quality: {
    tier: 'high_quality',
    model: 'gpt-4o',
    maxOutputTokens: 4000,
    timeoutMs: 60_000,
    estimatedCostPer1kTokens: 0.005,
  },
};

// ─── Routing Policy ────────────────────────────────────────────────

const TASK_TO_TIER: Record<IVXTaskType, IVXModelTier> = {
  simple_question: 'fast',
  architecture: 'reasoning',
  debugging: 'reasoning',
  screenshot_analysis: 'vision',
  file_analysis: 'vision',
  retrieval: 'embedding',
  code_verification: 'reasoning',
  final_summary: 'high_quality',
  business_analysis: 'reasoning',
  content_generation: 'high_quality',
  code_generation: 'reasoning',
  test_generation: 'reasoning',
  security_audit: 'reasoning',
  performance_analysis: 'reasoning',
};

const FALLBACK_CHAIN: Record<IVXModelTier, string | null> = {
  fast: null,
  reasoning: 'gpt-4o-mini',
  vision: null,
  embedding: null,
  high_quality: 'gpt-4o-mini',
};

// ─── Cost Tracking ─────────────────────────────────────────────────

type CostRecord = {
  taskType: IVXTaskType;
  tier: IVXModelTier;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  timestamp: string;
};

const costRecords: CostRecord[] = [];
const MAX_COST_RECORDS = 500;
let totalEstimatedCost = 0;
let dailyCostLimit = 50.0;

export function setDailyCostLimit(limit: number): void {
  dailyCostLimit = limit;
}

export function getDailyCostLimit(): number {
  return dailyCostLimit;
}

export function recordModelCost(input: {
  taskType: IVXTaskType;
  tier: IVXModelTier;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): void {
  const config = MODEL_REGISTRY[input.tier];
  const estimatedCost =
    ((input.inputTokens + input.outputTokens) / 1000) * config.estimatedCostPer1kTokens;
  const record: CostRecord = {
    taskType: input.taskType,
    tier: input.tier,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedCost,
    timestamp: new Date().toISOString(),
  };
  costRecords.push(record);
  totalEstimatedCost += estimatedCost;
  if (costRecords.length > MAX_COST_RECORDS) {
    costRecords.shift();
  }
}

export function getCostReport(): {
  totalEstimatedCost: number;
  dailyCostLimit: number;
  remainingBudget: number;
  records: CostRecord[];
  costByTier: Record<string, number>;
} {
  const costByTier: Record<string, number> = {};
  for (const r of costRecords) {
    costByTier[r.tier] = (costByTier[r.tier] || 0) + r.estimatedCost;
  }
  return {
    totalEstimatedCost,
    dailyCostLimit,
    remainingBudget: Math.max(0, dailyCostLimit - totalEstimatedCost),
    records: [...costRecords],
    costByTier,
  };
}

export function isCostLimitExceeded(): boolean {
  return totalEstimatedCost >= dailyCostLimit;
}

// ─── Provider Health ───────────────────────────────────────────────

export function getModelGatewayHealth(): {
  configured: boolean;
  providerType: string;
  modelsAvailable: IVXModelTier[];
  healthy: boolean;
  costLimitExceeded: boolean;
} {
  const health = getProviderHealth() as IVXProviderHealth | null;
  return {
    configured: Boolean(health),
    providerType: health?.provider || 'unknown',
    modelsAvailable: Object.keys(MODEL_REGISTRY) as IVXModelTier[],
    healthy: Boolean(health),
    costLimitExceeded: isCostLimitExceeded(),
  };
}

// ─── Core Routing Function ─────────────────────────────────────────

/**
 * Select the right model for a given task type.
 * Returns a routing decision with model, fallback, timeout, and cost estimate.
 */
export function routeModel(input: {
  taskType: IVXTaskType;
  promptChars?: number;
  hasImages?: boolean;
  hasFiles?: boolean;
  requiresStreaming?: boolean;
}): IVXModelRoutingDecision {
  let tier = TASK_TO_TIER[input.taskType];

  // Override: if images present and tier isn't vision, upgrade to vision
  if (input.hasImages && tier !== 'vision') {
    tier = 'vision';
  }

  // Override: if files present, use vision tier
  if (input.hasFiles && tier !== 'vision') {
    tier = 'vision';
  }

  // Cost guard: if cost limit exceeded, downgrade to fast (except for critical tasks)
  if (isCostLimitExceeded() && tier !== 'fast') {
    const criticalTasks: IVXTaskType[] = ['architecture', 'debugging', 'security_audit'];
    if (!criticalTasks.includes(input.taskType)) {
      tier = 'fast';
    }
  }

  const config = MODEL_REGISTRY[tier];
  const fallback = FALLBACK_CHAIN[tier];

  // Adjust timeout for large prompts
  const promptChars = input.promptChars || 0;
  const adjustedTimeout = Math.min(
    config.timeoutMs * 2,
    config.timeoutMs + Math.floor(promptChars / 100) * 100,
  );

  const estimatedCost =
    ((promptChars / 4 + config.maxOutputTokens) / 1000) * config.estimatedCostPer1kTokens;

  return {
    taskType: input.taskType,
    tier,
    model: config.model,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: adjustedTimeout,
    fallbackModel: fallback,
    reason: `Task ${input.taskType} → tier ${tier} → model ${config.model}`,
    estimatedCost,
  };
}

/**
 * Get the fallback model if the primary model fails.
 */
export function getFallbackModel(primaryModel: string): string | null {
  for (const config of Object.values(MODEL_REGISTRY)) {
    if (config.model === primaryModel) {
      return FALLBACK_CHAIN[config.tier];
    }
  }
  return null;
}

// ─── Task Type Detection ───────────────────────────────────────────

export function detectTaskType(message: string): IVXTaskType {
  const text = message.toLowerCase().trim();

  // Architecture/design
  if (/\b(architect|design|system design|refactor|restructure|migration|scale|microservice)\b/.test(text)) {
    return 'architecture';
  }

  // Debugging
  if (/\b(debug|error|crash|stack trace|exception|traceback|fix bug|broken|not working|failing|503|500|timeout)\b/.test(text)) {
    return 'debugging';
  }

  // Screenshot/file analysis
  if (/\b(screenshot|image|photo|picture|diagram|upload|attachment)\b/.test(text)) {
    return 'screenshot_analysis';
  }

  // Security audit
  if (/\b(security|vulnerab|cve|injection|xss|csrf|audit|penetration|exploit)\b/.test(text)) {
    return 'security_audit';
  }

  // Performance analysis
  if (/\b(performance|slow|latency|optimi[sz]e|bottleneck|profile|memory leak|cpu)\b/.test(text)) {
    return 'performance_analysis';
  }

  // Code generation
  if (/\b(generate code|write code|implement|create function|build feature|add endpoint)\b/.test(text)) {
    return 'code_generation';
  }

  // Test generation
  if (/\b(generate test|write test|test suite|unit test|integration test|coverage)\b/.test(text)) {
    return 'test_generation';
  }

  // Business analysis
  if (/\b(roi|irr|investor|deal|property|valuation|cap rate|cash flow|equity|return)\b/.test(text)) {
    return 'business_analysis';
  }

  // Content generation
  if (/\b(write|generate|create|draft|compose)\b/.test(text) && text.length > 20) {
    return 'content_generation';
  }

  // Code verification
  if (/\b(verify|check|validate|test|review code|code review)\b/.test(text)) {
    return 'code_verification';
  }

  // Final summary
  if (/\b(summary|summarize|tldr|overview|report|conclude)\b/.test(text)) {
    return 'final_summary';
  }

  // Default: simple question
  return 'simple_question';
}

// ─── Export ────────────────────────────────────────────────────────

export const IVX_MODEL_GATEWAY_MARKER = 'ivx-model-gateway-2026-07-23-v1';

export function getModelGatewayStatus(): {
  marker: string;
  models: Record<IVXModelTier, IVXModelConfig>;
  routingPolicy: Record<IVXTaskType, IVXModelTier>;
  fallbackPolicy: Record<IVXModelTier, string | null>;
  costPolicy: { totalEstimatedCost: number; dailyCostLimit: number; remainingBudget: number };
  health: ReturnType<typeof getModelGatewayHealth>;
} {
  return {
    marker: IVX_MODEL_GATEWAY_MARKER,
    models: MODEL_REGISTRY,
    routingPolicy: TASK_TO_TIER,
    fallbackPolicy: FALLBACK_CHAIN,
    costPolicy: getCostReport(),
    health: getModelGatewayHealth(),
  };
}
