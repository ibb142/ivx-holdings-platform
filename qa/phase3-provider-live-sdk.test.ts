import { test, expect } from 'bun:test';
import { generateText } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { createBudgetedFetch } from '../backend/services/ivx-global-ai-budget-fetch';
import { GlobalAIBudgetError } from '../backend/services/ivx-global-ai-budget';
import { checkRefusal } from './phase3-provider-live-guards.mjs';

test('installed SDK retries shared capacity with Retry-After and never sends refused calls upstream', async () => {
  for (const reason of ['global_capacity_exceeded', 'reservation_already_exists']) {
    const stats = { admissions: 0, gatewayAttempts: 0, lastAdmissionReason: '',
      httpStatus: null as number | null, lastErrorStatusCode: null as number | null,
      admissionResponses: [] as { httpStatus: number; retryAfter: string | null; at: number }[] };
    const transport = createBudgetedFetch((async () => {
      stats.gatewayAttempts++;
      throw new Error('UNEXPECTED_PROVIDER_CALL');
    }) as typeof fetch, { enabled: () => true, reserve: async () => {
      stats.admissions++; stats.lastAdmissionReason = reason;
      throw new GlobalAIBudgetError(reason);
    } });
    const gateway = createGateway({ apiKey: 'vck_isolated_fixture', fetch: async (resource, init) => {
      const response = await transport(resource, init);
      stats.admissionResponses.push({ httpStatus: response.status, retryAfter: response.headers.get('retry-after'), at: Date.now() });
      return response;
    } });
    try {
      await generateText({ model: gateway('openai/gpt-4o-mini'), prompt: 'fixture', maxOutputTokens: 4, maxRetries: 2 });
      throw new Error('EXPECTED_REFUSAL');
    } catch (error) {
      const value = error as { statusCode?: number; lastError?: { statusCode?: number } };
      stats.httpStatus = value.statusCode ?? null;
      stats.lastErrorStatusCode = value.lastError?.statusCode ?? null;
    }
    checkRefusal(stats, reason);
    expect(stats.gatewayAttempts).toBe(0);
  }
}, 15_000);
