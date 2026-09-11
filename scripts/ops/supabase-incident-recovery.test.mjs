import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recover, PROJECT } from './supabase-incident-recovery.mjs';
const good = () => Response.json([{ id: 'fixture-approved-video' }]);
const project = status => Response.json({ id: PROJECT, status });
const base = { token: 'fixture-secret', wait: async () => {}, emit: () => {} };
test('healthy public data avoids any management request', async () => {
  const result = await recover({ ...base, fetchImpl: async url => { assert.ok(url.includes('/rest/v1/project_videos')); return good(); } });
  assert.equal(result.result, 'already_healthy'); assert.equal(result.restartRequests, 0);
});
test('503 reproduces before one restart and the same public read passes three times after', async () => {
  let reads = 0, writes = 0;
  const result = await recover({ ...base, fetchImpl: async (url, init) => {
    if (url.includes('/rest/v1/')) { reads++; return writes ? good() : Response.json({ code: 'PGRST002' }, { status: 503 }); }
    assert.equal(init.headers.Authorization, 'Bearer fixture-secret');
    if (init.method === 'POST') { assert.equal(url, `https://api.supabase.com/v1/projects/${PROJECT}/restart`); writes++; return new Response(null, { status: 202 }); }
    return project('ACTIVE_HEALTHY');
  } });
  assert.equal(writes, 1); assert.equal(reads, 5); assert.equal(result.result, 'recovered'); assert.equal(result.restartAcknowledged, true);
});
test('rejected credentials and mismatched project never authorize a restart', async () => {
  for (const response of [() => new Response(null, { status: 401 }), () => Response.json({ id: 'other', status: 'ACTIVE_HEALTHY' })]) {
    let writes = 0;
    await assert.rejects(recover({ ...base, fetchImpl: async (url, init) => { if (init.method === 'POST') writes++; return url.includes('/rest/v1/') ? new Response(null, { status: 503 }) : response(); } }));
    assert.equal(writes, 0);
  }
});
test('a timed-out restart is uncertain and never resent', async () => {
  let writes = 0, logged;
  await assert.rejects(recover({ ...base, emit: value => { logged = JSON.parse(value); }, fetchImpl: async (url, init) => {
    if (url.includes('/rest/v1/')) return new Response(null, { status: 503 });
    if (init.method === 'POST') { writes++; throw new Error('request timed out'); }
    return project('ACTIVE_HEALTHY');
  } }), /not verified/);
  assert.equal(writes, 1); assert.equal(logged.restartUncertain, true); assert.equal(logged.restartAcknowledged, false);
  assert.equal(logged.result, 'unverified'); assert.equal(JSON.stringify(logged).includes('fixture-secret'), false);
});
test('an ongoing restart is observed without sending a second restart', async () => {
  let reads = 0, writes = 0;
  const result = await recover({ ...base, fetchImpl: async (url, init) => {
    if (url.includes('/rest/v1/')) return ++reads > 2 ? good() : new Response(null, { status: 503 });
    if (init.method === 'POST') writes++;
    return project('RESTARTING');
  } });
  assert.equal(writes, 0); assert.equal(result.result, 'recovered');
});
test('HTTP 200 with an empty catalog cannot authorize a restart', async () => {
  let writes = 0;
  await assert.rejects(recover({ ...base, fetchImpl: async (url, init) => {
    if (url.includes('/rest/v1/')) return Response.json([]);
    if (init.method === 'POST') { writes++; return new Response(null, { status: 202 }); }
    return project('ACTIVE_HEALTHY');
  } }), /restart refused/);
  assert.equal(writes, 0);
});
test('a permission error cannot authorize infrastructure recovery', async () => {
  let writes = 0;
  await assert.rejects(recover({ ...base, fetchImpl: async (url, init) => {
    if (init.method === 'POST') writes++;
    return new Response(null, { status: 401 });
  } }), /restart refused/);
  assert.equal(writes, 0);
});
test('one successful probe prevents a restart on an intermittent failure', async () => {
  let calls = 0;
  await assert.rejects(recover({ ...base, fetchImpl: async () => ++calls === 1 ? good() : new Response(null, { status: 503 }) }), /two consecutive/);
  assert.equal(calls, 2);
});
