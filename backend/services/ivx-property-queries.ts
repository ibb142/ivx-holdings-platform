/**
 * IVX Property Queries — real read-only queries for property / deal / project data.
 *
 * These queries are used by the owner-ai conversation state machine when the owner
 * asks about properties ("how many", "how many active", "show the latest five").
 * They are read-only, never write, and never fabricate results.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

type PropertyQueryResult = {
  ok: boolean;
  count: number | null;
  rows: Record<string, unknown>[];
  table: string | null;
  filter: string | null;
  httpStatus: number | null;
  reason: 'ok' | 'not_configured' | 'table_not_found' | 'column_not_found' | 'http_error' | 'network_error' | null;
  detail: string;
  queriedAt: string;
  executed: boolean;
};

/**
 * Resolve Supabase for server-side owner-AI tools.
 *
 * Production runtimes should not be forced to define an Expo-prefixed variable.
 * Accept canonical server-side aliases first, retain the public Expo alias for
 * backwards compatibility, and finally use the known public IVX project URL.
 * The service-role key is still required and is never exposed to the client.
 */
function resolveConfig(): { url: string; key: string; missing: string[]; client: SupabaseClient | null } {
  const url = (
    readTrimmed(process.env.SUPABASE_URL)
    || readTrimmed(process.env.IVX_SUPABASE_URL)
    || readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL)
    || 'https://kvclcdjmjghndxsngfzb.supabase.co'
  ).replace(/\/+$/, '');
  const key = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  let client: SupabaseClient | null = null;
  if (url && key) {
    try {
      client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    } catch {
      client = null;
    }
  }
  return { url, key, missing, client };
}

const PROPERTY_TABLES = ['jv_deals', 'properties', 'deals', 'projects', 'listings'];
const ACTIVE_COLUMN_CANDIDATES = ['status', 'active', 'is_active', 'is_active_listing', 'published', 'is_published', 'state', 'listing_status'];
const ACTIVE_VALUES = ['active', 'published', 'available', 'for_sale', 'for rent', 'for_rent', 'live', 'listed', 'true', '1', 'yes'];

async function findExistingTable(client: SupabaseClient, tables: string[]): Promise<{ table: string; exists: boolean }> {
  for (const table of tables) {
    try {
      const { error, status } = await client.from(table).select('id', { count: 'exact', head: true }).limit(1);
      if (!error || status === 200 || status === 204) {
        return { table, exists: true };
      }
      if (status === 404) continue;
    } catch {
      // continue trying
    }
  }
  return { table: tables[0] ?? 'properties', exists: false };
}

async function findActiveColumn(client: SupabaseClient, table: string): Promise<{ column: string | null; values: string[] }> {
  for (const column of ACTIVE_COLUMN_CANDIDATES) {
    try {
      const { error, status } = await client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq(column, ACTIVE_VALUES[0])
        .limit(1);
      if (!error && status !== 404) {
        return { column, values: ACTIVE_VALUES };
      }
    } catch {
      // continue
    }
  }
  return { column: null, values: [] };
}

export async function countActiveProperties(): Promise<PropertyQueryResult> {
  const { missing, client } = resolveConfig();
  const queriedAt = nowIso();
  if (missing.length > 0 || !client) {
    return {
      ok: false, count: null, rows: [], table: null, filter: null, httpStatus: null,
      reason: 'not_configured', detail: `Supabase not configured. Missing: ${missing.join(', ')}.`,
      queriedAt, executed: false,
    };
  }

  try {
    const { table, exists } = await findExistingTable(client, PROPERTY_TABLES);
    if (!exists) {
      return {
        ok: false, count: null, rows: [], table, filter: null, httpStatus: 404,
        reason: 'table_not_found', detail: `No property table found (tried ${PROPERTY_TABLES.join(', ')}).`,
        queriedAt, executed: true,
      };
    }

    const { column, values } = await findActiveColumn(client, table);
    if (!column) {
      return {
        ok: false, count: null, rows: [], table, filter: null, httpStatus: null,
        reason: 'column_not_found', detail: `No active-status column found in ${table} (tried ${ACTIVE_COLUMN_CANDIDATES.join(', ')}).`,
        queriedAt, executed: true,
      };
    }

    // One OR expression. Repeated .or() calls can accidentally compose as ANDs.
    const orFilter = values.map((value) => `${column}.eq.${value}`).join(',');
    const { count, error, status } = await client
      .from(table)
      .select('id', { count: 'exact', head: true })
      .or(orFilter)
      .limit(1);

    if (error) {
      return {
        ok: false, count: null, rows: [], table, filter: `${column} in (${values.join(', ')})`, httpStatus: status ?? 500,
        reason: 'http_error', detail: error.message,
        queriedAt, executed: true,
      };
    }

    return {
      ok: true, count: count ?? 0, rows: [], table, filter: `${column} in (${values.join(', ')})`, httpStatus: status ?? 200,
      reason: 'ok', detail: `Active property count on ${table}.${column} = ${count ?? 0}.`,
      queriedAt, executed: true,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network error';
    return {
      ok: false, count: null, rows: [], table: null, filter: null, httpStatus: null,
      reason: 'network_error', detail,
      queriedAt, executed: true,
    };
  }
}

export async function listLatestProperties(limit: number = 5): Promise<PropertyQueryResult> {
  const { missing, client } = resolveConfig();
  const queriedAt = nowIso();
  if (missing.length > 0 || !client) {
    return {
      ok: false, count: null, rows: [], table: null, filter: null, httpStatus: null,
      reason: 'not_configured', detail: `Supabase not configured. Missing: ${missing.join(', ')}.`,
      queriedAt, executed: false,
    };
  }

  try {
    const { table, exists } = await findExistingTable(client, PROPERTY_TABLES);
    if (!exists) {
      return {
        ok: false, count: null, rows: [], table, filter: null, httpStatus: 404,
        reason: 'table_not_found', detail: `No property table found (tried ${PROPERTY_TABLES.join(', ')}).`,
        queriedAt, executed: true,
      };
    }

    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const { data, error, status } = await client
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(boundedLimit);

    if (error) {
      const fallback = await client.from(table).select('*').order('id', { ascending: false }).limit(boundedLimit);
      if (fallback.error) {
        return {
          ok: false, count: null, rows: [], table, filter: null, httpStatus: status ?? 500,
          reason: 'http_error', detail: error.message,
          queriedAt, executed: true,
        };
      }
      return {
        ok: true, count: (fallback.data ?? []).length, rows: (fallback.data ?? []) as Record<string, unknown>[], table, filter: null, httpStatus: 200,
        reason: 'ok', detail: `Latest ${(fallback.data ?? []).length} properties from ${table} (ordered by id).`,
        queriedAt, executed: true,
      };
    }

    return {
      ok: true, count: (data ?? []).length, rows: (data ?? []) as Record<string, unknown>[], table, filter: null, httpStatus: 200,
      reason: 'ok', detail: `Latest ${(data ?? []).length} properties from ${table} (ordered by created_at desc).`,
      queriedAt, executed: true,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network error';
    return {
      ok: false, count: null, rows: [], table: null, filter: null, httpStatus: null,
      reason: 'network_error', detail,
      queriedAt, executed: true,
    };
  }
}
