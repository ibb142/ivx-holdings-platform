import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const api = 'https://api.ivxholding.com';
const mission = 'quantum_agi_learning_loop';
const idempotencyKey = 'owner-mission:quantum_agi_learning_loop:2026-09-14';
let token;
async function request(url, init = {}, authenticated = true, acceptedStatuses = []) {
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
  assert.ok(response.ok || acceptedStatuses.includes(response.status), `HTTP_${response.status}:${new URL(url).pathname}`);
  return body;
}

async function requestExecutorRepair(task, sourceSha) {
  assert.equal(task.taskType, 'qa', 'UNEXPECTED_MISSION_TYPE');
  assert.equal(task.idempotencyKey, idempotencyKey, 'UNEXPECTED_MISSION_IDENTITY');
  assert.match(task.blocker ?? '', /^NO_EXECUTOR:/, 'EXECUTOR_BLOCKER_NOT_OBSERVED');
  const marker = `[CONTINUITY_EXECUTOR_REPAIR:${task.taskId}]`;
  const goal = [
    marker,
    'Repair the reproduced canonical QA mission dispatch failure in ivx-agent-real-engineering-cycle.ts.',
    'The existing owner-created continuity verification task reaches its assigned IA but stops with NO_EXECUTOR because only Landing, technical schedules and module audits are supported.',
    'Implement a bounded supported execution path for this typed continuity-verification task using existing real inspection/worker capabilities and durable evidence. Preserve the original canonical taskId, assignment and physical lease fencing across handoff and restart.',
    'Verify actual CI status, readiness, feed availability and recent fleet evidence. Missing external access or an unmet criterion must remain explicitly blocked. Never call a generic module audit a completed migration or certify 112 model executions from registry or patrol counts.',
    'Add regression tests for accepted handoff, durable identity, duplicate/restart recovery and unsupported or malformed contracts. Keep incompatible tasks fail-closed; do not fabricate fields or reinterpret their instructions as a supported module.',
    'Preserve the existing 112 assignments, Owner Gates, global concurrency and budget. Do not change authentication, credentials, environment variables, DNS, infrastructure, database schema or production data.',
    'Do not edit the separate chat repair PR1879 or weaken its mobile tests. Produce a focused code diff and regression evidence in a reviewable PR. The existing owner policy permits merge only after every applicable check approves that exact head. Do not trigger a manual production deployment. Report committed, merged and live states separately.',
  ].join('\n');
  const priorEvidence = (task.evidence ?? []).find(evidence => evidence.summary?.includes(marker));
  let job;
  if (priorEvidence) {
    const url = new URL(priorEvidence.source);
    assert.equal(url.origin, api, 'REPAIR_RECEIPT_ORIGIN_MISMATCH');
    assert.match(url.pathname, /^\/api\/ivx\/senior-developer\/worker\/jobs\/ivx-worker-[a-f0-9-]+$/, 'REPAIR_RECEIPT_PATH_MISMATCH');
    job = (await request(url.href)).job;
  } else {
    const existing = await request(`${api}/api/ivx/senior-developer/worker/jobs`);
    assert.ok(Array.isArray(existing.jobs), 'WORKER_QUEUE_READ_UNCONFIRMED');
    job = existing.jobs.find(candidate => candidate.input?.goal?.includes(marker));
    if (!job) {
      // The existing owner-authenticated route supplies authorization and applies
      // the shared queue's admission limits. A lost POST response is never replayed.
      const admitted = await request(`${api}/api/ivx/senior-developer/worker/jobs`, {
        method: 'POST',
        body: JSON.stringify({
          goal, templateMode: 'BUG_FIX', executionMode: 'code_change',
          approvePatch: false, approveGitDeploy: false, validationMode: 'focused',
          proposedPlan: 'Repair the unsupported canonical QA dispatch path and prove durable identity with focused regressions.',
          filesAffected: ['backend/services/ivx-agent-real-engineering-cycle.ts', 'backend/services/ivx-agent-real-engineering-cycle.test.ts', 'backend/services/ivx-task-worker-handoff.ts'],
          riskLevel: 'low', rollbackOption: 'Revert the reviewed repair commit before deployment.',
        }),
      }, true, [409]);
      job = admitted.job;
    }
  }
  assert.ok(job?.jobId && job.input?.goal?.includes(marker), 'WORKER_REPAIR_IDENTITY_NOT_CONFIRMED');
  const receipt = { marker, sourceTaskId: task.taskId, workerJobId: job.jobId,
    workerStatus: job.status, sourceSha, observedAt: new Date().toISOString(),
    missionExecutionVerified: false, repairRequested: true,
    mergePolicy: 'existing owner policy: all applicable exact-head checks must pass',
    directDeployAuthorized: false, platformAutoDeployPossible: true };
  await mkdir('qa/evidence/continuity-admission', { recursive: true });
  await writeFile('qa/evidence/continuity-admission/repair-receipt.json', JSON.stringify(receipt, null, 2));
  if (!priorEvidence) {
    const summary = `${marker} Accepted code repair ${job.jobId}; observed status ${job.status}. This is a repair handoff, not proof that the mission executed or completed.`;
    const linked = await request(`${api}/api/ivx/autonomous-task-engine/tasks/${encodeURIComponent(task.taskId)}/evidence`, {
      method: 'POST', body: JSON.stringify({ evidenceType: 'log',
        source: `${api}/api/ivx/senior-developer/worker/jobs/${job.jobId}`,
        summary, contentHash: createHash('sha256').update(summary).digest('hex'), commitSha: sourceSha }),
    });
    assert.equal(linked.ok, true, 'REPAIR_RECEIPT_LINK_UNCONFIRMED');
  }
  console.log(JSON.stringify(receipt));
  return receipt;
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
  let persisted = await request(`${api}/api/ivx/autonomous-task-engine/tasks/${encodeURIComponent(taskId)}`);
  assert.equal(persisted.ok, true, 'MISSION_READBACK_FAILED');
  assert.equal(persisted.task?.taskId, taskId, 'PERSISTED_TASK_ID_CHANGED');
  assert.equal(persisted.task?.idempotencyKey, idempotencyKey, 'PERSISTED_IDEMPOTENCY_CHANGED');
  if (process.env.RECOVER_SUPPORTED_EXECUTOR === 'true') {
    const topology = await request(`${api}/api/ivx/autonomous/ha`);
    assert.equal(topology.ok, true, 'PROCESS_TOPOLOGY_UNAVAILABLE');
    assert.equal(topology.ready, true, 'NEW_EXECUTOR_NOT_READY_ON_ALL_REPLICAS');
    assert.equal(topology.commitSha, expectedSha, 'EXECUTOR_REPLICA_SHA_MISMATCH');
    const current = persisted.task;
    if (current.state === 'BLOCKED' && current.blocker?.startsWith('NO_EXECUTOR:')) {
      assert.ok(!current.leaseHolder || Date.parse(current.leaseExpiresAt ?? '') <= Date.now(), 'PRIOR_LEASE_STILL_ACTIVE');
      assert.equal(current.taskType, 'qa');
      assert.equal(current.milestone, mission);
      assert.ok(current.retryCount < current.maxRetries, 'MISSION_RETRY_BUDGET_EXHAUSTED');
      const retry = await request(`${api}/api/ivx/autonomous-task-engine/tasks/${encodeURIComponent(taskId)}/transition`, {
        method: 'POST', body: JSON.stringify({ toState: 'RETRYING' }),
      });
      assert.equal(retry.ok, true, 'CANONICAL_RETRY_REFUSED');
      assert.equal(retry.task?.taskId, taskId, 'RETRY_TASK_ID_CHANGED');
      persisted = await request(`${api}/api/ivx/autonomous-task-engine/tasks/${encodeURIComponent(taskId)}`);
    }
  }
  const repair = process.env.REQUEST_EXECUTOR_REPAIR === 'true'
    ? await requestExecutorRepair(persisted.task, version.commit) : null;
  const proof = {
    mission, taskId, idempotencyKey, duplicate: created.duplicate,
    sourceSha: version.commit, state: persisted.task.state,
    assignedAgentNumber: persisted.task.assignedAgentNumber,
    admitted: true, executionVerified: false, fleetAllocationRequested: 112,
    observedAt: new Date().toISOString(),
    repair,
  };
  await mkdir('qa/evidence/continuity-admission', { recursive: true });
  await writeFile('qa/evidence/continuity-admission/receipt.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} catch (error) {
  // Never print credential responses or authorization headers.
  console.error(error instanceof Error ? error.message : 'MISSION_ADMISSION_FAILED');
  process.exitCode = 1;
}
