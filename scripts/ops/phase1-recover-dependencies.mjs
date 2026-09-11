import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PROJECT } from './phase1-dependency-audit.mjs';

// One project restart, only after two independent unhealthy Auth observations.
// This operation never changes credentials, environment, data or owner controls.
export async function recoverDependencies({ env = process.env, fetchImpl = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date().toISOString(), record = () => {} } = {}) {
  if (env.PROJECT_REF !== PROJECT || env.PHASE1_RECOVERY !== PROJECT) throw Error('Recovery target is not authorized');
  const token = env.SUPABASE_ACCESS_TOKEN?.trim(), key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!token || !key) throw Error('Required credential binding unavailable');
  const management = `https://api.supabase.com/v1/projects/${PROJECT}`;
  const data = `https://${PROJECT}.supabase.co`;
  const report = { kind: 'bounded-dependency-recovery', project: PROJECT, sourceSha: env.GITHUB_SHA || null,
    startedAt: now(), restartAttempts: 0, observations: [] };
  async function request(url, headers, method = 'GET', timeout = 15_000) {
    try {
      const response = await fetchImpl(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    } catch { return { status: 0, body: null }; }
  }
  const managementHeaders = { Authorization: `Bearer ${token}` };
  const dataHeaders = { apikey: key, Authorization: `Bearer ${key}` };
  const identity = await request(management, managementHeaders);
  if (identity.status !== 200 || (identity.body?.id !== PROJECT && identity.body?.ref !== PROJECT)) throw Error('Management project identity could not be verified');
  if (identity.body.status !== 'ACTIVE_HEALTHY') throw Error('Project already transitioning; recovery not repeated');
  const health = await request(`${management}/health?services=auth`, managementHeaders);
  const unhealthy = health.status === 200 && Array.isArray(health.body)
    && health.body.length === 1 && health.body[0]?.name === 'auth' && health.body[0]?.healthy === false;
  report.managementAuthUnhealthy = unhealthy;
  if (!unhealthy) return { ...report, action: 'skipped', reason: 'Auth service is not confirmed unhealthy', finishedAt: now() };
  async function observe() {
    const [auth, durable] = await Promise.all([
      request(`${data}/auth/v1/health`, dataHeaders),
      request(`${data}/rest/v1/ivx_durable_documents?select=doc_key&limit=1`, dataHeaders),
    ]);
    const observation = { at: now(), authStatus: auth.status, authOk: auth.status === 200 && typeof auth.body?.name === 'string',
      durableStatus: durable.status, durableOk: durable.status === 200 && Array.isArray(durable.body) };
    report.observations.push(observation);
    record({ ...report, stage: 'observation' });
    return observation;
  }
  for (let index = 0; index < 2; index++) {
    const observation = await observe();
    if (observation.authOk) return { ...report, action: 'skipped', reason: 'Auth recovered before restart', finishedAt: now() };
    if (![0, 500, 502, 503, 504, 520, 521, 522, 523, 524, 544].includes(observation.authStatus)) {
      return { ...report, action: 'skipped', reason: 'Auth failure is not a confirmed transient outage', finishedAt: now() };
    }
    if (index === 0) await wait(5_000);
  }
  // Do not replay the mutation if its acknowledgement is lost.
  report.restartAttempts = 1;
  report.restartRequestedAt = now();
  record({ ...report, stage: 'restart-request' });
  const restart = await request(`${management}/restart`, managementHeaders, 'POST', 45_000);
  report.restartStatus = restart.status;
  report.acknowledged = [200, 201, 202, 204].includes(restart.status);
  record({ ...report, stage: 'restart-response' });
  if (!report.acknowledged) return { ...report, action: 'restart-not-confirmed', finishedAt: now() };
  let consecutiveHealthy = 0;
  for (let index = 0; index < 12; index++) {
    await wait(15_000);
    const observation = await observe();
    consecutiveHealthy = observation.authOk && observation.durableOk ? consecutiveHealthy + 1 : 0;
    if (consecutiveHealthy >= 3) return { ...report, action: 'restarted', dependenciesRecovered: true, finishedAt: now() };
  }
  return { ...report, action: 'restarted', dependenciesRecovered: false, finishedAt: now() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const record = report => {
    writeFileSync('phase1-dependency-recovery.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  };
  const report = await recoverDependencies({ record });
  record(report);
  if (report.action === 'restart-not-confirmed' || report.dependenciesRecovered === false) process.exitCode = 1;
}
