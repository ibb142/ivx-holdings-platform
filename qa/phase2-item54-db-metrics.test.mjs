import test from 'node:test';
import assert from 'node:assert/strict';
import { ENDPOINT, sample, summarizeMetrics } from './phase2-item54-db-metrics.mjs';

test('only numeric infrastructure metrics and known labels are published', () => {
  const body = '# secret header\nnode_cpu_seconds_total{cpu="0",mode="idle",owner="private-value"} 10\npg_stat_activity_count{state="active",query="private-sql"} 3\nprivate_metric{secret="private-value"} 42\nnode_load1 NaN\n';
  const out = summarizeMetrics(body);
  assert.deepEqual(out.series, [
    { name: 'node_cpu_seconds_total', labels: { cpu: '0', mode: 'idle' }, value: 10 },
    { name: 'pg_stat_activity_count', labels: { state: 'active' }, value: 3 },
  ]);
  assert.equal(/private|secret|header/.test(JSON.stringify(out)), false);
  assert.match(out.responseSha256, /^[a-f0-9]{64}$/);
});
test('read uses only the fixed metrics endpoint, no redirects or mutations', async () => {
  const out = await sample('fixture-key', async (url, init) => {
    assert.equal(url, ENDPOINT); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('service_role:fixture-key').toString('base64'));
    return new Response('node_load1 2.5\n');
  });
  assert.equal(out.series[0].value, 2.5);
  assert.equal(JSON.stringify(out).includes('fixture-key'), false);
});
test('credentials and request failures remain private, with no fallback', async () => {
  let calls = 0;
  const failing = async () => { calls++; throw new Error('private-secret'); };
  await assert.rejects(sample('', failing), /^Error: credential_unavailable$/);
  assert.equal(calls, 0);
  await assert.rejects(sample('fixture', failing), /^Error: metrics_request_failed$/);
  assert.equal(calls, 1);
  await assert.rejects(sample('fixture', async () => new Response('private body', { status: 503 })), /^Error: metrics_http_503$/);
});
test('unrecognized and oversized responses cannot produce a proof', async () => {
  assert.throws(() => summarizeMetrics('private_metric 1'), /recognized_metrics_unavailable/);
  await assert.rejects(sample('fixture', async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))), /metrics_body_limit/);
});
