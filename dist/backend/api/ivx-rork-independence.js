/**
 * IVX → Rork Independence API (owner-only).
 *
 * One read-only endpoint that returns the live 4-phase Rork→IVX independence
 * report — current phase, per-phase requirement readiness (derived from real
 * tool/handoff/dependency signals), the eight kept systems, the Rork
 * dependencies still present, the six owner-required capabilities, and the
 * exact next actions.
 *
 *   GET /api/ivx/rork-independence → full independence report.
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildRorkIndependenceReport } from '../services/ivx-rork-independence';
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
export async function handleRorkIndependenceRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    try {
        const report = await buildRorkIndependenceReport();
        return ownerOnlyJson({ ok: true, report: report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build Rork independence report.' }, 500);
    }
}
