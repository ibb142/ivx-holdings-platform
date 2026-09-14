import { expect, test } from 'bun:test';
import { currentLiveFleet, fetchLiveFleet, parseLiveFleetPayload, type LiveFleetPayload } from '../shared/ivx/live-fleet-dashboard';
import { subscribeLiveFleet } from '../shared/ivx/live-fleet-stream';
import { createEventStreamDecoder } from '../shared/ivx/event-stream';

function fixture(now = Date.now()): LiveFleetPayload {
  const agents = Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1, heartbeatAt: new Date(now).toISOString(),
    heartbeatFresh: true, heartbeatSource: 'agent_state' as const, assignedTasks: 0,
    running: false, activeTaskId: null, productive: false, evidence: null }));
  return { ok: true, dashboard: { marker: 'test', view: 'live', generatedAt: new Date(now).toISOString(),
    registryCount: 112, historyAvailable: false,
    fleetSignals: { marker: 'ivx-fleet-signals-2026-09-08-v1', status: 'AVAILABLE', measuredAt: new Date(now).toISOString(),
      commitSha: 'a'.repeat(40), maxAgeMs: 15_000, evidenceWindowMs: 300_000, error: null,
      counts: { heartbeat: 112, assigned: 0, running: 0, productive: 0 }, agents, instances: [] },
    agents: agents.map(signal => ({ agentNumber: signal.agentNumber, agentId: `agent-${signal.agentNumber}`,
      name: `IA ${signal.agentNumber}`, department: 'QA', primaryResponsibility: 'Test', status: 'IDLE',
      currentTask: null, lastActivityTime: signal.heartbeatAt, lastSourceReference: null, lastEvidenceSha: null, signals: signal })),
  } };
}

test('presence alone stays idle; disconnected snapshots expire without another response', () => {
  const now = Date.now(), payload = fixture(now);
  expect(currentLiveFleet(payload, null, now)?.fleetSignals.counts.running).toBe(0);
  expect(currentLiveFleet(payload, null, now + 15_001)).toBeNull();
  expect(currentLiveFleet(payload, 'HTTP 503', now)).toBeNull();
  expect(currentLiveFleet(null, null, now)).toBeNull();
});
test('an incomplete or incorrectly numbered roster is rejected', () => {
  const payload = fixture();
  payload.dashboard.agents[111]!.agentNumber = 1;
  expect(() => parseLiveFleetPayload(payload)).toThrow();
  expect(() => parseLiveFleetPayload({ ok: true, dashboard: { agents: [] } })).toThrow();
});
test('an HTTP 200 degraded response cannot become a successful dashboard', async () => {
  const request = async () => Response.json({ ok: false, status: 'DEGRADED', dashboard: { agents: [] } });
  await expect(fetchLiveFleet({ url: 'http://localhost/fleet', signal: new AbortController().signal,
    getToken: async () => 'test-token', fetch: request as typeof fetch })).rejects.toThrow('Telemetría no disponible');
});
test('the deadline bounds a stalled token refresh and prevents a late HTTP request', async () => {
  let finishToken!: (value: string) => void;
  let calls = 0;
  const token = new Promise<string>(resolve => { finishToken = resolve; });
  const result = fetchLiveFleet({ url: 'http://localhost/fleet', getToken: () => token,
    signal: new AbortController().signal, timeoutMs: 10,
    fetch: (async () => { calls++; return Response.json(fixture()); }) as typeof fetch });
  await expect(result).rejects.toThrow('tardó demasiado');
  finishToken('late-token');
  await Promise.resolve(); await Promise.resolve();
  expect(calls).toBe(0);
});
test('unmount cancellation aborts the active fetch', async () => {
  const owner = new AbortController();
  let signal: AbortSignal | undefined;
  const result = fetchLiveFleet({ url: 'http://localhost/fleet', getToken: async () => 'test-token', signal: owner.signal,
    fetch: (async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); }) as typeof fetch });
  await Promise.resolve(); await Promise.resolve();
  owner.abort();
  await expect(result).rejects.toThrow('FLEET_REQUEST_CANCELLED');
  expect(signal?.aborted).toBe(true);
});

