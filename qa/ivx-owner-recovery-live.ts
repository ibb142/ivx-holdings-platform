import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { getIVXOwnerEmailAllowlist } from '../expo/shared/ivx/access-control';
import { PRODUCTION_API } from './ivx-qa-types';

const expectedSha = process.env.GITHUB_SHA;
assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/, 'Exact deployment SHA required');
let observedSha: string | null = null;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const version = await fetch(PRODUCTION_API + '/version', { signal: AbortSignal.timeout(4000) });
    if (version.ok) {
      const body = await version.json() as Record<string, unknown>;
      observedSha = typeof body.commit === 'string' ? body.commit : null;
    } else await version.body?.cancel();
  } catch { /* Keep the failed observation; a different SHA cannot authorize this probe. */ }
  if (observedSha === expectedSha) break;
  if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 3000));
}
assert.equal(observedSha, expectedSha, 'Owner recovery fix is not the deployed SHA');
const email = getIVXOwnerEmailAllowlist()[0];
assert.ok(email, 'An owner identity is required for the negative credential test');
const response = await fetch(PRODUCTION_API + '/api/ivx/owner-passwordless-login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, emergency: 'ivx_emergency_recovery' }),
  signal: AbortSignal.timeout(5000), redirect: 'manual',
});
// Do not read or retain any token-bearing response if the guard regresses.
const status = response.status;
await response.body?.cancel();
const evidence = {
  task: '7.2', sourceSha: expectedSha, observedSha, observedAtUtc: new Date().toISOString(),
  check: 'anonymous_owner_recovery_rejected', status, passed: status === 401,
  responseBodyCaptured: false, scope: 'Negative deployed credential check; no positive owner login or account isolation claim',
};
await mkdir('qa/evidence', { recursive: true });
await writeFile('qa/evidence/owner-recovery-anonymous.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
assert.equal(status, 401, 'Owner recovery must reject a request without a password');
