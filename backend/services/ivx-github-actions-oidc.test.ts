import { describe, expect, test } from 'bun:test';
import { validateIVXGitHubOIDCClaims } from './ivx-github-actions-oidc';

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
  test('accepts legacy IVX 360 main workflow identity', () => {
    expect(validateIVXGitHubOIDCClaims(valid, now)).toBe(true);
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

  test('rejects wrong audience, repository ids, and expired tokens', () => {
    expect(validateIVXGitHubOIDCClaims({ ...valid, aud: 'other-audience' }, now)).toBe(false);
    expect(validateIVXGitHubOIDCClaims({ ...valid, repository_id: '999' }, now)).toBe(false);
    expect(validateIVXGitHubOIDCClaims({ ...valid, repository_owner_id: '999' }, now)).toBe(false);
    expect(validateIVXGitHubOIDCClaims({ ...valid, exp: now - 120 }, now)).toBe(false);
  });
});
