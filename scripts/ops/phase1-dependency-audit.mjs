import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'kvclcdjmjghndxsngfzb';
const API = 'https://api.ivxholding.com';
const SUPABASE = `https://${PROJECT}.supabase.co`;
const MANAGEMENT = `https://api.supabase.com/v1/projects/${PROJECT}`;

export function summarizeMetrics(source) {
  const allowed = new Set(['node_load1', 'node_load5', 'node_memory_MemTotal_bytes', 'node_memory_MemAvailable_bytes',
    'pg_stat_database_numbackends', 'pg_settings_max_connections', 'pg_locks_count', 'pg_stat_activity_count',
    'pg_database_size_bytes', 'pg_stat_database_blks_read', 'pg_stat_database_blks_hit']);
  const result = {};
  for (const line of source.split('\n')) {
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([-+0-9.eE]+)(?:\s|$)/.exec(line);
    if (!match || !allowed.has(match[1]) || !Number.isFinite(Number(match[2]))) continue;
    result[match[1]] = (result[match[1]] || 0) + Number(match[2]);
  }
  return result;
}

// Read-only and fixed-target. Never emit response bodies, credentials or user rows.
export async function auditDependencies({ env = process.env, fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  if (env.PROJECT_REF && env.PROJECT_REF !== PROJECT) throw Error('Unexpected project');
  const managementToken = env.SUPABASE_ACCESS_TOKEN?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const report = { kind: 'dependency-diagnostic', project: PROJECT, sourceSha: env.GITHUB_SHA || null,
    startedAt: now(), credentialBindings: { management: Boolean(managementToken), service: Boolean(serviceKey) } };
  async function probe(url, headers, select, timeoutMs = 15_000) {
    const start = performance.now();
    try {
      const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.json().catch(() => null);
      return { status: response.status, elapsedMs: Math.round(performance.now() - start), observedAt: now(),
        ...select(body) };
    } catch { return { status: 0, elapsedMs: Math.round(performance.now() - start), observedAt: now(), error: 'request_failed_or_timed_out' }; }
  }
  const bearer = managementToken ? { Authorization: `Bearer ${managementToken}` } : null;
  if (bearer) {
    report.management = await probe(MANAGEMENT, bearer, b => ({ identityMatches: b?.id === PROJECT || b?.ref === PROJECT, projectStatus: b?.status ?? null }));
    if (report.management.status === 200 && report.management.identityMatches) {
      report.compute = await probe(`${MANAGEMENT}/billing/addons`, bearer, b => ({ selected: Array.isArray(b?.selected_addons)
        ? b.selected_addons.filter(a => a?.type === 'compute_instance').map(a => ({ id: a.variant?.id ?? null, name: a.variant?.name ?? null })) : null }));
      report.services = await probe(`${MANAGEMENT}/health?services=auth`, bearer,
        b => ({ services: Array.isArray(b) ? b.map(s => ({ name: s.name, healthy: s.healthy === true, status: s.status })) : null }));
      report.pool = await probe(`${MANAGEMENT}/config/database/pgbouncer`, bearer,
        b => ({ mode: ['transaction', 'session'].includes(b?.pool_mode) ? b.pool_mode : null,
          configuredSize: Number.isInteger(b?.default_pool_size) ? b.default_pool_size : null,
          idleTimeout: Number.isFinite(b?.server_idle_timeout) ? b.server_idle_timeout : null }));
      const started = performance.now();
      try {
        const response = await fetchImpl(`${MANAGEMENT}/analytics/endpoints/metrics`, {
          method: 'GET', headers: bearer, redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        const source = await response.text();
        report.metrics = { status: response.status, observedAt: now(), elapsedMs: Math.round(performance.now() - started),
          totals: response.ok ? summarizeMetrics(source) : {} };
      } catch {
        report.metrics = { status: 0, observedAt: now(), elapsedMs: Math.round(performance.now() - started), error: 'request_failed_or_timed_out' };
      }
    }
  }
  if (serviceKey) {
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    report.durableRead = await probe(`${SUPABASE}/rest/v1/ivx_durable_documents?select=doc_key&limit=1`, headers,
      b => ({ validArray: Array.isArray(b), rows: Array.isArray(b) ? b.length : null }));
    report.auth = await probe(`${SUPABASE}/auth/v1/health`, headers, b => ({ validHealth: Boolean(b && typeof b === 'object' && b.name) }));
  }
  report.apiReadiness = await probe(`${API}/health/ready`, {}, b => ({ ok: b?.ok === true, databaseOk: b?.checks?.database?.ok === true,
    queueOk: b?.checks?.queue?.ok === true, providerState: b?.checks?.ai?.providerState ?? null,
    rootProbeStatus: b?.checks?.database?.rootProbe?.status ?? null,
    tableProbeStatus: b?.checks?.database?.tableProbe?.status ?? null,
    rootProbeMs: b?.checks?.database?.rootProbe?.latencyMs ?? null,
    tableProbeMs: b?.checks?.database?.tableProbe?.latencyMs ?? null,
    queueCircuitOpen: b?.checks?.queue?.circuit?.open ?? null,
    queueWorkerRunning: b?.checks?.queue?.running ?? null }), 35_000);
  report.publicReels = await probe(`${API}/api/reels`, {}, b => ({ validCatalog: Array.isArray(b?.videos), count: Array.isArray(b?.videos) ? b.videos.length : null }), 25_000);
  report.publicDeals = await probe(`${API}/api/landing-deals`, {}, b => ({ validCatalog: Array.isArray(b?.deals), count: Array.isArray(b?.deals) ? b.deals.length : null }), 25_000);
  report.ready = report.durableRead?.status === 200 && report.durableRead.validArray === true && report.auth?.status === 200 && report.auth.validHealth === true
    && report.apiReadiness.status === 200 && report.apiReadiness.ok && report.apiReadiness.databaseOk && report.apiReadiness.queueOk;
  report.finishedAt = now();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await auditDependencies();
  writeFileSync('phase1-dependency-audit.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.ready) process.exitCode = 1;
}
