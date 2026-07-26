/**
 * IVX Autonomous Continuous Improvement API (owner-only).
 *
 * Surfaces the daily self-audit, technical-debt + freeze + architecture-drift
 * findings, evidence-backed improvement proposals, and the safe
 * auto-improvement plan:
 *   GET  /api/ivx/continuous-improvement/dashboard  → latest audit summary + proposals
 *   POST /api/ivx/continuous-improvement/self-audit → run a fresh daily self-audit
 *   GET  /api/ivx/continuous-improvement/proposals  → evidence-backed proposals (latest audit)
 *   GET  /api/ivx/continuous-improvement/drift       → architecture-drift report
 *   POST /api/ivx/continuous-improvement/baseline    → set the architecture baseline
 *   GET  /api/ivx/continuous-improvement/safe-plan    → safe-to-auto-apply proposals only
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 */
import { runDailySelfAudit, getLatestSelfAudit, planSafeAutoImprovements, listSelfAudits, } from '../services/ivx-continuous-improvement';
import { detectArchitectureDrift, setArchitectureBaseline } from '../services/ivx-architecture-drift';
import { findSafeFixes } from '../services/ivx-safe-fix-finder';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
export const OPTIONS = () => ownerOnlyOptions();
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
/** GET /dashboard — latest persisted audit (or run one if none exists yet). */
export async function handleContinuousImprovementDashboardRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const latest = (await getLatestSelfAudit()) ?? (await runDailySelfAudit());
        const recent = await listSelfAudits(10);
        return ownerOnlyJson({ ok: true, audit: latest, recent });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to load continuous-improvement dashboard.' }, 500);
    }
}
/** POST /self-audit — run a fresh daily self-audit (real scans). */
export async function handleContinuousImprovementSelfAuditRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const audit = await runDailySelfAudit();
        return ownerOnlyJson({ ok: true, audit });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Self-audit failed.' }, 500);
    }
}
/** GET /proposals — evidence-backed improvement proposals from the latest audit. */
export async function handleContinuousImprovementProposalsRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const latest = (await getLatestSelfAudit()) ?? (await runDailySelfAudit());
        return ownerOnlyJson({ ok: true, auditId: latest.auditId, generatedAt: latest.generatedAt, summary: latest.summary, proposals: latest.proposals });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to load proposals.' }, 500);
    }
}
/** GET /drift — architecture-drift report vs the persisted baseline. */
export async function handleContinuousImprovementDriftRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const drift = await detectArchitectureDrift();
        return ownerOnlyJson({ ok: true, drift });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to detect architecture drift.' }, 500);
    }
}
/** POST /baseline — capture the current structure as the new architecture baseline. */
export async function handleContinuousImprovementBaselineRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const baseline = await setArchitectureBaseline();
        return ownerOnlyJson({ ok: true, baseline });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to set architecture baseline.' }, 500);
    }
}
/** GET /safe-plan — safe-to-auto-apply proposals only (the rest stays owner-gated). */
export async function handleContinuousImprovementSafePlanRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const plan = await planSafeAutoImprovements();
        return ownerOnlyJson({ ok: true, plan });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build safe improvement plan.' }, 500);
    }
}
/**
 * GET /safe-fixes — the Generative Safe-Issue Finder (Gap #3). Turns the safe
 * proposals into validated candidate PATCHES (never applied; application stays
 * owner-gated). Each candidate carries the issue, the generated patch + diff,
 * and a deterministic validation result (re-scan of the patched content).
 */
export async function handleContinuousImprovementSafeFixesRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const report = await findSafeFixes();
        return ownerOnlyJson({ ok: true, report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to run the safe-fix finder.' }, 500);
    }
}
