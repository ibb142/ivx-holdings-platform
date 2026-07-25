// AUTO-GENERATED stress test harness by the IVX Senior Developer runtime.
// Goal: Run a stress test on production
// Created at: 2026-07-19T13:01:29.591Z
// Job marker: ivx-senior-developer-runtime-blocks-33-37-2026-05-19
//
// SAFE BOUNDS: max 100 total requests, max 20 concurrent, 5s per-request timeout.
// Target: https://api.ivxholding.com/health (read-only GET /health — no mutations, no auth required).

/**
 * Run a bounded stress test against the live /health endpoint.
 * Measures latency percentiles (p50/p90/p99), success rate, and total duration.
 * Writes results to a JSON file alongside this harness.
 */

const TARGET_URL = 'https://api.ivxholding.com/health';
const TOTAL_REQUESTS = 100;
const CONCURRENCY = 20;
const PER_REQUEST_TIMEOUT_MS = 5000;
const RESULTS_FILE = 'backend/services/ivx-senior-developer-samples/stress-tests/stress-ec0298f1-results.json';

interface StressResult {
  targetUrl: string;
  totalRequests: number;
  concurrency: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  statusCodes: Record<number, number>;
  latenciesMs: number[];
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  errors: string[];
}

async function singleRequest(): Promise<{ ok: boolean; status: number; latencyMs: number; error: string | null }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(TARGET_URL, { method: 'GET', signal: controller.signal });
    const latencyMs = Date.now() - start;
    return { ok: res.ok, status: res.status, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, status: 0, latencyMs, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function runStressTest(): Promise<StressResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const latenciesMs: number[] = [];
  const statusCodes: Record<number, number> = {};
  const errors: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENCY) {
    const batch = Math.min(CONCURRENCY, TOTAL_REQUESTS - i);
    const promises = Array.from({ length: batch }, () => singleRequest());
    const results = await Promise.all(promises);
    for (const r of results) {
      latenciesMs.push(r.latencyMs);
      statusCodes[r.status] = (statusCodes[r.status] || 0) + 1;
      if (r.ok) { successCount++; } else { failureCount++; if (r.error) errors.push(r.error.slice(0, 200)); }
    }
  }

  latenciesMs.sort((a, b) => a - b);
  const durationMs = Date.now() - startMs;
  const completedAt = new Date().toISOString();
  const result: StressResult = {
    targetUrl: TARGET_URL, totalRequests: TOTAL_REQUESTS, concurrency: CONCURRENCY,
    startedAt, completedAt, durationMs, successCount, failureCount,
    successRate: successCount / TOTAL_REQUESTS, statusCodes, latenciesMs,
    p50Ms: percentile(latenciesMs, 50), p90Ms: percentile(latenciesMs, 90), p99Ms: percentile(latenciesMs, 99),
    minMs: latenciesMs[0] || 0, maxMs: latenciesMs[latenciesMs.length - 1] || 0,
    avgMs: latenciesMs.length > 0 ? Math.round(latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length) : 0,
    errors: errors.slice(0, 10),
  };

  try {
    const { writeFile: wf, mkdir: mkd } = await import('node:fs/promises');
    const { dirname: dn } = await import('node:path');
    await mkd(dn(RESULTS_FILE), { recursive: true });
    await wf(RESULTS_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');
  } catch (err) {
    errors.push('Failed to write results file: ' + (err instanceof Error ? err.message : String(err)));
  }
  return result;
}

if (import.meta.url === `file:${process.argv[1]}`) {
  runStressTest().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.successRate >= 0.95 ? 0 : 1);
  }).catch((e) => {
    console.error('Stress test failed:', e);
    process.exit(2);
  });
}
