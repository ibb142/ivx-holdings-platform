import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { ALL_AGENT_CONTRACTS } from '../services/ivx-agent-contracts';
import { IVXAuthServiceUnavailableError } from '../../expo/shared/ivx';
import { parseLiveFleetPayload } from '../../expo/shared/ivx/live-fleet-dashboard';
import type { FleetDashboardSignals } from '../../expo/shared/ivx/fleet-signals';

const previousSecret = process.env.IVX_AI_SYSTEM_SECRET;
process.env.IVX_AI_SYSTEM_SECRET = 'live-fleet-contract-key';
let now = Date.now();
const clock = spyOn(Date, 'now').mockImplementation(() => now);
let reads = 0;
let historyReads = 0;
let mode: 'available' | 'unavailable' | 'duplicate' | 'stale' = 'available';
mock.module('../services/ivx-agent-dashboard-ledger', () => ({
  IVX_AGENT_DASHBOARD_LEDGER_MARKER: 'history-must-not-load',
  readAgentDashboardLedger: async () => { historyReads++; throw new Error('History unavailable'); },
}));
mock.module('../services/ivx-fleet-dashboard-signals', () => ({
  readFleetDashboardSignals: async (): Promise<FleetDashboardSignals> => {
    reads++;
    await Promise.resolve();
    const agents = ALL_AGENT_CONTRACTS.map((agent, index) => ({
      agentNumber: mode === 'duplicate' && index === 111 ? 1 : agent.agentNumber,
      heartbeatAt: index < 3 ? new Date(now - 1000).toISOString() : null,
      heartbeatFresh: index < 3, heartbeatSource: index < 3 ? 'agent_state' as const : null,
      assignedTasks: index < 2 ? 1 : 0, running: index === 0,
      activeTaskId: index === 0 ? 'real-lease-task' : null, productive: false, evidence: null,
    }));
    return { marker: 'ivx-fleet-signals-2026-09-08-v1', status: mode === 'unavailable' ? 'UNKNOWN' : 'AVAILABLE',
      measuredAt: new Date(now - (mode === 'stale' ? 20_000 : 0)).toISOString(), commitSha: 'a'.repeat(40),
      maxAgeMs: 15_000, evidenceWindowMs: 300_000, error: null,
      counts: { heartbeat: 3, assigned: 2, running: 1, productive: 0 }, agents, instances: [] };
  },
}));
const ownerGuard = spyOn(await import('../api/owner-only'), 'assertIVXOwnerOnly');
const { handleLiveWorkAgentsRequest } = await import('../api/ivx-live-work');
const request = () => new Request('https://api.ivxholding.com/api/ivx/live-work/agents?enterpriseDashboard=1&view=live', {
  headers: { 'X-IVX-System-Key': 'live-fleet-contract-key' },
});
beforeEach(() => { now += 2000; mode = 'available'; ownerGuard.mockClear(); });
afterAll(() => {
  clock.mockRestore(); mock.restore();
  if (previousSecret === undefined) delete process.env.IVX_AI_SYSTEM_SECRET;
  else process.env.IVX_AI_SYSTEM_SECRET = previousSecret;
});

test('actual route and JSON transport retain all 112 identities while history is unavailable', async () => {
  const response = await handleLiveWorkAgentsRequest(request());
  expect(response.status).toBe(200);
  const payload = parseLiveFleetPayload(await response.json(), now);
  expect(payload.dashboard.agents).toHaveLength(112);
  expect(payload.dashboard.agents[0]?.status).toBe('RUNNING');
  expect(payload.dashboard.agents[1]?.status).toBe('ASSIGNED');
  expect(payload.dashboard.agents[2]?.status).toBe('IDLE');
  expect(payload.dashboard.agents[111]?.status).toBe('UNKNOWN');
  expect(payload.dashboard.fleetSignals.counts).toMatchObject({ heartbeat: 3, running: 1, productive: 0 });
  expect(payload.dashboard.historyAvailable).toBe(false);
  expect(historyReads).toBe(0);
  expect(ownerGuard).toHaveBeenCalledTimes(1);
});

test('simultaneous authorized polls share one observer read', async () => {
  const before = reads;
  const responses = await Promise.all(Array.from({ length: 6 }, () => handleLiveWorkAgentsRequest(request())));
  expect(responses.every(response => response.status === 200)).toBe(true);
  expect(reads - before).toBe(1);
  expect(ownerGuard).toHaveBeenCalledTimes(6);
});

test('the actual live route negotiates SSE with owner authentication and the same roster', async () => {
  const req = request(); req.headers.set('Accept', 'text/event-stream');
  const response = await handleLiveWorkAgentsRequest(req);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const data = new TextDecoder().decode((await reader.read()).value);
  const event = JSON.parse(data.trim().slice(6));
  expect(parseLiveFleetPayload(event.payload, now).dashboard.agents).toHaveLength(112);
  expect(ownerGuard).toHaveBeenCalledTimes(1);
  await reader.cancel();
});

for (const invalid of ['unavailable', 'duplicate', 'stale'] as const) {
  test(`${invalid} observation returns 503 with no fabricated empty dashboard`, async () => {
    mode = invalid;
    const response = await handleLiveWorkAgentsRequest(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.dashboard).toBeUndefined();
  });
}

test('missing credentials and owner-auth outages cannot expose cached fleet data', async () => {
  await handleLiveWorkAgentsRequest(request());
  const before = reads;
  const response = await handleLiveWorkAgentsRequest(new Request('https://api.ivxholding.com/api/ivx/live-work/agents?view=live'));
  expect(response.status).toBe(401);
  ownerGuard.mockRejectedValueOnce(new IVXAuthServiceUnavailableError());
  const unavailable = await handleLiveWorkAgentsRequest(request());
  expect(unavailable.status).toBe(503);
  expect((await unavailable.json()).dashboard).toBeUndefined();
  ownerGuard.mockRejectedValueOnce(new Error('Owner access denied'));
  expect((await handleLiveWorkAgentsRequest(request())).status).toBe(403);
  expect(reads).toBe(before);
});
