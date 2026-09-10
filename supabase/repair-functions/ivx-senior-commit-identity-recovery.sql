-- Apply as a registered Supabase migration after the PostgreSQL CI gate passes.
-- CREATE OR REPLACE preserves the existing grants; no task rows are edited.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

create or replace function public.ivx_senior_queue_claim(p_job_id text,p_worker_instance_id text,p_resume boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_doc jsonb; v_job jsonb; v_index integer; v_now timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_worker_instance_id),'') is null then raise exception 'Process identity required'; end if;
  select value into v_doc from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json' for update;
  select value,(ordinality-1)::integer into v_job,v_index from jsonb_array_elements(coalesce(v_doc->'jobs','[]'::jsonb)) with ordinality
    where value->>'jobId'=p_job_id limit 1;
  if v_job is null then return null; end if;
  if p_resume then
    if v_job->>'status'<>'committing' or nullif(v_job->'result'->>'commitSha','') is null
      -- A crash may persist the commit before persisting the PR number. Only
      -- its exact branch and full SHA permit a lease for PR identity recovery.
      -- This claim does not authorize a merge or mark the job completed.
      or (v_job->'result'->>'prNumber' is null and (
        nullif(btrim(v_job->'result'->>'branch'),'') is null
        or v_job->'result'->>'commitSha' !~ '^[a-fA-F0-9]{40}$'))
      or coalesce((v_job->>'leaseExpiresAt')::timestamptz,'-infinity') > clock_timestamp() then return null; end if;
  elsif v_job->>'status'<>'queued' then return null; end if;
  if exists (select 1 from jsonb_array_elements(v_doc->'jobs') j where j->>'ownerId'=v_job->>'ownerId'
    and j->>'jobId'<>p_job_id and j->>'status' not in ('queued','completed','failed','cancelled','blocked')) then return null; end if;
  v_job := v_job || jsonb_build_object('status',case when p_resume then 'committing' else 'running' end,'stage',case when p_resume then 'COMMITTING' else 'RUNNING' end,'startedAt',v_now,'lastHeartbeatAt',v_now,
    'attempts',coalesce((v_job->>'attempts')::integer,0)+case when p_resume then 0 else 1 end,'leaseWorkerInstanceId',p_worker_instance_id,'leaseExpiresAt',v_now+interval '120 seconds');
  v_doc := jsonb_set(v_doc,array['jobs',v_index::text],v_job);
  update public.ivx_durable_documents set value=v_doc,updated_at=v_now where doc_key='senior-developer-worker/queue.json';
  return v_job;
end;
$$;
commit;
