import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDependencies, PROJECT } from './phase1-dependency-audit.mjs';

const env = { PROJECT_REF: PROJECT, SUPABASE_ACCESS_TOKEN: 'management-test-secret', SUPABASE_SERVICE_ROLE_KEY: 'service-test-secret', GITHUB_SHA: 'a'.repeat(40) };
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
function healthy(url) {
  if (url.endsWith('/billing/addons')) return json({ selected_addons: [{ type: 'compute_instance', variant: { id: 'ci_nano', name: 'Nano' } }] });
  if (url.includes('/health?services')) return json([{ name: 'db', healthy: true, status: 'ACTIVE_HEALTHY' }]);
  if (url.includes('/rest/v1/')) return json([{ doc_key: 'private-audit-key' }]);
  if (url.includes('/auth/')) return json({ name: 'GoTrue', secret: 'private-row' });
  if (url.endsWith('/health/ready')) return json({ ok: true, checks: { database: { ok: true }, queue: { ok: true }, ai: { providerState: 'PROVIDER_READY' } } });
  if (url.endsWith('/api/reels')) return json({ videos: [{ id: 'private-row' }] });
  if (url.endsWith('/api/landing-deals')) return json({ deals: [{ owner: 'private-row' }] });
  return json({ id: PROJECT, status: 'ACTIVE_HEALTHY', secret: 'private-row' });
}

test('audit is fixed-target GET only and keeps credentials and rows out of its report', async () => {
  const report = await auditDependencies({ env, fetchImpl: async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    if (new URL(url).hostname === 'api.ivxholding.com') assert.deepEqual(init.headers, {});
    return healthy(url);
  } });
  assert.equal(report.ready, true); assert.equal(report.compute.selected[0].id, 'ci_nano');
  for (const secret of [env.SUPABASE_ACCESS_TOKEN, env.SUPABASE_SERVICE_ROLE_KEY, 'private-row', 'private-audit-key']) assert(!JSON.stringify(report).includes(secret));
});

test('management authentication failure stops privileged management follow-ups', async () => {
  const seen = [];
  const report = await auditDependencies({ env, fetchImpl: async url => { seen.push(url); return url.startsWith('https://api.supabase.com') ? new Response('secret error detail', { status: 401 }) : healthy(url); } });
  assert.equal(report.management.status, 401);
  assert.equal(seen.filter(u => u.startsWith('https://api.supabase.com')).length, 1);
  assert(!JSON.stringify(report).includes('secret error detail'));
});

test('missing credentials cannot claim dependency readiness', async () => {
  const report = await auditDependencies({ env: {}, fetchImpl: async url => { assert(url.startsWith('https://api.ivxholding.com')); return healthy(url); } });
  assert.equal(report.ready, false);
});

test('an unhealthy or malformed data plane does not receive PASS', async () => {
  for (const failure of [() => new Response('private failure', { status: 503 }), () => json({ error: 'private failure' }), () => { throw Error('secret timeout'); }]) {
    const report = await auditDependencies({ env, fetchImpl: async url => url.includes('/rest/v1/') ? failure() : healthy(url) });
    assert.equal(report.ready, false); assert(!JSON.stringify(report).includes('private failure')); assert(!JSON.stringify(report).includes('secret timeout'));
  }
});

test('an unexpected project is rejected before any request', async () => {
  await assert.rejects(auditDependencies({ env: { ...env, PROJECT_REF: 'other' }, fetchImpl: async () => { assert.fail('must not request'); } }), /Unexpected project/);
});
