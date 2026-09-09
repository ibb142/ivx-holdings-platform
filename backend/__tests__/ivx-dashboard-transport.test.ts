import { afterAll, expect, mock, spyOn, test } from 'bun:test';
import { ALL_AGENT_CONTRACTS } from '../services/ivx-agent-contracts';
import { IVXAuthServiceUnavailableError } from '../../expo/shared/ivx';

// Run this contract test in its own Bun process: it replaces storage only.
// Authentication and ownerOnlyJson's real 900 KB transport ceiling stay active.
const previousSecret = process.env.IVX_AI_SYSTEM_SECRET;
process.env.IVX_AI_SYSTEM_SECRET = 'dashboard-contract-machine-key';
let ledgerOk = false;
let fleetAvailable = false;
let ledgerReadCompleted = false;
let fleetReads = 0;
const startedAt = new Date(Date.now() - 10_000).toISOString();
const executions = Array.from({ length: 2000 }, (_, i) => {
  const agent = ALL_AGENT_CONTRACTS[i % 112]!;
  return {
    task_id: `contract-${i}`, run_id: 'contract-run', agent_id: agent.agentId,
    agent_number: agent.agentNumber, workflow: 'contract', task_type: 'dashboard transport audit',
    final_status: i === 0 ? 'pending' : 'completed', real_tool_used: true, tools_used: ['repository.read'],
    tool_result_id: `result-${i}`, source_reference: `https://example.test/evidence/${'x'.repeat(400)}`,
    verified_output: true, evidence: null, evidence_sha256: 'a'.repeat(64),
    output: { text: 'large output '.repeat(2000) }, cost_usage: { usd: 0 },
    error: null, retry_count: 0, duration_ms: 1000, dedup_key: `contract-${i}`,
    simulated: false, started_at: startedAt, finished_at: startedAt,
  };
});
mock.module('../services/ivx-agent-dashboard-ledger', () => ({
  IVX_AGENT_DASHBOARD_LEDGER_MARKER: 'contract-ledger',
  readAgentDashboardLedger: async () => {
    ledgerReadCompleted = false;
    await Promise.resolve();
    ledgerReadCompleted = true;
    return { ok: ledgerOk, mode: 'dedicated', states: [], executions, error: ledgerOk ? null : 'database unavailable' };
  },
}));
mock.module('../services/ivx-daily-executive-report', () => ({ getLatestReport: async () => null }));
mock.module('../services/ivx-durable-store', () => ({ readDurableJson: async () => [] }));
mock.module('../services/ivx-fleet-dashboard-signals', () => ({
  readFleetDashboardSignals: async () => {
    expect(ledgerReadCompleted).toBe(true);
    fleetReads += 1;
    return {
    marker: 'contract-fleet', status: fleetAvailable ? 'AVAILABLE' : 'UNKNOWN',
    measuredAt: fleetAvailable ? new Date().toISOString() : null, commitSha: 'a'.repeat(40),
    maxAgeMs: 15_000, evidenceWindowMs: 60_000, error: fleetAvailable ? null : 'observation unavailable',
    counts: fleetAvailable ? { heartbeat: 0, assigned: 1, running: 0, productive: 0 }
      : { heartbeat: null, assigned: null, running: null, productive: null },
    agents: fleetAvailable ? ALL_AGENT_CONTRACTS.map((a, i) => ({
      agentNumber: a.agentNumber, heartbeatAt: null, heartbeatFresh: false, heartbeatSource: null,
      assignedTasks: i === 0 ? 1 : 0, running: false, activeTaskId: null, productive: false, evidence: null,
    })) : [], instances: [],
    };
  },
}));
mock.module('../services/ivx-autonomous-sms-notifier', () => ({ getSmsNotifierStatus: () => ({ ownerActionSchedulerRunning: false }) }));
const ownerGuard = spyOn(await import('../api/owner-only'), 'assertIVXOwnerOnly');
const { handleLiveWorkAgentsRequest: handleAutonomousOpsDashboardRequest } = await import('../api/ivx-live-work');
afterAll(() => {
  if (previousSecret === undefined) delete process.env.IVX_AI_SYSTEM_SECRET;
  else process.env.IVX_AI_SYSTEM_SECRET = previousSecret;
  mock.restore();
});

test('preserves all 112 agents under the actual transport ceiling and fails closed on unavailable telemetry', async () => {
  const request = () => new Request('https://api.ivxholding.com/api/ivx/live-work/agents?enterpriseDashboard=1', {
    headers: { 'X-IVX-System-Key': 'dashboard-contract-machine-key' },
  });
  expect((await handleAutonomousOpsDashboardRequest(request())).status).toBe(503);
  expect(ownerGuard).toHaveBeenCalledTimes(1);
  expect(fleetReads).toBe(0);
  ledgerOk = true;
  const unavailableFleet = await (await handleAutonomousOpsDashboardRequest(request())).json();
  expect(unavailableFleet.dashboard.agents).toHaveLength(112);
  expect(unavailableFleet.dashboard.agents.every((a: { status: string }) => a.status === 'UNKNOWN')).toBe(true);
  expect(unavailableFleet.dashboard.deploymentStatus.productionHealthy).toBe(false);
  fleetAvailable = true;
  const response = await handleAutonomousOpsDashboardRequest(request());
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(Buffer.byteLength(text)).toBeLessThan(900_000);
  const body = JSON.parse(text);
  expect(body.ok).toBe(true);
  expect(body.dashboard.agents).toHaveLength(112);
  expect(new Set(body.dashboard.agents.map((a: { agentNumber: number }) => a.agentNumber)).size).toBe(112);
  expect(body.dashboard.enterprise112.ledgerOk).toBe(true);
  expect(body.dashboard.agents[0].status).toBe('ASSIGNED');
  expect(body.dashboard.rolling24h.tasksRunning).toBe(0);
  expect(body.dashboard.deploymentStatus.productionHealthy).toBe(true);
  expect(body.dashboard.history.possiblyTruncated).toBe(true);
  expect(body.dashboard.activityItems).toHaveLength(100);
  expect(body.responseTruncated).toBeUndefined();
  ownerGuard.mockClear();
  const unauthenticated = await handleAutonomousOpsDashboardRequest(new Request('https://api.ivxholding.com/api/ivx/live-work/agents?enterpriseDashboard=1'));
  expect(unauthenticated.status).toBe(401);
  expect(ownerGuard).toHaveBeenCalledTimes(1);
});

test('owner verification outages return 503 without disclosing cached dashboard data', async () => {
  const previousFleetReads = fleetReads;
  for (const query of ['?enterpriseDashboard=1', '']) {
    ownerGuard.mockRejectedValueOnce(new IVXAuthServiceUnavailableError());
    const response = await handleAutonomousOpsDashboardRequest(new Request(`https://api.ivxholding.com/api/ivx/live-work/agents${query}`));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.dashboard).toBeUndefined();
    expect(body.error).toContain('temporarily unavailable');
  }
  expect(fleetReads).toBe(previousFleetReads);
});
