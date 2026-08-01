import { createHmac } from 'node:crypto';

const records = new Map<string, unknown>();

const testStore = {
  readJson: async <T>(file: string, fallback: T): Promise<T> => (records.has(file) ? records.get(file) as T : fallback),
  writeJson: async (file: string, value: unknown): Promise<void> => {
    records.set(file, value);
  },
};

import { createInternalDeploymentAuthorizationRequest } from './ivx-internal-deploy-client';
import {
  authorizeInternalDeploymentRequest,
  createOwnerDeploymentApproval,
  InternalDeployAuthError,
  internalDeployAuthRuntimeStatus,
} from './ivx-internal-deploy-auth';

const originalSecret = process.env.IVX_INTERNAL_DEPLOY_SECRET;
const originalWorkerId = process.env.IVX_INTERNAL_WORKER_ID;
const commitSha = 'a'.repeat(40);
const workerId = 'ivx-senior-dev-01';
const secret = 'test-internal-deploy-secret';

function restoreEnvironment(): void {
  if (originalSecret === undefined) delete process.env.IVX_INTERNAL_DEPLOY_SECRET;
  else process.env.IVX_INTERNAL_DEPLOY_SECRET = originalSecret;
  if (originalWorkerId === undefined) delete process.env.IVX_INTERNAL_WORKER_ID;
  else process.env.IVX_INTERNAL_WORKER_ID = originalWorkerId;
}

function signedRequest(input: {
  ownerApprovalId: string;
  requestedCommitSha?: string;
  deploymentAction?: 'GITHUB_WRITE' | 'RENDER_DEPLOY' | 'PRODUCTION_DEPLOY';
  timestamp?: string;
  nonce?: string;
  signature?: string;
}): Request {
  const body = JSON.stringify({
    ownerApprovalId: input.ownerApprovalId,
    requestedCommitSha: input.requestedCommitSha ?? commitSha,
    deploymentAction: input.deploymentAction ?? 'PRODUCTION_DEPLOY',
    goal: 'Deploy the approved revision.',
  });
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? 'nonce-for-internal-test-0001';
  const payload = [workerId, timestamp, nonce, 'POST', '/api/ivx/senior-developer/worker/jobs', body].join('\n');
  const signature = input.signature ?? createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return new Request('https://api.ivxholding.com/api/ivx/senior-developer/worker/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-IVX-Worker-ID': workerId,
      'X-IVX-Timestamp': timestamp,
      'X-IVX-Nonce': nonce,
      'X-IVX-Deploy-Signature': signature,
    },
    body,
  });
}

async function approvedRecord(action: 'GITHUB_WRITE' | 'RENDER_DEPLOY' | 'PRODUCTION_DEPLOY' = 'PRODUCTION_DEPLOY') {
  return await createOwnerDeploymentApproval({
    ownerUserId: 'owner-user-1',
    requestedCommitSha: commitSha,
    action,
    requestId: 'approval-request-1',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  }, testStore);
}

beforeEach(() => {
  records.clear();
  process.env.IVX_INTERNAL_DEPLOY_SECRET = secret;
  process.env.IVX_INTERNAL_WORKER_ID = workerId;
  process.env.IVX_INTERNAL_API_URL = 'https://api.ivxholding.com';
});

afterEach(() => {
  records.clear();
  restoreEnvironment();
});

describe('internal deploy authentication', () => {
  test('reports only secret-safe runtime configuration state', () => {
    delete process.env.IVX_INTERNAL_DEPLOY_SECRET;
    delete process.env.IVX_INTERNAL_WORKER_ID;
    expect(internalDeployAuthRuntimeStatus()).toEqual({ workerIdConfigured: false, secretConfigured: false });
  });

  test('rejects a worker request when internal auth is not configured', async () => {
    delete process.env.IVX_INTERNAL_DEPLOY_SECRET;
    delete process.env.IVX_INTERNAL_WORKER_ID;
    const request = new Request('https://api.ivxholding.com/api/ivx/senior-developer/worker/jobs', { method: 'POST', body: '{}' });
    await expect(authorizeInternalDeploymentRequest(request, testStore)).rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 401 });
  });

  test('rejects missing signature headers with HTTP 401', async () => {
    const request = new Request('https://api.ivxholding.com/api/ivx/senior-developer/worker/jobs', { method: 'POST', body: '{}' });
    await expect(authorizeInternalDeploymentRequest(request, testStore)).rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 401 });
  });

  test('authorizes a valid signed request and consumes its matching approval once', async () => {
    const approval = await approvedRecord();
    const authorized = await authorizeInternalDeploymentRequest(signedRequest({ ownerApprovalId: approval.id }), testStore);

    expect(authorized).toEqual({ workerId, approvalId: approval.id, requestedCommitSha: commitSha, action: 'PRODUCTION_DEPLOY' });
    await expect(authorizeInternalDeploymentRequest(signedRequest({ ownerApprovalId: approval.id, nonce: 'nonce-for-internal-test-0002' }), testStore))
      .rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 403 });
  });

  test('rejects an invalid signature before it can consume an approval', async () => {
    const approval = await approvedRecord();
    await expect(authorizeInternalDeploymentRequest(signedRequest({ ownerApprovalId: approval.id, signature: 'b'.repeat(64) }), testStore))
      .rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 401 });

    await expect(authorizeInternalDeploymentRequest(signedRequest({ ownerApprovalId: approval.id, nonce: 'nonce-for-internal-test-0003' }), testStore))
      .resolves.toMatchObject({ approvalId: approval.id });
  });

  test('rejects an expired request timestamp with HTTP 401', async () => {
    const approval = await approvedRecord();
    const expiredTimestamp = String(Math.floor((Date.now() - 6 * 60_000) / 1000));
    await expect(authorizeInternalDeploymentRequest(signedRequest({ ownerApprovalId: approval.id, timestamp: expiredTimestamp }), testStore))
      .rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 401 });
  });

  test('rejects a replayed nonce with HTTP 401', async () => {
    const approval = await approvedRecord();
    const first = signedRequest({ ownerApprovalId: approval.id, nonce: 'nonce-for-internal-test-replay' });
    await expect(authorizeInternalDeploymentRequest(first, testStore)).resolves.toMatchObject({ approvalId: approval.id });

    const secondApproval = await approvedRecord();
    await expect(authorizeInternalDeploymentRequest(signedRequest({ ownerApprovalId: secondApproval.id, nonce: 'nonce-for-internal-test-replay' }), testStore))
      .rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 401 });
  });

  test('builds a valid signed request from the configured dedicated worker identity', async () => {
    const approval = await approvedRecord();
    const request = createInternalDeploymentAuthorizationRequest({
      ownerApprovalId: approval.id,
      requestedCommitSha: commitSha,
      deploymentAction: 'PRODUCTION_DEPLOY',
    });
    expect(new URL(request.url).pathname).toBe('/api/ivx/senior-developer/internal-deployment-authorizations/consume');
    await expect(authorizeInternalDeploymentRequest(request, testStore)).resolves.toMatchObject({ approvalId: approval.id, workerId });
  });

  test('rejects a signed request when its action does not match the owner approval', async () => {
    const approval = await approvedRecord('RENDER_DEPLOY');
    await expect(authorizeInternalDeploymentRequest(signedRequest({ ownerApprovalId: approval.id, deploymentAction: 'PRODUCTION_DEPLOY' }), testStore))
      .rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 403 });
  });
});
