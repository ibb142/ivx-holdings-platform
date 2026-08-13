/**
 * IVX Database Migration Runner
 *
 * Applies SQL migrations to the production Supabase database via the
 * Supabase Management API (POST /v1/projects/{ref}/database/query).
 * Uses the SUPABASE_ACCESS_TOKEN env var configured on Render.
 *
 * Owner-only: requires assertIVXOwnerOnly.
 */

import { assertIVXOwnerOnly } from './owner-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEPLOYMENT_MARKER = 'ivx-db-migration-runner-v1';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function getSupabaseProjectRef(): string {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return match ? match[1] : '';
}

async function getSupabaseAccessToken(): Promise<string> {
  const direct = process.env.SUPABASE_ACCESS_TOKEN || process.env.IVX_OWNER_SUPABASE_ACCESS_TOKEN || '';
  if (direct) return direct;
  try {
    const { getIVXOwnerVariableRuntimeValue } = await import('./ivx-owner-variables');
    const token = await getIVXOwnerVariableRuntimeValue('SUPABASE_ACCESS_TOKEN');
    return token || '';
  } catch {
    return '';
  }
}

/**
 * Execute SQL via the Supabase Management API.
 * The Management API requires a personal access token (sbp_...), not the service role key.
 */
async function executeSqlViaManagementApi(sql: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const projectRef = getSupabaseProjectRef();
  const accessToken = await getSupabaseAccessToken();

  if (!projectRef) {
    return { ok: false, error: 'SUPABASE_URL not configured or project ref could not be extracted.' };
  }
  if (!accessToken) {
    return { ok: false, error: 'SUPABASE_ACCESS_TOKEN not configured.' };
  }

  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

    if (!response.ok) {
      const message = typeof payload === 'object' && payload
        ? String((payload as Record<string, unknown>).message || (payload as Record<string, unknown>).error || `HTTP ${response.status}`)
        : `HTTP ${response.status}: ${text.substring(0, 200)}`;
      return { ok: false, error: message };
    }

    return { ok: true, result: payload };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error executing SQL.' };
  }
}

/**
 * Execute SQL via the Supabase REST RPC endpoint using the service role key.
 * This is a fallback when the Management API token is not available.
 * It calls a special-purpose function if one exists, or returns an error.
 */
async function executeSqlViaServiceRole(sql: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const url = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

  if (!url || !key) {
    return { ok: false, error: 'Service role key not configured.' };
  }

  // The Supabase REST API does not support arbitrary DDL.
  // We can only use this path if there's an rpc function that executes SQL.
  // For now, return an error indicating the Management API is required.
  return { ok: false, error: 'Service role key cannot execute DDL via REST. Management API token required.' };
}

export function migrationOptions(): Response {
  return jsonResponse({ deploymentMarker: DEPLOYMENT_MARKER }, 204);
}

/**
 * POST /api/ivx/db-migration/run
 * Body: { migrationName: "IVX-ENTERPRISE-REGISTRATION" }
 * Owner-only: applies a named SQL migration to the production database.
 */
export async function handleRunMigrationRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return jsonResponse({ ok: false, error: 'Owner authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const migrationName = String(body.migrationName || '').trim();
  if (!migrationName) {
    return jsonResponse({ ok: false, error: 'migrationName is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  // Allow inline SQL to be passed directly (bypasses disk read — useful when the
  // file on the server is stale and a deploy hasn't completed yet).
  const inlineSql = typeof body.sql === 'string' && body.sql.trim() ? String(body.sql) : null;

  // Only allow known migrations (when reading from disk)
  const ALLOWED_MIGRATIONS: Record<string, string> = {
    'IVX-ENTERPRISE-REGISTRATION': path.join(process.cwd(), 'expo', 'supabase', 'IVX-ENTERPRISE-REGISTRATION.sql'),
    'ivx-real-estate-platform': path.join(process.cwd(), 'supabase', 'migrations', 'ivx-real-estate-platform.sql'),
    'ivx-platform-extensions': path.join(process.cwd(), 'supabase', 'migrations', 'ivx-platform-extensions.sql'),
  };

  // Read the SQL — either inline from the request body, or from the server disk.
  let sql: string;
  if (inlineSql) {
    sql = inlineSql;
  } else {
    const filePath = ALLOWED_MIGRATIONS[migrationName];
    if (!filePath) {
      return jsonResponse({
        ok: false,
        error: `Unknown migration: ${migrationName}. Allowed: ${Object.keys(ALLOWED_MIGRATIONS).join(', ')}`,
        deploymentMarker: DEPLOYMENT_MARKER,
      }, 400);
    }
    try {
      sql = await readFile(filePath, 'utf8');
    } catch {
      return jsonResponse({
        ok: false,
        error: `Migration file not found on server: ${filePath}`,
        deploymentMarker: DEPLOYMENT_MARKER,
      }, 404);
    }
  }

  // Execute via Management API
  const result = await executeSqlViaManagementApi(sql);

  if (!result.ok) {
    // Try fallback
    const fallback = await executeSqlViaServiceRole(sql);
    if (!fallback.ok) {
      return jsonResponse({
        ok: false,
        error: `Migration failed. Management API: ${result.error}. Fallback: ${fallback.error}`,
        migrationName,
        deploymentMarker: DEPLOYMENT_MARKER,
      }, 500);
    }
    return jsonResponse({
      ok: true,
      migrationName,
      method: 'service_role_fallback',
      result: fallback.result,
      deploymentMarker: DEPLOYMENT_MARKER,
    });
  }

  return jsonResponse({
    ok: true,
    migrationName,
    method: 'supabase_management_api',
    projectRef: getSupabaseProjectRef(),
    sqlLength: sql.length,
    result: result.result,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * GET /api/ivx/db-migration/status
 * Owner-only: checks if the migration runner is configured.
 */
export async function handleMigrationStatusRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return jsonResponse({ ok: false, error: 'Owner authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }

  const projectRef = getSupabaseProjectRef();
  const hasAccessToken = !!(await getSupabaseAccessToken());
  const hasServiceRoleKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

  return jsonResponse({
    ok: true,
    deploymentMarker: DEPLOYMENT_MARKER,
    configured: {
      projectRef,
      managementApiTokenConfigured: hasAccessToken,
      serviceRoleKeyConfigured: hasServiceRoleKey,
      canRunMigrations: hasAccessToken,
    },
  });
}
