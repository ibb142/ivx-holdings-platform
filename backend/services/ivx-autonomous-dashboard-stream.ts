import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';
import { assertIVXRegisteredOwnerBearer } from '../api/owner-only';
import { handleAutonomousOpsDashboardRequest } from '../api/ivx-autonomous-ops-dashboard';

export const IVX_AUTONOMOUS_DASHBOARD_STREAM_PATH = '/api/ivx/autonomous-dashboard-stream';
export const IVX_AUTONOMOUS_DASHBOARD_STREAM_INTERVAL_MS = 1000;
export const IVX_AUTONOMOUS_DASHBOARD_STREAM_MARKER = 'ivx-autonomous-dashboard-realtime-ws-2026-09-01-v1';

const AUTH_TIMEOUT_MS = 10_000;
const WS_OPEN = 1;
const ALLOWED_RANGES = new Set(['24h', 'today', 'yesterday', '7d', '30d']);

type ClientMessage =
  | { type: 'auth'; token?: unknown; range?: unknown }
  | { type: 'set_range'; range?: unknown }
  | { type: 'ping' };

function send(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(payload));
}

function safeRange(value: unknown): string {
  const range = typeof value === 'string' ? value.trim() : '';
  return ALLOWED_RANGES.has(range) ? range : '24h';
}

function ownerRequest(token: string, range: string): Request {
  return new Request(`https://api.ivxholding.com/api/ivx/autonomous-ops?range=${encodeURIComponent(range)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-store',
      'X-IVX-Dashboard-Transport': 'websocket',
    },
  });
}

export async function handleAutonomousDashboardStreamConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
  let token = '';
  let range = '24h';
  let authenticated = false;
  let pushing = false;
  let interval: NodeJS.Timeout | null = null;
  let sequence = 0;

  const stop = () => {
    if (interval) clearInterval(interval);
    interval = null;
  };

  const closeWith = (code: number, reason: string) => {
    stop();
    try { ws.close(code, reason.slice(0, 120)); } catch {}
  };

  const authTimer = setTimeout(() => {
    if (!authenticated) closeWith(4401, 'owner authentication required');
  }, AUTH_TIMEOUT_MS);
  authTimer.unref?.();

  const pushSnapshot = async () => {
    if (!authenticated || !token || pushing || ws.readyState !== WS_OPEN) return;
    pushing = true;
    try {
      const response = await handleAutonomousOpsDashboardRequest(ownerRequest(token, range));
      if (response.status === 401 || response.status === 403) {
        console.error('Error in pushSnapshot:', error);
send(ws, { type: 'auth_error', marker: IVX_AUTONOMOUS_DASHBOARD_STREAM_MARKER, status: response.status });
        closeWith(4401, 'owner session expired');
        return;
      }
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || !payload || payload.ok !== true) {
        send(ws, {
          type: 'stream_error',
          marker: IVX_AUTONOMOUS_DASHBOARD_STREAM_MARKER,
          status: response.status,
          error: typeof payload?.error === 'string' ? payload.error : 'dashboard snapshot unavailable',
          at: new Date().toISOString(),
        });
        return;
      }
      sequence += 1;
      send(ws, {
        type: 'snapshot',
        marker: IVX_AUTONOMOUS_DASHBOARD_STREAM_MARKER,
        sequence,
        serverTime: new Date().toISOString(),
        intervalMs: IVX_AUTONOMOUS_DASHBOARD_STREAM_INTERVAL_MS,
        dashboard: payload.dashboard,
      });
    } catch (error) {
      send(ws, {
        type: 'stream_error',
        marker: IVX_AUTONOMOUS_DASHBOARD_STREAM_MARKER,
        error: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      });
    } finally {
      pushing = false;
    }
  };

  ws.on('message', (raw) => {
    void (async () => {
      let message: ClientMessage;
      try { message = JSON.parse(raw.toString()) as ClientMessage; }
      catch {
        send(ws, { type: 'protocol_error', error: 'invalid json' });
        return;
      }

      if (message.type === 'auth') {
        if (authenticated) return;
        const supplied = typeof message.token === 'string' ? message.token.trim() : '';
        if (!supplied) {
          closeWith(4401, 'owner bearer missing');
          return;
        }
        range = safeRange(message.range);
        try {
          const auth = await assertIVXRegisteredOwnerBearer(ownerRequest(supplied, range), 'autonomous_dashboard_stream');
          token = supplied;
          authenticated = true;
          clearTimeout(authTimer);
          send(ws, {
            type: 'auth_ok',
            marker: IVX_AUTONOMOUS_DASHBOARD_STREAM_MARKER,
            approval: auth.approval,
            transport: 'websocket',
            range,
            intervalMs: IVX_AUTONOMOUS_DASHBOARD_STREAM_INTERVAL_MS,
            connectedAt: new Date().toISOString(),
          });
          await pushSnapshot();
          interval = setInterval(() => { void pushSnapshot(); }, IVX_AUTONOMOUS_DASHBOARD_STREAM_INTERVAL_MS);
          interval.unref?.();
        } catch {
          closeWith(4401, 'owner authentication failed');
        }
        return;
      }

      if (!authenticated) {
        closeWith(4401, 'authenticate first');
        return;
      }

      if (message.type === 'set_range') {
        range = safeRange(message.range);
        send(ws, { type: 'range_ok', range, at: new Date().toISOString() });
        await pushSnapshot();
        return;
      }

      if (message.type === 'ping') {
        send(ws, { type: 'pong', at: new Date().toISOString(), sequence });
      }
    })();
  });

  ws.on('close', stop);
  ws.on('error', stop);

  send(ws, {
    type: 'hello',
    marker: IVX_AUTONOMOUS_DASHBOARD_STREAM_MARKER,
    transport: 'websocket',
    authRequired: true,
    authTimeoutMs: AUTH_TIMEOUT_MS,
    remoteAddress: request.socket.remoteAddress ?? null,
  });
}
