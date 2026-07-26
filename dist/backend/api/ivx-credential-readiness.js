/**
 * IVX Credential Readiness API (owner-only, BLOCKER 2).
 *
 *   GET  /api/ivx/credentials                 → full readiness report (presence + diagnostics + fallback)
 *   GET  /api/ivx/credentials/deployment      → deployment-token verification + safe fallback
 *   POST /api/ivx/credentials/approval-gate   { action, ownerApproved } → owner-approval gate evaluation
 *
 * Never returns a secret value — only presence + a non-reversible shape verdict.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { IVX_CREDENTIAL_READINESS_MARKER, buildCredentialReadiness, buildDeploymentReadiness, evaluateOwnerApprovalGate, listGuardedActions, } from '../services/ivx-credential-readiness';
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
/** GET /api/ivx/credentials — full credential readiness report. */
export async function handleCredentialReadinessRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const report = buildCredentialReadiness();
        return ownerOnlyJson({ ok: true, report: report });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build credential readiness.' }, 500);
    }
}
/** GET /api/ivx/credentials/deployment — deployment-token verification + safe fallback. */
export async function handleCredentialDeploymentRequest(request) {
    const auth = await requireOwner(request);
    if (!auth.ok)
        return auth.response;
    try {
        const deployment = buildDeploymentReadiness();
        return ownerOnlyJson({
            ok: true,
            marker: IVX_CREDENTIAL_READINESS_MARKER,
            deployment: deployment,
            secretValuesReturned: false,
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build deployment readiness.' }, 500);
    }
}
/** POST /api/ivx/credentials/approval-gate — evaluate the owner-approval gate for a guarded action. */
export async function handleCredentialApprovalGateRequest(request) {
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
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    if (!action) {
        return ownerOnlyJson({ ok: false, error: 'A non-empty "action" string is required.', guardedActions: listGuardedActions() }, 400);
    }
    try {
        const result = evaluateOwnerApprovalGate(action, body.ownerApproved === true);
        return ownerOnlyJson({ ok: true, result: result, guardedActions: listGuardedActions() });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to evaluate approval gate.' }, 500);
    }
}
