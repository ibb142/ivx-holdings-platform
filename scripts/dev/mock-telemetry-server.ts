import { createServer, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AutonomousOpsDashboard, DateRange, UnifiedAgent } from '../../expo/src/modules/ivx-owner-ai/services/ivxAutonomousOpsService';
import type { AgentFleetSignal } from '../../expo/shared/ivx/fleet-signals';

export const TELEMETRY_PATH = '/api/ivx/live-work/agents';
export const SCENARIOS = ['mixed', 'idle', 'stale', 'incomplete', 'ledger-error', 'unavailable', 'unauthorized'] as const;
export type MockScenario = typeof SCENARIOS[number];
const RANGES = ['24h', 'today', 'yesterday', '7d', '30d'] as const;

function isScenario(value: string): value is MockScenario {
  return SCENARIOS.some(scenario => scenario === value);
}

function dateRange(range: DateRange, now: number): AutonomousOpsDashboard['dateRange'] {
  const day = 86_400_000;
  const date = new Date(now);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const end = range === 'yesterday' ? midnight : now;
  const start = range === 'today' ? midnight : range === 'yesterday' ? midnight - day
    : now - day * (range === '7d' ? 7 : range === '30d' ? 30 : 1);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), label: `SIMULATED ${range} (UTC)` };
}

export function createMockDashboard(scenario: MockScenario = 'mixed', range: DateRange = '24h', now = Date.now()): AutonomousOpsDashboard {
  const generatedAt = new Date(now).toISOString();
  const measuredAt = new Date(now - (scenario === 'stale' ? 60_000 : 0)).toISOString();
  const agents: UnifiedAgent[] = Array.from({ length: 112 }, (_, index) => {
    const agentNumber = index + 1;
    const running = scenario !== 'idle' && index % 10 === 0;
    const signals: AgentFleetSignal = {
      agentNumber, heartbeatAt: measuredAt, heartbeatFresh: scenario !== 'stale',
      heartbeatSource: 'agent_state', assignedTasks: running ? 1 : 0, running,
      activeTaskId: running ? `mock-task-${agentNumber}` : null,
      productive: false, evidence: null,
    };
    return {
      agentNumber, agentId: `mock-agent-${agentNumber}`, name: `[SIMULATED] Agent ${String(agentNumber).padStart(3, '0')}`,
      department: 'LOCAL TEST', primaryResponsibility: 'Dashboard contract simulation',
      status: running ? 'RUNNING' : 'IDLE', currentTask: running ? 'Simulated task; no work is executed' : null,
      tasksStartedToday: 0, tasksCompletedToday: 0, tasksFailedToday: 0, tasksBlockedToday: 0,
      lastActivityTime: null, totalExecutionTimeMs: null, successRate: null,
      evidenceLink: null, traceId: null, signals,
    };
  });
  if (scenario === 'incomplete') agents.pop();
  const signals = agents.map(agent => agent.signals!);
  return {
    marker: 'ivx-local-mock-d1f6518', generatedAt,
    servedBy: { instanceId: 'local-mock', role: 'mock' },
    backendCommitSha: null, backendBootTime: null, backendRouteCount: 1,
    githubHeadSha: null, commitMatch: false, dateRange: dateRange(range, now),
    agents, activityItems: [], categoryBreakdown: [], dailySummary: null,
    liveActivityFeed: [], ownerActionRequests: [],
    deploymentStatus: { renderDeployId: null, renderDeployStatus: null, renderCommitSha: null, productionHealthy: false },
    realAgentCount: 0, placeholderAgentCount: agents.length,
    enterprise112: {
      registryCount: agents.length, durableStateCount: 0, durableExecutionCount: 0,
      storeMode: 'local-mock', ledgerOk: scenario !== 'ledger-error',
      ledgerError: scenario === 'ledger-error' ? 'Simulated ledger outage' : null,
    },
    fleetSignals: {
      marker: 'ivx-fleet-signals-2026-09-08-v1', status: 'AVAILABLE', measuredAt,
      commitSha: 'local-mock', maxAgeMs: 15_000, evidenceWindowMs: 60_000, error: null,
      counts: {
        heartbeat: signals.filter(signal => signal.heartbeatFresh).length,
        assigned: signals.filter(signal => signal.assignedTasks > 0).length,
        running: signals.filter(signal => signal.running).length, productive: 0,
      },
      agents: signals, instances: [],
    },
    disclaimer: 'SIMULATED LOCAL DATA. No live agents, database reads, verified work or production certification.',
  };
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status);
  res.end(JSON.stringify({ simulated: true, source: 'local-mock', ...body }));
}

export function createMockTelemetryServer(defaultScenario: MockScenario = 'mixed') {
  return createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cache-Control');
    res.setHeader('X-IVX-Telemetry-Source', 'local-mock');
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); }
    catch { sendJson(res, 400, { ok: false, error: 'INVALID_URL' }); return; }

    if (url.pathname !== TELEMETRY_PATH) {
      sendJson(res, 404, { ok: false, error: 'ROUTE_NOT_FOUND' }); return;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
      sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }); return;
    }
    if (url.searchParams.get('individualCerts') === '1') {
      sendJson(res, 501, { ok: false, error: 'INDIVIDUAL_CERTIFICATES_NOT_SIMULATED' }); return;
    }
    const scenario = url.searchParams.get('scenario') ?? defaultScenario;
    const range = url.searchParams.get('range') ?? '24h';
    if (!isScenario(scenario) || !RANGES.some(value => value === range)) {
      sendJson(res, 400, { ok: false, error: 'INVALID_SCENARIO_OR_RANGE', scenarios: SCENARIOS, ranges: RANGES }); return;
    }
    if (scenario === 'unavailable' || scenario === 'unauthorized') {
      sendJson(res, scenario === 'unavailable' ? 503 : 401, {
        ok: false, scenario, error: scenario === 'unavailable' ? 'Simulated telemetry outage' : 'Simulated missing owner session',
      });
      return;
    }
    const dashboard = createMockDashboard(scenario, range as DateRange);
    sendJson(res, 200, { ok: true, scenario, timestamp: dashboard.generatedAt, dashboard });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const portText = process.env.MOCK_PORT ?? '8080';
  const port = Number(portText);
  const host = process.env.MOCK_HOST ?? '127.0.0.1';
  const scenario = process.env.MOCK_SCENARIO ?? 'mixed';
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535 || !host || !isScenario(scenario)) {
    console.error('Invalid MOCK_PORT (1..65535), MOCK_HOST or MOCK_SCENARIO.');
    process.exitCode = 1;
  } else {
    const server = createMockTelemetryServer(scenario);
    server.on('error', error => { console.error(`[LOCAL MOCK] ${error.message}`); process.exitCode = 1; });
    server.listen(port, host, () => {
      const urlHost = host.includes(':') ? `[${host}]` : host;
      console.log(`[LOCAL MOCK] SIMULATED DATA — http://${urlHost}:${port}${TELEMETRY_PATH}?enterpriseDashboard=1&range=24h`);
      console.log(`Default scenario: ${scenario}. Scenarios: ${SCENARIOS.join(', ')}. Change with ?scenario=...`);
    });
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
}
