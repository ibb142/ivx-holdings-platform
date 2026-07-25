/**
 * IVX Chat Performance Instrumentation
 *
 * Measures every phase of the chat loading path with real wall-clock milliseconds.
 * Emits a structured performance trace that can be logged, displayed in a debug
 * overlay, or sent to the backend for production monitoring.
 *
 * Measured phases (in startup order):
 *   1. cold_start         — from app open to chat route mount
 *   2. route_mount        — chat component mount
 *   3. session_restore    — auth session restore from AsyncStorage/Supabase
 *   4. owner_lookup       — owner role verification
 *   5. conversation_lookup — Supabase conversation row resolve
 *   6. first_message_paint — first message bubble visible to user
 *   7. composer_ready     — composer input is tappable
 *   8. realtime_connected — Supabase realtime channel subscribed
 *   9. full_interaction_ready — all startup complete, chat fully usable
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type IVXChatPhase =
  | 'cold_start'
  | 'route_mount'
  | 'session_restore'
  | 'owner_lookup'
  | 'conversation_lookup'
  | 'message_load'
  | 'first_message_paint'
  | 'composer_ready'
  | 'realtime_connected'
  | 'ai_probe'
  | 'worker_status'
  | 'full_interaction_ready';

export interface IVXChatPhaseTiming {
  phase: IVXChatPhase;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  metadata?: Record<string, unknown>;
}

export interface IVXChatPerformanceTrace {
  traceId: string;
  sessionId: string;
  startedAt: number;
  completedAt: number | null;
  phases: Map<IVXChatPhase, IVXChatPhaseTiming>;
  totalDurationMs: number | null;
}

// ── Singleton trace per chat session ──────────────────────────────────────────

let currentTrace: IVXChatPerformanceTrace | null = null;

/**
 * Start a new performance trace for the current chat session.
 * Called when the chat route mounts.
 */
