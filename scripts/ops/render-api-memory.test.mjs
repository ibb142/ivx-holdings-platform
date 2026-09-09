import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upgradeAPI, SERVICE } from './render-api-memory.mjs';
const commit = 'a'.repeat(40);
function fixture({ wrongOwner = false, failedPlan = false, heap = '--max-old-space-size=320' } = {}) {
  const calls = [];
  const service = { id: SERVICE, ownerId: wrongOwner ? 'other' : 'tea-d7plj9beo5us73ch3ukg',
    type: 'web_service', repo: 'https://github.com/ibb142/ivx-holdings-platform', branch: 'main',
    serviceDetails: { plan: 'starter', numInstances: 2 } };
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'PATCH') { if (!failedPlan) service.serviceDetails.plan = body.serviceDetails.plan; return service; }
    if (method === 'PUT') { heap = body.value; return { value: heap }; }
    if (method === 'POST') return { id: 'dep-test' };
    return path.endsWith('NODE_OPTIONS') ? { value: heap } : service;
  };
  return { request, calls };
}
test('missing approval performs no network calls', async () => {
  const f = fixture();
  await assert.rejects(upgradeAPI({ ...f, approved: false, commit }), /approval/);
  assert.equal(f.calls.length, 0);
});
test('wrong workspace and unexpected heap prevent all writes', async () => {
  for (const options of [{ wrongOwner: true }, { heap: '--inspect' }]) {
    const f = fixture(options);
    await assert.rejects(upgradeAPI({ ...f, approved: true, commit }));
    assert.ok(f.calls.every(c => c.method === 'GET'));
  }
});
test('failed plan verification prevents heap increase and deployment', async () => {
  const f = fixture({ failedPlan: true });
  await assert.rejects(upgradeAPI({ ...f, approved: true, commit }), /readback/);
  assert.ok(f.calls.every(c => !['PUT', 'POST'].includes(c.method)));
});
test('upgrades only the API, preserves instance count and requests the exact commit', async () => {
  const f = fixture();
  const result = await upgradeAPI({ ...f, approved: true, commit });
  assert.ok(f.calls.every(c => c.path.startsWith(`/services/${SERVICE}`)));
  assert.deepEqual(f.calls.filter(c => c.method === 'PATCH').map(c => c.body), [{ serviceDetails: { plan: 'standard' } }]);
  assert.deepEqual(f.calls.at(-1).body, { clearCache: 'do_not_clear', commitId: commit });
  assert.equal(result.productionRecoveryVerified, false);
  assert.equal(result.instances, 2);
});
