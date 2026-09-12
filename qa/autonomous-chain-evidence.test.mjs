import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest, parseOwnerResponse, verifyChainEvidence, SERVICE_IDS } from './autonomous-chain-evidence.mjs';

function fixture() {
  const requestId = 'message-123', conversationId = 'room-1', ownerId = 'owner-1';
  const taskId = `chat:${digest(JSON.stringify([ownerId, conversationId, requestId]))}`;
  const jobId = 'ivx-worker-11111111-1111-4111-8111-111111111111';
  const commitSha = 'b'.repeat(40), liveSha = 'c'.repeat(40);
  return { requestId, conversationId, ownerId, sentCount: 1, baseSha: 'a'.repeat(40),
    submittedAt: '2026-09-12T20:00:00Z',
    job: { jobId, ownerId, status: 'completed', createdAt: '2026-09-12T20:00:01Z', finishedAt: '2026-09-12T20:05:00Z',
      input: { taskId, sourceChatMessageId: requestId, conversationId, agentNumber: 7, agentId: 'agent-007' },
      workspaceEvidence: { jobId, taskId, ownerId, agentNumber: 7, agentId: 'agent-007' },
      result: { jobId, ok: true, durable: true, finalStatus: 'COMPLETE', changedFiles: ['expo/app/reels.tsx'],
        commitCreated: true, pushed: true, commitSha, testsRun: true, testsPassed: true,
        typecheckRun: true, typecheckPassed: true, ciChecksGreen: true,
        ciCheckEvidence: [{ context: 'qa-suite', checkRunName: 'qa-suite', matched: true, status: 'completed', conclusion: 'success' }],
        validationEvidence: [{ kind: 'test', ok: true, exitCode: 0 }, { kind: 'typecheck', ok: true, exitCode: 0 }],
        prNumber: 42, prMerged: true, prMergeCommitSha: liveSha, endToEndProductionComplete: true,
        deployVerified: true, commitMatch: true, healthOk: true, liveCommit: liveSha, deployId: 'dep-0' } },
    database: { jobIds: [jobId], ownerMessageCount: 1, receipt: { state: 'completed', status: 202,
      identity: { requestId, conversationId, ownerId }, body: JSON.stringify({ requestId, executionStatus: { taskId: jobId } }) } },
    commit: { sha: commitSha, commit: { message: `Repair autoplay\n\nIVX-Agent: IA-007\nIVX-Agent-ID: agent-007\nIVX-Task-ID: ${taskId}\nIVX-Worker-Job: ${jobId}` } },
    checkRuns: [{ name: 'qa-suite', head_sha: commitSha, status: 'completed', conclusion: 'success' }],
    pullRequest: { number: 42, merged: true, merged_at: '2026-09-12T20:03:00Z',
      base: { ref: 'main', repo: { full_name: 'ibb142/ivx-holdings-platform' } },
      head: { sha: commitSha }, merge_commit_sha: liveSha },
    deployments: SERVICE_IDS.map((serviceId, i) => ({ serviceId, id: `dep-${i}`, status: 'live',
      commit: { id: liveSha }, finishedAt: '2026-09-12T20:04:00Z' })),
    health: { httpStatus: 200, commitSha: liveSha, degraded: false },
    version: { httpStatus: 200, commitSha: liveSha, degraded: false } };
}

test('accepts linked authored and merge SHAs without certifying the fleet or 24 hours', () => {
  const result = verifyChainEvidence(fixture());
  assert.equal(result.chainPassed, true);
  assert.equal(result.phase4Certified, false);
  assert.equal(result.continuous24HoursCertified, false);
  assert.notEqual(result.commitSha, result.liveSha);
});

