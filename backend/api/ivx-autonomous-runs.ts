/**
 * IVX Autonomous Run Log API (owner-only) — 2026-07-26.
 *
 *   GET /api/ivx/autonomous/runs          → recent permanent run records (newest first)
 *   GET /api/ivx/autonomous/runs/summary  → aggregated evidence counts (honest)
 *
 * This is the permanent per-run evidence layer: every autonomous engine/scheduler
 * run is persisted as an individual record in the durable Supabase store and is
 * readable here. Records survive server restarts, Render redeploys, and scheduler
 * restarts. No mock data — every record is grounded in a real execution.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { readAutonomousRuns, summarizeAutonomousRunLog } from '../services/ivx-autonomous-run-log';

export const IVX_AUTONOMOUS_RUNS_MARKER = 'ivx-autonomous-runs-api-2026-07-26';

export function autonomousRunsOptions(): Response {
  return ownerOnlyOptions();
}

/** GET /api/ivx/autonomous/runs — recent permanent run records (newest first). */
export async function handleAutonomousRunsGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const limit = Math.max(1, Math.min(500, Number.parseInt(limitParam ?? '100', 10) || 100));
  const engine = url.searchParams.get('engine');
  const kind = url.searchParams.get('kind');

  let runs = await readAutonomousRuns(limit);
  if (engine) {
    runs = runs.filter((r) => r.engine === engine);
  }
  if (kind) {
    runs = runs.filter((r) => r.kind === kind);
  }

  return ownerOnlyJson({
    ok: true,
    marker: IVX_AUTONOMOUS_RUNS_MARKER,
    generatedAt: new Date().toISOString(),
    source: 'durable_store',
    count: runs.length,
    runs: runs as unknown as Record<string, unknown>,
  } as unknown as Record<string, unknown>);
}

/** GET /api/ivx/autonomous/runs/summary — aggregated honest evidence counts. */
export async function handleAutonomousRunsSummaryGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const summary = await summarizeAutonomousRunLog(500);
  if (!summary) {
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMOUS_RUNS_MARKER,
      generatedAt: new Date().toISOString(),
      source: 'durable_store',
      totalRuns: 0,
      runsWithEvidence: 0,
      runsWithoutEvidence: 0,
      failed: 0,
      byEngine: [],
      note: 'No permanent run records yet. Records appear after the next autonomous execution.',
    } as unknown as Record<string, unknown>);
  }

  return ownerOnlyJson({
    ok: true,
    marker: IVX_AUTONOMOUS_RUNS_MARKER,
    generatedAt: new Date().toISOString(),
    source: 'durable_store',
    ...summary,
    note: `${summary.totalRuns} permanent run record(s) — ${summary.runsWithEvidence} with evidence, ${summary.runsWithoutEvidence} without, ${summary.failed} failed. Every run is persisted to the durable Supabase store and survives restarts/deploys.`,
  } as unknown as Record<string, unknown>);
}
