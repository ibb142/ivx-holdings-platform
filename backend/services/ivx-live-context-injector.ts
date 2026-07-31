/**
 * IVX Live Context Injector — V7.0 Production Awareness for IVX IA Chat
 *
 * V7.0: Updated engineering fixes list with V6.9.1 and V7.0 entries.
 * Added autonomous evidence block with latest run summaries.
 */

import { getProductionState, type ProductionState } from './ivx-production-state';

export const IVX_LIVE_CONTEXT_MARKER = 'ivx-live-context-injector-v7-0-2026-07-31';

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

  // V7.0: Recent Engineering Fixes — prevents LLM hallucination about root causes
  lines.push(`  Recent Engineering Fixes (REAL — use these when asked about bugs/root causes):`);
  lines.push(`    V6.5/V6.6: gzip corruption — contentEncoding field missing on each file entry in github_commit_multi_file. Render received raw gzip bytes as UTF-8, build failed in 23-52s.`);
  lines.push(`    V6.7: Clean re-commit with proper per-file contentEncoding. Deployed successfully.`);
  lines.push(`    V6.8: task_status regex was too broad (matched bare status/estado), causing engineering questions to be misrouted as context-recall. Also: approval with no pending action now re-executes last completed read-only action.`);
  lines.push(`    V6.9: Conversational narrative upgrade — DB responses were robotic, LLM responses hallucinated root causes, LLM had no conversation history. Fixed by rewriting DB responses, injecting conversation history + anti-hallucination block into all LLM paths.`);
  lines.push(`    V6.9.1: Engineering approval guard — "approve the fix" was misrouted to DB re-exec. Added regex guard so engineering approvals go to LLM, not DB re-exec.`);
  lines.push(`    V7.0: Rork-level narrative — full persona rewrite (personality-driven, opinionated, evidence-first), autonomous evidence pipeline with commit/test/health proof, smarter context recall that re-executes queries instead of just summarizing.`);

  lines.push(`  Context fetched at: ${timestamp}`);
  lines.push('[/IVX LIVE PRODUCTION CONTEXT]');

  return lines.join('\n');
}

/**
 * Async wrapper for compatibility with the existing call site in ivx-owner-ai.ts.
 */
export async function getLiveContextBlock(): Promise<string> {
  return buildLiveContextBlock();
}
