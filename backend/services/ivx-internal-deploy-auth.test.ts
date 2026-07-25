import { afterEach, describe, expect, test } from 'bun:test';
import { authorizeInternalDeploymentRequest, InternalDeployAuthError, internalDeployAuthRuntimeStatus } from './ivx-internal-deploy-auth';

const originalSecret = process.env.IVX_INTERNAL_DEPLOY_SECRET;
const originalWorkerId = process.env.IVX_INTERNAL_WORKER_ID;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.IVX_INTERNAL_DEPLOY_SECRET;
  else process.env.IVX_INTERNAL_DEPLOY_SECRET = originalSecret;
  if (originalWorkerId === undefined) delete process.env.IVX_INTERNAL_WORKER_ID;
  else process.env.IVX_INTERNAL_WORKER_ID = originalWorkerId;
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
    await expect(authorizeInternalDeploymentRequest(request)).rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 401 });
  });

  test('rejects missing signature headers with HTTP 401 when configured', async () => {
    process.env.IVX_INTERNAL_DEPLOY_SECRET = 'test-secret';
    process.env.IVX_INTERNAL_WORKER_ID = 'ivx-senior-dev-01';
    const request = new Request('https://api.ivxholding.com/api/ivx/senior-developer/worker/jobs', { method: 'POST', body: '{}' });
    await expect(authorizeInternalDeploymentRequest(request)).rejects.toMatchObject<Partial<InternalDeployAuthError>>({ status: 401 });
  });
});
