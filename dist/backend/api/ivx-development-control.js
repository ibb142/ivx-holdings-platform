import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
const DEPLOYMENT_MARKER = 'ivx-development-control-2026-04-27';
/**
 * Resolves the owner context, mapping auth-guard failures to proper 401/403
 * responses instead of letting the thrown error surface as an HTTP 500.
 * Returns either an authenticated owner context or a ready-to-send denial Response.
 */
async function resolveOwnerOrDenial(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return {
                denial: ownerOnlyJson({ ok: false, ownerOnly: true, systemOwner: 'IVX', error: 'IVX owner authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401),
            };
        }
        return { owner };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return {
            denial: ownerOnlyJson({ ok: false, ownerOnly: true, systemOwner: 'IVX', error: message, deploymentMarker: DEPLOYMENT_MARKER }, status),
        };
    }
}
const ACTION_CONFIRMATION_TEXT = {
    deploy: 'CONFIRM_IVX_DEPLOY_ACTION',
    public_deploy: 'CONFIRM_IVX_PUBLIC_DEPLOY',
};
const CAPABILITIES = [
    { id: 'inspect_repo', status: 'available', owner: 'IVX', scope: 'repo-local' },
    { id: 'patch_repo_files', status: 'available', owner: 'IVX', scope: 'repo-local' },
    { id: 'run_validation', status: 'available', owner: 'IVX', scope: 'repo-local' },
    { id: 'build_expo_exports', status: 'available', owner: 'IVX', scope: 'repo-local' },
    { id: 'supabase_read_tools', status: 'available', owner: 'IVX', scope: 'backend' },
    { id: 'supabase_write_tools', status: 'confirmation_required', owner: 'IVX', scope: 'backend' },
    { id: 'deploy_scripts', status: 'confirmation_required', owner: 'IVX', scope: 'deploy' },
    { id: 'public_production_deploy', status: 'confirmation_required', owner: 'IVX', scope: 'public-deploy' },
];
export function ivxDevelopmentControlOptions() {
    return ownerOnlyOptions();
}
function normalizeAction(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'inspect' || normalized === 'patch' || normalized === 'validate' || normalized === 'build' || normalized === 'supabase_read' || normalized === 'deploy' || normalized === 'public_deploy') {
        return normalized;
    }
    return null;
}
function isConfirmedAction(action, request) {
    if (action !== 'deploy' && action !== 'public_deploy') {
        return true;
    }
    return request.confirm === true && request.confirmText === ACTION_CONFIRMATION_TEXT[action];
}
function getActionScope(action) {
    if (action === 'supabase_read') {
        return 'backend';
    }
    if (action === 'deploy') {
        return 'deploy';
    }
    if (action === 'public_deploy') {
        return 'public-deploy';
    }
    return 'repo-local';
}
export async function handleIVXDevelopmentControlRequest(request) {
    const resolved = await resolveOwnerOrDenial(request);
    if ('denial' in resolved) {
        return resolved.denial;
    }
    const ownerContext = resolved.owner;
    return ownerOnlyJson({
        ok: true,
        ownerOnly: true,
        systemOwner: 'IVX',
        mode: 'senior_developer_control',
        defaultToolPriority: ['IVX-owned repo tools', 'IVX-owned backend routes', 'IVX Supabase server routes', 'IVX deploy scripts'],
        capabilities: CAPABILITIES,
        destructiveActionsRequireConfirmation: true,
        billingCredentialAndPublicDeployRequireConfirmation: true,
        publicDeployAutoRun: false,
        visibleResponsesLeakAuditMetadata: false,
        authenticatedUserId: ownerContext.userId,
        deploymentMarker: DEPLOYMENT_MARKER,
    });
}
export async function handleIVXDevelopmentActionRequest(request) {
    const resolved = await resolveOwnerOrDenial(request);
    if ('denial' in resolved) {
        return resolved.denial;
    }
    const ownerContext = resolved.owner;
    const body = await request.json().catch(() => ({}));
    const action = normalizeAction(body.action);
    const target = typeof body.target === 'string' ? body.target.trim() : '';
    if (!action) {
        return ownerOnlyJson({
            ok: false,
            ownerOnly: true,
            systemOwner: 'IVX',
            error: 'Unsupported IVX development action.',
            allowedActions: ['inspect', 'patch', 'validate', 'build', 'supabase_read', 'deploy', 'public_deploy'],
            deploymentMarker: DEPLOYMENT_MARKER,
        }, 400);
    }
    const confirmed = isConfirmedAction(action, body);
    const confirmationRequired = !confirmed;
    return ownerOnlyJson({
        ok: confirmed,
        ownerOnly: true,
        systemOwner: 'IVX',
        mode: 'repo_local_action_control',
        action,
        target: target || 'repo',
        scope: getActionScope(action),
        executionOwner: 'IVX',
        mayExecuteNow: confirmed,
        confirmationRequired,
        requiredConfirmationText: action === 'deploy' || action === 'public_deploy' ? ACTION_CONFIRMATION_TEXT[action] : null,
        destructiveActionsRequireConfirmation: true,
        billingCredentialAndPublicDeployRequireConfirmation: true,
        publicDeployAutoRun: false,
        visibleResponsesLeakAuditMetadata: false,
        authenticatedUserId: ownerContext.userId,
        deploymentMarker: DEPLOYMENT_MARKER,
    }, confirmed ? 200 : 409);
}
