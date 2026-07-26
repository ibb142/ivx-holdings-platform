/**
 * IVX Repair Jobs API — async repair-job orchestrator endpoints.
 *
 *   POST /api/ivx/repair-jobs              start a job for an incident
 *   GET  /api/ivx/repair-jobs              list recent jobs (owner-only)
 *   GET  /api/ivx/repair-jobs/:id          job detail (owner-only)
 *   GET  /api/ivx/repair-jobs/by-incident/:incidentId  latest job for incident
 */
import { ensureIncidentStoreReady, getIncident } from '../services/ivx-incident-store';
import { getLatestRepairJobForIncident, getRepairJob, listRepairJobs, startRepairJob, } from '../services/ivx-repair-jobs';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
function publicJson(payload, status = 200) {
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
/**
 * POST /api/ivx/repair-jobs
 * Body: { incidentId }
 * Auth-light: the watchdog bridge calls this immediately after reporting a
 * silent failure so the chat surface can render "Repair job started".
 */
export async function handleIVXRepairJobStart(request) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    if (request.method !== 'POST')
        return publicJson({ ok: false, error: 'Method not allowed.' }, 405);
    await ensureIncidentStoreReady();
    let body = {};
    try {
        body = (await request.json());
    }
    catch {
        return publicJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const incidentId = typeof body.incidentId === 'string' ? body.incidentId : '';
    if (!incidentId)
        return publicJson({ ok: false, error: 'incidentId required.' }, 400);
    if (!getIncident(incidentId))
        return publicJson({ ok: false, error: 'Incident not found.' }, 404);
    const job = startRepairJob(incidentId);
    return publicJson({
        ok: true,
        job: { id: job.id, stage: job.stage, incidentId: job.incidentId, createdAt: job.createdAt },
        bubble: 'Repair job started',
    });
}
export async function handleIVXRepairJobList(request) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '50')));
        return ownerOnlyJson({ ok: true, items: listRepairJobs(limit) });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 401);
    }
}
export async function handleIVXRepairJobGet(request, id) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    try {
        await assertIVXOwnerOnly(request);
        const job = getRepairJob(id);
        if (!job)
            return ownerOnlyJson({ ok: false, error: 'Repair job not found.' }, 404);
        return ownerOnlyJson({ ok: true, job });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 401);
    }
}
export async function handleIVXRepairJobByIncident(request, incidentId) {
    if (request.method === 'OPTIONS')
        return ownerOnlyOptions();
    try {
        await assertIVXOwnerOnly(request);
        const job = getLatestRepairJobForIncident(incidentId);
        if (!job)
            return ownerOnlyJson({ ok: false, error: 'No repair job for incident.' }, 404);
        return ownerOnlyJson({ ok: true, job });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 401);
    }
}
