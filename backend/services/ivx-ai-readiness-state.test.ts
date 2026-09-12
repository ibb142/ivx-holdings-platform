import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkAIHealth } from './ivx-owner-ai-task-queue';
import { initProviderStateMachine, markAIUnavailable, markFallbackReady, markProviderFailed, markProviderReady, resetProviderStateMachine } from './ivx-provider-state-machine';
import { probeGatewayCompletion } from './ivx-ai-completion-probe';
import { createBudgetedFetch } from './ivx-global-ai-budget-fetch';
import { GlobalAIBudgetError } from './ivx-global-ai-budget';

describe('AI readiness requires a successful provider observation', () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    env = { ...process.env };
    // Deliberately invalid local fixture; these state checks never call a provider.
    process.env.IVX_OPENAI_API_KEY = 'sk-local-readiness-test';
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

  test('a refused local budget admission cannot claim the provider needs credit', async () => {
    let providerCalls = 0;
    const budgeted = createBudgetedFetch((async () => { providerCalls++; throw new Error('provider must not be contacted'); }) as typeof fetch,
      { enabled: () => true, reserve: async () => { throw new GlobalAIBudgetError('reservation RPC unavailable'); } });
    const result = await probeGatewayCompletion({ url: 'https://ai-gateway.vercel.sh/v1/chat/completions',
      apiKey: 'synthetic-budget-probe', model: 'openai/gpt-4o', provider: 'vercel_ai_gateway', fetchImpl: budgeted, timeoutMs: 500 });
    expect(providerCalls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AI_GLOBAL_BUDGET_BLOCKED');
    const health = checkAIHealth();
    expect(health.ok).toBe(false);
    expect(health.detail.code).toBe('AI_GLOBAL_BUDGET_BLOCKED');
    expect(health.detail.ownerActionRequired).toContain('global AI budget');
    expect(health.detail.ownerActionRequired).not.toContain('balance');
  });
});
