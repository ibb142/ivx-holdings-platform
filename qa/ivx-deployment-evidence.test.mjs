import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDeploymentEvidence, PHASE1_ITEMS } from './ivx-deployment-evidence.mjs';

const env = { GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123' };
const ready = { ok: true, checks: Object.fromEntries(['database', 'auth', 'queue', 'ai'].map(k => [k, { ok: true }])) };
const response = (url, overrides = {}) => Response.json(url.endsWith('/health/ready') ? { ...ready, ...overrides } : { ok: true, commit: env.GITHUB_SHA, ...overrides });

test('healthy exact-SHA probes are partial evidence and cannot certify any phase', async () => {
  const report = await collectDeploymentEvidence({ env, fetchImpl: async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(new URL(url).origin, 'https://api.ivxholding.com');
    return response(url);
  } });
  assert.equal(report.probeGatePassed, true);
  assert.equal(report.certified, false);
  assert.equal(report.certificationStatus, 'NOT_CERTIFIED');
  assert.equal(PHASE1_ITEMS.length, 28); assert.equal(new Set(PHASE1_ITEMS).size, 28);
  assert(report.phase1Checklist.every(c => c.result === 'NOT_CERTIFIED'));
  assert(Object.values(report.phases).every(v => v === 'NOT_CERTIFIED'));
  assert(!('hardGates' in report));
});

test('liveness with unknown or failed Auth, DB, queue or AI cannot pass readiness', async () => {
  for (const component of ['auth', 'database', 'queue', 'ai']) {
    for (const value of [undefined, { ok: false }]) {
      const checks = { ...ready.checks, [component]: value };
      const report = await collectDeploymentEvidence({ env, fetchImpl: async url => response(url, url.endsWith('/health/ready') ? { checks } : {}) });
      assert.equal(report.observations.apiExactSha, true);
      assert.equal(report.probeGatePassed, false);
    }
  }
});

test('mismatched versions, malformed JSON and a body that never completes fail closed', async () => {
  for (const failed of [() => response('/version', { commit: 'b'.repeat(40) }),
    () => new Response('not-json'), () => ({ status: 200, json: () => new Promise(() => {}) })]) {
    const report = await collectDeploymentEvidence({ env, timeoutMs: 10, fetchImpl: async url => url.endsWith('/version') ? failed() : response(url) });
    assert.equal(report.probeGatePassed, false); assert.equal(report.certified, false);
  }
});

test('transient errors are redacted and old probes cannot be reused as fresh evidence', async () => {
  const report = await collectDeploymentEvidence({ env, fetchImpl: async url => {
    if (url.endsWith('/health')) throw Error('sensitive-response-detail');
    return response(url);
  } });
  assert.equal(report.observations.health.status, 0);
  assert.equal(report.probeGatePassed, false);
  assert(!JSON.stringify(report).includes('sensitive-response-detail'));
});
