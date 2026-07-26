/**
 * IVX Owner AI Executive Layer API (owner-only).
 *
 * One read-only endpoint that returns the full executive operations payload —
 * daily business briefing, strategic plan (30/90/yearly), opportunity engine,
 * decision engine, execution tracking, and the four-quadrant executive
 * scorecard (company / AI / engineering / capital).
 *
 *   GET /api/ivx/executive-layer → full executive layer.
 *
 * Owner-only. Composes existing engines (business-impact, capital command
 * center, autonomous-core, task orchestrator); never promises guaranteed
 * profit; cash runway stays honest-unknown without burn data.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildExecutiveLayer } from '../services/ivx-executive-layer';
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
export async function handleExecutiveLayerRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const executive = await buildExecutiveLayer();
    return ownerOnlyJson({ ok: true, executive: executive });
}
