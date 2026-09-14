import { expect, mock, test } from 'bun:test';
import { createBudgetedFetch } from './ivx-global-ai-budget-fetch';

const rows = new Map<string, { status: string; worker: string; amount: string }>();
const finishes: Record<string, unknown>[] = [];
let mode: 'lost-ack' | 'denied' = 'lost-ack';
mock.module('./ivx-postgres-autonomous-task-store', () => ({
  autonomousWorkerInstanceId: () => 'isolated-admission-test-process',
  globalAIBudgetRpc: async (name: string, value: Record<string, unknown>) => {
    if (name === 'ivx_ai_budget_reserve') {
      if (mode === 'denied') return { allowed: false, reason: 'global_capacity_exceeded' };
      rows.set(String(value.p_reservation_id), {
        status: 'reserved', worker: String(value.p_worker_instance_id), amount: String(value.p_reserved_nano),
      });
      throw new Error('Database committed admission; acknowledgement was lost');
    }
    if (name !== 'ivx_ai_budget_finish') throw new Error('Unexpected RPC');
    finishes.push(value);
    const row = rows.get(String(value.p_reservation_id));
    if (!row || row.worker !== value.p_worker_instance_id) throw new Error('Reservation identity mismatch');
    expect(value.p_status).toBe('cancelled');
    expect(value.p_settled_upper_nano).toBe('0');
    expect(value.p_generation_id).toBeNull();
    row.status = 'cancelled';
    return { ok: true };
  },
}));

const catalog = { data: [{ id: 'openai/fixture', type: 'language', context_window: 100,
  max_tokens: 20, modalities: { output: ['text'] }, pricing: { input: '0.000001', output: '0.000002' } }] };
const request = () => new Request('https://ai-gateway.vercel.sh/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'openai/fixture', messages: [{ role: 'user', content: 'fixture' }] }),
});

test('lost admission acknowledgement closes the unstarted reservation without sending inference', async () => {
  rows.clear(); finishes.length = 0; mode = 'lost-ack';
  let providerCalls = 0;
  const guarded = createBudgetedFetch((async input => {
    if (String(input) === 'https://ai-gateway.vercel.sh/v1/models') return Response.json(catalog);
    providerCalls += 1;
    throw new Error('An unconfirmed admission must not contact the provider');
  }) as typeof fetch, { enabled: () => true });
  const response = await guarded(request());
  expect(response.status).toBe(402);
  expect(providerCalls).toBe(0);
  expect(rows.size).toBe(1);
  expect(finishes).toHaveLength(1);
  expect([...rows.values()][0]!.status).toBe('cancelled');
  expect((await response.json()).error.code).toBe('IVX_GLOBAL_AI_BUDGET_BLOCKED');
});

test('an explicit capacity rejection does not cancel another reservation or call the provider', async () => {
  rows.clear(); finishes.length = 0; mode = 'denied';
  let providerCalls = 0;
  const guarded = createBudgetedFetch((async input => {
    if (String(input) === 'https://ai-gateway.vercel.sh/v1/models') return Response.json(catalog);
    providerCalls += 1;
    throw new Error('Provider must remain behind admission');
  }) as typeof fetch, { enabled: () => true });
  const response = await guarded(request());
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('2');
  expect(rows.size).toBe(0);
  expect(finishes).toHaveLength(0);
  expect(providerCalls).toBe(0);
});
