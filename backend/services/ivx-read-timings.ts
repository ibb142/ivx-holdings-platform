import { AsyncLocalStorage } from 'node:async_hooks';

type Timings = { headersMs: number; payloadMs: number; completed: number; pending: number;
  poolMs: number | null; poolMaxMs?: number; sqlMs: number | null; sqlCompleted: number; sqlPending: number; deadline?: AbortSignal };
export const readTimings = new AsyncLocalStorage<Timings>();
export function newReadTimings(timeoutMs?: number): Timings {
  return { headersMs: 0, payloadMs: 0, completed: 0, pending: 0, poolMs: null,
    sqlMs: null, sqlCompleted: 0, sqlPending: 0, deadline: timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs) };
}
export function recordPoolCheckout(ms: number): void {
  const metrics = readTimings.getStore();
  if (metrics) {
    metrics.poolMs = (metrics.poolMs ?? 0) + ms;
    metrics.poolMaxMs = Math.max(metrics.poolMaxMs ?? 0, ms);
  }
}
/** Client-observed query round trips, including failed attempts and lock/network
 * waits. Excludes checkout, transaction setup and commit; not server CPU time.
 * Capture the request context before awaiting so unrelated requests stay isolated.
 */
export async function measuredSqlQuery<T>(operation: () => Promise<T>): Promise<T> {
  const metrics = readTimings.getStore();
  if (!metrics) return operation();
  const started = performance.now();
  metrics.sqlPending++;
  try { return await operation(); }
  finally {
    metrics.sqlMs = (metrics.sqlMs ?? 0) + Math.max(0, performance.now() - started);
    metrics.sqlPending--; metrics.sqlCompleted++;
  }
}
export function timingHeaders(metrics: Timings): Record<string, string> {
  return {
    'X-Pool-Acquisition-Ms': metrics.poolMaxMs === undefined ? 'unavailable' : metrics.poolMaxMs.toFixed(1),
    // A fallback may be returned while a query is still running. Do not present
    // an incomplete sum, or an unobserved REST/cache read, as finished SQL time.
    'X-SQL-Execution-Ms': metrics.sqlMs === null || metrics.sqlPending > 0 ? 'unavailable' : metrics.sqlMs.toFixed(1),
    'X-IVX-Pool-Wait-Ms': metrics.poolMs === null ? 'unavailable' : metrics.poolMs.toFixed(1),
    'X-IVX-Payload-Ms': metrics.completed ? metrics.payloadMs.toFixed(1) : 'unavailable',
    'X-IVX-Upstream-Headers-Ms': metrics.completed || metrics.pending ? metrics.headersMs.toFixed(1) : 'unavailable',
    'X-IVX-Timing-Scope': `request-owned-upstream-sum; completed=${metrics.completed}; pending=${metrics.pending}; sql=client-query-roundtrip-sum; sql_completed=${metrics.sqlCompleted}; sql_pending=${metrics.sqlPending}`,
  };
}
/** HTTP header wait includes network/server time, NOT a measurement of Supavisor checkout.
 * Body timing runs until consumption ends (or fails); never log URLs or payloads.
 */
export async function measuredReadFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const metrics = readTimings.getStore();
  if (!metrics) return fetch(input, init);
  const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const signal = metrics.deadline ? AbortSignal.any([metrics.deadline, ...(caller ? [caller] : [])]) : caller;
  const started = performance.now();
  metrics.pending++;
  let response: Response;
  try { response = await fetch(input, { ...init, signal }); }
  catch (error) { metrics.headersMs += performance.now() - started; metrics.pending--; if (signal?.aborted) throw new DOMException('Public read deadline exceeded', 'AbortError'); throw error; }
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
      } catch (error) { finish(); controller.error(signal?.aborted ? new DOMException('Public read deadline exceeded', 'AbortError') : error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** PostgREST retries TimeoutError as a network failure. Normalize our expired
 * deadline to AbortError so it cannot create a fresh timeout on every retry. */
export async function boundedReadFetch(input: string | URL | Request, init?: RequestInit, timeoutMs = 5000): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const budget = readTimings.getStore()?.deadline;
  const signal = AbortSignal.any([deadline, ...(caller ? [caller] : []), ...(budget ? [budget] : [])]);
  try { return await measuredReadFetch(input, { ...init, signal }); }
  catch (error) {
    if (signal.aborted) throw new DOMException('Supabase request cancelled or deadline exceeded', 'AbortError');
    throw error;
  }
}
