import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';

const base = process.env.API_BASE;
const sha = process.env.GITHUB_SHA ?? '';
const token = process.env.OWNER_TOKEN;
assert.equal(base, 'https://api.ivxholding.com');
assert(/^[a-f0-9]{40}$/.test(sha)); assert(token);
const apiService = 'srv-d7t9ivreo5us73ftose0', workerService = 'srv-d9i15fg4n6ts73bn00j0';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function request(path: string, body?: unknown) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(body ? 60_000 : 20_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection: 'close' }, ...(body ? { body: JSON.stringify(body) } : {}) });
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
// Wait until both services have the exact release and shared state before scaling.
let prepared = false;
for (let i = 0; i < 60; i++) {
  const t = await topology().catch(() => null);
  if (!t) { await sleep(5000); continue; }
  prepared = t.apiInstances.length >= 1 && t.workerInstances.length >= 1;
  if (prepared) break;
  await sleep(5000);
}
assert(prepared, 'Current release with shared state is not running in both roles');
for (const service of [workerService, apiService]) {
  await action('render_scale_service', service, 2);
  console.log(JSON.stringify({ scaleAccepted: true, serviceId: service, requestedInstances: 2, liveVerified: false }));
}
let before: any, consecutive = 0;
for (let i = 0; i < 72; i++) {
  const t = await topology().catch(() => null);
  if (!t) { consecutive = 0; await sleep(5000); continue; }
  if (t.ready && t.apiInstances.length === 2 && t.workerInstances.length === 2) consecutive++; else consecutive = 0;
  if (consecutive >= 4) { before = t; break; }
  await sleep(5000);
}
assert(before, 'Two healthy processes per role did not become observable');
const proof: Record<string, unknown> = { sourceSha: sha, before, rollingWorkerRestart: false, databaseFailoverTested: false, verifiedAt: new Date().toISOString() };
if (process.env.IVX_HA_RESTART_WORKER === 'true') {
  const oldWorkers = new Set(before.workerInstances.map((i: any) => i.instanceId));
  const apiIds = new Set(before.apiInstances.map((i: any) => i.instanceId));
  await action('render_restart_service', workerService);
  const health: unknown[] = []; let after: any;
  for (let i = 0; i < 90; i++) {
    const start = Date.now();
    const response = await fetch(base + '/health', { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Connection: 'close' } });
    assert.equal(response.status, 200, 'API availability failed during worker restart');
    const h = await response.json(); assert.equal(h.commit, sha); assert(apiIds.has(h.instanceId));
    health.push({ instanceId: h.instanceId, ms: Date.now() - start, at: new Date().toISOString() });
    const t = await topology();
    if (t.ready && t.workerInstances.length === 2 && t.workerInstances.every((w: any) => !oldWorkers.has(w.instanceId))) after = t;
    if (after && i >= 40) break;
    await sleep(3000);
  }
  assert(after, 'Worker processes did not recover after restart');
  Object.assign(proof, { after, health, rollingWorkerRestart: true, apiAvailabilityDuringRestart: 'PASS', taskRecoveryClaimed: false });
}
await mkdir('qa/evidence/fleet-ha', { recursive: true });
await writeFile('qa/evidence/fleet-ha/live.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));
