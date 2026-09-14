import { expect, test } from 'bun:test';
import { ownerTextFailure, readOwnerBudgetFailureReason } from './ivx-owner-text-failure';

test('local and SDK-wrapped admission errors retain a safe actionable diagnosis', () => {
  const message = 'Global AI budget: durable admission unavailable';
  for (const error of [new Error(message), { cause: new Error(message) }, {
    responseBody: JSON.stringify({ error: { code: 'IVX_GLOBAL_AI_BUDGET_BLOCKED', message } }),
  }]) expect(ownerTextFailure(error)).toMatchObject({ httpStatus: 503,
    code: 'IVX_AI_BUDGET_ADMISSION_UNAVAILABLE', error: message, providerRequestState: 'not_started' });
});

test('the legacy screenshot receipt is recognized without exposing its router metadata', () => {
  const reason = 'LLM call failed for knowledge question (conversation). No deploy, no commit, no task creation. Error: Global AI budget: durable admission unavailable';
  expect(readOwnerBudgetFailureReason(reason)).toBe('durable admission unavailable');
  expect(ownerTextFailure(reason).answer).not.toContain('No deploy');
});

test('capacity and monetary policy retain different HTTP outcomes', () => {
  expect(ownerTextFailure(new Error('Global AI budget: global_capacity_exceeded')).httpStatus).toBe(429);
  expect(ownerTextFailure(new Error('Global AI budget: global_daily_budget_exceeded')).httpStatus).toBe(402);
  expect(ownerTextFailure(new Error('Global AI budget: budget_not_activated')).httpStatus).toBe(402);
});

test('unknown, malformed and cyclic errors cannot leak secrets or claim the provider never started', () => {
  const cyclic: Record<string, unknown> = {}; cyclic.cause = cyclic;
  for (const error of [new Error('postgres://secret:private@host/db'), null, cyclic,
    { responseBody: 'not-json' }, { message: 'Global AI budget: durable admission unavailable secret' }]) {
    const result = ownerTextFailure(error);
    expect(result.code).toBe('OWNER_TEXT_REPLY_FAILED'); expect(result.providerRequestState).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('secret');
  }
});
