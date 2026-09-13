import { afterEach, expect, spyOn, test } from 'bun:test';
import { verifyLiveFleetDeployment } from './ivx-live-fleet-production';

const sha = 'a'.repeat(40);
let now = Date.parse('2026-09-13T20:00:00Z');
let clock: ReturnType<typeof spyOn> | undefined;
afterEach(() => { clock?.mockRestore(); });

function setup(mode: 'healthy' | 'public' | 'wrong-sha' | 'frozen' | 'degraded' = 'healthy') {
  now = Date.parse('2026-09-13T20:00:00Z');
  clock = spyOn(Date, 'now').mockImplementation(() => now);
  const initial = now;
  let ownerRequests = 0;
  const request = (async (_url: unknown, init?: RequestInit) => {
    const authorized = new Headers(init?.headers).has('Authorization');
    if (!authorized) return new Response(null, { status: mode === 'public' ? 200 : 401 });
    ownerRequests++;
    if (mode === 'degraded') return Response.json({ ok: false, status: 'DEGRADED' });
    const observed = new Date(mode === 'frozen' ? initial : now).toISOString();
    const signals = Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1, heartbeatAt: observed,
      heartbeatFresh: true, heartbeatSource: 'agent_state', assignedTasks: 0,
      running: false, activeTaskId: null, productive: false, evidence: null }));
    return Response.json({ ok: true, dashboard: { view: 'live', marker: 'test', registryCount: 112,
      historyAvailable: false, generatedAt: observed,
      fleetSignals: { marker: 'ivx-fleet-signals-2026-09-08-v1', status: 'AVAILABLE', measuredAt: observed,
        commitSha: mode === 'wrong-sha' ? 'b'.repeat(40) : sha, maxAgeMs: 15000, evidenceWindowMs: 300000,
        agents: signals, instances: [], error: null, counts: { heartbeat: 112, assigned: 0, running: 0, productive: 0 } },
      agents: signals.map(signal => ({ agentNumber: signal.agentNumber, agentId: `agent-${signal.agentNumber}`,
        name: `IA ${signal.agentNumber}`, status: 'IDLE', currentTask: null, signals: signal })),
    } });
  }) as typeof fetch;
  return { options: { sha, token: 'test-owner-token', fetchImpl: request, sleep: async (ms: number) => { now += ms; } },
    ownerRequests: () => ownerRequests };
}

test('production proof records three new observations and does not equate presence with work', async () => {
  const { options, ownerRequests } = setup();
  const result = await verifyLiveFleetDeployment(options);
  expect(result.status).toBe('PASS');
  expect(ownerRequests()).toBe(3);
  expect(result.samples).toHaveLength(3);
  expect(result.samples.every(s => s.registryCount === 112 && s.counts.running === 0 && s.counts.heartbeat === 112)).toBe(true);
  expect(Date.parse(result.samples[2]!.observedAt) - Date.parse(result.samples[0]!.observedAt)).toBe(10000);
  expect(JSON.stringify(result)).not.toContain(options.token);
});
test('a public dashboard fails before an owner request is made', async () => {
  const { options, ownerRequests } = setup('public');
  await expect(verifyLiveFleetDeployment(options)).rejects.toThrow('FLEET_ANONYMOUS_ACCESS_NOT_REJECTED');
  expect(ownerRequests()).toBe(0);
});
test('another deployed SHA cannot certify the requested change', async () => {
  await expect(verifyLiveFleetDeployment(setup('wrong-sha').options)).rejects.toThrow('FLEET_DEPLOYMENT_SHA_MISMATCH');
});
test('a repeatedly cached observation cannot certify live updates', async () => {
  await expect(verifyLiveFleetDeployment(setup('frozen').options)).rejects.toThrow('FLEET_OBSERVATION_DID_NOT_ADVANCE');
});
test('an HTTP 200 degraded response cannot certify production', async () => {
  await expect(verifyLiveFleetDeployment(setup('degraded').options)).rejects.toThrow('Telemetría no disponible');
});
