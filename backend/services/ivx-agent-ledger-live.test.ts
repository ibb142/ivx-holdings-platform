import { afterEach, expect, spyOn, test } from 'bun:test';
import type { Pool } from 'pg';
import * as pools from './ivx-database-pools';
import { readAgentLedgerLive } from './ivx-agent-ledger-live';
import { buildAgentLedgerLiveSnapshot, type LiveAgentRow } from './ivx-agent-ledger-live-snapshot';

const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => { while (mocks.length) mocks.pop()!.mockRestore(); });
const emptyRows = (): LiveAgentRow[] => Array.from({ length: 112 }, (_, index) => ({
  agent_number: index + 1, agent_id: null, agent_name: null, status: null,
  last_heartbeat: null, measured_at: '2026-09-13T20:00:00Z', heartbeat_state: 'MISSING_AGENT',
  running_task_id: null, task_heartbeat: null, lease_expires_at: null, active_work: false,
}));

test('overlapping readers share the telemetry query but receive independent snapshots', async () => {
  let resolve!: (value: { rows: LiveAgentRow[] }) => void;
  let calls = 0;
  const result = new Promise<{ rows: LiveAgentRow[] }>(done => { resolve = done; });
  const pool = { query: () => { calls++; return result; } } as unknown as Pool;
  const get = spyOn(pools, 'getObserverPool').mockReturnValue(pool); mocks.push(get);
  const first = readAgentLedgerLive(), second = readAgentLedgerLive();
  expect(calls).toBe(1); expect(get).toHaveBeenCalledWith(process.env, 'telemetry');
  resolve({ rows: emptyRows() });
  const [a, b] = await Promise.all([first, second]);
  expect(a.summary.registry_complete).toBe(false);
  a.matrix112.pop(); expect(b.matrix112).toHaveLength(112);
  await readAgentLedgerLive(); expect(calls).toBe(2);
});

test('pool setup and query failures clear the in-flight read without retrying', async () => {
  let calls = 0;
  const get = spyOn(pools, 'getObserverPool').mockImplementation(() => { throw new Error('setup failed'); }); mocks.push(get);
  await expect(readAgentLedgerLive()).rejects.toThrow('setup failed');
  get.mockReturnValue({ query: async () => { calls++; throw new Error('query failed'); } } as unknown as Pool);
  await expect(readAgentLedgerLive()).rejects.toThrow('query failed');
  expect(calls).toBe(1);
  get.mockReturnValue({ query: async () => ({ rows: emptyRows() }) } as unknown as Pool);
  expect((await readAgentLedgerLive()).summary.registered_count).toBe(0);
});

test('malformed, duplicate or mixed-time snapshots cannot return a complete fleet', () => {
  expect(() => buildAgentLedgerLiveSnapshot([])).toThrow();
  const duplicate = emptyRows(); duplicate[111].agent_number = 1;
  expect(() => buildAgentLedgerLiveSnapshot(duplicate)).toThrow();
  const identity = emptyRows(); identity[0].agent_id = 'other_company_1';
  expect(() => buildAgentLedgerLiveSnapshot(identity)).toThrow();
  const clock = emptyRows(); clock[111].measured_at = '2026-09-13T20:00:01Z';
  expect(() => buildAgentLedgerLiveSnapshot(clock)).toThrow();
});
