import { afterAll, afterEach, expect, mock, spyOn, test } from 'bun:test';

let mode = 'uninitialized';
const persistence = await import('./ivx-agent-persistence');
const postgres = await import('./ivx-postgres-autonomous-task-store');
const directSpy = spyOn(postgres, 'preferDirectTransport').mockReturnValue(false);
const modeSpy = spyOn(persistence, 'activeStoreMode').mockImplementation(() => mode as ReturnType<typeof persistence.activeStoreMode>);
const bindingSpy = spyOn(persistence, 'resolveSupabaseBinding').mockImplementation(() => ({
  url: 'https://ledger.example.test', key: 'fixture-service-key', missing: [],
  urlBinding: 'SUPABASE_URL', keyBinding: 'SUPABASE_SERVICE_ROLE_KEY',
}));
afterAll(() => { modeSpy.mockRestore(); bindingSpy.mockRestore(); directSpy.mockRestore(); });
const { readAgentDashboardLedger } = await import('./ivx-agent-dashboard-ledger');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; mode = 'uninitialized'; directSpy.mockReturnValue(false); });
const states = Array.from({ length: 112 }, (_, i) => ({ agent_number: i + 1, agent_id: `agent-${i + 1}` }));
const execution = { task_id: 'task-1', agent_id: 'agent-1', output: { testsPassed: true }, evidence: { commitSha: 'a'.repeat(40) } };

test('keeps real execution proof and reads the state/primary ledger once', async () => {
  const paths: string[] = [];
  globalThis.fetch = mock(async input => {
    const path = new URL(String(input)).pathname; paths.push(path);
    return Response.json(path.endsWith('ivx_agent_states') ? states : [execution]);
  }) as typeof fetch;
  const result = await readAgentDashboardLedger(2000);
  expect(result.ok).toBe(true);
  expect(result.states).toHaveLength(112);
  expect(result.executions[0]?.output).toEqual(execution.output);
  expect(result.executions[0]?.evidence).toEqual(execution.evidence);
  expect(paths).toHaveLength(2);
});

test.each(['timeout', 'invalid_json', 'wrong_shape'])('%s fails closed without switching or repeating history stores', async failure => {
  const paths: string[] = [];
  globalThis.fetch = mock(async input => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path.endsWith('ivx_agent_states')) return Response.json(states);
    if (failure === 'timeout') throw new DOMException('Read expired', 'TimeoutError');
    return failure === 'invalid_json' ? new Response('invalid json') : Response.json({ error: 'wrong shape' });
  }) as typeof fetch;
  const result = await readAgentDashboardLedger();
  expect(result.ok).toBe(false);
  expect(result.executions).toEqual([]);
  expect(result.error).toBeTruthy();
  expect(paths).toHaveLength(2);
  expect(paths.some(path => path.endsWith('ivx_agent_jobs'))).toBe(false);
});

test.each([false, true])('only a missing persistence table probes its alternative (fallback first: %s)', async fallbackFirst => {
  mode = fallbackFirst ? 'jobs_fallback' : 'uninitialized';
  const paths: string[] = [];
  globalThis.fetch = mock(async input => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path.endsWith('ivx_agent_states')) return Response.json(states);
    const jobs = path.endsWith('ivx_agent_jobs');
    if (jobs === fallbackFirst) return Response.json({ code: 'PGRST205' }, { status: 404 });
    return Response.json(jobs ? [{ payload: execution }] : [execution]);
  }) as typeof fetch;
  const result = await readAgentDashboardLedger();
  expect(result.ok).toBe(true);
  expect(result.mode).toBe(fallbackFirst ? 'dedicated' : 'jobs_fallback');
  expect(result.executions[0]?.task_id).toBe('task-1');
  expect(paths).toHaveLength(3);
  expect(new Set(paths).size).toBe(3);
});

test.each(['ok', 'timeout', '42P01', '42501', 'invalid'])('direct ledger preserves evidence and fails closed: %s', async scenario => {
  directSpy.mockReturnValue(true);
  const calls: string[] = [];
  const readSpy = spyOn(postgres, 'readPostgresAgentDashboardRows').mockImplementation(async (kind) => {
    calls.push(kind);
    if (kind === 'states') return states;
    if (kind === 'jobs') return [{ payload: execution }];
    if (scenario === 'invalid') return {} as unknown as unknown[];
    if (scenario !== 'ok') throw Object.assign(new Error('private connection detail'), { code: scenario });
    return [execution];
  });
  const rest = mock(async () => { throw new Error('REST transport must not replay a direct read'); });
  globalThis.fetch = rest as unknown as typeof fetch;
  try {
    const result = await readAgentDashboardLedger(2000);
    expect(rest).not.toHaveBeenCalled();
    expect(result.ok).toBe(scenario === 'ok' || scenario === '42P01');
    expect(calls).toEqual(scenario === '42P01' ? ['states', 'executions', 'jobs'] : ['states', 'executions']);
    if (result.ok) {
      expect(result.states).toHaveLength(112);
      expect(result.executions[0]?.evidence).toEqual(execution.evidence);
      expect(result.executions[0]?.output).toEqual(execution.output);
    } else {
      expect(result.executions).toEqual([]);
      expect(result.error).not.toContain('private connection detail');
    }
  } finally { readSpy.mockRestore(); }
});
