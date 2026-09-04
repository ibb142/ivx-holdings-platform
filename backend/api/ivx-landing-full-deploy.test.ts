/**
 * Regression: POST /api/ivx/landing-deploy must be owner-only and must reject
 * unauthenticated callers BEFORE reading the body. Found by the Landing P0 fleet
 * (unit security.landing-deploy-unauth): the endpoint pushed production landing
 * assets to S3/CloudFront and accepted AWS credentials with only a confirm token.
 */
import { describe, expect, it } from 'bun:test';
import { handleLandingFullDeploy } from './ivx-landing-full-deploy';

describe('POST /api/ivx/landing-deploy owner guard', () => {
  it('rejects an unauthenticated request with 401 even when the confirm token is supplied', async () => {
    const response = await handleLandingFullDeploy(new Request('https://api.ivxholding.com/api/ivx/landing-deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'DEPLOY_IVX_LANDING_FULL', awsCredentials: { accessKeyId: 'AKIAEXAMPLE0000000000', secretAccessKey: 'not-a-real-secret' }, storeCredentials: true }),
    }));
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain('Owner authorization required');
    expect(text).not.toContain('DEPLOY_IVX_LANDING_FULL');
  });

  it('rejects an empty unauthenticated request with 401 (no confirm-token hint leaks)', async () => {
    const response = await handleLandingFullDeploy(new Request('https://api.ivxholding.com/api/ivx/landing-deploy', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('Invalid confirmation token');
  });
});
