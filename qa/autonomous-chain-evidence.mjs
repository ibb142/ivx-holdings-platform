import { createHash } from 'node:crypto';

export class ChainEvidenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireProof(condition, code) {
  if (!condition) throw new ChainEvidenceError(code);
}
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const SERVICE_IDS = ['srv-d7t9ivreo5us73ftose0', 'srv-d9i15fg4n6ts73bn00j0', 'srv-d7t9j00sfn5c738a18j0'];

// The owner route supports JSON and SSE. Only its terminal receipt identifies
// the durable worker job; streamed prose is never execution evidence.
export function parseOwnerResponse(contentType, text) {
  try {
    if (!contentType.includes('text/event-stream')) return JSON.parse(text);
    requireProof(text.replaceAll('\r\n', '\n').endsWith('\n\n'), 'CHAT_STREAM_TRUNCATED');
    const events = text.replaceAll('\r\n', '\n').split('\n\n').filter(Boolean).flatMap(block => {
      const data = block.split('\n').filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      return data ? [JSON.parse(data)] : [];
    });
    requireProof(!events.some(event => event.type === 'error'), 'CHAT_STREAM_ERROR');
    const final = events.filter(event => event.type === 'final');
    requireProof(final.length === 1 && [200, 202].includes(final[0].status), 'CHAT_TERMINAL_RECEIPT_MISSING');
    return final[0].body;
  } catch (error) {
    if (error instanceof ChainEvidenceError) throw error;
    throw new ChainEvidenceError('CHAT_RESPONSE_INVALID');
  }
}

// These queries return only scoped counts, IDs and a compact receipt. Never
// transfer the complete queue/history or change its rows to make a test pass.
export const ORDER_SEEN_SQL = `
select exists (
  select 1 from public.ivx_messages where conversation_id = $2::uuid
    and sender_role = 'owner'
    and body like ('%' || replace(replace(replace($1, '!', '!!'), '%', '!%'), '_', '!_') || '%') escape '!'
  union all
  select 1 from public.ivx_durable_documents d
    cross join lateral jsonb_path_query(d.value, '$.jobs[*].input.goal') g(goal)
    where d.doc_key = 'senior-developer-worker/queue.json'
    and strpos(g.goal #>> '{}', $1) > 0
  union all
  select 1 from public.ivx_durable_documents d
    where d.doc_key like 'senior-developer-worker/archive/%'
    and strpos(d.value #>> '{job,input,goal}', $1) > 0
) as seen`;

export const CHAIN_SNAPSHOT_SQL = `
with candidates as (
  select j.job from public.ivx_durable_documents d
    cross join lateral jsonb_path_query(d.value,
      '$.jobs[*] ? (@.input.sourceChatMessageId == $request)',
      jsonb_build_object('request', $1::text)) j(job)
    where d.doc_key = 'senior-developer-worker/queue.json'
  union all
  select d.value->'job' from public.ivx_durable_documents d
    where d.doc_key like 'senior-developer-worker/archive/%'
      and d.value #>> '{job,input,sourceChatMessageId}' = $1
), matching as (
  select job from candidates where job->>'ownerId' = $2
    and job #>> '{input,conversationId}' = $3
)
select
  (select coalesce(jsonb_agg(distinct job->>'jobId'), '[]'::jsonb) from matching) as "jobIds",
  (select count(*)::int from public.ivx_messages where conversation_id = $3::uuid
    and sender_role = 'owner' and body = $4) as "ownerMessageCount",
  (select jsonb_build_object('state', value->>'state', 'identity', value->'identity',
    'status', value #> '{response,status}', 'body', value #>> '{response,body}')
    from public.ivx_durable_documents where doc_key = $5) as receipt`;

