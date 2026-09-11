import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'kvclcdjmjghndxsngfzb';
const API = 'https://api.ivxholding.com';
const SUPABASE = `https://${PROJECT}.supabase.co`;
const MANAGEMENT = `https://api.supabase.com/v1/projects/${PROJECT}`;

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
        ...(response.ok ? select(body) : {}) };
    } catch { return { status: 0, elapsedMs: Math.round(performance.now() - start), observedAt: now(), error: 'request_failed_or_timed_out' }; }
  }
  const bearer = managementToken ? { Authorization: `Bearer ${managementToken}` } : null;
  if (bearer) {
    report.management = await probe(MANAGEMENT, bearer, b => ({ identityMatches: b?.id === PROJECT || b?.ref === PROJECT, projectStatus: b?.status ?? null }));
    if (report.management.status === 200 && report.management.identityMatches) {
      report.compute = await probe(`${MANAGEMENT}/billing/addons`, bearer, b => ({ selected: Array.isArray(b?.selected_addons)
        ? b.selected_addons.filter(a => a?.type === 'compute_instance').map(a => ({ id: a.variant?.id ?? null, name: a.variant?.name ?? null })) : null }));
      report.services = await probe(`${MANAGEMENT}/health?services=auth,rest,db&timeout_ms=5000`, bearer,
        b => ({ services: Array.isArray(b) ? b.map(s => ({ name: s.name, healthy: s.healthy === true, status: s.status })) : null }));
    }
  }
  if (serviceKey) {
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    report.durableRead = await probe(`${SUPABASE}/rest/v1/ivx_durable_documents?select=doc_key&limit=1`, headers,
      b => ({ validArray: Array.isArray(b), rows: Array.isArray(b) ? b.length : null }));
    report.auth = await probe(`${SUPABASE}/auth/v1/health`, headers, b => ({ validHealth: Boolean(b && typeof b === 'object' && b.name) }));
  }
  report.apiReadiness = await probe(`${API}/health/ready`, {}, b => ({ ok: b?.ok === true, databaseOk: b?.checks?.database?.ok === true,
    queueOk: b?.checks?.queue?.ok === true, providerState: b?.checks?.ai?.providerState ?? null }), 35_000);
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
