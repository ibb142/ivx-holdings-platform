/**
 * IVX Senior Developer Autonomous Mode API (owner-only).
 *
 * The single entry point for the FINAL autonomous mode — IVX IA behaves like a
 * real senior developer 24/7: executes safe work end-to-end without asking
 * "proceed?", asks for owner approval ONLY for genuinely risky actions, and
 * returns the exact owner-required response format with the 6 allowed states.
 *
 *   GET  /api/ivx/senior-developer/autonomous-mode/status → policy gate + pipeline + rules
 *   POST /api/ivx/senior-developer/autonomous-mode/run    { task } → final autonomous report
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 */
import { buildSeniorDeveloperAutonomousStatus, runSeniorDeveloperAutonomousMode, } from '../services/ivx-senior-developer-autonomous-mode';
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
/** GET /api/ivx/senior-developer/autonomous-mode/status — the policy gate + pipeline + rules. */
export async function handleSeniorDevAutonomousStatusRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const status = buildSeniorDeveloperAutonomousStatus();
        return ownerOnlyJson(status);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build autonomous-mode status.' }, 500);
    }
}
/** POST /api/ivx/senior-developer/autonomous-mode/run — run the full autonomous pipeline. */
export async function handleSeniorDevAutonomousRunRequest(request) {
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
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    if (!task) {
        return ownerOnlyJson({ ok: false, error: 'A non-empty "task" string is required.' }, 400);
    }
    try {
        const report = await runSeniorDeveloperAutonomousMode(task, {
            conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
            approverEmail: typeof body.approverEmail === 'string' ? body.approverEmail : undefined,
        });
        // HTTP stays 200 — the truthful outcome lives in STATE.
        return ownerOnlyJson({ ok: true, report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Autonomous mode run failed.' }, 500);
    }
}
