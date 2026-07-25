import { assertIVXRegisteredOwnerBearer, ownerOnlyJson } from './owner-only';
import { createOwnerDeploymentApproval, type InternalDeployAuthorization } from '../services/ivx-internal-deploy-auth';

const ALLOWED_ACTIONS = new Set<InternalDeployAuthorization['action']>(['GITHUB_WRITE', 'RENDER_DEPLOY', 'PRODUCTION_DEPLOY']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Creates a short-lived, single-use approval that an internal signed worker may consume. */
export async function handleCreateDeploymentApproval(request: Request): Promise<Response> {
  try {
    const { context, approval } = await assertIVXRegisteredOwnerBearer(request, 'create_owner_deployment_approval');
    const body = await request.json().catch((): Record<string, unknown> => ({}));
    const requestedCommitSha = text(body.requestedCommitSha).toLowerCase();
    const action = text(body.action) as InternalDeployAuthorization['action'];
    const requestId = text(body.requestId) || `owner-approval-${Date.now()}`;
    const ttlMinutes = Math.min(60, Math.max(5, Number(body.ttlMinutes) || 30));
    if (!/^[a-f0-9]{40}$/i.test(requestedCommitSha) || !ALLOWED_ACTIONS.has(action)) {
      return ownerOnlyJson({ ok: false, error: 'A 40-character requestedCommitSha and allowed action are required.', secretValuesReturned: false }, 400);
    }
    const record = await createOwnerDeploymentApproval({
      ownerUserId: context.userId,
      requestedCommitSha,
      action,
      requestId,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
    });
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      ownerApproval: approval,
      approval: { id: record.id, requestedCommitSha: record.requestedCommitSha, action: record.action, approvedAt: record.approvedAt, expiresAt: record.expiresAt, usedAt: record.usedAt, requestId: record.requestId },
      secretValuesReturned: false,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner deployment approval could not be created.';
    return ownerOnlyJson({ ok: false, error: message.slice(0, 300), secretValuesReturned: false }, message.toLowerCase().includes('bearer') ? 401 : 403);
  }
}
