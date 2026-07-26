/**
 * IVX Incidents API — ingest, list, detail, diagnose, approve.
 *
 * Ingest is open (auth-light) so the frontend can report client crashes
 * before login. Listing, diagnosing and approving require owner auth.
 */
import { recordIncident, listIncidents, getIncident, updateIncident, ensureIncidentStoreReady, } from '../services/ivx-incident-store';
import { evaluateAndMaybeRollback, getProductionHealth, triggerProductionRollback } from '../services/ivx-production-guard';
import { diagnoseIncident } from '../services/ivx-repair-brain';
import { decideRepairPolicy, deployRepairToStaging, promoteRepairToProduction, replayIncidentAgainstStaging, } from '../services/ivx-repair-policy';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
const DEPLOYMENT_MARKER = 'ivx-incidents-2026-05-26';
const STATUSES = ['open', 'diagnosing', 'awaiting_approval', 'fix_proposed', 'rolled_back', 'resolved', 'ignored'];
const SEVERITIES = ['info', 'warning', 'error', 'critical'];
const SOURCES = ['frontend', 'backend', 'provider', 'auth', 'render', 'timeout', 'rollback', 'silent_failure', 'unknown'];
function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
    });
}
function preflight() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
    });
}
function pickSource(value) {
    return SOURCES.includes(value) ? value : 'unknown';
}
function pickSeverity(value) {
    return SEVERITIES.includes(value) ? value : 'error';
}
function pickStatusFilter(value) {
    return STATUSES.includes(value) ? value : undefined;
}
/** POST /api/ivx/incidents — auth-light ingest. */
export async function handleIVXIncidentIngest(request) {
    if (request.method === 'OPTIONS')
        return preflight();
    if (request.method !== 'POST')
        return json({ error: 'Method not allowed.' }, 405);
    await ensureIncidentStoreReady();
    let body = {};
    try {
        body = (await request.json());
    }
    catch {
        return json({ error: 'Invalid JSON body.' }, 400);
    }
    const message = typeof body.message === 'string' && body.message.trim().length > 0 ? body.message : 'unknown error';
    const incident = recordIncident({
        traceId: typeof body.traceId === 'string' ? body.traceId : null,
        userId: typeof body.userId === 'string' ? body.userId : null,
        conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
        source: pickSource(body.source),
        checkpoint: typeof body.checkpoint === 'string' ? body.checkpoint : null,
        fileLine: typeof body.fileLine === 'string' ? body.fileLine : null,
        message,
        stack: typeof body.stack === 'string' ? body.stack : null,
        requestBodyPreview: typeof body.requestBodyPreview === 'string' ? body.requestBodyPreview : null,
        responseStatus: typeof body.responseStatus === 'number' ? body.responseStatus : null,
        buildId: typeof body.buildId === 'string' ? body.buildId : null,
        suggestedFix: typeof body.suggestedFix === 'string' ? body.suggestedFix : null,
        severity: pickSeverity(body.severity),
    });
    void evaluateAndMaybeRollback();
    // Auto-trigger diagnosis for silent failures so the repair brain works without
    // an owner having to manually click Diagnose.
    if (incident.source === 'silent_failure') {
        // Staged auto-repair pipeline (policy: staging auto, production gated):
        //   diagnose -> staging deploy -> replay -> awaiting_production_approval
        void (async () => {
            try {
                const diag = await diagnoseIncident(incident.id);
                if (!diag.ok)
                    return;
                await deployRepairToStaging(incident.id);
                await replayIncidentAgainstStaging(incident.id);
            }
            catch (err) {
                console.log('[ivx-incidents] staged auto-repair failed:', err instanceof Error ? err.message : String(err));
            }
        })();
    }
    return json({ ok: true, incident, deploymentMarker: DEPLOYMENT_MARKER });
}
/** GET /api/ivx/incidents — owner-only list. */
export async function handleIVXIncidentsList(request) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    if (request.method !== 'GET')
        return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    await ensureIncidentStoreReady();
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? '50')));
        const items = listIncidents(limit, {
            severity: SEVERITIES.includes(url.searchParams.get('severity')) ? url.searchParams.get('severity') : undefined,
            status: pickStatusFilter(url.searchParams.get('status')),
            source: SOURCES.includes(url.searchParams.get('source')) ? url.searchParams.get('source') : undefined,
        });
        return ownerOnlyJson({ ok: true, items, count: items.length, deploymentMarker: DEPLOYMENT_MARKER });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
