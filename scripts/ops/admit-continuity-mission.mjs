import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const api = 'https://api.ivxholding.com';
const mission = 'quantum_agi_learning_loop';
const idempotencyKey = 'owner-mission:quantum_agi_learning_loop:2026-09-14';
let token;
async function request(url, init = {}, authenticated = true) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await response.json();
  assert.equal(response.ok, true, `HTTP_${response.status}:${new URL(url).pathname}`);
  return body;
}

try {
  const expectedSha = process.env.EXPECTED_PRODUCTION_SHA;
  assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/);
  const version = await request(`${api}/version`, {}, false);
  assert.equal(version.commit, expectedSha, 'PRODUCTION_SHA_CHANGED');
  const authUrl = new URL(process.env.SUPABASE_URL ?? 'https://invalid');
  assert.equal(authUrl.origin, 'https://kvclcdjmjghndxsngfzb.supabase.co');
  const password = ['OWNER_NEW_PASSWORD', 'OWNER_PASSWORD', 'IVX_OWNER_PASSWORD',
    'IVX_OWNER_NEW_PASSWORD', 'OWNER_LOGIN_PASSWORD', 'IVX_OWNER_LOGIN_PASSWORD']
    .map(name => process.env[name]).find(value => value?.trim());
  assert.ok(password && process.env.SUPABASE_ANON_KEY, 'OWNER_BINDING_UNAVAILABLE');
  const signedIn = await request(`${authUrl.origin}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: 'iperez4242@gmail.com', password }),
  }, false);
  token = signedIn.access_token;
  assert.ok(token, 'OWNER_TOKEN_UNAVAILABLE');
  const owner = await request(`${authUrl.origin}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY },
  });
  assert.equal(owner.id, signedIn.user.id, 'OWNER_IDENTITY_MISMATCH');
  const states = await request(`${api}/api/ivx/autonomous-task-engine/states`);
  assert.equal(states.ok, true, 'OWNER_GATE_NOT_CONFIRMED');

  // One real coordination task; reuse the existing 112-agent fleet. The core
  // generates the taskId and writes that same identity into its durable payload.
  const input = {
    title: `${mission}: continuity recovery and verification`,
    description: [
      'Owner requested continuity recovery for the existing 112-agent fleet and gradual Vercel-to-Render migration.',
      'Verify current CI and the real feed/reels, active leases and recent worker heartbeats, canonical task receipts, and the previous dispatcher state.',
      'Use real tool evidence and keep task identity throughout execution. Preserve the existing fleet assignments and global concurrency/budget limits.',
      'Record code repair, QA, and deployment evidence separately. Do not treat registration, a queued task, or patrol observations as 112 simultaneous developer executions or 24/7 certification.',
      'Existing chat repair PR1879 is being verified. Do not duplicate its edits. Merge/deploy only after the required approved checks and applicable Owner Gates.',
      'Do not change credentials, financial reservations, permissions, production data, lease TTL, or infrastructure as part of this verification task.',
      'Report remaining blockers with the actual task ID and observed source SHA.',
    ].join('\n'),
    taskType: 'qa',
    idempotencyKey,
    priority: 'high',
    milestone: mission,
    estimatedMinutes: 30,
    maxRetries: 2,
  };
  const created = await request(`${api}/api/ivx/autonomous-task-engine/tasks`, {
    method: 'POST', body: JSON.stringify(input),
  });
  assert.equal(created.ok, true, 'MISSION_ADMISSION_FAILED');
  const taskId = created.task?.taskId;
  assert.ok(taskId, 'CORE_TASK_ID_MISSING');
  assert.equal(created.task.idempotencyKey, idempotencyKey, 'ADMISSION_IDENTITY_MISMATCH');
  const persisted = await request(`${api}/api/ivx/autonomous-task-engine/tasks/${encodeURIComponent(taskId)}`);
  assert.equal(persisted.ok, true, 'MISSION_READBACK_FAILED');
  assert.equal(persisted.task?.taskId, taskId, 'PERSISTED_TASK_ID_CHANGED');
  assert.equal(persisted.task?.idempotencyKey, idempotencyKey, 'PERSISTED_IDEMPOTENCY_CHANGED');
  const proof = {
    mission, taskId, idempotencyKey, duplicate: created.duplicate,
    sourceSha: version.commit, state: persisted.task.state,
    assignedAgentNumber: persisted.task.assignedAgentNumber,
    admitted: true, executionVerified: false, fleetAllocationRequested: 112,
    observedAt: new Date().toISOString(),
  };
  await mkdir('qa/evidence/continuity-admission', { recursive: true });
  await writeFile('qa/evidence/continuity-admission/receipt.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} catch (error) {
  // Never print credential responses or authorization headers.
  console.error(error instanceof Error ? error.message : 'MISSION_ADMISSION_FAILED');
  process.exitCode = 1;
}
