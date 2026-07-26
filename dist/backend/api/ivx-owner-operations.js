/**
 * IVX Owner Operations API (owner-only, non-developer).
 *
 *   GET  /api/ivx/owner-operations/dashboard              → vault + actions + rork preflight + headline
 *   GET  /api/ivx/owner-operations/connections            → credential vault (status only, never values)
 *   POST /api/ivx/owner-operations/connections/test       { connection } → live connection test
 *   GET  /api/ivx/owner-operations/actions                → one-click action catalog
 *   GET  /api/ivx/owner-operations/rork-removal/preflight → Rork-removal readiness / BLOCKED_MISSING_OWNER_CONNECTION
 *
 * Read-only + presence-only. Never returns or logs a secret value. Same owner
 * guard as the rest of the IVX developer surface.
 */
import { buildOwnerConnectionVault, buildOwnerActionCatalog, buildRorkRemovalPreflight, buildOwnerOperationsDashboard, testOwnerConnection, } from '../services/ivx-owner-operations';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
export const OPTIONS = () => ownerOnlyOptions();
const VALID_CONNECTIONS = [
    'github',
    'render',
    'supabase',
    'aws',
    'domain',
    'ai_gateway',
    'model_3d',
    'crm_import',
];
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
        }
        return { ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
        const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
        return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
    }
}
/** GET /api/ivx/owner-operations/dashboard — full owner-operations surface. */
export async function handleOwnerOperationsDashboardRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const dashboard = buildOwnerOperationsDashboard();
        return ownerOnlyJson({ ok: true, dashboard });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build owner-operations dashboard.' }, 500);
    }
}
/** GET /api/ivx/owner-operations/connections — credential vault (status only). */
export async function handleOwnerOperationsConnectionsRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const vault = buildOwnerConnectionVault();
        return ownerOnlyJson({ ok: true, vault });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build connection vault.' }, 500);
    }
}
/** POST /api/ivx/owner-operations/connections/test — live test of one connection. */
export async function handleOwnerOperationsConnectionTestRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const connection = typeof body.connection === 'string' ? body.connection.trim() : '';
    if (!VALID_CONNECTIONS.includes(connection)) {
        return ownerOnlyJson({ ok: false, error: `A valid "connection" id is required (one of: ${VALID_CONNECTIONS.join(', ')}).` }, 400);
    }
    try {
        const result = await testOwnerConnection(connection);
        return ownerOnlyJson({ ok: true, result });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Connection test failed.' }, 500);
    }
}
/** GET /api/ivx/owner-operations/actions — one-click action catalog. */
export async function handleOwnerOperationsActionsRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const catalog = buildOwnerActionCatalog();
        return ownerOnlyJson({ ok: true, catalog });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build action catalog.' }, 500);
    }
}
/** GET /api/ivx/owner-operations/rork-removal/preflight — Rork-removal readiness. */
export async function handleOwnerOperationsRorkRemovalPreflightRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const vault = buildOwnerConnectionVault();
        const preflight = buildRorkRemovalPreflight(vault);
        return ownerOnlyJson({ ok: true, preflight });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build Rork-removal preflight.' }, 500);
    }
}
