import { createHmac, timingSafeEqual } from 'node:crypto';
import { readDurableJson, writeDurableJson } from './ivx-durable-store';
const NONCE_STORE = 'logs/audit/internal-deploy-auth/nonces.json';
const APPROVAL_STORE = 'logs/audit/owner-deployment-approvals/approvals.json';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_NONCES = 500;
const durableAuthStore = {
    readJson: readDurableJson,
    writeJson: writeDurableJson,
};
export class InternalDeployAuthError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.name = 'InternalDeployAuthError';
        this.status = status;
    }
}
function trimmed(value) {
    return value?.trim() ?? '';
}
function configuredSecret() {
    return trimmed(process.env.IVX_INTERNAL_DEPLOY_SECRET);
}
function configuredWorkerId() {
    return trimmed(process.env.IVX_INTERNAL_WORKER_ID);
}
function secureEqual(left, right) {
    const a = Buffer.from(left, 'utf8');
    const b = Buffer.from(right, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}
function signaturePayload(input) {
    return [input.workerId, input.timestamp, input.nonce, input.method.toUpperCase(), input.pathname, input.body].join('\n');
}
function parseAuthorizationBody(bodyText) {
    let raw;
    try {
        raw = JSON.parse(bodyText);
    }
    catch {
        throw new InternalDeployAuthError('Signed worker requests require a JSON body.', 401);
    }
    const body = raw && typeof raw === 'object' ? raw : {};
    const approvalId = typeof body.ownerApprovalId === 'string' ? body.ownerApprovalId.trim() : '';
    const requestedCommitSha = typeof body.requestedCommitSha === 'string' ? body.requestedCommitSha.trim().toLowerCase() : '';
    const action = typeof body.deploymentAction === 'string' ? body.deploymentAction.trim() : '';
    if (!approvalId || !/^[a-zA-Z0-9_-]{8,128}$/.test(approvalId))
        throw new InternalDeployAuthError('A valid ownerApprovalId is required.', 403);
    if (!/^[a-f0-9]{40}$/i.test(requestedCommitSha))
        throw new InternalDeployAuthError('A 40-character requestedCommitSha is required.', 403);
    if (action !== 'GITHUB_WRITE' && action !== 'RENDER_DEPLOY' && action !== 'PRODUCTION_DEPLOY')
        throw new InternalDeployAuthError('The requested deployment action is not allowed.', 403);
    return { approvalId, requestedCommitSha, action };
}
async function claimNonce(nonce, nowMs, store) {
    const stored = await store.readJson(NONCE_STORE, []);
    const active = stored.filter((item) => item.expiresAt > nowMs).slice(-MAX_NONCES);
    if (active.some((item) => item.nonce === nonce))
        throw new InternalDeployAuthError('Worker nonce has already been used.', 401);
    active.push({ nonce, expiresAt: nowMs + MAX_CLOCK_SKEW_MS });
    await store.writeJson(NONCE_STORE, active);
}
/** Creates a durable single-use owner approval after human JWT authorization. */
export async function createOwnerDeploymentApproval(input, store = durableAuthStore) {
    const requestedCommitSha = input.requestedCommitSha.trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/i.test(requestedCommitSha))
        throw new Error('requestedCommitSha must be a 40-character SHA.');
    if (Date.parse(input.expiresAt) <= Date.now())
        throw new Error('expiresAt must be in the future.');
    const approvals = await store.readJson(APPROVAL_STORE, []);
    const approval = {
        id: crypto.randomUUID(),
        ownerUserId: input.ownerUserId,
        requestedCommitSha,
        action: input.action,
        status: 'approved',
        approvedAt: new Date().toISOString(),
        expiresAt: input.expiresAt,
        usedAt: null,
        requestId: input.requestId,
        createdAt: new Date().toISOString(),
    };
    approvals.push(approval);
    await store.writeJson(APPROVAL_STORE, approvals.slice(-MAX_NONCES));
    return approval;
}
async function consumeApproval(input, store) {
    const approvals = await store.readJson(APPROVAL_STORE, []);
    const now = Date.now();
    const index = approvals.findIndex((approval) => approval.id === input.approvalId);
    const approval = index >= 0 ? approvals[index] : null;
    if (!approval || approval.status !== 'approved')
        throw new InternalDeployAuthError('No approved owner deployment record exists for this request.', 403);
    if (approval.usedAt)
        throw new InternalDeployAuthError('The owner deployment approval has already been used.', 403);
    if (Date.parse(approval.expiresAt) <= now)
        throw new InternalDeployAuthError('The owner deployment approval has expired.', 403);
    if (approval.requestedCommitSha !== input.requestedCommitSha || approval.action !== input.action) {
        throw new InternalDeployAuthError('The owner approval does not match the requested commit and action.', 403);
    }
    approvals[index] = { ...approval, usedAt: new Date(now).toISOString() };
    await store.writeJson(APPROVAL_STORE, approvals);
}
/** Validates and consumes a one-time signed worker deployment authorization. */
export async function authorizeInternalDeploymentRequest(request, store = durableAuthStore) {
    const secret = configuredSecret();
    const expectedWorkerId = configuredWorkerId();
    if (!secret || !expectedWorkerId)
        throw new InternalDeployAuthError('Internal worker authentication is not configured.', 401);
    const workerId = trimmed(request.headers.get('X-IVX-Worker-ID'));
    const timestamp = trimmed(request.headers.get('X-IVX-Timestamp'));
    const nonce = trimmed(request.headers.get('X-IVX-Nonce'));
    const receivedSignature = trimmed(request.headers.get('X-IVX-Deploy-Signature'));
    if (!workerId || !timestamp || !nonce || !receivedSignature)
        throw new InternalDeployAuthError('Required signed worker authentication headers are missing.', 401);
    if (!secureEqual(workerId, expectedWorkerId))
        throw new InternalDeployAuthError('Worker identity is not authorized.', 401);
    const timestampMs = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS)
        throw new InternalDeployAuthError('Worker request timestamp is expired or invalid.', 401);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce))
        throw new InternalDeployAuthError('Worker request nonce is invalid.', 401);
    const body = await request.clone().text();
    const expectedSignature = createHmac('sha256', secret).update(signaturePayload({ workerId, timestamp, nonce, method: request.method, pathname: new URL(request.url).pathname, body }), 'utf8').digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(receivedSignature) || !secureEqual(receivedSignature.toLowerCase(), expectedSignature))
        throw new InternalDeployAuthError('Worker request signature is invalid.', 401);
    const approval = parseAuthorizationBody(body);
    await claimNonce(nonce, Date.now(), store);
    const authorization = { workerId, ...approval };
    await consumeApproval(authorization, store);
    return authorization;
}
/** Secret-safe startup configuration status for observability. */
export function internalDeployAuthRuntimeStatus() {
    return { workerIdConfigured: Boolean(configuredWorkerId()), secretConfigured: Boolean(configuredSecret()) };
}