const rejected = [
  ['two browser submissions', 'DUPLICATE_BROWSER_SUBMISSION', f => { f.sentCount = 2; }],
  ['two durable jobs for one message', 'DURABLE_JOB_COUNT_MISMATCH', f => { f.database.jobIds.push('another-job'); }],
  ['duplicate owner history', 'OWNER_MESSAGE_COUNT_MISMATCH', f => { f.database.ownerMessageCount = 2; }],
  ['worker for another message', 'JOB_MESSAGE_IDENTITY_MISMATCH', f => { f.job.input.sourceChatMessageId = 'other'; }],
  ['request still pending', 'DURABLE_CHAT_RECEIPT_MISSING', f => { f.database.receipt.state = 'running'; }],
  ['receipt for another worker', 'DURABLE_RECEIPT_JOB_MISMATCH', f => { f.database.receipt.body = '{}'; }],
  ['unassigned IA', 'AUTONOMOUS_IA_ASSIGNMENT_MISSING', f => { f.job.input.agentNumber = null; }],
  ['badge without execution provenance', 'IA_EXECUTION_PROVENANCE_MISSING', f => { f.job.workspaceEvidence.agentNumber = 8; }],
  ['failed worker', 'WORKER_NOT_COMPLETED', f => { f.job.status = 'failed'; }],
  ['reused preexisting job', 'JOB_TIMELINE_INVALID', f => { f.job.createdAt = '2026-09-11T20:00:00Z'; }],
  ['unchanged source SHA', 'NEW_CODE_COMMIT_MISSING', f => { f.job.result.commitSha = f.baseSha; }],
  ['short SHA printed as proof', 'NEW_CODE_COMMIT_MISSING', f => { f.job.result.commitSha = 'abc123'; }],
  ['green flags without test receipts', 'VALIDATION_RECEIPTS_MISSING', f => { f.job.result.validationEvidence = []; }],
  ['missing independent GitHub commit', 'GITHUB_COMMIT_NOT_FOUND', f => { f.commit.sha = f.baseSha; }],
  ['commit from another IA', 'COMMIT_ATTRIBUTION_MISMATCH', f => { f.commit.commit.message = 'Repair autoplay'; }],
  ['CI for a different SHA', 'GITHUB_CI_EVIDENCE_MISSING', f => { f.checkRuns[0].head_sha = f.baseSha; }],
  ['failed live CI hidden behind worker flags', 'GITHUB_CI_EVIDENCE_MISSING', f => { f.checkRuns[0].conclusion = 'failure'; }],
  ['unmerged PR', 'PULL_REQUEST_NOT_MERGED', f => { f.pullRequest.merged = false; }],
  ['PR from another repository', 'PULL_REQUEST_NOT_MERGED', f => { f.pullRequest.base.repo.full_name = 'other/repo'; }],
  ['local-only result', 'WORKER_DEPLOYMENT_NOT_VERIFIED', f => { f.job.result.deployVerified = false; }],
  ['stale frontend deployment', 'RENDER_DEPLOYMENT_MISMATCH', f => { f.deployments[2].commit.id = f.baseSha; }],
  ['missing worker deployment', 'RENDER_DEPLOYMENT_MISMATCH', f => { f.deployments.splice(1, 1); }],
  ['unrelated service', 'RENDER_DEPLOYMENT_MISMATCH', f => { f.deployments[1].serviceId = 'other-service'; }],
  ['health HTTP 200 with an old SHA', 'LIVE_PROBE_MISMATCH', f => { f.health.commitSha = f.baseSha; }],
  ['degraded HTTP 200', 'LIVE_PROBE_MISMATCH', f => { f.health.degraded = true; }],
  ['version HTTP 503', 'LIVE_PROBE_MISMATCH', f => { f.version.httpStatus = 503; }],
];
for (const [name, code, mutate] of rejected) {
  test(`rejects ${name}`, () => {
    const evidence = fixture();
    mutate(evidence);
    assert.throws(() => verifyChainEvidence(evidence), { message: code });
  });
}

test('reads canonical JSON and CRLF SSE final bodies', () => {
  const body = { requestId: 'one', executionStatus: { taskId: 'job' } };
  assert.deepEqual(parseOwnerResponse('application/json', JSON.stringify(body)), body);
  const sse = `: keepalive\r\n\r\ndata: ${JSON.stringify({ type: 'delta', text: 'queued' })}\r\n\r\n`
    + `data: ${JSON.stringify({ type: 'final', status: 202, body })}\r\n\r\n`;
  assert.deepEqual(parseOwnerResponse('text/event-stream', sse), body);
});
test('streamed prose and duplicate terminal events cannot certify an execution', () => {
  assert.throws(() => parseOwnerResponse('text/event-stream', 'data: {"type":"delta","text":"SUCCESS"}\n\n'),
    { message: 'CHAT_TERMINAL_RECEIPT_MISSING' });
  const final = 'data: {"type":"final","status":200,"body":{}}\n\n';
  assert.throws(() => parseOwnerResponse('text/event-stream', final + final), { message: 'CHAT_TERMINAL_RECEIPT_MISSING' });
  assert.throws(() => parseOwnerResponse('text/event-stream', 'data: {"type":"error"}\n\n'), { message: 'CHAT_STREAM_ERROR' });
  assert.throws(() => parseOwnerResponse('application/json', 'truncated'), { message: 'CHAT_RESPONSE_INVALID' });
  assert.throws(() => parseOwnerResponse('text/event-stream', final.trimEnd()), { message: 'CHAT_STREAM_TRUNCATED' });
});
