/**
 * IVX Autonomous OS API (owner-only).
 *
 *   GET /api/ivx/autonomous-os         → live Autonomous OS status (truth-gated).
 *   GET /api/ivx/autonomous-os/weekly  → weekly executive report.
 *
 * Owner-only. Read/derive only — composes existing engines; never fabricates and
 * never deploys.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { buildAutonomousOsStatus, buildWeeklyExecutiveReport, } from '../services/ivx-autonomous-os';
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
/** GET — live Autonomous OS status. */
export async function handleAutonomousOsStatus(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const status = await buildAutonomousOsStatus({ includeLiveWebCheck: false });
    return ownerOnlyJson({ ok: true, status: status });
}
/** GET — weekly executive report. */
export async function handleAutonomousOsWeekly(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const report = await buildWeeklyExecutiveReport();
    return ownerOnlyJson({ ok: true, report: report });
}
