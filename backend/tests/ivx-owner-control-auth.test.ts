import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { authorizeIVXOwnerControl, invalidateIVXSystemSecretCache } from '../services/ivx-owner-control-auth';

/**
 * Owner-control authorization contract:
 *   valid credential  -> authorized (true)
 *   invalid credential -> denied (false)
 *   missing credential -> denied (false)
 *   GitHub Actions OIDC machine auth is accepted as a separate path and is
 *   verified cryptographically; malformed/wrong-repo tokens are denied.
 */
describe('ivx-owner-control-auth contract', () => {
  const ORIGINAL = process.env.IVX_AI_SYSTEM_SECRET;

  beforeEach(() => {
    process.env.IVX_AI_SYSTEM_SECRET = 'test-canonical-secret-0123456789abcdef';
    invalidateIVXSystemSecretCache();
  });

  afterEach(() => {
    if (typeof ORIGINAL === 'string') process.env.IVX_AI_SYSTEM_SECRET = ORIGINAL;
    else delete process.env.IVX_AI_SYSTEM_SECRET;
    invalidateIVXSystemSecretCache();
  });

  it('authorizes the exact canonical credential', async () => {
    expect(await authorizeIVXOwnerControl('test-canonical-secret-0123456789abcdef')).toBe(true);
  });

  it('denies an invalid credential', async () => {
    expect(await authorizeIVXOwnerControl('wrong-secret-value')).toBe(false);
  });

  it('denies a missing credential', async () => {
    expect(await authorizeIVXOwnerControl('')).toBe(false);
  });

  it('denies when no canonical secret is configured and no OIDC token is present', async () => {
    delete process.env.IVX_AI_SYSTEM_SECRET;
    invalidateIVXSystemSecretCache();
    expect(await authorizeIVXOwnerControl('anything')).toBe(false);
  });

  it('denies a malformed GitHub Actions OIDC token', async () => {
    const request = new Request('https://api.ivxholding.com/api/ivx/agents/app-completion/control', {
      method: 'POST',
      headers: { 'X-IVX-GitHub-OIDC': 'not-a-jwt' },
    });
    expect(await authorizeIVXOwnerControl('', request)).toBe(false);
  });

  it('denies when no credential and no OIDC header are present', async () => {
    const request = new Request('https://api.ivxholding.com/api/ivx/agents/app-completion/control', { method: 'POST' });
    expect(await authorizeIVXOwnerControl('', request)).toBe(false);
  });

  it('still authorizes the canonical secret when an unrelated OIDC header is present', async () => {
    const request = new Request('https://api.ivxholding.com/api/ivx/agents/app-completion/control', {
      method: 'POST',
      headers: { 'X-IVX-GitHub-OIDC': 'garbage' },
    });
    expect(await authorizeIVXOwnerControl('test-canonical-secret-0123456789abcdef', request)).toBe(true);
  });
});
