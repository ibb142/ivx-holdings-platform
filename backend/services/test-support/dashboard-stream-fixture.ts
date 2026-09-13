import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

// Execute the complete real handler, replacing only external services.
// No global module mocks can leak into other backend test files.
export async function dashboardStreamFixture(options: { snapshot?: (request: Request) => Promise<Response> } = {}) {
  const sent: Record<string, any>[] = [], errors: unknown[][] = [];
  const authCalls: Request[] = [], snapshotCalls: Request[] = [];
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number; bufferedAmount: number; send: (data: string) => void; close: (code?: number) => void;
  };
  let closeCode: number | undefined;
  ws.readyState = 1; ws.bufferedAmount = 0;
  ws.send = data => { const message = JSON.parse(data); sent.push(message); ws.emit('sent', message); };
  ws.close = code => { closeCode = code; ws.readyState = 3; ws.emit('close'); };
  const source = readFileSync(new URL('../ivx-autonomous-dashboard-stream.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const handler = new Function('assertIVXRegisteredOwnerBearer', 'handleAutonomousOpsDashboardRequest',
    'console', 'setInterval', 'clearInterval', new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
      + '\nreturn handleAutonomousDashboardStreamConnection;')(
    async (request: Request) => { authCalls.push(request); return { approval: 'fixture-owner' }; },
    async (request: Request) => {
      snapshotCalls.push(request);
      return options.snapshot ? options.snapshot(request)
        : Response.json({ ok: true, dashboard: { jobs: [{ id: 'fixture-job', state: 'RUNNING' }] } });
    },
    { error: (...args: unknown[]) => errors.push(args) },
    (callback: () => void, ms: number) => { const timer = setInterval(callback, ms); intervals.add(timer); return timer; },
    (timer: ReturnType<typeof setInterval>) => { clearInterval(timer); intervals.delete(timer); },
  );
  await handler(ws, { socket: { remoteAddress: '127.0.0.1' } });
  return {
    ws, sent, errors, authCalls, snapshotCalls,
    get closeCode() { return closeCode; },
    intervalCount: () => intervals.size,
    receive: (message: object) => ws.emit('message', Buffer.from(JSON.stringify(message))),
    close: () => { ws.close(); for (const timer of intervals) clearInterval(timer); intervals.clear(); },
    next: (type: string) => new Promise<Record<string, any>>((resolve, reject) => {
      const timer = setTimeout(() => { ws.off('sent', listener); reject(new Error('Missing awaited ' + type)); }, 1000);
      const listener = (message: Record<string, any>) => {
        if (message.type !== type) return;
        clearTimeout(timer); ws.off('sent', listener); resolve(message);
      };
      ws.on('sent', listener);
    }),
  };
}
