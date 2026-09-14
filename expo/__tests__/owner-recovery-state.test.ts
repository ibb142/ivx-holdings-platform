import { expect, test } from 'bun:test';
import { describeOwnerRecovery, ownerConnectionStatus, ownerFailureNextStep } from '../src/modules/ivx-owner-ai/services/ivxOwnerRecoveryState';

test('503 receipt exposes the cause and does not promise recovery, retry or cancellation', () => {
  const message = describeOwnerRecovery({ ok: false, taskId: 'owner-request:message-1', status: 'FAILED',
    answer: null, error: 'Provider unavailable', errorCode: 'PROVIDER_UNAVAILABLE', httpStatus: 503 });
  expect(message).toContain('original request ended with an error');
  expect(message).toContain('Provider unavailable'); expect(message).toContain('HTTP: 503');
  expect(message).not.toContain('retry or cancel'); expect(message).not.toContain('preserved server-side');
});

test('unknown transport outcome is not presented as a completed failure or a successful repair', () => {
  const message = describeOwnerRecovery({ ok: false, taskId: 'owner-request:1', status: 'RUNNING', answer: null, error: null });
  expect(message).toContain('not confirmed yet'); expect(message).toContain('before repeating the action');
});

test('a recovered answer is kept verbatim for stable receipt and history deduplication', () => {
  expect(describeOwnerRecovery({ ok: true, taskId: 'owner-request:1', status: 'COMPLETED', answer: 'The original answer.', error: null }))
    .toBe('The original answer.');
});

test('composer distinguishes unavailable, unverified and reachable state', () => {
  expect(ownerConnectionStatus(false)).toContain('unavailable');
  expect(ownerConnectionStatus(null)).toContain('not yet verified');
  expect(ownerConnectionStatus(true)).toBe('Assistant ready.');
});

test('HTTP 503 alone is never diagnosed as Render cold start or an expired login', () => {
  expect(ownerFailureNextStep(503, 'response')).toContain('original result');
  expect(ownerFailureNextStep(503, 'response')).not.toContain('warming');
  expect(ownerFailureNextStep(503, 'auth')).toContain('original result');
  expect(ownerFailureNextStep(401, 'auth')).toContain('Auth Diagnostics');
});
