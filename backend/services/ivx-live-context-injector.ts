/**
 * IVX Live Context Injector — Production Awareness for IVX IA Chat
 *
 * Owner mandate 2026-07-30: IVX IA must always know the current production
 * state, autonomous jobs, deployment SHA, health, and pending approvals.
 *
 * V2 fix: Uses in-process production state (ivx-production-state.ts) instead
 * of HTTP fetches to localhost. The HTTP approach failed on Render because
 * the server can't call its own endpoints reliably during request processing.
 *
 * Phases covered:
 *   Phase 4 — Context Memory: current project, deployment, production state
 *   Phase 5 — Autonomous Integration: what workers are doing
 *   Phase 6 — Production Awareness: SHA, health, jobs, deployments
 */

import { getProductionState, type ProductionState } from './ivx-production-state';

export const IVX_LIVE_CONTEXT_MARKER = 'ivx-live-context-injector-v2-2026-07-30';

/**
 * Build the [IVX LIVE PRODUCTION CONTEXT] block from in-process state.
 * This is synchronous — no HTTP calls, no async, no network dependency.
 */
export function buildLiveContextBlock(): string {
  const state = getProductionState();
  const timestamp = new Date().toISOString();

  if (!state) {
    return [
      '[IVX LIVE PRODUCTION CONTEXT]',
      `  Note: Production state not yet initialized.`,
      `  Timestamp: ${timestamp}`,
      '[/IVX LIVE PRODUCTION CONTEXT]',
    ].join('\n');
  }

  const lines: string[] = [
    '[IVX LIVE PRODUCTION CONTEXT]',
  ];

  // Production health
  lines.push(`  Production Health:`);
  lines.push(`    Status: ${state.status}`);
  lines.push(`    Commit SHA: ${state.commit.slice(0, 12)}`);
  lines.push(`    Full SHA: ${state.commit}`);
  lines.push(`    Boot Time: ${state.bootTime}`);
  lines.push(`    Environment: ${state.environment}`);
  lines.push(`    Service: ${state.serviceName}`);

  // Autonomous QA scheduler
  lines.push(`  Autonomous QA Scheduler:`);
  lines.push(`    Running: ${state.schedulerRunning}`);
  lines.push(`    Process Started: ${state.processStartedAt}`);

  // Health markers (deploy proof)
  if (state.healthMarkers && Object.keys(state.healthMarkers).length > 0) {
    lines.push(`  Deploy Markers (proof of what's live):`);
    for (const [key, value] of Object.entries(state.healthMarkers)) {
      lines.push(`    ${key}: ${value}`);
    }
  }

  lines.push(`  Context fetched at: ${timestamp}`);
  lines.push('[/IVX LIVE PRODUCTION CONTEXT]');

  return lines.join('\n');
}

/**
 * Async wrapper for compatibility with the existing call site in ivx-owner-ai.ts.
 * Returns the same result as buildLiveContextBlock() — kept async so the
 * caller doesn't need to change its await pattern.
 */
export async function getLiveContextBlock(): Promise<string> {
  return buildLiveContextBlock();
}
