/**
 * IVX Autonomous Scheduler API (owner-only) — BLOCK 41.
 *
 * Surfaces + controls the durable scheduler that automatically runs the daily
 * self-audit + architecture-drift detection and wires each result into the
 * unified memory + executive action loop:
 *   GET  /api/ivx/scheduler            → scheduler + per-job state (last/next run)
 *   POST /api/ivx/scheduler/run-now    → run due jobs now (or a specific {job})
 *   POST /api/ivx/scheduler/enable     → enable/disable the scheduler ({enabled})
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 */
import { getSchedulerState, runDueJobs, runScheduledJob, setSchedulerEnabled, SCHEDULED_JOB_KINDS, } from '../services/ivx-autonomous-scheduler';
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
function isJobKind(value) {
    return typeof value === 'string' && SCHEDULED_JOB_KINDS.includes(value);
}
async function parseBody(request) {
    try {
        const body = await request.json();
        return body && typeof body === 'object' ? body : {};
    }
    catch {
        return {};
    }
}
/** GET / — scheduler + per-job state. */
export async function handleSchedulerStatusRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const state = await getSchedulerState();
        return ownerOnlyJson({ ok: true, scheduler: state });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to load scheduler state.' }, 500);
    }
}
/** POST /run-now — run due jobs now, or a specific {job} kind. */
export async function handleSchedulerRunNowRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const body = await parseBody(request);
        if (body.job !== undefined) {
            if (!isJobKind(body.job)) {
                return ownerOnlyJson({ ok: false, error: `Unknown job. Valid jobs: ${SCHEDULED_JOB_KINDS.join(', ')}.` }, 400);
            }
            const result = await runScheduledJob(body.job);
            const state = await getSchedulerState();
            return ownerOnlyJson({ ok: true, ran: [result], scheduler: state });
        }
        const results = await runDueJobs();
        const state = await getSchedulerState();
        return ownerOnlyJson({ ok: true, ran: results, scheduler: state });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to run scheduled jobs.' }, 500);
    }
}
/** POST /enable — enable/disable the scheduler ({enabled:boolean}). */
export async function handleSchedulerEnableRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const body = await parseBody(request);
        const enabled = body.enabled !== false; // default to enabling unless explicitly false
        const state = await setSchedulerEnabled(enabled);
        return ownerOnlyJson({ ok: true, scheduler: state });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to update scheduler.' }, 500);
    }
}
