import type { Pool } from 'pg';

/** Transaction-local deadlines survive Supavisor transaction pooling. */
export async function queryWithPostgresDeadline<T = Record<string, unknown>>(
  pool: Pick<Pool, 'connect'>, text: string, values: unknown[],
) {
  const client = await pool.connect();
  let failed = false;
  try {
    // Startup parameters are not a reliable server deadline through a pooler.
    // BEGIN pins one backend; SET LOCAL applies to the following RPC and resets
    // at transaction end. Server cancellation precedes the client's 5s timeout.
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '4s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '8s'");
    const result = await client.query<T>(text, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    failed = true;
    await client.query('ROLLBACK').catch(() => undefined);
    // Never replay an RPC after an ambiguous timeout or commit response loss.
    throw error;
  } finally {
    client.release(failed);
  }
}
