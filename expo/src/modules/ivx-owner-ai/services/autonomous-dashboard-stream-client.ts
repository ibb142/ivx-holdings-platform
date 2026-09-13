import type { DashboardStreamMeta, DateRange, AutonomousOpsDashboard } from './ivxAutonomousOpsService';

type Socket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onerror' | 'onclose' | 'readyState' | 'send' | 'close'>;
type Options = {
  token: string; url: string; range: DateRange;
  normalize: (raw: AutonomousOpsDashboard) => AutonomousOpsDashboard;
  onSnapshot: (dashboard: AutonomousOpsDashboard, meta: DashboardStreamMeta) => void;
  onState?: (meta: DashboardStreamMeta) => void;
  onError?: (error: Error) => void;
};

/** A stalled socket must reach the screen's existing reconnect loop. A socket
 * authenticating successfully is not yet a live snapshot or productive work. */
export function connectDashboardSocket(opts: Options, deps = {
  createSocket: (url: string): Socket => new WebSocket(url),
  schedule: (fn: () => void) => setTimeout(fn, 15_000),
  cancel: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
}) {
  let closed = false, sequence = 0, currentRange = opts.range;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let meta: DashboardStreamMeta = { state: 'CONNECTING', sequence: 0, serverTime: null,
    intervalMs: null, marker: null, transport: 'websocket' };
  const emit = (patch: Partial<DashboardStreamMeta>) => { meta = { ...meta, ...patch, sequence }; opts.onState?.(meta); };
  const ws = deps.createSocket(opts.url);
  const clear = () => { if (timer !== null) deps.cancel(timer); timer = null; };
  const fail = (reason: string) => {
    if (closed) return;
    closed = true; clear();
    emit({ state: 'ERROR' });
    try { ws.close(); } catch { /* Socket already closed. */ }
    opts.onError?.(new Error(reason));
  };
  const arm = () => { clear(); timer = deps.schedule(() => fail('Autonomous dashboard stream stalled; reconnecting.')); };
  emit({ state: 'CONNECTING' }); arm();
  ws.onopen = () => {
    if (closed) return;
    emit({ state: 'AUTHENTICATING' }); arm();
    try { ws.send(JSON.stringify({ type: 'auth', token: opts.token, range: currentRange })); }
    catch { fail('Autonomous dashboard authentication transport failed.'); }
  };
  ws.onmessage = event => {
    if (closed) return;
    try {
      const message = JSON.parse(String(event.data));
      if (message?.type === 'auth_ok') {
        emit({ state: 'AUTHENTICATING', marker: typeof message.marker === 'string' ? message.marker : null,
          intervalMs: typeof message.intervalMs === 'number' ? message.intervalMs : null });
      } else if (message?.type === 'snapshot') {
        if (!Number.isSafeInteger(message.sequence) || message.sequence <= sequence) return;
        const dashboard = opts.normalize(message.dashboard);
        sequence = message.sequence;
        meta = { ...meta, state: 'LIVE', sequence,
          serverTime: typeof message.serverTime === 'string' ? message.serverTime : null };
        arm(); opts.onSnapshot(dashboard, meta); opts.onState?.(meta);
      } else if (['stream_error', 'auth_error', 'protocol_error'].includes(message?.type)) {
        fail(`Autonomous dashboard ${message.type}; fresh evidence unavailable.`);
      }
    } catch { fail('Invalid autonomous dashboard stream response.'); }
  };
  ws.onerror = () => fail('Autonomous dashboard WebSocket error.');
  ws.onclose = () => { if (!closed) { closed = true; clear(); emit({ state: 'RECONNECTING' }); } };
  return {
    close: () => { if (closed) return; closed = true; clear(); emit({ state: 'CLOSED' }); try { ws.close(); } catch {} },
    setRange: (range: DateRange) => {
      currentRange = range;
      if (!closed && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'set_range', range })); } catch { fail('Autonomous dashboard range update failed.'); }
      }
    },
  };
}
