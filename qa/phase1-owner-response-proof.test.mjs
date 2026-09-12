import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeOwnerResponse } from './phase1-owner-response-proof.mjs';
const encode = body => `data: ${JSON.stringify(body)}\n\n`;
const success = { type: 'final', status: 200, ok: true, body: { answer: 'maple_unique', model: 'gpt-4o', provider: 'chatgpt' } };
test('accepts the canonical final envelope used by the published client', () => {
  assert.equal(decodeOwnerResponse(encode({ type: 'heartbeat' }) + encode(success), 'maple_unique').valid, true);
});
test('partial deltas and an echoed request do not prove completion', () => {
  assert.equal(decodeOwnerResponse(encode({ type: 'delta', delta: 'maple_unique' }), 'maple_unique').valid, false);
});
test('a server failure cannot pass with a matching answer', () => {
  assert.equal(decodeOwnerResponse(encode({ ...success, status: 503, ok: false }), 'maple_unique').valid, false);
});
test('fallback and provider error cannot be certified', () => {
  for (const extra of [{ model: 'ivx_provider_error_fallback' }, { fallback: true }, { providerError: { code: 'timeout' } }])
    assert.equal(decodeOwnerResponse(encode({ ...success, body: { ...success.body, ...extra } }), 'maple_unique').valid, false);
});
test('an old or unrelated response cannot pass a fresh challenge', () => {
  assert.equal(decodeOwnerResponse(encode(success), 'maple_different').valid, false);
});
