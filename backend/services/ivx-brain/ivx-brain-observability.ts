/**
 * IVX IA Brain — Observability Recorder (§17).
 *
 * Records metadata for every IVX IA response:
 *   conversation ID, request ID, user intent, route selected, model,
 *   tools used, sources used, latency, token usage, cost, confidence,
 *   fallback, errors, safety decision, feedback, final status.
 *
 * Designed to feed dashboards for:
 *   accuracy, hallucination rate, tool success rate, retrieval quality,
 *   user satisfaction, latency, cost, provider failure, memory failure,
 *   domain score, escalation rate.
 *
 * The recorder is a pure data structure builder — the caller persists
 * the record to Supabase or the durable store.
 */

export const IVX_BRAIN_OBSERVABILITY_MARKER =
  'ivx-brain-observability-2026-08-07-v1';

export type IVXBrainEvent = {
  /** Unique request ID (trace ID). */
  requestId: string;
  /** Conversation/session ID. */
  conversationId: string;
  /** Timestamp (ISO string). */
  timestamp: string;
  /** Classified user intent (from domain router). */
  userIntent: string;
  /** Primary domain (from domain router). */
  domain: string;
  /** All domains matched. */
  domains: string[];
  /** Routes selected (A–E). */
  routes: string[];
  /** AI model used (e.g. "gpt-4o"). */
  model: string | null;
  /** Tools used (e.g. ["github_search", "render_deploy"]). */
  toolsUsed: string[];
  /** Sources used (e.g. ["github_code", "supabase_records"]). */
  sourcesUsed: string[];
  /** Total response latency in milliseconds. */
  latencyMs: number;
  /** Time to first token in milliseconds (for streaming). */
  timeToFirstTokenMs: number | null;
  /** Token usage (input + output). */
  tokenUsage: { input: number; output: number; total: number } | null;
  /** Estimated cost in USD. */
  costUsd: number | null;
  /** Confidence level (HIGH/MEDIUM/LOW). */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Whether a fallback provider was used. */
  fallbackUsed: boolean;
  /** Errors encountered (empty if none). */
  errors: string[];
  /** Safety decision (e.g. "allowed", "blocked_fake_execution"). */
  safetyDecision: string;
  /** User feedback (if any). */
  feedback: 'correct' | 'incorrect' | 'incomplete' | 'outdated' | 'too_generic' | 'unsafe' | 'not_useful' | null;
  /** Final status of the response. */
  finalStatus: 'READY' | 'RUNNING' | 'WAITING_OWNER' | 'BLOCKED' | 'FAILED' | 'VERIFIED';
  /** Gate pipeline stages (audit trail). */
  gateStages: Array<{ gate: string; gated: boolean; state: string; markers: string[] }>;
  /** Hallucination flags count. */
  hallucinationFlags: number;
  /** Whether live retrieval was used. */
  usedLiveRetrieval: boolean;
  /** Whether the response was gated by any gate. */
  wasGated: boolean;
};

// ─── Cost Estimation ─────────────────────────────────────────────

const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },
  'text-embedding-3-small': { inputPer1M: 0.02, outputPer1M: 0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return Math.round((inputCost + outputCost) * 10000) / 10000; // 4 decimal places
}

// ─── Event Builder ───────────────────────────────────────────────

export type IVXBrainEventBuilder = {
  requestId: string;
  conversationId: string;
  startTime: number;
  intent: string;
  domain: string;
  domains: string[];
  routes: string[];
  model: string | null;
  toolsUsed: string[];
  sourcesUsed: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  fallbackUsed: boolean;
  errors: string[];
  safetyDecision: string;
  finalStatus: IVXBrainEvent['finalStatus'];
  gateStages: IVXBrainEvent['gateStages'];
  hallucinationFlags: number;
  usedLiveRetrieval: boolean;
  wasGated: boolean;
  tokenUsage: { input: number; output: number; total: number } | null;
  timeToFirstTokenMs: number | null;
  feedback: IVXBrainEvent['feedback'];
};

/**
 * Build an observability event from a builder. The caller should call
 * this after the response is complete.
 */
