import { afterEach, expect, spyOn, test } from 'bun:test';
import { createBudgetedFetch } from './ivx-global-ai-budget-fetch';
import * as taskStore from './ivx-postgres-autonomous-task-store';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });

// Exercise denied admission for ordinary and streaming provider requests.
// Use the real pricing/reservation/fetch guard; replace only database I/O
// and the external pricing/provider transport with synthetic fixtures.
for (const stream of [false, true]) {
  for (const failure of ['statement_timeout', 'connection_timeout']) {
    test(`${stream ? 'SSE' : 'JSON'}: ${failure} blocks inference without releasing an unconfirmed reservation`, async () => {
      const rpc = spyOn(taskStore, 'globalAIBudgetRpc').mockRejectedValue(
        failure === 'statement_timeout'
          ? Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
          : new Error('Connection terminated due to connection timeout'),
      );
      spies.push(rpc);
      let providerCalls = 0;
      const nativeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.url === 'https://ai-gateway.vercel.sh/v1/models' && request.method === 'GET') {
          return Response.json({ data: [{
            id: 'openai/admission-outage-fixture', type: 'language',
            modalities: { output: ['text'] }, context_window: 128_000, max_tokens: 4096,
            pricing: { input: '0.000002', output: '0.000008' },
          }] });
        }
        providerCalls++;
        throw new Error('A blocked request must not contact the provider');
      }) as typeof fetch;
      const guarded = createBudgetedFetch(nativeFetch, { enabled: () => true });
      const response = await guarded('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/admission-outage-fixture', stream,
          messages: [{ role: 'user', content: 'Admission outage fixture' }] }),
      });

      expect(response.status).toBe(402);
      expect(await response.json()).toEqual({ error: {
        type: 'quota_for_entity_exceeded', code: 'IVX_GLOBAL_AI_BUDGET_BLOCKED',
        message: 'Global AI budget: durable admission unavailable',
      } });
      expect(providerCalls).toBe(0);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls[0]![0]).toBe('ivx_ai_budget_reserve');
      // In particular, no finish/cancel RPC follows an ambiguous admission.
      expect(response.headers.get('retry-after')).toBeNull();
    });
  }
}
