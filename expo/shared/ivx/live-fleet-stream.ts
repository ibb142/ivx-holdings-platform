import { createEventStreamDecoder } from './event-stream';
import { parseLiveFleetPayload, type LiveFleetPayload } from './live-fleet-dashboard';

/** One connection; callers reconnect after it closes. JSON supports older APIs. */
export async function subscribeLiveFleet(options: {
  url: string; getToken: () => Promise<string | null>; signal: AbortSignal;
  onSnapshot: (payload: LiveFleetPayload) => void;
  fetch?: typeof fetch; timeoutMs?: number;
}): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStopped: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  // Cancellation can happen between reads; keep the rejection observed.
  void stopped.catch(() => {});
  const stop = (error: Error) => { rejectStopped(error); controller.abort(error); };
  const abort = () => stop(new Error('FLEET_REQUEST_CANCELLED'));
  options.signal.addEventListener('abort', abort, { once: true });
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop(new Error('La telemetría tardó demasiado. Se reintentará.')), options.timeoutMs ?? 12_000);
  };
  arm();
  if (options.signal.aborted) abort();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cleanEOF = false;
  try {
    const token = await Promise.race([options.getToken(), stopped]);
    if (controller.signal.aborted) throw new Error('FLEET_REQUEST_CANCELLED');
    if (!token) throw new Error('Inicia sesión como owner para ver la flota.');
    const response = await Promise.race([(options.fetch ?? fetch)(options.url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: controller.signal,
    }), stopped]);
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'La sesión no permite consultar la flota.' : 'Telemetría no disponible. Se reintentará.');
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const payload = parseLiveFleetPayload(await Promise.race([response.json(), stopped]));
      if (controller.signal.aborted) throw new Error('FLEET_REQUEST_CANCELLED');
      options.onSnapshot(payload); cleanEOF = true; return;
    }
    if (!response.body) throw new Error('El stream de la flota no está disponible.');
    reader = response.body.getReader();
    let sequence = 0;
    const decoder = new TextDecoder();
    const events = createEventStreamDecoder(data => {
      if (controller.signal.aborted) return;
      const event = JSON.parse(data);
      if (event?.type === 'error') throw new Error('Telemetría no disponible. Se reintentará.');
      if (event?.type !== 'snapshot') return;
      if (!Number.isSafeInteger(event.sequence) || event.sequence <= sequence) throw new Error('Secuencia de telemetría inválida.');
      const payload = parseLiveFleetPayload(event.payload);
      sequence = event.sequence;
      options.onSnapshot(payload);
      arm();
    }, 1_048_576);
    while (!controller.signal.aborted) {
      const { value, done } = await Promise.race([reader.read(), stopped]);
      if (done) { cleanEOF = true; break; }
      events.push(decoder.decode(value, { stream: true }));
    }
    if (sequence === 0) throw new Error('El stream terminó sin observaciones.');
  } finally {
    clearTimeout(timer); options.signal.removeEventListener('abort', abort);
    // Expo SDK54's reader.cancel races native stream completion; abort fetch.
    if (!cleanEOF && !controller.signal.aborted) controller.abort();
    reader?.releaseLock();
  }
}
