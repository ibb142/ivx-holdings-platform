import { createCancellableEventStream } from './ivx-cancellable-event-stream';

/** One bounded observation at a time; each read rechecks the owner's session. */
export function createLiveFleetStream(options: {
  signal: AbortSignal;
  initial: unknown;
  read: () => Promise<Response>;
  intervalMs?: number;
  maxDurationMs?: number;
  readTimeoutMs?: number;
}): ReadableStream<Uint8Array> {
  return createCancellableEventStream(options.signal, async (signal, send) => {
    let sequence = 1;
    send({ type: 'snapshot', sequence, payload: options.initial });
    const endAt = Date.now() + (options.maxDurationMs ?? 55_000);
    const bounded = async <T>(run: () => Promise<T>, ms: number, timeout: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort = () => {};
      const stopped = new Promise<never>((_, reject) => {
        abort = () => reject(new Error('FLEET_STREAM_CANCELLED'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        timer = setTimeout(() => reject(new Error(timeout)), ms);
      });
      try { return await Promise.race([Promise.resolve().then(() => {
        if (signal.aborted) throw new Error('FLEET_STREAM_CANCELLED');
        return run();
      }), stopped]); }
      finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    };
    try {
      while (!signal.aborted) {
        const waitMs = Math.min(options.intervalMs ?? 5000, Math.max(0, endAt - Date.now()));
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, waitMs);
          signal.addEventListener('abort', done, { once: true });
          if (signal.aborted) done();
        });
        if (signal.aborted || Date.now() >= endAt) return;
        const result = await bounded(async () => {
          const response = await options.read();
          return { status: response.status, ok: response.ok, payload: await response.json() };
        }, Math.min(options.readTimeoutMs ?? 10_000, endAt - Date.now()), 'FLEET_READ_TIMEOUT');
        if (!result.ok || result.payload?.ok !== true) {
          send({ type: 'error', status: result.status, error: 'FLEET_TELEMETRY_UNAVAILABLE' });
          return;
        }
        send({ type: 'snapshot', sequence: ++sequence, payload: result.payload });
      }
    } catch {
      if (!signal.aborted) send({ type: 'error', status: 503, error: 'FLEET_TELEMETRY_UNAVAILABLE' });
    }
  });
}
