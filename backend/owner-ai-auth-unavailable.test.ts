import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownerAIAuthUnavailableResponse } from './api/owner-ai-auth-unavailable';

test('identity provider outage returns retryable 503 without an assistant answer', async () => {
  const error = new Error('IVX owner verification is temporarily unavailable. Please retry.');
  error.name = 'IVXAuthServiceUnavailableError';
  const response = ownerAIAuthUnavailableResponse(error);
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '5');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, { error: error.message, code: 'AUTH_SERVICE_UNAVAILABLE', retryable: true });
  assert.equal('answer' in body, false);
});

test('invalid credentials and unrelated failures retain their existing handling', () => {
  for (const error of [new Error('invalid or expired Supabase session'), new Error('provider timeout'), null, {}]) {
    assert.equal(ownerAIAuthUnavailableResponse(error), null);
  }
});
