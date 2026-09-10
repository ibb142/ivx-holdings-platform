import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { Task, TaskEvidence } from './ivx-autonomous-task-engine';
import type { AlertRow } from './ivx-agent-persistence';
import { buildFleetSloSnapshot, FleetSloMonitor, fleetSloPrometheus } from './ivx-fleet-slo';
import { handleFleetSloGet } from '../api/ivx-fleet-slo';

const NOW = Date.parse('2026-09-08T17:00:00Z');
const SHA = 'a'.repeat(40);
function proof(agent: number, overrides: Record<string, unknown> = {}): TaskEvidence {
  const summary = 'LANDING_P0_RESULT ' + JSON.stringify({ v: 1, agent_number: agent, status: 'PASS', production_sha: SHA, started_at: new Date(NOW - 2000).toISOString(), completed_at: new Date(NOW - 1000).toISOString(), productive_seconds: 1, api_checks: 1, browser_checks: 0, evidence: ['GET /health 200'], ...overrides });
  return { evidenceId: `proof-${agent}`, evidenceType: 'production_verification', source: 'continuous-patrol:api.health', summary, contentHash: createHash('sha256').update(summary).digest('hex'), createdAt: new Date(NOW - 1000).toISOString(), commitSha: SHA, deploymentId: null };
}
function task(agent: number): Task {
  return { taskId: `task-${agent}`, state: 'RUNNING', assignedAgentNumber: agent, leaseHolder: `agent:ivx_holdings_${agent}`, leaseExpiresAt: new Date(NOW + 60_000).toISOString(), lastHeartbeatAt: new Date(NOW - 1000).toISOString(), evidence: [proof(agent)] } as Task;
}
describe('Fleet SLO evidence and alerts', () => {
  test('112 heartbeats without real proof yield zero productive agents', () => {
    const tasks = Array.from({ length: 112 }, (_, n) => ({ ...task(n + 1), evidence: [] }));
    const snapshot = buildFleetSloSnapshot(tasks, NOW, SHA);
    expect(snapshot.heartbeat_agents).toBe(112);
    expect(snapshot.running_agents).toBe(112);
    expect(snapshot.productive_agents).toBe(0);
    expect(snapshot.status).toBe('BREACH');
  });
  test('rejects stale, failed, tampered, wrong-SHA, zero-time and unleased proof', () => {
    const tasks = Array.from({ length: 8 }, (_, n) => task(n + 1));
    tasks[0].evidence[0].createdAt = new Date(NOW - 300_001).toISOString();
    tasks[1].evidence = [proof(2, { status: 'FAIL' })];
    tasks[2].evidence[0].contentHash = 'f'.repeat(64);
    tasks[3].evidence = [proof(4, { production_sha: 'b'.repeat(40) })];
    tasks[4].evidence = [proof(5, { productive_seconds: 0 })];
    tasks[5].state = 'LEASED';
    tasks[6].leaseExpiresAt = new Date(NOW - 1).toISOString();
    tasks[7].evidence = [proof(8), { ...proof(8, { status: 'FAIL' }), createdAt: new Date(NOW).toISOString() }];
    expect(buildFleetSloSnapshot(tasks, NOW, SHA).productive_agents).toBe(0);
  });
  test('deduplicates logical IA identities and attributes stolen work to the holder', () => {
    const tasks = Array.from({ length: 112 }, (_, n) => task(n + 1));
    tasks[0].assignedAgentNumber = 99;
    const snapshot = buildFleetSloSnapshot([...tasks, task(1)], NOW, SHA);
    expect(snapshot.productive_agents).toBe(112);
    expect(snapshot.status).toBe('MET');
  });
  test('automatically alerts at 111, suppresses repeats, then records recovery at 112', async () => {
    let tasks = Array.from({ length: 111 }, (_, n) => task(n + 1));
    const alerts: AlertRow[] = [];
    const saved: Record<string, unknown>[] = [];
    const monitor = new FleetSloMonitor({ read: async () => tasks, persist: async (value) => { saved.push(value); }, alert: async (alert) => { alerts.push(alert); return { ok: true }; }, now: () => NOW, sha: () => SHA });
    await monitor.sample(); await monitor.sample();
    expect(alerts.map((alert) => alert.alert_type)).toEqual(['fleet_productivity_breach']);
    expect(JSON.parse(alerts[0].detail).productive_agents).toBe(111);
    tasks = [...tasks, task(112)];
    await monitor.sample();
    expect(alerts[1].alert_type).toBe('fleet_productivity_recovered');
    expect(saved).toHaveLength(3);
    expect(monitor.snapshot()?.durable).toBe(true);
  });
  test('DB outage and stale sampling are UNKNOWN, and failed alerts are retried', async () => {
    let now = NOW;
    let deliveries = 0;
    const monitor = new FleetSloMonitor({ read: async () => { throw new Error('db unavailable'); }, persist: async () => {}, alert: async () => { deliveries += 1; return { ok: false }; }, now: () => now, sha: () => SHA });
    await monitor.sample(); await monitor.sample();
    expect(deliveries).toBe(2);
    expect(monitor.snapshot()?.productive_agents).toBeNull();
    expect(fleetSloPrometheus(monitor.snapshot()!)).toContain('ivx_fleet_telemetry_available 0');
    now += 61_000;
    expect(monitor.snapshot()?.error).toBe('SLO sample is stale');
  });
  test('slow alerts cannot block fresh durable samples or create overlapping alert requests', async () => {
    let now = NOW;
    let deliveries = 0;
    let finishAlert: (result: { ok: boolean }) => void = () => {};
    const saved: Record<string, unknown>[] = [];
    const monitor = new FleetSloMonitor({
      read: async () => [],
      persist: async (value) => { saved.push(value); },
      alert: async () => {
        deliveries++;
        return new Promise<{ ok: boolean }>((resolve) => { finishAlert = resolve; });
      },
      now: () => now, sha: () => SHA,
    });
    await monitor.sample();
    now += 60_000;
    const fresh = await monitor.sample();
    expect(saved).toHaveLength(2);
    expect(fresh.measured_at).toBe(new Date(now).toISOString());
    expect(fresh.durable).toBe(true);
    expect(monitor.snapshot()?.status).toBe('BREACH');
    expect(deliveries).toBe(1);

    finishAlert({ ok: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await monitor.sample();
    expect(deliveries).toBe(2);
    finishAlert({ ok: true });
  });
  test('does not expose owner metrics without authentication', async () => {
    expect((await handleFleetSloGet(new Request('https://api.ivx.test/api/ivx/autonomous/fleet-slo'))).status).toBe(401);
  });
});

test('identifies read versus persistence timeouts without leaking raw errors or certifying productivity', async () => {
  for (const stage of ['read', 'persist']) {
    const failure = () => { throw new Error('timeout secret=must-not-escape'); };
    const monitor = new FleetSloMonitor({
      read: async () => stage === 'read' ? failure() : [],
      persist: async () => { if (stage === 'persist') failure(); },
      alert: async () => ({ ok: true }), now: () => NOW, sha: () => SHA,
    });
    const result = await monitor.sample();
    expect(result.failure_stage).toBe(stage);
    expect(result.failure_kind).toBe('timeout');
    expect(result.status).toBe('UNKNOWN');
    expect(result.productive_agents).toBeNull();
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
  }
});
