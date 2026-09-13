import { expect, mock, test } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createMockTelemetryServer, TELEMETRY_PATH, type MockScenario } from './mock-telemetry-server';
import { visibleFleetSignals } from '../../expo/shared/ivx/fleet-signals';

let apiBase = '';
// Only replace session/base URL boundaries. The real mobile client uses real HTTP.
mock.module('@/lib/api-base', () => ({ getDirectApiBaseUrl: () => apiBase }));
mock.module('@/lib/ivx-supabase-client', () => ({ getIVXAccessToken: async () => 'local-mock-session' }));
const { getAutonomousOpsDashboard } = await import('../../expo/src/modules/ivx-owner-ai/services/ivxAutonomousOpsService');

async function withServer(scenario: MockScenario, check: (base: string) => Promise<void>): Promise<void> {
  const server = createMockTelemetryServer(scenario);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await check(apiBase); }
  finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

test('the actual Expo REST client accepts 112 distinct simulated agents with its query parameters', async () => {
  await withServer('mixed', async () => {
    const dashboard = await getAutonomousOpsDashboard({ range: '24h' });
    expect(dashboard.agents.map(a => a.agentNumber)).toEqual(Array.from({ length: 112 }, (_, i) => i + 1));
    expect(new Set(dashboard.agents.map(a => a.agentId)).size).toBe(112);
    expect(dashboard.agents.filter(a => a.status === 'RUNNING')).toHaveLength(12);
    expect(dashboard.agents.filter(a => a.status === 'IDLE')).toHaveLength(100);
    expect(visibleFleetSignals(dashboard.fleetSignals)?.counts.running).toBe(12);
    expect(dashboard.fleetSignals.counts.productive).toBe(0);
    expect(dashboard.agents.every(a => a.name.startsWith('[SIMULATED]') && a.evidenceLink === null)).toBe(true);
    expect(dashboard.realAgentCount).toBe(0);
    expect(dashboard.backendCommitSha).toBeNull();
    expect(dashboard.deploymentStatus.productionHealthy).toBe(false);
    expect(dashboard.disclaimer).toContain('SIMULATED');
  });
});

test('the bare URL is a marked local alias and scenario/range changes work without restart', async () => {
  await withServer('mixed', async base => {
    const response = await fetch(`${base}${TELEMETRY_PATH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ivx-telemetry-source')).toBe('local-mock');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ok: true, simulated: true, source: 'local-mock' });
    const changed = await fetch(`${base}${TELEMETRY_PATH}?enterpriseDashboard=1&range=7d&scenario=idle&_ts=123`);
    const { dashboard } = await changed.json();
    expect(dashboard.agents).toHaveLength(112);
    expect(dashboard.agents.every((a: { status: string }) => a.status === 'IDLE')).toBe(true);
    expect(dashboard.fleetSignals.counts.running).toBe(0);
    expect(Date.parse(dashboard.dateRange.end) - Date.parse(dashboard.dateRange.start)).toBe(7 * 86_400_000);
  });
});

test('stale telemetry retains the registry but expires in the real frontend freshness check', async () => {
  await withServer('stale', async () => {
    const dashboard = await getAutonomousOpsDashboard();
    expect(dashboard.agents).toHaveLength(112);
    expect(visibleFleetSignals(dashboard.fleetSignals)).toBeNull();
    expect(dashboard.deploymentStatus.productionHealthy).toBe(false);
  });
});

for (const [scenario, expectedError] of [
  ['incomplete', 'expected 112 agents, received 111'],
  ['ledger-error', 'durable ledger unhealthy'],
  ['unavailable', 'HTTP 503'],
  ['unauthorized', 'HTTP 401'],
] as const) {
  test(`the real REST client rejects the ${scenario} scenario`, async () => {
    await withServer(scenario, async () => {
      await expect(getAutonomousOpsDashboard()).rejects.toThrow(expectedError);
    });
  });
}

test('CORS preflight permits the headers sent by the mobile web client', async () => {
  await withServer('mixed', async base => {
    const response = await fetch(`${base}${TELEMETRY_PATH}?enterpriseDashboard=1`, {
      method: 'OPTIONS', headers: {
        Origin: 'http://localhost:8081',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type,cache-control',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    expect(await response.text()).toBe('');
  });
});

test('unknown inputs, write methods and certificate requests return explicit errors', async () => {
  await withServer('mixed', async base => {
    for (const [path, method, status] of [
      ['/missing', 'GET', 404],
      [TELEMETRY_PATH, 'POST', 405],
      [`${TELEMETRY_PATH}?scenario=typo`, 'GET', 400],
      [`${TELEMETRY_PATH}?range=invalid`, 'GET', 400],
      [`${TELEMETRY_PATH}?individualCerts=1&enterpriseDashboard=1`, 'GET', 501],
    ] as const) {
      const response = await fetch(`${base}${path}`, { method });
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toMatchObject({ ok: false, simulated: true });
      expect(body.dashboard).toBeUndefined();
    }
  });
});
