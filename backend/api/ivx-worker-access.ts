/**
 * Owner-facing "Generate Worker Access" endpoint.
 *
 * Lets the registered IVX owner mint a short-lived (5-15 minute), single-use,
 * action- and commit-SHA-bound worker access token using their existing live
 * Supabase session — no raw JWT ever needs to be copied into Render.
 *
 * The response returns the raw token exactly once. Only its SHA-256 hash is
 * ever persisted (see ivx-worker-access-token.ts). The worker later presents
 * this token, alongside its existing signed HMAC identity, to consume it via
 * the extended /internal-deployment-authorizations/consume flow.
 */
import { assertIVXRegisteredOwnerBearer, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  generateWorkerAccessToken,
  isAllowedWorkerAccessAction,
  normalizeTtlMinutes,
  WorkerAccessTokenError,
  type WorkerAccessAction,
} from '../services/ivx-worker-access-token';
import { writeProofLedger } from '../services/ivx-senior-dev-proof';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleGenerateWorkerAccessRequest(request: Request): Promise<Response> {
  const requestId = `worker-access-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { context, approval } = await assertIVXRegisteredOwnerBearer(request, 'generate_worker_access');
    const body = await request.json().catch((): Record<string, unknown> => ({}));

    const action = text(body.action) as WorkerAccessAction;
    const commitSha = text(body.commitSha).toLowerCase();
    const workerId = text(body.workerId) || null;
    const ttlMinutes = normalizeTtlMinutes(body.ttlMinutes);

    if (!isAllowedWorkerAccessAction(action)) {
      return ownerOnlyJson({
        ok: false,
        error: 'A valid action (GITHUB_WRITE, RENDER_DEPLOY, PRODUCTION_DEPLOY, or QA_ONLY) is required.',
        secretValuesReturned: false,
      }, 400);
    }
    if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
      return ownerOnlyJson({
        ok: false,
        error: 'A 40-character commitSha is required.',
        secretValuesReturned: false,
      }, 400);
    }

    const { rawToken, record } = await generateWorkerAccessToken({
      ownerId: context.userId,
      action,
      commitSha,
      requestId,
      workerId,
      ttlMinutes,
    });

    // Best-effort proof-ledger issuance record. Never include the raw token.
    await writeProofLedger({
      taskId: record.id,
      workerId: workerId ?? 'unassigned',
      commitSha,
      status: 'running',
      logs: [
        `worker_access_token_issued action=${action} owner=${context.userId} ttlMinutes=${ttlMinutes} tokenId=${record.id}`,
      ],
    }).catch(() => null);

    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      ownerApproval: approval,
      workerAccessToken: rawToken,
      authorization: {
        id: record.id,
        action: record.action,
        commitSha: record.commitSha,
        workerId: record.workerId,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
      },
      tokenStoredAsHashOnly: true,
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (error) {
    if (error instanceof WorkerAccessTokenError) {
      return ownerOnlyJson({ ok: false, error: error.message.slice(0, 300), code: error.code, secretValuesReturned: false }, error.status);
    }
    const message = error instanceof Error ? error.message : 'Worker access token could not be generated.';
    const status = message.toLowerCase().includes('bearer') || message.toLowerCase().includes('invalid or expired') ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message.slice(0, 300), secretValuesReturned: false }, status);
  }
}
