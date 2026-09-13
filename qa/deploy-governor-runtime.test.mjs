import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyGovernorRuntime } from './deploy-governor-runtime.mjs';
const sha = 'a'.repeat(40);
const options = { targetSha: sha, apiBase: 'https://example.test', runId: '123-1' };
function transport(patch = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    const path = new URL(url).pathname; calls.push({ path, init });
    if (patch[path] instanceof Error) throw patch[path];
    const body = patch[path] ?? (path === '/api/public/chat' ? { source: 'chatgpt', endpoint: 'provider', answer: 'IVX-LIVE-123-1-1' } : { ok: true, commit: sha });
    return new Response(JSON.stringify(body), { status: 200 });
  } };
}
test('a real inference response and both matching health SHAs are required', async () => {
  const f = transport(); const report = await verifyGovernorRuntime({ ...options, fetchImpl: f.fetchImpl });
  assert.equal(report.gate, 'PASS'); assert.equal(report.certified, false); assert.equal(f.calls.length, 4); assert.ok(f.calls.every(c => c.init.signal instanceof AbortSignal));
});
test('SHA mismatch remains a failure and does not spend an inference request', async () => {
  const f = transport({ '/version': { ok: true, commit: 'b'.repeat(40) } });
  const report = await verifyGovernorRuntime({ ...options, fetchImpl: f.fetchImpl }); assert.equal(report.gate, 'FAIL'); assert.equal(report.checks.at(-1).name, 'version'); assert.equal(f.calls.length, 2);
});
test('provider failure identifies the actual stage after successful deployment parity', async () => {
  const f = transport({ '/health/ai/live': { ok: false, privateDetail: 'PRIVATE' } });
  const report = await verifyGovernorRuntime({ ...options, fetchImpl: f.fetchImpl }); assert.equal(report.gate, 'FAIL'); assert.equal(report.checks.at(-1).name, 'ai_provider'); assert.equal(report.checks.at(-1).errorType, 'ASSERTION_FAILED'); assert.ok(!JSON.stringify(report).includes('PRIVATE'));
});
test('an inference timeout stays failed and is not retried', async () => {
  const f = transport({ '/api/public/chat': new DOMException('private', 'TimeoutError') });
  const report = await verifyGovernorRuntime({ ...options, fetchImpl: f.fetchImpl }); assert.equal(report.gate, 'FAIL'); assert.equal(report.checks.at(-1).errorType, 'TIMEOUT'); assert.equal(f.calls.filter(c => c.path === '/api/public/chat').length, 1);
});
