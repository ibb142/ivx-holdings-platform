/**
 * IVX Autonomous Scale Loop API (owner-only).
 *
 *   GET  /api/ivx/autonomous-scale/dashboard  → live autonomous dashboard
 *   GET  /api/ivx/autonomous-scale/reports     → recent daily-run reports
 *   POST /api/ivx/autonomous-scale/run         → force one daily run now (proof)
 *   POST /api/ivx/autonomous-scale/enable      → enable/disable the daily loop
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';
import { buildScaleDashboard, getScaleLoopState, listScaleLoopReports, runScaleLoopOnce, setScaleLoopEnabled, } from '../services/ivx-autonomous-scale-loop';
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
export async function handleScaleDashboardRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const dashboard = await buildScaleDashboard();
    return ownerOnlyJson({ ok: true, dashboard: dashboard });
}
export async function handleScaleReportsRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
    const reports = await listScaleLoopReports(Number.isFinite(limit) ? limit : 20);
    const state = await getScaleLoopState();
    return ownerOnlyJson({ ok: true, state: state, reports });
}
export async function handleScaleRunRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    // Pre-Execution Feasibility Gate (Stage 0)
    try {
        const gate = await checkPreExecutionGate(request, {
            prompt: 'autonomous scale loop force run',
            ownerSessionPresent: true,
            entryPoint: 'autonomous-scale-run',
        });
        if (gate.blocked && gate.response)
            return gate.response;
    }
    catch (gateError) {
        console.log('[IVXAutonomousScale] Pre-execution gate error (non-blocking):', gateError instanceof Error ? gateError.message : 'unknown');
    }
    try {
        const report = await runScaleLoopOnce({ force: true });
        return ownerOnlyJson({ ok: true, report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Scale run failed.' }, 500);
    }
}
export async function handleScaleEnableRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    let body;
    try {
        body = (await request.json());
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const enabled = body.enabled !== false;
    const state = await setScaleLoopEnabled(enabled);
    return ownerOnlyJson({ ok: true, state: state });
}
