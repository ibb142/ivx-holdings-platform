import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { recordPoolCheckout } from './ivx-read-timings';

export const SENIOR_QUEUE_READ_BUDGET_MS = 3_500;

export class SeniorQueueReadTimeout extends Error {
  readonly code = 'IVX_QUEUE_READ_TIMEOUT';
  readonly retryable = true;
  constructor(readonly budgetMs: number) {
    super(`Queue read timeout after ${budgetMs}ms`);
    this.name = 'SeniorQueueReadTimeout';
  }
}

type ReadBudget = {
  signal: AbortSignal;
  check: () => void;
  fail: (error: unknown) => void;
  onAbort: (cleanup: () => void) => () => void;
};

/** One elapsed-time budget, including connection acquisition and response body. */
async function withReadBudget<T>(work: (budget: ReadBudget) => Promise<T>, budgetMs: number): Promise<T> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > SENIOR_QUEUE_READ_BUDGET_MS) {
    throw new Error('Repair read budget must be between 1 and 3500ms');
  }
  const controller = new AbortController();
  const deadline = performance.now() + budgetMs;
  let rejectAbort!: (error: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const fail = (error: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(error);
    rejectAbort(error);
  };
  const expire = () => fail(new SeniorQueueReadTimeout(budgetMs));
  const budget: ReadBudget = {
    signal: controller.signal,
    fail,
    check: () => {
      if (performance.now() >= deadline) expire();
      if (controller.signal.aborted) throw controller.signal.reason;
    },
    onAbort: cleanup => {
      const run = () => { try { cleanup(); } catch { /* Preserve the read failure. */ } };
      if (controller.signal.aborted) run();
      else controller.signal.addEventListener('abort', run, { once: true });
      return () => controller.signal.removeEventListener('abort', run);
    },
  };
  const timer = setTimeout(expire, budgetMs);
  const operation = Promise.resolve().then(() => { budget.check(); return work(budget); })
    .then(value => { budget.check(); return value; })
    .catch(error => { fail(error); throw error; });
  // Both promises retain rejection handlers after the deadline wins. Late
  // connection acquisition is handled by the transport, never left checked out.
  try { return await Promise.race([operation, aborted]); }
  finally { clearTimeout(timer); }
}

/** Only repair SELECTs use this wrapper. Mutation RPCs keep their own policy. */
export async function queryWithSeniorQueueReadBudget<T = Record<string, unknown>>(
  pool: Pick<Pool, 'connect'>, sql: string, values: unknown[],
  budgetMs = SENIOR_QUEUE_READ_BUDGET_MS,
) {
  const start = performance.now();
  let stage: 'checkout' | 'setup' | 'query' | 'commit' = 'checkout';
  try {
    return await withReadBudget(async budget => {
      const client: PoolClient = await pool.connect();
      recordPoolCheckout(Math.max(0, performance.now() - start));
      let released = false;
      let succeeded = false;
      const release = (destroy: boolean) => {
        if (released) return;
        released = true;
        client.release(destroy);
      };
      const onError = (error: Error) => budget.fail(error);
      client.on('error', onError);
      // If checkout finishes after expiry, destroy it before sending any SQL.
      const stop = budget.onAbort(() => release(true));
      try {
        budget.check();
        stage = 'setup';
        await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '4s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '8s'");
        budget.check();
        stage = 'query';
        const result = await client.query<T>(sql, values);
        budget.check();
        stage = 'commit';
        await client.query('COMMIT');
        budget.check();
        succeeded = true;
        return result;
      } finally {
        stop();
        try { release(!succeeded); }
        finally { client.removeListener('error', onError); }
      }
    }, budgetMs);
  } catch (error) {
    try {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      console.error('[IVX repair read] deadline failure ' + JSON.stringify({
        pool: 'repair', stage, queryHash: createHash('sha256').update(sql).digest('hex').slice(0, 16),
        sqlState: typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null,
        budgetExpired: error instanceof SeniorQueueReadTimeout, budgetMs,
        elapsedMs: Math.max(0, Math.round(performance.now() - start)),
      }));
    } catch { /* Logging never replaces the original failure. */ }
    throw error;
  }
}

/** Existing repair documents only: one GET, no schema work or outage retries. */
export function readSeniorQueueJson<T>(url: string, headers: Record<string, string>,
  budgetMs = SENIOR_QUEUE_READ_BUDGET_MS): Promise<T> {
  return withReadBudget(async budget => {
    const response = await fetch(url, { method: 'GET', headers, signal: budget.signal });
    const reader = response.body?.getReader();
    let consumed = false;
    const cancel = () => { void reader?.cancel(budget.signal.reason).catch(() => {}); };
    const stop = budget.onAbort(cancel);
    try {
      budget.check();
      if (!response.ok) throw new Error(`Shared senior queue read rejected (HTTP ${response.status})`);
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      if (reader) {
        while (true) {
          const part = await reader.read();
          budget.check();
          if (part.done) { consumed = true; break; }
          chunks.push(decoder.decode(part.value, { stream: true }));
        }
      }
      chunks.push(decoder.decode());
      const value: T = JSON.parse(chunks.join(''));
      budget.check();
      return value;
    } finally {
      if (!consumed) cancel();
      stop();
      try { reader?.releaseLock(); } catch { /* Cancellation settles a pending read. */ }
    }
  }, budgetMs);
}
