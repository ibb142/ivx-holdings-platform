import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverDependencies } from './phase1-recover-dependencies.mjs';
import { PROJECT } from './phase1-dependency-audit.mjs';
const env = { PROJECT_REF: PROJECT, PHASE1_RECOVERY: PROJECT, SUPABASE_ACCESS_TOKEN: 'private-management', SUPABASE_SERVICE_ROLE_KEY: 'private-data' };
function fixture({ identity = PROJECT, projectStatus = 'ACTIVE_HEALTHY', healthy = false, authStatus = 503, lost = false } = {}) {
  const mutations = [];
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'error');
    assert([`https://api.supabase.com/v1/projects/${PROJECT}`, `https://${PROJECT}.supabase.co`].some(prefix => url.startsWith(prefix)));
    if (init.method !== 'GET') {
      assert.equal(init.method, 'POST'); assert.equal(url, `https://api.supabase.com/v1/projects/${PROJECT}/restart`);
      mutations.push(url); if (lost) throw Error('private ambiguous acknowledgement'); return Response.json({});
    }
    if (url.endsWith(`/projects/${PROJECT}`)) return Response.json({ id: identity, status: projectStatus });
    if (url.includes('/health?')) return Response.json([{ name: 'auth', healthy }]);
    if (url.includes('/rest/')) return Response.json([{ doc_key: 'private-data-row' }]);
    return mutations.length ? Response.json({ name: 'GoTrue' }) : new Response(JSON.stringify({ name: 'GoTrue' }), { status: authStatus });
  };
  return { mutations, fetchImpl };
}
test('healthy Auth never triggers restart', async () => {
  for (const option of [{ healthy: true }, { authStatus: 200 }, { authStatus: 401 }]) {
    const f = fixture(option); const result = await recoverDependencies({ env, ...f, wait: async () => {} });
    assert.equal(result.action, 'skipped'); assert.equal(f.mutations.length, 0);
  }
});
test('two failed probes permit one restart and three independent recovery observations', async () => {
  const f = fixture(); const result = await recoverDependencies({ env, ...f, wait: async () => {} });
  assert.equal(f.mutations.length, 1); assert.equal(result.dependenciesRecovered, true); assert.equal(result.observations.length, 5);
  assert(!JSON.stringify(result).includes('private'));
});
test('an ambiguous restart is never replayed', async () => {
  const f = fixture({ lost: true }); const result = await recoverDependencies({ env, ...f, wait: async () => {} });
  assert.equal(f.mutations.length, 1); assert.equal(result.action, 'restart-not-confirmed'); assert(!JSON.stringify(result).includes('private'));
});
test('identity mismatch or an in-progress platform operation prevents mutation', async () => {
  for (const option of [{ identity: 'other' }, { projectStatus: 'RESTARTING' }]) {
    const f = fixture(option); await assert.rejects(recoverDependencies({ env, ...f, wait: async () => {} })); assert.equal(f.mutations.length, 0);
  }
});
test('explicit fixed-target authorization and both credential bindings are required', async () => {
  for (const delta of [{ PHASE1_RECOVERY: '' }, { PROJECT_REF: 'other' }, { SUPABASE_ACCESS_TOKEN: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
    await assert.rejects(recoverDependencies({ env: { ...env, ...delta }, fetchImpl: () => assert.fail('must not request') }));
  }
});
