/**
 * IVX Autonomous Capability Registry API (owner-only, BLOCK 34).
 *
 *   GET /api/ivx/capabilities          → full registry (20 capabilities + readiness)
 *   GET /api/ivx/capabilities/:id      → one capability record
 *   GET /api/ivx/readiness             → six-dimension readiness + dev/autonomous %
 *
 * Read-only; every record is derived from live subsystem signals.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildCapabilityRegistry, getCapabilityById } from '../services/ivx-capability-registry';
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
        }
        return null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
export async function handleCapabilityRegistryRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const registry = await buildCapabilityRegistry();
    return ownerOnlyJson({ ok: true, registry: registry });
}
export async function handleCapabilityByIdRequest(request, id) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const capability = await getCapabilityById(id);
    if (!capability) {
        return ownerOnlyJson({ ok: false, error: `Unknown capability id "${id}".` }, 404);
    }
    return ownerOnlyJson({ ok: true, capability: capability });
}
export async function handleReadinessRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const registry = await buildCapabilityRegistry();
    return ownerOnlyJson({
        ok: true,
        readiness: registry.readiness,
        summary: registry.summary,
        pathTo100: registry.pathTo100,
        generatedAt: registry.generatedAt,
        marker: registry.marker,
    });
}
