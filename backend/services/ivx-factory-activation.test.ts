import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as notifications from './ivx-autonomous-sms-notifier';
import { runFactoryActivation, getFactoryActivationStatus } from './ivx-factory-activation';
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let alert: ReturnType<typeof spyOn<typeof notifications, 'sendOwnerAlertSms'>>;
beforeEach(() => {
  alert = spyOn(notifications, 'sendOwnerAlertSms').mockResolvedValue({
    ok: false, status: 'missing_config', missingEnvNames: [], sentAt: '2026-01-01T00:00:00Z',
  });
});
afterEach(() => { alert.mockRestore(); globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

function transport(roster: unknown, status = 200) {
  const writes: Array<{ url: string; body: string }> = [];
  process.env.IVX_SUPABASE_URL = 'https://factory-fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH') { writes.push({ url, body: String(init.body) }); return new Response(null, { status: 204 }); }
    return Response.json(url.includes('/ivx_ia_agents?') ? [] : roster, { status });
  }) as typeof fetch;
  return writes;
}

test('a named factory agent with a stored PASSED flag cannot manufacture activation evidence', async () => {
  const writes = transport([{ factory_agent_id: 'AF-001', name: 'Fixture Developer', kind: 'AGENT', version: 1,
    qa_status: 'PASSED', activation_status: 'PENDING_OWNER_APPROVAL', created_by: 'fixture' }]);
  const report = await runFactoryActivation();
  expect(report.verified).toBe(0);
  expect(report.activated).toBe(0);
  expect(report.blocked).toBe(1);
  expect(report.results[0].toolsUsed).toEqual([]);
  expect(report.results[0].realTask).toContain('NOT EXECUTED');
  expect(writes.some(w => w.url.includes('/ivx_ia_factory_agents?'))).toBe(false);
  expect(writes.some(w => w.body.includes('"VERIFIED"') || w.body.includes('"ACTIVE"'))).toBe(false);
});

test('roster read failures do not produce a successful empty factory', async () => {
  const writes = transport({ error: 'unavailable' }, 503);
  await expect(runFactoryActivation()).rejects.toThrow('FACTORY_ROSTER_UNAVAILABLE');
  await expect(getFactoryActivationStatus()).rejects.toThrow('FACTORY_ROSTER_UNAVAILABLE');
  expect(writes).toEqual([]);
});

test('malformed successful roster responses remain unavailable', async () => {
  const writes = transport({ unexpected: 'object' });
  await expect(runFactoryActivation()).rejects.toThrow('FACTORY_ROSTER_INVALID_RESPONSE');
  expect(writes).toEqual([]);
});
