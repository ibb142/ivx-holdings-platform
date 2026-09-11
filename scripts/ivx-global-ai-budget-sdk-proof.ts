import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateText } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { createBudgetedFetch } from '../backend/services/ivx-global-ai-budget-fetch';
import { GlobalAIBudgetError, quoteCatalogModel } from '../backend/services/ivx-global-ai-budget';

// Installed SDK, isolated HTTP transport. This never connects to a provider.
let mode: 'deny' | 'allow' = 'deny', admissions = 0, nativeCalls = 0, settlements = 0;
const fixture = { data: [{ id: 'openai/fixture', type: 'language', context_window: 100, max_tokens: 20,
  modalities: { output: ['text'] }, pricing: { input: '0.000001', output: '0.000002' } }] };
const transport = createBudgetedFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  assert.equal(new URL(request.url).pathname, '/v4/ai/language-model');
  nativeCalls++;
  return Response.json({ content: [{ type: 'text', text: 'bounded fixture' }],
    finishReason: { unified: 'stop', raw: 'stop' }, warnings: [],
    usage: { inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 3, text: 3, reasoning: 0 } } });
}) as typeof fetch, { enabled: () => true, reserve: async (model, hash) => {
  admissions++;
  assert.equal(model, 'openai/fixture'); assert.match(hash, /^[a-f0-9]{64}$/);
  if (mode === 'deny') throw new GlobalAIBudgetError('global_daily_budget_exceeded');
  return { quote: quoteCatalogModel(fixture, model, Date.now(), 'a'.repeat(64)), finish: async usage => {
    assert.deepEqual(usage, { inputTokens: 2, outputTokens: 3 }); settlements++;
  } };
} });
const gateway = createGateway({ apiKey: 'vck_isolated_fixture', fetch: transport });
const invoke = () => generateText({ model: gateway('openai/fixture'), prompt: 'fixture', maxOutputTokens: 4, maxRetries: 4 });
await assert.rejects(invoke, (error: unknown) => {
  assert.equal((error as { statusCode?: number }).statusCode, 402); return true;
});
assert.equal(admissions, 1, 'budget rejection must not enter the SDK retry loop');
assert.equal(nativeCalls, 0, 'a refused admission cannot reach the provider transport');
mode = 'allow';
assert.equal((await invoke()).text, 'bounded fixture');
assert.equal(nativeCalls, 1); assert.equal(settlements, 1);
const proof = { verification: 'PASS', sourceSha: process.env.GITHUB_SHA ?? null,
  sdk: 'installed_ai_sdk', localTransportResponses: nativeCalls, realProviderCalls: 0,
  refusedAdmissionNativeCalls: 0, refusedAdmissionAttempts: 1, admittedCompletionSettled: true,
  observedAt: new Date().toISOString() };
await mkdir('qa/evidence/fleet-ha', { recursive: true });
await writeFile('qa/evidence/fleet-ha/global-ai-budget-sdk.json', JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof));
