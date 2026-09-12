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
