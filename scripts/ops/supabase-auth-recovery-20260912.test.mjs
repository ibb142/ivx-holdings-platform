import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverAuth, PROJECT, EXPECTED_BOOT, CONFIRMED_INCIDENT } from './supabase-auth-recovery-20260912.mjs';

async function run({ health = [false, false, true, true, true], project = PROJECT,
  status = 'ACTIVE_HEALTHY', boot = EXPECTED_BOOT, restartThrows = false, attempt = '1',
  now = Date.parse('2026-09-12T01:00:00Z'), healthHttp = 200, bootHttp = 201, confirmedIncident } = {}) {
  let probes = 0; const calls = [];
  const receipt = await recoverAuth({ token: 'test-only', runAttempt: attempt, confirmedIncident, clock: () => now,
    wait: async () => {}, fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      assert.equal(new URL(url).hostname, 'api.supabase.com');
      if (url.endsWith('/restart')) {
        if (restartThrows) throw new Error('network result uncertain');
        return Response.json({}, { status: 200 });
      }
      if (url.includes('/health?')) return Response.json([{ name: 'auth', healthy: health[Math.min(probes++, health.length - 1)] }], { status: healthHttp });
      if (url.endsWith('/database/query/read-only')) {
        assert.equal(JSON.parse(options.body).query, 'select pg_catalog.pg_postmaster_start_time() as boot_at');
        return Response.json([{ boot_at: boot }], { status: bootHttp });
      }
      return Response.json({ id: project, status });
    } });
  return { receipt, restarts: calls.filter(call => call.url.endsWith('/restart')).length, calls };
}
test('Auth incident recovers with one restart even when the project is ACTIVE_HEALTHY', async () => {
  const r = await run(); assert.equal(r.restarts, 1); assert.equal(r.receipt.result, 'AUTH_RECOVERED');
});
test('healthy Auth is never restarted', async () => {
  const r = await run({ health: [true, true] }); assert.equal(r.restarts, 0); assert.equal(r.receipt.result, 'AUTH_ALREADY_HEALTHY');
});
test('confirmed failed QA and database lock remain an incident even when Auth liveness is healthy', async () => {
  const r = await run({ confirmedIncident: CONFIRMED_INCIDENT, health: [true] });
  assert.equal(r.restarts, 1); assert.equal(r.receipt.result, 'AUTH_RECOVERED');
  assert.equal((await run({ confirmedIncident: CONFIRMED_INCIDENT, health: [true], boot: '2026-09-12T01:00:00Z' })).restarts, 0);
  assert.equal((await run({ confirmedIncident: 'unrecognized', health: [true] })).restarts, 0);
});
test('wrong project cannot be restarted', async () => { assert.equal((await run({ project: 'wrong' })).restarts, 0); });
test('credential and ambiguous health failures do not authorize restart', async () => {
  for (const healthHttp of [401, 403, 500]) assert.equal((await run({ healthHttp })).restarts, 0);
});
test('intermittent Auth health cannot pass preflight', async () => { assert.equal((await run({ health: [false, true] })).restarts, 0); });
test('a bounded sample still requires two consecutive explicit Auth failures after a transient success', async () => {
  const r = await run({ health: [false, true, false, false, true, true, true] });
  assert.equal(r.restarts, 1); assert.equal(r.receipt.result, 'AUTH_RECOVERED');
});
test('changed or unreadable boot prevents an additional restart', async () => {
  assert.equal((await run({ boot: '2026-09-12T00:59:00Z' })).restarts, 0);
  assert.equal((await run({ bootHttp: 500 })).restarts, 0);
});
test('an existing restart is only observed', async () => { const r = await run({ status: 'RESTARTING' }); assert.equal(r.restarts, 0); assert.equal(r.receipt.result, 'AUTH_RECOVERED'); });
test('an uncertain restart is never repeated or reported as recovered without healthy probes', async () => {
  const r = await run({ restartThrows: true, health: [false] }); assert.equal(r.restarts, 1);
  assert.equal(r.receipt.result, 'UNVERIFIED'); assert.equal(r.receipt.restartUncertain, true);
});
test('reruns and expired authorization never make requests', async () => {
  assert.equal((await run({ attempt: '2' })).calls.length, 0);
  assert.equal((await run({ now: Date.parse('2026-09-12T02:00:00Z') })).calls.length, 0);
});
