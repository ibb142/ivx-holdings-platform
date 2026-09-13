import { expect, test } from 'bun:test';
import { handleFleetStatusMatrixRequest } from './ivx-fleet-status-matrix';
import type { FleetDashboardSignals } from '../../expo/shared/ivx/fleet-signals';

const now = Date.parse('2026-09-13T18:00:00Z');
const request = new Request('https://api.example.test/api/fleet/status-matrix');
function observation(): FleetDashboardSignals {
  return { marker: 'ivx-fleet-signals-2026-09-08-v1', status: 'AVAILABLE', measuredAt: new Date(now).toISOString(),
    commitSha: 'a'.repeat(40), maxAgeMs: 15_000, evidenceWindowMs: 60_000, error: null, instances: [],
    counts: { heartbeat: 0, assigned: 0, running: 0, productive: 0 },
    agents: Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1, heartbeatAt: null, heartbeatFresh: false,
      heartbeatSource: null, assignedTasks: 0, running: false, activeTaskId: null, productive: false, evidence: null })) };
}
test('Owner authorization is checked before any telemetry read', async () => {
  let reads = 0;
  const response = await handleFleetStatusMatrixRequest(request, { authorize: async () => { throw new Error('denied'); },
    read: async () => { reads++; return observation(); }, now: () => now });
  expect(response.status).toBe(401); expect(reads).toBe(0);
});
test('presence, assignment, real execution and stale telemetry remain distinct for all 112 agents', async () => {
  const signals = observation();
  for (const i of [0, 1, 2]) Object.assign(signals.agents[i], { heartbeatAt: new Date(now - 1000).toISOString(), heartbeatFresh: true, heartbeatSource: 'agent_state' });
  signals.agents[1].assignedTasks = 3;
  Object.assign(signals.agents[2], { running: true, activeTaskId: 'leased-task', heartbeatSource: 'task_lease' });
  signals.agents[3].heartbeatAt = new Date(now - 90_000).toISOString();
  signals.counts = { heartbeat: 3, assigned: 1, running: 1, productive: 0 };
  const response = await handleFleetStatusMatrixRequest(request, { authorize: async () => {}, read: async () => signals, now: () => now });
  const result = await response.json();
  expect(response.status).toBe(200); expect(result.fleetSize).toBe(112); expect(result.runningCount).toBe(1);
  expect(result.matrix.slice(0, 5).map((row: any) => row.real_time_execution_status)).toEqual(['IDLE', 'QUEUED', 'ACTIVE_RUNNING', 'STALE', 'NO_TELEMETRY']);
  expect(result.generatedAt).toBe(signals.measuredAt);
});
test('stale, incomplete or unavailable observations return unknown instead of zero running', async () => {
  for (const variant of ['stale', 'incomplete', 'outage']) {
    const signals = observation();
    if (variant === 'stale') signals.measuredAt = new Date(now - 16_000).toISOString();
    if (variant === 'incomplete') signals.agents.pop();
    const response = await handleFleetStatusMatrixRequest(request, { authorize: async () => {}, now: () => now,
      read: async () => { if (variant === 'outage') throw new Error('database unavailable'); return signals; } });
    expect(response.status).toBe(503);
    const result = await response.json(); expect(result.runningCount).toBeNull(); expect(result.matrix).toEqual([]);
  }
});
