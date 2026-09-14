import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { AutonomousOpsDashboard } from '../src/modules/ivx-owner-ai/services/ivxAutonomousOpsService';

// Exercise the actual REST/WebSocket normalizer; only session/network boundaries
// are replaced. Run this test in its own process to isolate module mocks.
mock.module('@/lib/api-base', () => ({ getDirectApiBaseUrl: () => 'https://example.test' }));
mock.module('@/lib/ivx-supabase-client', () => ({ getIVXAccessToken: async () => 'fixture-owner-session' }));
const { normalizeAutonomousDashboard, getAutonomousOpsDashboard } = await import('../src/modules/ivx-owner-ai/services/ivxAutonomousOpsService');
afterEach(() => mock.restore());

function dashboard(): AutonomousOpsDashboard {
  const now = new Date().toISOString();
  const sha = 'a'.repeat(40);
  const agents = Array.from({ length: 112 }, (_, i) => ({
    agentNumber: i + 1, agentId: `ivx_holdings_${i + 1}`, name: `Agent ${i + 1}`,
    department: 'QA', primaryResponsibility: 'Contract fixture', status: 'IDLE' as const,
    currentTask: null, tasksStartedToday: 0, tasksCompletedToday: 0, tasksFailedToday: 0,
    tasksBlockedToday: 0, lastActivityTime: null, totalExecutionTimeMs: null,
    successRate: null, evidenceLink: null, traceId: null, signals: null,
  }));
  return {
    marker: 'fixture', generatedAt: now, backendCommitSha: sha, backendBootTime: now,
    backendRouteCount: 0, githubHeadSha: sha, commitMatch: false,
    servedBy: { instanceId: 'fixture-api', role: 'api' },
    dateRange: { start: now, end: now, label: 'Last 24 Hours' },
    agents, activityItems: [], categoryBreakdown: [], dailySummary: null,
    liveActivityFeed: [], ownerActionRequests: [], realAgentCount: 0,
    placeholderAgentCount: 112, disclaimer: 'Test fixture; no runtime certification.',
    enterprise112: { registryCount: 112, durableStateCount: 112, durableExecutionCount: 0, storeMode: 'dedicated', ledgerOk: true, ledgerError: null },
    deploymentStatus: { renderDeployId: null, renderDeployStatus: null, renderCommitSha: sha, productionHealthy: true },
    fleetSignals: {
      marker: 'ivx-fleet-signals-2026-09-08-v1', status: 'AVAILABLE', measuredAt: now,
      commitSha: sha, maxAgeMs: 15_000, evidenceWindowMs: 60_000, error: null,
      counts: { heartbeat: 0, assigned: 0, running: 0, productive: 0 },
      agents: agents.map(a => ({ agentNumber: a.agentNumber, heartbeatAt: null,
        heartbeatFresh: false, heartbeatSource: null, assignedTasks: 0, running: false,
        activeTaskId: null, productive: false, evidence: null })), instances: [],
    },
  };
}

test('accepts a healthy current snapshot while keeping idle agents distinct from work', () => {
  const raw = dashboard();
  const result = normalizeAutonomousDashboard(raw);
  expect(result.deploymentStatus.productionHealthy).toBe(true);
  expect(result.agents).toBe(raw.agents);
  expect(result.agents).toHaveLength(112);
  expect(result.fleetSignals.counts.running).toBe(0);
  expect(result.fleetSignals.counts.productive).toBe(0);
});

test('never upgrades the server health verdict because commit SHAs match', () => {
  const raw = dashboard();
  raw.deploymentStatus.productionHealthy = false;
  expect(normalizeAutonomousDashboard(raw).deploymentStatus.productionHealthy).toBe(false);
});

test('missing server health is not confirmation of health', () => {
  const raw = dashboard();
  Reflect.deleteProperty(raw.deploymentStatus, 'productionHealthy');
  expect(normalizeAutonomousDashboard(raw).deploymentStatus.productionHealthy).toBe(false);
});

for (const condition of ['unknown', 'stale', 'duplicate-agent'] as const) {
  test(`keeps ${condition} fleet telemetry unhealthy even with matching commits`, () => {
    const raw = dashboard();
    if (condition === 'unknown') {
      raw.fleetSignals.status = 'UNKNOWN';
      raw.fleetSignals.measuredAt = null;
      raw.fleetSignals.counts = { heartbeat: null, assigned: null, running: null, productive: null };
      raw.fleetSignals.agents = [];
    } else if (condition === 'stale') {
      raw.fleetSignals.measuredAt = new Date(Date.now() - 60_000).toISOString();
    } else {
      raw.fleetSignals.agents[111]!.agentNumber = 1;
    }
    const result = normalizeAutonomousDashboard(raw);
    expect(result.deploymentStatus.productionHealthy).toBe(false);
    expect(result.agents).toHaveLength(112);
    expect(result.fleetSignals).toBe(raw.fleetSignals);
  });
}

test('rejects a deployment mismatch even when the server reports healthy', () => {
  const raw = dashboard();
  raw.deploymentStatus.renderCommitSha = 'b'.repeat(40);
  expect(normalizeAutonomousDashboard(raw).deploymentStatus.productionHealthy).toBe(false);
});

test('a heartbeat-only subset cannot replace the full enterprise registry', () => {
  const raw = dashboard();
  raw.agents = raw.agents.slice(0, 1);
  expect(() => normalizeAutonomousDashboard(raw)).toThrow('expected 112 agents, received 1');
});

test('the mobile REST client rejects HTTP 200 with ok=false instead of accepting zero agents', async () => {
  spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
    ok: false, error: 'Telemetry unavailable', dashboard: { registeredCount: 0, agents: [] },
  }));
  await expect(getAutonomousOpsDashboard()).rejects.toThrow('Telemetry unavailable');
});

test('the mobile REST client handles an explicit service outage as an error', async () => {
  spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
    ok: false, error: 'Durable dashboard telemetry is unavailable.',
  }, { status: 503 }));
  await expect(getAutonomousOpsDashboard()).rejects.toThrow('HTTP 503');
});
