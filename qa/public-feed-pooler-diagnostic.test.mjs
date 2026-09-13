import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect, summarizePool, summarizeBinding, summarizeMetrics } from './public-feed-pooler-diagnostic.mjs';

const url = 'postgres://postgres.kvclcdjmjghndxsngfzb:PRIVATE_PASSWORD@aws-0-us-west-2.pooler.supabase.com:6543/postgres';

test('only selected nonsecret configuration fields can enter public diagnostics', () => {
  const result = summarizePool({ default_pool_size: 5, max_client_conn: 200, pool_mode: 'transaction',
    connection_string: url, password: 'PRIVATE_PASSWORD', db_pool: 'PRIVATE_PASSWORD' });
  assert.deepEqual(result, [{ default_pool_size: 5, max_client_conn: 200, pool_mode: 'transaction' }]);
});
test('binding checks validate the actual highest-priority URL without emitting its contents', () => {
  const result = summarizeBinding({ SUPABASE_DB_URL: url, DATABASE_URL: 'bad' });
  assert.equal(result.targetMatches, true); assert.equal(result.port, 6543);
  assert.equal(result.poolerRegionMatches, true); assert.equal(result.mode, 'transaction');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_PASSWORD'));
  assert.equal(summarizeBinding({ SUPABASE_DB_URL: url.replace('kvclcdjmjghndxsngfzb', 'different') }).targetMatches, false);
  assert.deepEqual(summarizeBinding({ SUPABASE_DB_URL: 'not a url PRIVATE_PASSWORD' }), { configured: true, validUrl: false });
});
test('inspection issues GETs only to the fixed provider scopes and returns no credentials', async () => {
  const calls = [];
  const evidence = await inspect({ env: { RENDER_API_KEY: 'PRIVATE_RENDER', SUPABASE_ACCESS_TOKEN: 'PRIVATE_MANAGEMENT' },
    fetchImpl: async (address, options) => {
      calls.push(address); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
      assert.ok(options.signal); assert.ok(!options.body);
      if (address.startsWith('https://api.render.com/')) return Response.json([{ envVar: { key: 'SUPABASE_DB_URL', value: url } },
        { envVar: { key: 'UNRELATED_SECRET', value: 'PRIVATE_UNRELATED' } }]);
      assert.ok(address.startsWith('https://api.supabase.com/v1/projects/kvclcdjmjghndxsngfzb/'));
      return Response.json({ default_pool_size: 5, password: 'PRIVATE_PASSWORD', connection_string: url });
    } });
  assert.equal(calls.length, 6); assert.ok(evidence.bindings.every(row => row.targetMatches));
  assert.ok(!JSON.stringify(evidence).includes('PRIVATE_'));
});
test('metrics retain numeric measurements and drop labels and arbitrary metric names', () => {
  assert.deepEqual(summarizeMetrics('node_load1{tenant="PRIVATE_TENANT"} 3.1\n'
    + 'node_cpu_seconds_total{cpu="0",mode="idle",host="PRIVATE_HOST"} 120\n'
    + 'node_cpu_seconds_total{cpu="1",mode="idle"} 130\n'
    + 'PRIVATE_METRIC 8\nnode_load5 NaN'), { node_load1: 3.1, cpu_seconds_idle: 250 });
});
test('provider failures remain explicit without serializing their response or exception', async () => {
  const evidence = await inspect({ env: { RENDER_API_KEY: 'PRIVATE_RENDER', SUPABASE_ACCESS_TOKEN: 'PRIVATE_MANAGEMENT' },
    fetchImpl: async address => {
      if (address.includes('api.render.com')) throw new Error('PRIVATE_PASSWORD');
      return new Response('PRIVATE_PASSWORD', { status: 401 });
    } });
  assert.ok(evidence.bindings.every(row => row.error === 'READ_UNAVAILABLE'));
  assert.ok(evidence.configuration.every(row => row.error === 'HTTP_401'));
  assert.ok(!JSON.stringify(evidence).includes('PRIVATE_'));
});
