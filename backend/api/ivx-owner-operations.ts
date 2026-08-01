/**
 * IVX Owner Operations API (owner-only, non-developer).
 *
 *   GET  /api/ivx/owner-operations/dashboard              → vault + actions + removal preflight + headline
 *   GET  /api/ivx/owner-operations/connections            → credential vault (status only, never values)
 *   POST /api/ivx/owner-operations/connections/test       { connection } → live connection test
 *   GET  /api/ivx/owner-operations/actions                → one-click action catalog
 *   GET  /api/ivx/owner-operations/removal-preflight → Platform removal readiness / BLOCKED_MISSING_OWNER_CONNECTION
 *
 * Read-only + presence-only. Never returns or logs a secret value. Same owner
 * guard as the rest of the IVX developer surface.
 */
import {
  buildOwnerConnectionVault,
  buildOwnerActionCatalog,
  buildPlatformRemovalPreflight,
  buildOwnerOperationsDashboard,
  testOwnerConnection,
  type ConnectionId,
} from '../services/ivx-owner-operations';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const OPTIONS = (): Response => ownerOnlyOptions();

const VALID_CONNECTIONS: ConnectionId[] = [
  'github',
  'render',
  'supabase',
  'aws',
  'domain',
  'ai_gateway',
  'model_3d',
  'crm_import',
];

async function requireOwner(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
  }
}

/** GET /api/ivx/owner-operations/dashboard — full owner-operations surface. */
export async function handleOwnerOperationsDashboardRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const dashboard = buildOwnerOperationsDashboard();
    return ownerOnlyJson({ ok: true, dashboard });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build owner-operations dashboard.' }, 500);
  }
}

/** GET /api/ivx/owner-operations/connections — credential vault (status only). */
export async function handleOwnerOperationsConnectionsRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const vault = buildOwnerConnectionVault();
    return ownerOnlyJson({ ok: true, vault });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build connection vault.' }, 500);
  }
}

/** POST /api/ivx/owner-operations/connections/test — live test of one connection. */
export async function handleOwnerOperationsConnectionTestRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  let body: { connection?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const connection = typeof body.connection === 'string' ? body.connection.trim() : '';
  if (!VALID_CONNECTIONS.includes(connection as ConnectionId)) {
    return ownerOnlyJson({ ok: false, error: `A valid "connection" id is required (one of: ${VALID_CONNECTIONS.join(', ')}).` }, 400);
  }

  try {
    const result = await testOwnerConnection(connection as ConnectionId);
    return ownerOnlyJson({ ok: true, result });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Connection test failed.' }, 500);
  }
}

/** GET /api/ivx/owner-operations/actions — one-click action catalog. */
export async function handleOwnerOperationsActionsRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const catalog = buildOwnerActionCatalog();
    return ownerOnlyJson({ ok: true, catalog });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build action catalog.' }, 500);
  }
}

/** GET /api/ivx/owner-operations/removal-preflight — Platform removal readiness. */
export async function handleOwnerOperationsRemovalPreflightRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;
  try {
    const vault = buildOwnerConnectionVault();
    const preflight = buildPlatformRemovalPreflight(vault);
    return ownerOnlyJson({ ok: true, preflight });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build Rork-removal preflight.' }, 500);
  }
}
