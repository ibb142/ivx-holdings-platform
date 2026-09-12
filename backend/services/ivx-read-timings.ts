import { AsyncLocalStorage } from 'node:async_hooks';

type Timings = { headersMs: number; payloadMs: number; completed: number; pending: number; poolMs: number | null };
export const readTimings = new AsyncLocalStorage<Timings>();
export function newReadTimings(): Timings {
  return { headersMs: 0, payloadMs: 0, completed: 0, pending: 0, poolMs: null };
}
export function recordPoolCheckout(ms: number): void {
  const metrics = readTimings.getStore();
  if (metrics) metrics.poolMs = (metrics.poolMs ?? 0) + ms;
}
export function timingHeaders(metrics: Timings): Record<string, string> {
  return {
    'X-IVX-Pool-Wait-Ms': metrics.poolMs === null ? 'unavailable' : metrics.poolMs.toFixed(1),
    'X-IVX-Payload-Ms': metrics.completed ? metrics.payloadMs.toFixed(1) : 'unavailable',
    'X-IVX-Upstream-Headers-Ms': metrics.completed || metrics.pending ? metrics.headersMs.toFixed(1) : 'unavailable',
    'X-IVX-Timing-Scope': `request-owned-upstream-sum; completed=${metrics.completed}; pending=${metrics.pending}`,
  };
}
/** HTTP header wait includes network/server time, NOT a measurement of Supavisor checkout.
 * Body timing runs until consumption ends (or fails); never log URLs or payloads.
 */
export async function measuredReadFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const metrics = readTimings.getStore();
  if (!metrics) return fetch(input, init);
  const started = performance.now();
  metrics.pending++;
  let response: Response;
  try { response = await fetch(input, init); }
  catch (error) { metrics.headersMs += performance.now() - started; metrics.pending--; throw error; }
  metrics.headersMs += performance.now() - started;
  const bodyStarted = performance.now();
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true; metrics.payloadMs += performance.now() - bodyStarted;
    metrics.pending--; metrics.completed++;
  };
  if (!response.body) { finish(); return response; }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { finish(); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) { finish(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
