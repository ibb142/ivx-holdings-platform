import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// This probe creates one real, read-only inspection through the chat endpoint.
// Credentials stay in process memory; evidence contains only task identities.
const env = process.env;
const api = (env.EXPO_PUBLIC_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/$/, '');
const authBase = env.EXPO_PUBLIC_SUPABASE_URL;
const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
assert(authBase && anon && env.OWNER_EMAIL && env.OWNER_PASSWORD_EFFECTIVE, 'Owner credential binding required');
const login = await fetch(`${authBase.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD_EFFECTIVE }),
  signal: AbortSignal.timeout(30_000),
});
assert.equal(login.status, 200, 'Real owner login failed');
const session = await login.json();
assert(session.access_token, 'Owner access token missing');
const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };

const versionResponse = await fetch(`${api}/version`, { signal: AbortSignal.timeout(15_000) });
assert.equal(versionResponse.status, 200);
const version = await versionResponse.json();
assert.equal(version.commit, env.EXPO_PUBLIC_SOURCE_COMMIT_SHA, 'Live backend must match the certified APK source');

const requestId = `apk-cert-${randomUUID()}`;
const response = await fetch(`${api}/public/chat/stream`, {
  method: 'POST', headers: { ...headers, 'x-ivx-client-id': requestId },
  body: JSON.stringify({
    message: `Audit the repository pipeline in read-only mode and report findings. Verification reference ${requestId}.`,
    requestId, sessionId: requestId, clientId: requestId,
  }),
  signal: AbortSignal.timeout(90_000),
});
assert.equal(response.status, 200, 'Chat handoff HTTP failure');
const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
const handoff = events.find(event => event.type === 'response.autonomous_task');
assert(handoff?.ok && handoff.jobId, 'Chat did not return a real Autonomous job');
assert.equal(handoff.intent.executionMode, 'read_only', 'Probe must remain read-only');
assert.equal(handoff.attached, false, 'An unrelated active job cannot certify this new probe');
const completed = events.find(event => event.type === 'response.completed');
assert.equal(completed?.jobId, handoff.jobId, 'Chat completion lost its job identity');
assert.equal(completed.source, 'autonomous');

let job;
const deadline = Date.now() + 12 * 60_000;
while (Date.now() < deadline) {
  const status = await fetch(`${api}/api/ivx/senior-developer/worker/jobs/${encodeURIComponent(handoff.jobId)}`, {
    headers, signal: AbortSignal.timeout(30_000),
  });
  assert.equal(status.status, 200, 'Worker status unavailable');
  job = (await status.json()).job;
  assert.equal(job?.jobId, handoff.jobId);
  assert.equal(job.input.executionMode, 'read_only');
  assert.equal(job.input.conversationId, requestId, 'Worker provenance does not match this chat');
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(job.status)) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.equal(job?.status, 'completed', `Read-only worker did not complete: ${job?.status || 'unknown'}`);
assert.equal(job.result?.finalStatus, 'COMPLETE', 'Worker completion lacks a successful result');
assert(job.finishedAt, 'Worker completion time missing');
const proof = {
  certificate: 'IVX-CHAT-AUTONOMOUS-LIVE-HANDOFF', passed: true,
  sourceSha: version.commit, requestId, jobId: job.jobId,
  executionMode: job.input.executionMode, workerStatus: job.status,
  workerFinalStatus: job.result.finalStatus, finishedAt: job.finishedAt,
  authenticatedOwner: true, freshJob: true, chatJobIdentityPreserved: true,
  verifiedAt: new Date().toISOString(), secretValuesReturned: false,
};
await mkdir('qa/evidence/dashboard-chat', { recursive: true });
await writeFile('qa/evidence/dashboard-chat/autonomous-handoff.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
