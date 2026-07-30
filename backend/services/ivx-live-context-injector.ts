/**
 * IVX Live Context Injector — Production Awareness for IVX IA Chat
 *
 * Owner mandate 2026-07-30: IVX IA must always know the current production
 * state, autonomous jobs, deployment SHA, health, and pending approvals.
 * This module fetches live data from the production API and assembles a
 * context block injected into every owner-AI prompt so the model can answer
 * production-awareness questions without guessing.
 *
 * Phases covered:
 *   Phase 4 — Context Memory: current project, deployment, production state
 *   Phase 5 — Autonomous Integration: what workers are doing
 *   Phase 6 — Production Awareness: SHA, health, jobs, deployments
 */

export const IVX_LIVE_CONTEXT_MARKER = 'ivx-live-context-injector-2026-07-30';

export type IVXLiveContextData = {
  health: {
    status: string;
    commit: string;
    bootTime: string;
    environment: string;
    serviceName: string;
  } | null;
  autonomousQA: {
    ok: boolean;
    schedulerRunning: boolean;
    processStartedAt: string;
    cadence: { healthMinutes: number; authMinutes: number; matrixHours: number } | null;
  } | null;
  autonomousRuns: {
    ok: boolean;
    count: number;
    recentRuns: { runId: string; kind: string; status: string; engine: string }[];
  } | null;
  executiveLayer: {
    ok: boolean;
    summary: string;
  } | null;
  timestamp: string;
  error: string | null;
};

type AutonomousRunRecord = {
  runId?: string;
  kind?: string;
  status?: string;
  engine?: string;
};

type HealthResponse = {
  status?: string;
  commit?: string;
  bootTime?: string;
  environment?: string;
  serviceName?: string;
};

type AutonomousQAResponse = {
  ok?: boolean;
  schedulerRunning?: boolean;
  processStartedAt?: string;
  cadence?: { healthMinutes: number; authMinutes: number; matrixHours: number };
};

type AutonomousRunsResponse = {
  ok?: boolean;
  count?: number;
  runs?: AutonomousRunRecord[];
  records?: AutonomousRunRecord[];
};

type ExecutiveLayerResponse = {
  ok?: boolean;
  summary?: string;
};

/**
 * Fetch JSON from a URL with a timeout. Returns null on any error.
 */
async function fetchJson<T>(url: string, timeoutMs = 8000, headers?: Record<string, string>): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: headers ?? {},
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch all live production context data in parallel.
 * This runs server-side on the Render backend — it calls its own endpoints.
 */
export async function fetchLiveContext(baseOrigin?: string): Promise<IVXLiveContextData> {
  const base = baseOrigin ?? `http://localhost:${process.env.PORT ?? '3000'}`;
  const timestamp = new Date().toISOString();

  const [health, qa, runs, exec] = await Promise.all([
    fetchJson<HealthResponse>(`${base}/health`, 5000),
    fetchJson<AutonomousQAResponse>(`${base}/api/ivx/autonomous/qa`, 5000),
    fetchJson<AutonomousRunsResponse>(`${base}/api/ivx/autonomous/runs`, 5000),
    fetchJson<ExecutiveLayerResponse>(`${base}/api/ivx/executive-layer`, 5000),
  ]);

  const hasAny = health || qa || runs || exec;

  return {
    health: health ? {
      status: health.status ?? 'unknown',
      commit: health.commit ?? 'unknown',
      bootTime: health.bootTime ?? 'unknown',
      environment: health.environment ?? 'unknown',
      serviceName: health.serviceName ?? 'unknown',
    } : null,
    autonomousQA: qa ? {
      ok: qa.ok ?? false,
      schedulerRunning: qa.schedulerRunning ?? false,
      processStartedAt: qa.processStartedAt ?? 'unknown',
      cadence: qa.cadence ?? null,
    } : null,
    autonomousRuns: runs ? {
      ok: runs.ok ?? false,
      count: runs.count ?? 0,
      recentRuns: (runs.runs ?? runs.records ?? []).slice(0, 5).map((r) => ({
        runId: r.runId ?? 'unknown',
        kind: r.kind ?? 'unknown',
        status: r.status ?? 'unknown',
        engine: r.engine ?? 'unknown',
      })),
    } : null,
    executiveLayer: exec ? {
      ok: exec.ok ?? false,
      summary: exec.summary ?? 'no summary',
    } : null,
    timestamp,
    error: hasAny ? null : 'Could not fetch live production context — all endpoints returned null.',
  };
}

/**
 * Build the [IVX LIVE PRODUCTION CONTEXT] block injected into every prompt.
 * This gives the model real-time awareness of production state, autonomous
 * jobs, deployment SHA, and system health so it can answer questions like:
 *   "What is the current SHA?"
 *   "What are the workers doing?"
 *   "What changed today?"
 *   "Is production healthy?"
 *   "What is the highest priority?"
 */
export function buildLiveContextBlock(data: IVXLiveContextData): string {
  if (data.error) {
    return `[IVX LIVE PRODUCTION CONTEXT]\n  Note: ${data.error}\n  Timestamp: ${data.timestamp}\n[/IVX LIVE PRODUCTION CONTEXT]`;
  }

  const lines: string[] = [
    '[IVX LIVE PRODUCTION CONTEXT]',
  ];

  // Production health
  if (data.health) {
    lines.push(`  Production Health:`);
    lines.push(`    Status: ${data.health.status}`);
    lines.push(`    Commit SHA: ${data.health.commit.slice(0, 12)}`);
    lines.push(`    Boot Time: ${data.health.bootTime}`);
    lines.push(`    Environment: ${data.health.environment}`);
    lines.push(`    Service: ${data.health.serviceName}`);
  }

  // Autonomous QA scheduler
  if (data.autonomousQA) {
    lines.push(`  Autonomous QA Scheduler:`);
    lines.push(`    Running: ${data.autonomousQA.schedulerRunning}`);
    lines.push(`    Process Started: ${data.autonomousQA.processStartedAt}`);
    if (data.autonomousQA.cadence) {
      lines.push(`    Cadence: health every ${data.autonomousQA.cadence.healthMinutes}min, auth every ${data.autonomousQA.cadence.authMinutes}min, matrix every ${data.autonomousQA.cadence.matrixHours}h`);
    }
  }

  // Autonomous runs
  if (data.autonomousRuns) {
    lines.push(`  Autonomous Runs:`);
    lines.push(`    Total recent runs: ${data.autonomousRuns.count}`);
    if (data.autonomousRuns.recentRuns.length > 0) {
      lines.push(`    Recent jobs:`);
      for (const run of data.autonomousRuns.recentRuns) {
        lines.push(`      - ${run.runId.slice(0, 20)}: ${run.kind} / ${run.status} (engine: ${run.engine})`);
      }
    } else {
      lines.push(`    Recent jobs: none in recent window`);
    }
  }

  // Executive layer
  if (data.executiveLayer) {
    lines.push(`  Executive Layer: ${data.executiveLayer.ok ? 'OK' : 'unavailable'}`);
  }

  lines.push(`  Context fetched at: ${data.timestamp}`);
  lines.push('[/IVX LIVE PRODUCTION CONTEXT]');

  return lines.join('\n');
}

/**
 * Full live context fetch + render in one call.
 * Returns the context block string ready to inject into a prompt.
 */
export async function getLiveContextBlock(baseOrigin?: string): Promise<string> {
  const data = await fetchLiveContext(baseOrigin);
  return buildLiveContextBlock(data);
}