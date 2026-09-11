import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkAIHealth } from './ivx-owner-ai-task-queue';
import { initProviderStateMachine, markAIUnavailable, markFallbackReady, markProviderFailed, markProviderReady, resetProviderStateMachine } from './ivx-provider-state-machine';

describe('AI readiness requires a successful provider observation', () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    env = { ...process.env };
    process.env.IVX_OPENAI_API_KEY = 'sk-test-placeholder';
    resetProviderStateMachine();
    initProviderStateMachine('openai', 'gpt-4o', true, true);
  });
  afterEach(() => { process.env = env; resetProviderStateMachine(); });

  test('configured credentials do not prove startup or half-open validation', () => {
    const health = checkAIHealth();
    expect(health.detail.startupOk).toBe(true);
    expect(health.detail.providerState).toBe('PROVIDER_VALIDATING');
    expect(health.ok).toBe(false);
    expect(health.detail.code).toBe('AI_VALIDATION_PENDING');
  });

  test('failed primary is unavailable until an approved fallback succeeds', () => {
    markProviderFailed(401, 'test rejected credential', 'qa-primary');
    expect(checkAIHealth().ok).toBe(false);
    markFallbackReady('approved-test-fallback', 'test-model');
    expect(checkAIHealth().ok).toBe(true);
    expect(checkAIHealth().detail.providerState).toBe('FALLBACK_READY');
  });

  test('a successful request permits readiness; a later failure revokes it', () => {
    markProviderReady('openai', 'gpt-4o');
    expect(checkAIHealth().ok).toBe(true);
    markAIUnavailable('qa-outage', 'test provider outage');
    expect(checkAIHealth().ok).toBe(false);
  });

  test('a billing response requires credits rather than credential rotation', () => {
    markProviderFailed(402, 'A positive credit balance is required', 'qa-balance');
    markAIUnavailable('qa-balance', 'A positive credit balance is required');
    const health = checkAIHealth();
    expect(health.ok).toBe(false);
    expect(health.detail.code).toBe('AI_CREDITS_REQUIRED');
    expect(health.detail.ownerActionRequired).toContain('balance');
    expect(health.detail.ownerActionRequired).not.toContain('generate a new');
  });

  test('an unavailable billing error without a recorded HTTP status is still explicit', () => {
    markAIUnavailable('qa-balance', 'A positive credit balance is required');
    expect(checkAIHealth().detail.code).toBe('AI_CREDITS_REQUIRED');
    expect(checkAIHealth().ok).toBe(false);
  });
});