export function startChatPerformanceTrace(): IVXChatPerformanceTrace {
  const traceId = `chat_trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = `session_${Date.now()}`;

  currentTrace = {
    traceId,
    sessionId,
    startedAt: Date.now(),
    completedAt: null,
    phases: new Map(),
    totalDurationMs: null,
  };

  // Mark cold_start as started immediately
  markPhaseStart('cold_start');
  markPhaseStart('route_mount');

  return currentTrace;
}

/**
 * Mark the start of a phase. If the phase was already started, this is a no-op.
 */
export function markPhaseStart(phase: IVXChatPhase, metadata?: Record<string, unknown>): void {
  if (!currentTrace) {
    startChatPerformanceTrace();
  }
  if (!currentTrace) return;

  if (!currentTrace.phases.has(phase)) {
    currentTrace.phases.set(phase, {
      phase,
      startedAt: Date.now(),
      endedAt: null,
      durationMs: null,
      metadata,
    });
  }
}

/**
 * Mark the end of a phase and record its duration.
 */
export function markPhaseEnd(phase: IVXChatPhase, metadata?: Record<string, unknown>): void {
  if (!currentTrace) return;

  const existing = currentTrace.phases.get(phase);
  if (!existing || existing.endedAt !== null) return;

  const endedAt = Date.now();
  existing.endedAt = endedAt;
  existing.durationMs = endedAt - existing.startedAt;
  if (metadata) {
    existing.metadata = { ...existing.metadata, ...metadata };
  }

  // Auto-complete the trace when the final phase ends
  if (phase === 'full_interaction_ready') {
    currentTrace.completedAt = endedAt;
    currentTrace.totalDurationMs = endedAt - currentTrace.startedAt;
  }
}

/**
 * Get the current performance trace (or null if not started).
 */
export function getCurrentTrace(): IVXChatPerformanceTrace | null {
  return currentTrace;
}

/**
 * Get the duration of a specific phase, or null if not completed.
 */
export function getPhaseDurationMs(phase: IVXChatPhase): number | null {
  if (!currentTrace) return null;
  return currentTrace.phases.get(phase)?.durationMs ?? null;
}

/**
 * Reset the current trace (used on unmount or logout).
 */
export function resetChatPerformanceTrace(): void {
  currentTrace = null;
}

// ── Trace serialization (for logging / debug overlay / backend reporting) ─────

/**
 * Convert the trace to a plain object for JSON serialization.
 */
export function serializeTrace(trace: IVXChatPerformanceTrace | null): Record<string, unknown> | null {
  if (!trace) return null;

  const phases: Record<string, { durationMs: number | null; metadata?: Record<string, unknown> }> = {};
  for (const [key, value] of trace.phases.entries()) {
    phases[key] = {
      durationMs: value.durationMs,
      metadata: value.metadata,
    };
  }

  return {
    traceId: trace.traceId,
    sessionId: trace.sessionId,
    startedAt: new Date(trace.startedAt).toISOString(),
    completedAt: trace.completedAt ? new Date(trace.completedAt).toISOString() : null,
    totalDurationMs: trace.totalDurationMs,
    phases,
  };
}

/**
 * Get a human-readable summary of all phase timings.
 */
export function getTraceSummary(trace: IVXChatPerformanceTrace | null): string {
  if (!trace) return 'No performance trace active';

  const lines: string[] = [`Chat Performance Trace ${trace.traceId}`];
  lines.push(`  Total: ${trace.totalDurationMs ?? 'in progress'}ms`);

  const phaseOrder: IVXChatPhase[] = [
    'cold_start',
    'route_mount',
    'session_restore',
    'owner_lookup',
    'conversation_lookup',
    'message_load',
    'first_message_paint',
    'composer_ready',
    'realtime_connected',
    'ai_probe',
    'worker_status',
    'full_interaction_ready',
  ];

  for (const phase of phaseOrder) {
    const timing = trace.phases.get(phase);
    if (timing) {
      const dur = timing.durationMs !== null ? `${timing.durationMs}ms` : 'pending';
      lines.push(`  ${phase}: ${dur}`);
    }
  }

  return lines.join('\n');
}

// ── Performance targets (mirrors ivxChatPerformanceOptimizer) ──────────────────

export const INSTRUMENTATION_TARGETS = {
  shellVisibleMs: 200,
  firstContentMs: 2000,
  composerReadyMs: 2000,
  noIndefiniteLoading: true,
} as const;

/**
 * Check the trace against performance targets and return violations.
 */
export function checkTraceTargets(
  trace: IVXChatPerformanceTrace | null,
): { passed: boolean; violations: string[]; summary: Record<string, number | null> } {
  const violations: string[] = [];
  const summary: Record<string, number | null> = {};

  if (!trace) {
    return { passed: false, violations: ['No performance trace active'], summary };
  }

  const firstPaint = getPhaseDurationMs('first_message_paint');
  const composerReady = getPhaseDurationMs('composer_ready');
  const coldStart = getPhaseDurationMs('cold_start');
  const fullReady = getPhaseDurationMs('full_interaction_ready');

  summary.firstPaintMs = firstPaint;
  summary.composerReadyMs = composerReady;
  summary.coldStartMs = coldStart;
  summary.fullReadyMs = fullReady;

  if (firstPaint !== null && firstPaint > INSTRUMENTATION_TARGETS.firstContentMs) {
    violations.push(
      `First message paint took ${firstPaint}ms (target: ≤${INSTRUMENTATION_TARGETS.firstContentMs}ms)`,
    );
  }

  if (composerReady !== null && composerReady > INSTRUMENTATION_TARGETS.composerReadyMs) {
    violations.push(
      `Composer ready took ${composerReady}ms (target: ≤${INSTRUMENTATION_TARGETS.composerReadyMs}ms)`,
    );
  }

  if (fullReady === null) {
    violations.push('Full interaction readiness was never marked (indefinite loading)');
  }

  return {
    passed: violations.length === 0,
    violations,
    summary,
  };
}
