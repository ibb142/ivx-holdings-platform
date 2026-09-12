import { measuredSqlExecution, recordPoolCheckout } from './ivx-read-timings';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';

const poolPurposes = new WeakMap<object, string>();
const poolEvents = new WeakMap<object, { connects: number; acquires: number }>();
const transactionSetup = {
  default: "BEGIN; SET LOCAL statement_timeout = '4s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '8s'",
  assignment: "BEGIN; SET LOCAL statement_timeout = '2500ms'; SET LOCAL lock_timeout = '1000ms'; SET LOCAL idle_in_transaction_session_timeout = '8s'",
} as const;

/** pg removes failed idle connections itself; observe the error without exiting. */
export function observePostgresPoolErrors(pool: Pick<Pool, 'on'>, purpose: string): void {
  if (poolEvents.has(pool)) return;
  poolPurposes.set(pool, purpose);
  const events = { connects: 0, acquires: 0 };
  poolEvents.set(pool, events);
  pool.on('connect', () => { events.connects++; });
  pool.on('acquire', () => { events.acquires++; });
  pool.on('error', () => console.error('[IVX PostgreSQL] idle connection failed', { pool: purpose }));
}

/** Transaction-local deadlines survive Supavisor transaction pooling. */
export async function queryWithPostgresDeadline<T = Record<string, unknown>>(
  pool: Pick<Pool, 'connect'>, text: string, values: unknown[],
  deadline: keyof typeof transactionSetup = 'default',
) {
  const startedAt = Date.now();
  let stageStartedAt = startedAt;
  let stage: 'checkout' | 'setup' | 'query' | 'commit' = 'checkout';
  const reportFailure = (error: unknown) => {
    // Identify a static SQL template without logging SQL, bound values, server
    // error text, or connection credentials. Logging must not replace the error.
    try {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      console.error('[IVX PostgreSQL] deadline failure ' + JSON.stringify({
        pool: poolPurposes.get(pool) ?? 'unregistered', stage,
        queryHash: createHash('sha256').update(text).digest('hex').slice(0, 16),
        sqlState: typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        stageElapsedMs: Math.max(0, Date.now() - stageStartedAt),
      }));
    } catch { /* Preserve the original database failure if logging fails. */ }
  };
  const acquisitionStarted = performance.now();
  const snapshot = pool as Partial<Pick<Pool, 'totalCount' | 'idleCount' | 'waitingCount'>>;
  const waitingAtStart = snapshot.waitingCount ?? null;
  const idleAtStart = snapshot.idleCount ?? null;
  const observeAcquisition = (ok: boolean) => {
    const acquisitionMs = Math.max(0, performance.now() - acquisitionStarted);
    recordPoolCheckout(acquisitionMs);
    if (acquisitionMs > 500) {
      try {
        console.warn('[IVX PostgreSQL] slow acquisition', {
          pool: poolPurposes.get(pool) ?? 'unregistered', acquisitionMs, ok,
          waitingAtStart, idleAtStart, waitingNow: snapshot.waitingCount ?? null,
          total: snapshot.totalCount ?? null, ...poolEvents.get(pool),
          // Checkout includes connection establishment. Query time is measured
          // separately; REST clients cannot observe the provider's pool here.
          scope: 'local-pg-checkout-including-connect',
        });
      } catch { /* Telemetry must never change database semantics. */ }
    }
  };
  const client = await pool.connect().catch(error => { observeAcquisition(false); reportFailure(error); throw error; });
  observeAcquisition(true);
  let failed = false;
  let connectionError: Error | null = null;
  const onConnectionError = (error: Error) => { connectionError = error; };
  const requireConnection = () => { if (connectionError) throw connectionError; };
  // A checked-out pg client no longer has the pool's idle error listener.
  // Socket termination can emit an error even between awaited statements.
  client.on('error', onConnectionError);
  try {
    // Startup parameters are not a reliable server deadline through a pooler.
    // BEGIN pins one backend; SET LOCAL applies to the following RPC and resets
    // at transaction end. Server cancellation precedes the client's 5s timeout.
    // One simple-query round trip pins the transaction and installs the same
    // local limits. The parameterized mutation is sent only after this succeeds.
    stage = 'setup'; stageStartedAt = Date.now();
    requireConnection();
    await client.query(transactionSetup[deadline]);
    requireConnection();
    stage = 'query'; stageStartedAt = Date.now();
    const result = await measuredSqlExecution(async () => {
      const result = await client.query<T>(text, values);
      requireConnection();
      return result;
    });
    stage = 'commit'; stageStartedAt = Date.now();
    await client.query('COMMIT');
    requireConnection();
    return result;
  } catch (error) {
    failed = true;
    reportFailure(error);
    // A client timeout or connection failure leaves protocol state uncertain.
    // Do not enqueue ROLLBACK behind an unanswered query and wait another timeout.
    // The finally block destroys this connection; never return it to the pool.
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    const serverRejected = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
      && !code.startsWith('08') && !['57P01', '57P02', '57P03'].includes(code);
    if (!connectionError && serverRejected) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    // Never replay an RPC after an ambiguous timeout or commit response loss.
    throw error;
  } finally {
    try { client.release(failed || Boolean(connectionError)); }
    finally { client.removeListener('error', onConnectionError); }
  }
}