export function buildBrainEvent(builder: IVXBrainEventBuilder): IVXBrainEvent {
  const latencyMs = Date.now() - builder.startTime;
  const costUsd = builder.model && builder.tokenUsage
    ? estimateCost(builder.model, builder.tokenUsage.input, builder.tokenUsage.output)
    : null;

  return {
    requestId: builder.requestId,
    conversationId: builder.conversationId,
    timestamp: new Date().toISOString(),
    userIntent: builder.intent,
    domain: builder.domain,
    domains: builder.domains,
    routes: builder.routes,
    model: builder.model,
    toolsUsed: builder.toolsUsed,
    sourcesUsed: builder.sourcesUsed,
    latencyMs,
    timeToFirstTokenMs: builder.timeToFirstTokenMs,
    tokenUsage: builder.tokenUsage,
    costUsd,
    confidence: builder.confidence,
    fallbackUsed: builder.fallbackUsed,
    errors: builder.errors,
    safetyDecision: builder.safetyDecision,
    feedback: builder.feedback,
    finalStatus: builder.finalStatus,
    gateStages: builder.gateStages,
    hallucinationFlags: builder.hallucinationFlags,
    usedLiveRetrieval: builder.usedLiveRetrieval,
    wasGated: builder.wasGated,
  };
}

// ─── Dashboard Aggregation ───────────────────────────────────────

export type IVXBrainDashboard = {
  totalRequests: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalCostUsd: number;
  averageCostUsd: number;
  totalTokens: number;
  hallucinationRate: number;
  gatedRate: number;
  fallbackRate: number;
  errorRate: number;
  liveRetrievalRate: number;
  confidenceDistribution: { HIGH: number; MEDIUM: number; LOW: number };
  domainDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
  feedbackDistribution: Record<string, number>;
};

/**
 * Aggregate a list of brain events into a dashboard summary.
 */
export function aggregateBrainDashboard(events: IVXBrainEvent[]): IVXBrainDashboard {
  if (events.length === 0) {
    return {
      totalRequests: 0,
      averageLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      totalCostUsd: 0,
      averageCostUsd: 0,
      totalTokens: 0,
      hallucinationRate: 0,
      gatedRate: 0,
      fallbackRate: 0,
      errorRate: 0,
      liveRetrievalRate: 0,
      confidenceDistribution: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      domainDistribution: {},
      statusDistribution: {},
      feedbackDistribution: {},
    };
  }

  const latencies = events.map((e) => e.latencyMs).sort((a, b) => a - b);
  const totalCost = events.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  const totalTokens = events.reduce((sum, e) => sum + (e.tokenUsage?.total ?? 0), 0);
  const hallucinationCount = events.filter((e) => e.hallucinationFlags > 0).length;
  const gatedCount = events.filter((e) => e.wasGated).length;
  const fallbackCount = events.filter((e) => e.fallbackUsed).length;
  const errorCount = events.filter((e) => e.errors.length > 0).length;
  const liveRetrievalCount = events.filter((e) => e.usedLiveRetrieval).length;

  const confidenceDistribution = {
    HIGH: events.filter((e) => e.confidence === 'HIGH').length,
    MEDIUM: events.filter((e) => e.confidence === 'MEDIUM').length,
    LOW: events.filter((e) => e.confidence === 'LOW').length,
  };

  const domainDistribution: Record<string, number> = {};
  for (const e of events) {
    domainDistribution[e.domain] = (domainDistribution[e.domain] ?? 0) + 1;
  }

  const statusDistribution: Record<string, number> = {};
  for (const e of events) {
    statusDistribution[e.finalStatus] = (statusDistribution[e.finalStatus] ?? 0) + 1;
  }

  const feedbackDistribution: Record<string, number> = {};
  for (const e of events) {
    if (e.feedback) {
      feedbackDistribution[e.feedback] = (feedbackDistribution[e.feedback] ?? 0) + 1;
    }
  }

  const percentile = (sorted: number[], p: number): number => {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  };

  return {
    totalRequests: events.length,
    averageLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    totalCostUsd: Math.round(totalCost * 10000) / 10000,
    averageCostUsd: Math.round((totalCost / events.length) * 10000) / 10000,
    totalTokens,
    hallucinationRate: hallucinationCount / events.length,
    gatedRate: gatedCount / events.length,
    fallbackRate: fallbackCount / events.length,
    errorRate: errorCount / events.length,
    liveRetrievalRate: liveRetrievalCount / events.length,
    confidenceDistribution,
    domainDistribution,
    statusDistribution,
    feedbackDistribution,
  };
}
