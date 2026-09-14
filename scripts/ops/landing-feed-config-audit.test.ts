import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { auditFeedEnvironment, auditRenderFeedConfig } from './landing-feed-config-audit';

test('diagnostics use the real configuration validators without leaking values', () => {
  const env = { SUPABASE_URL: 'https://fixtureproject.supabase.co',
    SUPABASE_DB_URL: 'postgresql://postgres:private-password@db.fixtureproject.supabase.co/postgres', NODE_ENV: 'production' };
  const healthy = auditFeedEnvironment(env);
  assert.equal(healthy.projectBinding, 'valid');
  assert.equal(healthy.poolBudget, 'valid');
  assert.equal(healthy.restUrls.SUPABASE_URL, 'valid_supabase_url');
  assert.equal(healthy.restUrls.EXPO_PUBLIC_SUPABASE_URL, 'missing');
  const malformed = auditFeedEnvironment({ SUPABASE_URL: 'private-invalid-url', SUPABASE_DB_URL: 'private-invalid-database' });
  assert.equal(malformed.restUrls.SUPABASE_URL, 'invalid_url');
  assert.equal(malformed.databaseUrls.SUPABASE_DB_URL, 'malformed_uri');
  assert.doesNotMatch(JSON.stringify(malformed), /private-invalid/);
  assert.equal(auditFeedEnvironment({ ...env, SUPABASE_URL: 'invalid' }).projectBinding, 'invalid_url');
  assert.equal(auditFeedEnvironment({ ...env, SUPABASE_URL: 'https://otherproject.supabase.co' }).projectBinding, 'project_mismatch');
  assert.equal(auditFeedEnvironment({ ...env, IVX_PG_API_MAX_CONNECTIONS: '100' }).poolBudget, 'budget_exceeded');
  assert.equal(auditFeedEnvironment({ ...env, IVX_PG_API_MAX_CONNECTIONS: 'secret-string' }).poolBudget, 'invalid_limit');
  assert.doesNotMatch(JSON.stringify(healthy), /private-password|fixtureproject|postgresql/);
});

test('audit rejects wrong services before reading their environment', async () => {
  let requests = 0;
  await assert.rejects(auditRenderFeedConfig((async () => { requests++; return Response.json({ ownerId: 'other' }); }) as typeof fetch, 'fixture-token'), /identity_mismatch/);
  assert.equal(requests, 1);
});

test('audit performs GET reads and returns no environment or credentials', async () => {
  const requests: string[] = [];
  const result = await auditRenderFeedConfig((async (url: string, init: RequestInit) => {
    requests.push(String(url));
    assert.equal(init.method, undefined);
    if (String(url).includes('/env-vars')) return Response.json([{ envVar: { key: 'UNRELATED_SECRET', value: 'private-value' } }]);
    return Response.json({ ownerId: 'tea-d7plj9beo5us73ch3ukg', repo: 'https://github.com/ibb142/ivx-holdings-platform' });
  }) as typeof fetch, 'fixture-token');
  assert.equal(requests.length, 4);
  assert.equal(result.readOnly, true);
  assert.doesNotMatch(JSON.stringify(result), /private-value|fixture-token|UNRELATED_SECRET/);
});
