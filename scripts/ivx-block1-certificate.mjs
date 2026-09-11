import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function buildBlock1Certificate({ sha, health, member, provider, inference, verifiedAt = new Date().toISOString() }) {
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(health?.ok, true, 'Liveness was not observed');
  assert.equal(health?.commit, sha, 'Health belongs to another deployment');
  assert.equal(member?.commit, sha, 'Auth evidence belongs to another deployment');
  assert.equal(member?.certified, true, 'Auth acceptance is incomplete');
  const required = ['runtimeConfig', 'ownerLogin', 'memberRegistration', 'memberLogin', 'memberPersistence', 'regularClassification', 'vipClassification', 'cleanup'];
  const checks = Object.fromEntries(required.map(name => [name, member?.checks?.[name]?.ok === true]));
  assert(Object.values(checks).every(Boolean), 'A required Auth check is missing or failed');
  assert.equal(provider?.aiProviderReady, true, 'Provider readiness was not observed');
  assert.equal(inference?.ok, true, 'Live inference was rejected');
  assert.equal(inference?.commit, sha, 'Inference belongs to another deployment');
  assert(typeof inference?.answer === 'string' && inference.answer.trim().length > 0, 'Live inference returned no answer');
  assert(typeof inference.source === 'string' && inference.source && inference.source !== 'fallback', 'No real provider response');
  return { certificate: 'IVX-BLOCK1-RUNTIME-OBSERVATIONS', certified: true, githubSha: sha,
    scope: 'Observed owner/member Auth, cleanup, provider completion and deployment parity',
    checks, providerReady: true, inferenceSource: inference.source, inferenceRequestId: inference.requestId ?? null,
    healthInstanceId: health.instanceId ?? null, authStartedAt: member.startedAt ?? null,
    authCompletedAt: member.completedAt ?? null, verifiedAt, secretValuesReturned: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const read = name => JSON.parse(readFileSync(`/tmp/${name}.json`, 'utf8'));
  const certificate = buildBlock1Certificate({ sha: process.env.GITHUB_SHA,
    health: read('health'), member: read('member-cert'), provider: read('ai-status'), inference: read('ai') });
  writeFileSync('qa/evidence/block1-p0-certificate.json', JSON.stringify(certificate, null, 2) + '\n');
}
