import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';

const base = process.env.API_BASE;
const sha = process.env.IVX_TARGET_SHA || process.env.GITHUB_SHA || '';
const token = process.env.OWNER_TOKEN;
const systemKey = process.env.IVX_SYSTEM_KEY;
const renderKey = process.env.RENDER_API_KEY?.trim();
assert.equal(base, 'https://api.ivxholding.com');
assert(/^[a-f0-9]{40}$/.test(sha));
assert(token || systemKey, 'Owner bearer or protected system credential is required');
assert(renderKey, 'RENDER_API_KEY is required for physical process certification');
const apiService = 'srv-d7t9ivreo5us73ftose0', workerService = 'srv-d9i15fg4n6ts73bn00j0';
const expectedRepo = 'https://github.com/ibb142/ivx-holdings-platform';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function request(path: string, body?: unknown) {
  const authHeaders = token
    ? { Authorization: `Bearer ${token}` }
    : { 'X-IVX-System-Key': String(systemKey) };
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(body ? 60_000 : 20_000),
    headers: { ...authHeaders, 'Content-Type': 'application/json', Connection: 'close' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, 200, `HTTP ${response.status} at ${path}`);
  const value = await response.json(); assert.equal(value.ok, true, `Operation rejected at ${path}`); return value;
}
async function topology() {
  const value = await request('/api/ivx/autonomous/ha');
  assert.equal(value.marker, 'ivx-api-worker-ha-2026-09-08-v1'); assert.equal(value.commitSha, sha);
  assert(Date.now() - Date.parse(value.measuredAt) <= 15_000, 'Stale HA observation');
  return value;
}
async function action(action: string, serviceId: string, numInstances?: number) {
  return request('/api/ivx/developer-deploy/action', { action, input: { serviceId, ...(numInstances ? { numInstances } : {}) },
    confirm: true, confirmText: 'CONFIRM_IVX_RENDER_SERVICE_UPDATE', reason: 'Owner-authorized API/worker HA rollout and verification for items 8/9.' });
}
async function renderRequest(path: string) {
  const response = await fetch(`https://api.render.com/v1${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${renderKey}`, Accept: 'application/json' },
  });
  const text = await response.text();
  assert.equal(response.status, 200, `Render HTTP ${response.status} at ${path}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
async function exactLiveDeploy(serviceId: string) {
  const payload = await renderRequest(`/services/${encodeURIComponent(serviceId)}/deploys?limit=20`);
  assert(Array.isArray(payload), `Render deploy response for ${serviceId} is not an array`);
  const deploys = payload.map((entry: any) => entry?.deploy ?? entry);
  const live = deploys.find((deploy: any) => deploy?.status === 'live');
  assert(live, `No live Render deploy for ${serviceId}`);
  const commitSha = live?.commit?.id ?? live?.commitId ?? live?.commit?.sha;
  assert.equal(commitSha, sha, `Render live deploy for ${serviceId} is not the certification SHA`);
  return { id: live.id, status: live.status, commitSha, finishedAt: live.finishedAt ?? null };
}
async function physicalInstances(serviceId: string) {
  const payload = await renderRequest(`/services/${encodeURIComponent(serviceId)}/instances`);
  assert(Array.isArray(payload), `Render instance response for ${serviceId} is not an array`);
  const instances = payload.map((entry: any) => ({
    instanceId: String(entry?.id ?? ''),
    createdAt: String(entry?.createdAt ?? ''),
  }));
  assert(instances.every((entry: any) => entry.instanceId && entry.createdAt), `Malformed Render instance for ${serviceId}`);
  assert.equal(new Set(instances.map((entry: any) => entry.instanceId)).size, instances.length, `Duplicate Render instance for ${serviceId}`);
  return instances;
}
async function physicalTopology() {
  const [api, worker, apiInstances, workerInstances] = await Promise.all([
    renderRequest(`/services/${apiService}`),
    renderRequest(`/services/${workerService}`),
    physicalInstances(apiService),
    physicalInstances(workerService),
  ]);
  assert.equal(api.id, apiService); assert.equal(worker.id, workerService);
  assert.equal(api.repo, expectedRepo); assert.equal(worker.repo, expectedRepo);
  assert.equal(api.branch, 'main'); assert.equal(worker.branch, 'main');
  assert.equal(api.type, 'web_service'); assert.equal(worker.type, 'background_worker');
  assert.equal(api.suspended, 'not_suspended'); assert.equal(worker.suspended, 'not_suspended');
  return {
    source: 'render-public-api-list-instances',
    observedAt: new Date().toISOString(),
    api: { serviceId: api.id, configuredInstances: api.serviceDetails?.numInstances, instances: apiInstances },
    worker: { serviceId: worker.id, configuredInstances: worker.serviceDetails?.numInstances, instances: workerInstances },
  };
}
function twoByTwo(value: any) {
  return value?.api?.configuredInstances === 2 && value?.worker?.configuredInstances === 2
    && value.api.instances.length === 2 && value.worker.instances.length === 2;
}
async function optionalSharedTopology() {
  let value: any;
  try {
    value = await topology();
  } catch {
    return { status: 'UNAVAILABLE', topology: null };
  }
  assert.equal(value.apiInstances.length, 2); assert.equal(value.workerInstances.length, 2);
  return { status: 'PASS', topology: value };
}
// Require both services to be on the exact target release before changing
// replica count. The Render instances endpoint is the authoritative physical
// process observer; the shared PostgreSQL endpoint is retained as an
// independent application-level observation when that provider is reachable.
const exactDeploys = {
  api: await exactLiveDeploy(apiService),
  worker: await exactLiveDeploy(workerService),
};
for (const service of [workerService, apiService]) {
  await action('render_scale_service', service, 2);
  console.log(JSON.stringify({ scaleAccepted: true, serviceId: service, requestedInstances: 2, liveVerified: false }));
}
let before: any, consecutive = 0;
for (let i = 0; i < 48; i++) {
  const value = await physicalTopology().catch(() => null);
  if (value && twoByTwo(value)) consecutive++; else consecutive = 0;
  if (consecutive >= 3) { before = value; break; }
  await sleep(5000);
}
assert(before, 'Render did not report two configured and two physical processes per role');
const sharedBefore = await optionalSharedTopology();
const proof: Record<string, unknown> = {
  sourceSha: sha,
  exactDeploys,
  physicalTopologySource: 'render-public-api-list-instances',
  before,
  sharedStateObservation: sharedBefore,
  rollingWorkerRestart: false,
  databaseFailoverTested: false,
  verifiedAt: new Date().toISOString(),
};
if (process.env.IVX_HA_RESTART_WORKER === 'true') {
  const oldWorkers = new Set(before.worker.instances.map((entry: any) => entry.instanceId));
  const apiIds = new Set(before.api.instances.map((entry: any) => entry.instanceId));
  await action('render_restart_service', workerService);
  const health: unknown[] = []; let after: any; let recoveryProbe = -1;
  for (let i = 0; i < 90; i++) {
    const start = Date.now();
    const response = await fetch(base + '/health', { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Connection: 'close' } });
    assert.equal(response.status, 200, 'API availability failed during worker restart');
    const h = await response.json(); assert.equal(h.commit, sha); assert(apiIds.has(h.instanceId));
    health.push({ instanceId: h.instanceId, ms: Date.now() - start, at: new Date().toISOString() });
    const workers = await physicalInstances(workerService).catch(() => []);
    if (workers.length === 2 && workers.every((entry: any) => !oldWorkers.has(entry.instanceId))) {
      after = await physicalTopology();
      if (twoByTwo(after) && recoveryProbe < 0) recoveryProbe = i;
    }
    if (after && i - recoveryProbe >= 20) break;
    await sleep(3000);
  }
  assert(after && recoveryProbe >= 0, 'Two replacement worker processes did not recover after restart');
  const sharedAfter = await optionalSharedTopology();
  Object.assign(proof, {
    after,
    sharedStateObservationAfterRestart: sharedAfter,
    health,
    rollingWorkerRestart: true,
    workerProcessReplacement: 'PASS',
    apiAvailabilityDuringRestart: 'PASS',
    taskRecoveryClaimed: false,
  });
}
await mkdir('qa/evidence/fleet-ha', { recursive: true });
await writeFile('qa/evidence/fleet-ha/live.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));
