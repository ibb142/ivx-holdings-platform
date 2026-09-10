import type { Pool } from 'pg';

/** Transaction-local deadlines survive Supavisor transaction pooling. */
export async function queryWithPostgresDeadline<T = Record<string, unknown>>(
  pool: Pick<Pool, 'connect'>, text: string, values: unknown[],
) {
  const client = await pool.connect();
  let failed = false;
  let connectionFailure: Error | null = null;
  // pg-pool removes its idle error listener while a client is checked out.
  // A socket loss emits on Client as well as rejecting the active query.
  const onConnectionError = (error: Error) => { connectionFailure = error; };
  client.on('error', onConnectionError);
  try {
    // Startup parameters are not a reliable server deadline through a pooler.
    // BEGIN pins one backend; SET LOCAL applies to the following RPC and resets
    // at transaction end. Server cancellation precedes the client's 5s timeout.
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '4s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '8s'");
    const result = await client.query<T>(text, values);
    if (connectionFailure) throw connectionFailure;
    await client.query('COMMIT');
    if (connectionFailure) throw connectionFailure;
    return result;
  } catch (error) {
    failed = true;
    await client.query('ROLLBACK').catch(() => undefined);
    // Never replay an RPC after an ambiguous timeout or commit response loss.
    throw error;
  } finally {
    // Restore the pool's idle listener (or destroy the connection) before
    // removing ours. Never return a disconnected client to the reusable pool.
    try { client.release(failed || connectionFailure !== null); }
    finally { client.removeListener('error', onConnectionError); }
  }
}
