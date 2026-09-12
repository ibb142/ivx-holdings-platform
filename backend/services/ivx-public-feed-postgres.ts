import { getApiPool } from './ivx-database-pools';
import { emergencyStopPostgresConfig } from './ivx-emergency-stop-postgres';
import { queryWithPostgresDeadline } from './ivx-postgres-deadline';

/** Fixed, server-owned SELECT templates only. Keep the former REST transport
 * when direct PostgreSQL is not configured; never replay a failed SQL read as
 * a successful empty result. Preserve the public role and its RLS policies. */
export async function publicFeedRead<T>(
  sql: string, values: unknown[], rest: () => PromiseLike<{ data: T[] | null; error?: unknown; count?: number | null }>,
  role: 'anon' | 'service_role' = 'service_role',
): Promise<{ data: T[] | null; error?: unknown; count?: number | null }> {
  const env = process.env;
  if (!(env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL || env.SUPABASE_POOLER_URL)?.trim()) return rest();
  emergencyStopPostgresConfig(env); // Reject a mismatched project before reading.
  const effectiveRole = role === 'anon' || !(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY)?.trim() ? 'anon' : 'service_role';
  // row_to_json preserves PostgREST's JSON date/numeric representation.
  const result = await queryWithPostgresDeadline<{ value: T }>(getApiPool(),
    `select row_to_json(feed_row) as value from (${sql}) feed_row`, values, effectiveRole);
  return { data: result.rows.map(row => row.value), error: null };
}
