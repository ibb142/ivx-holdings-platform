import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect, summarizeConfig } from './inspect-feed-fleet-config.mjs';

test('configuration reports binding and presence without credentials or raw unknown values', () => {
  const summary = summarizeConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_DB_URL: 'postgres://postgres.fixture:private-password@aws-0-us-west-2.pooler.supabase.com:6543/postgres',
    SUPABASE_SERVICE_ROLE_KEY: 'private-service-key', APP_SECRET: 'private-app-key',
    IVX_PG_API_MAX_CONNECTIONS: '12', IVX_AUTONOMOUS_QUEUE_BACKEND: 'postgres_atomic',
    IVX_SUPABASE_RECOVERY_MODE: 'private-accidental-value' });
  assert.equal(summary.binding, 'valid');
  assert.equal(summary.target, 'supabase_pooler');
  assert.equal(summary.presence.APP_SECRET, true);
  assert.equal(summary.controls.IVX_SUPABASE_RECOVERY_MODE, 'unrecognized');
  assert.equal(JSON.stringify(summary).includes('private-'), false);
});

test('wrong project, non-Supabase database and malformed URLs are distinguished', () => {
  const env = { EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co' };
  assert.equal(summarizeConfig(env).binding, 'not_configured');
  assert.equal(summarizeConfig({ ...env, DATABASE_URL: 'postgres://postgres:private@db.other.supabase.co/postgres' }).binding, 'project_or_connection_mismatch');
  assert.equal(summarizeConfig({ ...env, DATABASE_URL: 'postgres://postgres:private@internal-render/postgres' }).target, 'other_database');
  assert.equal(summarizeConfig({ ...env, SUPABASE_DB_URL: 'private-invalid-url' }).binding, 'invalid_url');
});

test('inspection only sends GETs to the two configured IVX services and paginates', async () => {
  const calls = [];
  const summaries = await inspect({ token: 'private-render-token', fetchImpl: async (url, init) => {
    assert.equal(url.origin, 'https://api.render.com');
    assert.equal(init.method ?? 'GET', 'GET');
    assert.equal(init.headers.Authorization, 'Bearer private-render-token');
    calls.push(url.pathname);
    return Response.json(!url.searchParams.has('cursor')
      ? Array.from({ length: 100 }, (_, i) => ({ cursor: 'next', envVar: { key: `UNUSED_${i}`, value: 'private-unused-value' } }))
      : [{ envVar: { key: 'APP_SECRET', value: 'private-secret' } }]);
  } });
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls).size, 2);
  assert.ok(summaries.every(row => row.presence.APP_SECRET));
  assert.equal(JSON.stringify(summaries).includes('private-'), false);
});

test('HTTP and pagination failures never return a partial successful inspection', async () => {
  await assert.rejects(inspect({ token: 'private-token', fetchImpl: async () => new Response('private-error', { status: 403 }) }), /^Error: RENDER_CONFIG_HTTP_403$/);
  await assert.rejects(inspect({ token: 'private-token', fetchImpl: async () => Response.json(Array.from({ length: 100 }, () => ({ cursor: 'repeat' }))) }), /RENDER_CONFIG_PAGINATION_INCOMPLETE/);
});