/** Fails closed for a missing link, including a worker with unknown IA provenance. */
export function verifyChainEvidence({ requestId, conversationId, ownerId, baseSha, sentCount,
  job, database, pullRequest, commit, checkRuns, deployments, health, version, submittedAt }) {
  requireProof(sentCount === 1, 'DUPLICATE_BROWSER_SUBMISSION');
  const expectedTaskId = `chat:${digest(JSON.stringify([ownerId, conversationId, requestId]))}`;
  requireProof(job?.input?.sourceChatMessageId === requestId && job.input.taskId === expectedTaskId
    && job.ownerId === ownerId && job.input.conversationId === conversationId, 'JOB_MESSAGE_IDENTITY_MISMATCH');
  requireProof(database?.jobIds?.length === 1 && database.jobIds[0] === job.jobId, 'DURABLE_JOB_COUNT_MISMATCH');
  requireProof(database.ownerMessageCount === 1, 'OWNER_MESSAGE_COUNT_MISMATCH');
  const receipt = database.receipt;
  requireProof(receipt?.state === 'completed' && [200, 202].includes(receipt.status)
    && receipt.identity?.requestId === requestId && receipt.identity?.ownerId === ownerId
    && receipt.identity?.conversationId === conversationId, 'DURABLE_CHAT_RECEIPT_MISSING');
  let saved;
  try { saved = JSON.parse(receipt.body); } catch { throw new ChainEvidenceError('DURABLE_CHAT_RECEIPT_INVALID'); }
  requireProof(saved.requestId === requestId && saved.executionStatus?.taskId === job.jobId, 'DURABLE_RECEIPT_JOB_MISMATCH');
  requireProof(Number.isInteger(job.input.agentNumber) && job.input.agentNumber >= 1
    && job.input.agentNumber <= 112 && typeof job.input.agentId === 'string'
    && job.input.agentId.trim().length > 0, 'AUTONOMOUS_IA_ASSIGNMENT_MISSING');
  requireProof(job.workspaceEvidence?.jobId === job.jobId
    && job.workspaceEvidence.taskId === expectedTaskId && job.workspaceEvidence.ownerId === ownerId
    && job.workspaceEvidence.agentId === job.input.agentId
    && job.workspaceEvidence.agentNumber === job.input.agentNumber, 'IA_EXECUTION_PROVENANCE_MISSING');
  const result = job.result;
  requireProof(job.status === 'completed' && result?.ok === true && result.finalStatus === 'COMPLETE'
    && result.durable === true && result.jobId === job.jobId, 'WORKER_NOT_COMPLETED');
  requireProof(Date.parse(job.createdAt) >= Date.parse(submittedAt)
    && Date.parse(job.finishedAt) >= Date.parse(job.createdAt), 'JOB_TIMELINE_INVALID');
  requireProof(result.changedFiles?.length > 0 && result.commitCreated === true && result.pushed === true
    && sha(result.commitSha) && result.commitSha !== baseSha, 'NEW_CODE_COMMIT_MISSING');
  requireProof(result.testsRun === true && result.testsPassed === true && result.typecheckRun === true
    && result.typecheckPassed === true && result.ciChecksGreen === true, 'VALIDATION_NOT_PASSED');
  requireProof(result.validationEvidence?.some(e => e.kind === 'test' && e.ok === true && e.exitCode === 0)
    && result.validationEvidence?.some(e => e.kind === 'typecheck' && e.ok === true && e.exitCode === 0), 'VALIDATION_RECEIPTS_MISSING');
  requireProof(commit?.sha === result.commitSha, 'GITHUB_COMMIT_NOT_FOUND');
  const trailers = (commit.commit?.message || '').split('\n').map(line => line.trim());
  requireProof(trailers.includes(`IVX-Agent: IA-${String(job.input.agentNumber).padStart(3, '0')}`)
    && trailers.includes(`IVX-Agent-ID: ${job.input.agentId}`)
    && trailers.includes(`IVX-Task-ID: ${expectedTaskId}`)
    && trailers.includes(`IVX-Worker-Job: ${job.jobId}`), 'COMMIT_ATTRIBUTION_MISMATCH');
  requireProof(result.ciCheckEvidence?.length > 0 && result.ciCheckEvidence.every(e => {
    const matching = checkRuns?.filter(run => run.name === e.checkRunName && run.head_sha === result.commitSha) || [];
    return e.matched === true && e.status === 'completed' && e.conclusion === 'success'
      && matching.length > 0 && matching.every(run => run.status === 'completed' && run.conclusion === 'success');
  }), 'GITHUB_CI_EVIDENCE_MISSING');
  requireProof(pullRequest?.number === result.prNumber && pullRequest.merged === true
    && pullRequest.base?.ref === 'main' && pullRequest.base?.repo?.full_name === 'ibb142/ivx-holdings-platform'
    && pullRequest.head?.sha === result.commitSha && result.prMerged === true
    && sha(pullRequest.merge_commit_sha) && pullRequest.merge_commit_sha === result.prMergeCommitSha, 'PULL_REQUEST_NOT_MERGED');
  const liveSha = pullRequest.merge_commit_sha;
  requireProof(result.endToEndProductionComplete === true && result.deployVerified === true
    && result.commitMatch === true && result.healthOk === true && result.liveCommit === liveSha, 'WORKER_DEPLOYMENT_NOT_VERIFIED');
  requireProof(deployments?.length === 3 && new Set(deployments.map(d => d.serviceId)).size === 3
    && deployments.every(d => SERVICE_IDS.includes(d.serviceId) && d.status === 'live' && d.commit?.id === liveSha
      && Date.parse(d.finishedAt) >= Date.parse(pullRequest.merged_at))
    && deployments.some(d => d.id === result.deployId), 'RENDER_DEPLOYMENT_MISMATCH');
  for (const probe of [health, version]) {
    requireProof(probe?.httpStatus === 200 && probe.commitSha === liveSha
      && probe.degraded === false, 'LIVE_PROBE_MISMATCH');
  }
  return { requestId, taskId: expectedTaskId, jobId: job.jobId, agentId: job.input.agentId,
    agentNumber: job.input.agentNumber, commitSha: result.commitSha, prNumber: result.prNumber,
    liveSha, deployments: deployments.map(d => ({ serviceId: d.serviceId, id: d.id, status: d.status })),
    chainPassed: true, phase4Certified: false, continuous24HoursCertified: false };
}