test('SSE supports CRLF, multiline data, and arbitrary network chunk boundaries', () => {
  const seen: unknown[] = [];
  const decoder = createEventStreamDecoder(data => seen.push(JSON.parse(data)));
  const source = ': heartbeat\r\ndata: {"type":"delta",\r\ndata: "delta":"hola"}\r\n\r\n';
  for (const char of source) decoder.push(char);
  expect(seen).toEqual([{ type: 'delta', delta: 'hola' }]);
  expect(() => createEventStreamDecoder(() => {}, 10).push('data: xxxxxxxxxxx')).toThrow('TOO_LARGE');
});

test('fleet snapshots reach the screen before the connection closes, using one authenticated request', async () => {
  const seen: LiveFleetPayload[] = [];
  let finish!: () => void, first!: () => void;
  const firstSnapshot = new Promise<void>(resolve => { first = resolve; });
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    const push = (sequence: number) => controller.enqueue(new TextEncoder().encode(
      'data: ' + JSON.stringify({ type: 'snapshot', sequence, payload: fixture() }) + '\r\n\r\n'));
    push(1); finish = () => { push(2); controller.close(); };
  } });
  let requests = 0;
  const result = subscribeLiveFleet({ url: 'http://localhost/fleet', getToken: async () => 'owner-test',
    signal: new AbortController().signal, onSnapshot: payload => { seen.push(payload); first(); },
    fetch: (async (_url, init) => {
      requests++; expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer owner-test');
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch });
  await firstSnapshot; expect(seen).toHaveLength(1);
  finish(); await result; expect(seen).toHaveLength(2); expect(requests).toBe(1);
});

test('fleet streaming preserves JSON compatibility without making a second request', async () => {
  let requests = 0, snapshots = 0;
  await subscribeLiveFleet({ url: 'http://localhost/fleet', getToken: async () => 'owner-test',
    signal: new AbortController().signal, onSnapshot: () => { snapshots++; },
    fetch: (async () => { requests++; return Response.json(fixture()); }) as typeof fetch });
  expect(requests).toBe(1); expect(snapshots).toBe(1);
});

test('an SSE telemetry error cannot leave a successful live state', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(new TextEncoder().encode('data: {"type":"error","status":503}\n\n')); c.close();
  } });
  let snapshots = 0;
  await expect(subscribeLiveFleet({ url: 'http://localhost/fleet', getToken: async () => 'owner-test',
    signal: new AbortController().signal, onSnapshot: () => { snapshots++; },
    fetch: (async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch,
  })).rejects.toThrow('Telemetría no disponible');
  expect(snapshots).toBe(0);
});

test('fleet streaming bounds a stalled body and aborts its network transport', async () => {
  let signal: AbortSignal | undefined;
  await expect(subscribeLiveFleet({ url: 'http://localhost/fleet', getToken: async () => 'owner-test',
    signal: new AbortController().signal, onSnapshot: () => {}, timeoutMs: 10,
    fetch: (async (_url, init) => {
      signal = init?.signal as AbortSignal;
      return new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch,
  })).rejects.toThrow('tardó demasiado');
  expect(signal?.aborted).toBe(true);
});

test('a cancelled token refresh never starts a late fleet stream', async () => {
  const owner = new AbortController(); let finish!: (token: string) => void, requests = 0;
  const token = new Promise<string>(resolve => { finish = resolve; });
  const result = subscribeLiveFleet({ url: 'http://localhost/fleet', getToken: () => token, signal: owner.signal,
    onSnapshot: () => {}, fetch: (async () => { requests++; return Response.json(fixture()); }) as typeof fetch });
  owner.abort(); await expect(result).rejects.toThrow('FLEET_REQUEST_CANCELLED');
  finish('late-token'); await Promise.resolve(); expect(requests).toBe(0);
});
