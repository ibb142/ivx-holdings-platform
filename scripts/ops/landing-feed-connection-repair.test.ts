import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { repairApiFeedConnection } from './landing-feed-connection-repair';

const sha = 'a'.repeat(40), candidate = 'postgresql://postgres:private-value@db.kvclcdjmjghndxsngfzb.supabase.co/postgres';
function fixture({ failProbe = false, wrongOwner = false, concurrent = false, uncertain = false } = {}) {
  let current = 'malformed-private-value', targetReads = 0, writes = 0, probes = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (init.method === 'PUT') {
      writes++;
      assert.equal(path, '/v1/services/srv-d7t9ivreo5us73ftose0/env-vars/SUPABASE_DB_URL');
      assert.deepEqual(JSON.parse(String(init.body)), { value: candidate });
      current = candidate;
      if (uncertain) throw new Error('private-network-error');
      return Response.json({ value: current });
    }
    assert.equal(init.method, undefined);
    if (path.endsWith('/deploys')) return Response.json([{ deploy: { status: 'live', commit: { id: sha } } }]);
    if (path.includes('/env-vars/')) {
      const key = path.split('/').at(-1);
      if (key === 'SUPABASE_DB_URL') {
        if (path.includes('srv-d9i15')) return Response.json({ value: candidate });
        if (concurrent && ++targetReads > 1) current = 'someone-elses-value';
        return Response.json({ value: current });
      }
      if (key?.endsWith('SUPABASE_URL')) return Response.json({ value: 'https://kvclcdjmjghndxsngfzb.supabase.co' });
      return Response.json({ value: 'existing-private-role-key' });
    }
    return Response.json({ ownerId: wrongOwner ? 'other' : 'tea-d7plj9beo5us73ch3ukg', repo: 'https://github.com/ibb142/ivx-holdings-platform' });
  }) as typeof fetch;
  const probeImpl = async () => { probes++; if (failProbe) throw new Error('probe-failed'); return { tlsVerified: true, approvedVideosObserved: 2 }; };
  return { options: { token: 'private-token', expectedLiveSha: sha, fetchImpl, probeImpl }, counts: () => ({ writes, probes }) };
}
test('read-only mode proves the candidate without staging values or leaking credentials', async () => {
  const f = fixture(); const result = await repairApiFeedConnection(f.options);
  assert.equal(result.changed, false); assert.equal(result.changeRequired, true);
  assert.deepEqual(f.counts(), { writes: 0, probes: 1 });
  assert.doesNotMatch(JSON.stringify(result), /private|postgresql|kvclcd/);
});
test('identity and database failures prevent writes', async () => {
  for (const options of [{ wrongOwner: true }, { failProbe: true }]) {
    const f = fixture(options); await assert.rejects(repairApiFeedConnection({ ...f.options, stage: true }));
    assert.equal(f.counts().writes, 0);
  }
});
test('a concurrent correction prevents overwriting the target', async () => {
  const f = fixture({ concurrent: true });
  await assert.rejects(repairApiFeedConnection({ ...f.options, stage: true }), /concurrent_change/);
  assert.equal(f.counts().writes, 0);
});
test('staging writes only the API alias once and reconciles an uncertain response without replay', async () => {
  const f = fixture({ uncertain: true }); const result = await repairApiFeedConnection({ ...f.options, stage: true });
  assert.equal(result.changed, true); assert.equal(result.deploymentRequested, false);
  assert.equal(f.counts().writes, 1); assert.doesNotMatch(JSON.stringify(result), /private|postgresql/);
});
