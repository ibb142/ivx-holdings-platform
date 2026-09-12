export const SENIOR_QUEUE_ACTIVE_STATUSES = [
  'queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying',
] as const;

type WorkItem = { status: string; result?: { commitSha?: string | null; commitMatch?: boolean } | null };
export function isSeniorQueueWorkItem(job: WorkItem): boolean {
  return (SENIOR_QUEUE_ACTIVE_STATUSES as readonly string[]).includes(job.status)
    || (job.status === 'failed' && Boolean(job.result?.commitSha) && job.result?.commitMatch === false);
}

// Failed deployments with a commit and no verified match still belong to the
// existing verification recovery. Keep their complete checkpoints as well.
export const SENIOR_WORK_QUEUE_PATH = '$.jobs[*] ? ('
  + SENIOR_QUEUE_ACTIVE_STATUSES.map(status => `@.status == "${status}"`).join(' || ')
  + ' || (@.status == "failed" && exists(@.result.commitSha)'
  + ' && @.result.commitSha != null && @.result.commitSha != "" && @.result.commitMatch == false))';
export const SENIOR_WORK_QUEUE_SQL = `select jsonb_set(value, '{jobs}',
  jsonb_path_query_array(value, $2::jsonpath)) as value
  from public.ivx_durable_documents where doc_key = $1 limit 1`;

// Filter before the set-returning function materializes payloads. Keep malformed
// non-string identities for the original text comparison and caller validation;
// they must not hide a duplicate. The requested identity is always a bound value.
export const SENIOR_QUEUE_JOB_SQL = `select job from public.ivx_durable_documents d
  cross join lateral jsonb_path_query(coalesce(d.value->'jobs', '[]'::jsonb),
    'strict $[*] ? (@.jobId == $id || @.jobId.type() != "string")',
    jsonb_build_object('id', $2::text)) as job
  where d.doc_key = $1 and job->>'jobId' = $2 limit 2`;

// Filter the owner and active states before materializing checkpoints. Repeated
// d.value->'jobs' extraction per ordinal repeatedly expands the retained history.
// Ordinality preserves the original last-match rule; bound text predicates keep
// malformed identities from changing ownership or hiding an invalid checkpoint.
export const SENIOR_ACTIVE_OWNER_JOB_SQL = `select job from public.ivx_durable_documents d
  cross join lateral jsonb_path_query(coalesce(d.value->'jobs', '[]'::jsonb),
    'strict $[*] ? ((@.ownerId == $owner || @.ownerId.type() != "string") && (@.status == $statuses[*] || @.status.type() != "string"))',
    jsonb_build_object('owner', $2::text, 'statuses', to_jsonb($3::text[])))
    with ordinality as matching(job, ordinal)
  where d.doc_key = $1 and job->>'ownerId' = $2 and job->>'status' = any($3::text[])
  order by ordinal desc limit 1`;

// A mutation boundary needs a fresh lease observation, not another rewrite of
// the queue and its terminal history. Preserve duplicate detection and use the
// database clock; host clock skew must never extend execution authority.
export const SENIOR_QUEUE_AUTHORITY_SQL = `select job->>'jobId' as job_id,
  job->>'status' as status, job->>'leaseWorkerInstanceId' as worker_id,
  job->>'leaseExpiresAt' as lease_expires_at, clock_timestamp() as observed_at
  from (${SENIOR_QUEUE_JOB_SQL}) authority`;
