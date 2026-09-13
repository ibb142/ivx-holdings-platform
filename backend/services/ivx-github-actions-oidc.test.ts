import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { diagnoseIVXGitHubActionsOIDCToken, IVX_GITHUB_OIDC_CONTRACT, validateIVXGitHubOIDCClaims } from './ivx-github-actions-oidc';

const recoveryWorkflows = [
  'ivx-112-per-agent-timer-control.yml',
  'ivx-autonomous-certificate-trust-guard.yml',
  'ivx-autonomous-end-to-end-operational-control.yml',
  'ivx-autonomous-out-of-band-rescue.yml',
  'owner-activate-112-landing-now.yml',
];

const now = 2_000_000_000;
const valid = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'ivx-360-autonomous-recovery',
  exp: now + 300,
  nbf: now - 10,
  repository: 'ibb142/ivx-holdings-platform',
  repository_id: '1169662811',
  repository_owner_id: '74543014',
  ref: 'refs/heads/main',
  workflow_ref: 'ibb142/ivx-holdings-platform/.github/workflows/ivx-360-early-warning.yml@refs/heads/main',
  event_name: 'push',
  sub: 'repo:ibb142/ivx-holdings-platform:ref:refs/heads/main',
};

describe('IVX GitHub Actions OIDC claims', () => {
  for (const workflow of recoveryWorkflows) {
    test(`authorizes ${workflow} only for the trusted repository and main branch`, () => {
      const claims = {
        ...valid,
        workflow_ref: `${valid.repository}/.github/workflows/${workflow}@refs/heads/main`,
        event_name: 'workflow_dispatch',
      };
      expect(validateIVXGitHubOIDCClaims(claims, now)).toBe(true);
      expect(IVX_GITHUB_OIDC_CONTRACT.workflows).toContain(`.github/workflows/${workflow}`);
      expect(validateIVXGitHubOIDCClaims({ ...claims, repository: 'attacker/repo' }, now)).toBe(false);
      expect(validateIVXGitHubOIDCClaims({ ...claims, ref: 'refs/heads/feature' }, now)).toBe(false);
      expect(validateIVXGitHubOIDCClaims({ ...claims, workflow_ref: claims.workflow_ref.replace('@refs/heads/main', '@refs/heads/feature') }, now)).toBe(false);
      expect(validateIVXGitHubOIDCClaims({ ...claims, event_name: 'pull_request' }, now)).toBe(false);
    });
  }

  test('accepts legacy IVX 360 main workflow identity', () => {
    expect(validateIVXGitHubOIDCClaims(valid, now)).toBe(true);
  });

  test('accepts exact-SHA 112 certificate workflow identity', () => {
    expect(validateIVXGitHubOIDCClaims({
      ...valid,
      workflow_ref: 'ibb142/ivx-holdings-platform/.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml@refs/heads/main',
    }, now)).toBe(true);
  });

  test('accepts GitHub immutable owner/repository subject identity', () => {
    expect(validateIVXGitHubOIDCClaims({
      ...valid,
      sub: 'repo:ibb142@74543014/ivx-holdings-platform@1169662811:ref:refs/heads/main',
    }, now)).toBe(true);
  });

  test('rejects immutable subject with wrong repository id', () => {
    expect(validateIVXGitHubOIDCClaims({
      ...valid,
      sub: 'repo:ibb142@74543014/ivx-holdings-platform@999:ref:refs/heads/main',
    }, now)).toBe(false);
  });

  test('rejects another repository', () => {
    expect(validateIVXGitHubOIDCClaims({ ...valid, repository: 'attacker/repo' }, now)).toBe(false);
  });

  test('rejects another branch', () => {
    expect(validateIVXGitHubOIDCClaims({ ...valid, ref: 'refs/heads/feature' }, now)).toBe(false);
  });

  test('rejects another workflow', () => {
    expect(validateIVXGitHubOIDCClaims({ ...valid, workflow_ref: 'ibb142/ivx-holdings-platform/.github/workflows/other.yml@refs/heads/main' }, now)).toBe(false);
  });

  test('accepts the manual P0 112-agent fleet workflow', () => {
    expect(validateIVXGitHubOIDCClaims({
      ...valid,
      workflow_ref: 'ibb142/ivx-holdings-platform/.github/workflows/landing-112-p0-force-fleet.yml@refs/heads/main',
      event_name: 'workflow_dispatch',
    }, now)).toBe(true);
  });

  test('accepts the continuous 500-check fleet workflow that drives the agent run endpoint', () => {
    expect(validateIVXGitHubOIDCClaims({
      ...valid,
      workflow_ref: 'ibb142/ivx-holdings-platform/.github/workflows/ivx-112-continuous-500-cycle.yml@refs/heads/main',
      event_name: 'workflow_dispatch',
    }, now)).toBe(true);
  });

  test('rejects wrong audience, repository ids, and expired tokens', () => {
    expect(validateIVXGitHubOIDCClaims({ ...valid, aud: 'other-audience' }, now)).toBe(false);
    expect(validateIVXGitHubOIDCClaims({ ...valid, repository_id: '999' }, now)).toBe(false);
    expect(validateIVXGitHubOIDCClaims({ ...valid, repository_owner_id: '999' }, now)).toBe(false);
    expect(validateIVXGitHubOIDCClaims({ ...valid, exp: now - 120 }, now)).toBe(false);
  });

  test('verifies the signature before accepting a newly authorized recovery workflow', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'ivx-oidc-recovery-test';
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://token.actions.githubusercontent.com/.well-known/jwks');
      return Response.json({ keys: [jwk] });
    }) as typeof fetch;
    try {
      const issuedAt = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        ...valid,
        exp: issuedAt + 300,
        nbf: issuedAt - 10,
        workflow_ref: `${valid.repository}/.github/workflows/${recoveryWorkflows[0]}@refs/heads/main`,
      })).toString('base64url');
      const signed = `${header}.${payload}`;
      const signature = sign('RSA-SHA256', Buffer.from(signed), privateKey);
      expect((await diagnoseIVXGitHubActionsOIDCToken(`${signed}.${signature.toString('base64url')}`)).reason).toBe('ok');
      signature[0] ^= 1;
      expect((await diagnoseIVXGitHubActionsOIDCToken(`${signed}.${signature.toString('base64url')}`)).reason).toBe('signature_invalid');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
