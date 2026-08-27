import { describe, expect, test } from 'bun:test';
import { validateIVXGitHubOIDCClaims } from './ivx-github-actions-oidc';

const now = 2_000_000_000;
const valid = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'ivx-360-autonomous-recovery',
  exp: now + 300,
  nbf: now - 10,
  repository: 'ibb142/ivx-holdings-platform',
  ref: 'refs/heads/main',
  workflow_ref: 'ibb142/ivx-holdings-platform/.github/workflows/ivx-360-early-warning.yml@refs/heads/main',
  event_name: 'push',
  sub: 'repo:ibb142/ivx-holdings-platform:ref:refs/heads/main',
};

describe('IVX GitHub Actions OIDC claims', () => {
  test('accepts only the IVX 360 main workflow identity', () => {
    expect(validateIVXGitHubOIDCClaims(valid, now)).toBe(true);
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

  test('rejects wrong audience and expired tokens', () => {
    expect(validateIVXGitHubOIDCClaims({ ...valid, aud: 'other-audience' }, now)).toBe(false);
    expect(validateIVXGitHubOIDCClaims({ ...valid, exp: now - 120 }, now)).toBe(false);
  });
});