/** GET /api/ivx/incidents/:id — owner-only detail. */
export async function handleIVXIncidentGet(request, id) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    await ensureIncidentStoreReady();
    try {
        await assertIVXOwnerOnly(request);
        const incident = getIncident(id);
        if (!incident)
            return ownerOnlyJson({ ok: false, error: 'Incident not found.' }, 404);
        return ownerOnlyJson({ ok: true, incident, deploymentMarker: DEPLOYMENT_MARKER });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
/** POST /api/ivx/incidents/:id/diagnose — owner-only diagnose. */
export async function handleIVXIncidentDiagnose(request, id) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    if (request.method !== 'POST')
        return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    await ensureIncidentStoreReady();
    try {
        await assertIVXOwnerOnly(request);
        const result = await diagnoseIncident(id);
        return ownerOnlyJson({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, result.ok ? 200 : 400);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
/** POST /api/ivx/incidents/:id/approve — owner approval for medium/high-risk patches. */
export async function handleIVXIncidentApprove(request, id) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    if (request.method !== 'POST')
        return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    await ensureIncidentStoreReady();
    let body = {};
    try {
        body = (await request.json().catch(() => ({})));
    }
    catch {
        body = {};
    }
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const incident = getIncident(id);
        if (!incident)
            return ownerOnlyJson({ ok: false, error: 'Incident not found.' }, 404);
        // Production approval gate: owner can only approve once staging has
        // proven the fix (or explicitly forced with note="force").
        const force = body.force === true;
        if (!force && incident.status !== 'awaiting_production_approval' && incident.status !== 'staging_passed') {
            return ownerOnlyJson({
                ok: false,
                error: `Production approval requires staging to have passed first (current status: ${incident.status}). Pass force=true to override.`,
                currentStatus: incident.status,
            }, 409);
        }
        const updated = updateIncident(id, {
            status: 'awaiting_production_approval',
            approval: {
                approvedBy: ctx.email || ctx.userId,
                approvedAt: new Date().toISOString(),
                note: typeof body.note === 'string' ? body.note : null,
            },
        });
        return ownerOnlyJson({ ok: true, incident: updated, deploymentMarker: DEPLOYMENT_MARKER });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
/** POST /api/ivx/incidents/:id/stage — auto-deploy diagnosed patch to staging (policy: allowed). */
export async function handleIVXIncidentStage(request, id) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    if (request.method !== 'POST')
        return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    await ensureIncidentStoreReady();
    try {
        await assertIVXOwnerOnly(request);
        const result = await deployRepairToStaging(id);
        return ownerOnlyJson({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, result.ok ? 200 : 400);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
/** POST /api/ivx/incidents/:id/replay — replay incident against staging (policy: allowed). */
export async function handleIVXIncidentReplay(request, id) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    if (request.method !== 'POST')
        return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    await ensureIncidentStoreReady();
    try {
        await assertIVXOwnerOnly(request);
        const result = await replayIncidentAgainstStaging(id);
        return ownerOnlyJson({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, result.ok ? 200 : 400);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
/** POST /api/ivx/incidents/:id/promote — deploy to production AFTER owner approval (policy: gated). */
export async function handleIVXIncidentPromote(request, id) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    if (request.method !== 'POST')
        return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    await ensureIncidentStoreReady();
    try {
        await assertIVXOwnerOnly(request);
        const result = await promoteRepairToProduction(id, 'owner');
        return ownerOnlyJson({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, result.ok ? 200 : 409);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
/** GET /api/ivx/incidents/:id/policy — inspect the current repair policy decision. */
export async function handleIVXIncidentPolicy(request, id) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    await ensureIncidentStoreReady();
    try {
        await assertIVXOwnerOnly(request);
        const incident = getIncident(id);
        if (!incident)
            return ownerOnlyJson({ ok: false, error: 'Incident not found.' }, 404);
        return ownerOnlyJson({
            ok: true,
            incidentId: id,
            status: incident.status,
            lifecycle: incident.lifecycle,
            policy: decideRepairPolicy(incident),
            deploymentMarker: DEPLOYMENT_MARKER,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
/** GET /api/ivx/production-guard/health — current rolling failure rate. */
export async function handleIVXProductionGuardHealth(request) {
    if (request.method === 'OPTIONS')
        return preflight();
    await ensureIncidentStoreReady();
    return json({ ok: true, health: getProductionHealth(), deploymentMarker: DEPLOYMENT_MARKER });
}
/** POST /api/ivx/production-guard/rollback — manual owner-only rollback. */
export async function handleIVXProductionGuardRollback(request) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    if (request.method !== 'POST')
        return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const result = await triggerProductionRollback({
            force: body.force === true,
            reason: typeof body.reason === 'string' ? body.reason : undefined,
        });
        return ownerOnlyJson({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, result.ok ? 200 : 400);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
}
