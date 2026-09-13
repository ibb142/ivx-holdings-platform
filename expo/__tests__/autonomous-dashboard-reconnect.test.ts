import { test, expect } from 'bun:test';
import { connectDashboardSocket } from '../src/modules/ivx-owner-ai/services/autonomous-dashboard-stream-client';
import { useTelemetrySync } from '../hooks/useTelemetrySync';
import type { AutonomousOpsDashboard } from '../src/modules/ivx-owner-ai/services/ivxAutonomousOpsService';

const sha = 'a'.repeat(40), now = Date.parse('2026-09-13T19:00:00Z');
function dashboard(): AutonomousOpsDashboard {
  return { backendCommitSha: sha, agents: Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1 })),
    fleetSignals: { status: 'AVAILABLE', measuredAt: new Date(now).toISOString(), commitSha: sha, maxAgeMs: 15_000,
      counts: { heartbeat: 0, assigned: 0, running: 0, productive: 0 }, agents: Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1, heartbeatFresh: false, assignedTasks: 0, running: false, productive: false })) } } as AutonomousOpsDashboard;
}
function fixture() {
  const states: string[] = [], snapshots: AutonomousOpsDashboard[] = [], errors: string[] = [];
  let callback: (() => void) | null = null, closes = 0;
  const ws = { readyState: 1, onopen: null, onmessage: null, onerror: null, onclose: null,
    send: (_value: string) => {}, close: () => { closes++; } } as unknown as WebSocket;
  const client = connectDashboardSocket({ token: 'private', url: 'wss://example.test', range: '24h', normalize: raw => { if (!raw?.agents) throw Error('invalid'); return raw; },
    onSnapshot: value => snapshots.push(value), onState: meta => states.push(meta.state), onError: error => errors.push(error.message) }, {
    createSocket: () => ws, schedule: fn => { callback = fn; return 1 as unknown as ReturnType<typeof setTimeout>; }, cancel: () => { callback = null; },
  });
  return { ws, client, states, snapshots, errors, stall: () => callback?.(), closes: () => closes,
    message: (body: unknown) => ws.onmessage?.({ data: JSON.stringify(body) } as MessageEvent) };
}
test('auth success without a snapshot is not LIVE and a stalled connection reconnects', () => {
  const f = fixture(); f.ws.onopen?.({} as Event); f.message({ type: 'auth_ok', intervalMs: 1000 });
  expect(f.states.at(-1)).toBe('AUTHENTICATING'); expect(f.snapshots).toHaveLength(0);
  f.stall(); expect(f.states.at(-1)).toBe('ERROR'); expect(f.closes()).toBe(1); expect(f.errors).toHaveLength(1);
});
test('stalled, closed or failed sockets cannot overwrite a new connection with late data', () => {
  for (const stop of ['stall', 'close', 'error']) {
    const f = fixture();
    if (stop === 'stall') f.stall(); else if (stop === 'close') f.client.close(); else f.ws.onerror?.({} as Event);
    f.message({ type: 'snapshot', sequence: 1, dashboard: dashboard() });
    expect(f.snapshots).toHaveLength(0); expect(f.closes()).toBe(1);
  }
});
test('only advancing valid snapshots reset the watchdog; a new connection starts its own sequence', () => {
  const f = fixture(); f.message({ type: 'snapshot', sequence: 8, dashboard: dashboard() });
  f.message({ type: 'snapshot', sequence: 7, dashboard: dashboard() });
  f.message({ type: 'snapshot', sequence: 8, dashboard: dashboard() });
  expect(f.snapshots).toHaveLength(1); expect(f.states.at(-1)).toBe('LIVE'); f.stall(); expect(f.states.at(-1)).toBe('ERROR');
  const next = fixture(); next.message({ type: 'snapshot', sequence: 1, dashboard: dashboard() }); expect(next.snapshots).toHaveLength(1); next.client.close();
});
test('malformed and server-error responses reach the reconnect loop without a false snapshot', () => {
  for (const message of [{ type: 'snapshot', sequence: 1, dashboard: null }, { type: 'stream_error', error: 'private backend message' }]) {
    const f = fixture(); f.message(message); expect(f.states.at(-1)).toBe('ERROR'); expect(f.snapshots).toHaveLength(0); expect(JSON.stringify(f.errors)).not.toContain('private backend message');
  }
});
test('rows survive disconnection but expired evidence stays UNKNOWN until a fresh sample returns', () => {
  const data = dashboard();
  const before = useTelemetrySync(data, 'LIVE', now); expect(before.signals?.counts.productive).toBe(0);
  const disconnected = useTelemetrySync(data, 'RECONNECTING', now + 15_001);
  expect(disconnected.agents).toHaveLength(112); expect(disconnected.signals).toBeNull(); expect(disconnected.isNetworkReconnecting).toBe(true); expect(disconnected.displayStatus).toContain('UNKNOWN');
  data.fleetSignals.measuredAt = new Date(now + 16_000).toISOString();
  const restored = useTelemetrySync(data, 'LIVE', now + 16_001); expect(restored.signals).not.toBeNull(); expect(restored.isNetworkReconnecting).toBe(false);
});
test('112 rows and a live socket cannot certify missing, stale or other-SHA evidence', () => {
  const data = dashboard(); data.fleetSignals.status = 'UNKNOWN'; expect(useTelemetrySync(data, 'LIVE', now).signals).toBeNull();
  data.fleetSignals.status = 'AVAILABLE'; data.backendCommitSha = 'b'.repeat(40); expect(useTelemetrySync(data, 'LIVE', now).signals).toBeNull();
});
