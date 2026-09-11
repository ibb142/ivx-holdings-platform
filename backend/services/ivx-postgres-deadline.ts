import type { Pool } from 'pg';

/** pg removes failed idle connections itself; observe the error without exiting. */
export function observePostgresPoolErrors(pool: Pick<Pool, 'on'>, purpose: string): void {
  pool.on('error', () => console.error('[IVX PostgreSQL] idle connection failed', { pool: purpose }));
}

/** Transaction-local deadlines survive Supavisor transaction pooling. */
export async function queryWithPostgresDeadline<T = Record<string, unknown>>(
  pool: Pick<Pool, 'connect'>, text: string, values: unknown[],
) {
  const client = await pool.connect();
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
    requireConnection();
    await client.query("BEGIN; SET LOCAL statement_timeout = '4s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '8s'");
    requireConnection();
    const result = await client.query<T>(text, values);
    requireConnection();
    await client.query('COMMIT');
    requireConnection();
    return result;
  } catch (error) {
    failed = true;
    await client.query('ROLLBACK').catch(() => undefined);
    // Never replay an RPC after an ambiguous timeout or commit response loss.
    throw error;
  } finally {
    try { client.release(failed || Boolean(connectionError)); }
    finally { client.removeListener('error', onConnectionError); }
  }
}
