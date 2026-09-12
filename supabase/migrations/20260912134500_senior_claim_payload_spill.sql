-- Project only the claimed payload; retain the document lock and every lease check.
-- No queue rows, history, permissions or memory settings are changed by this migration.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $guard$
declare actual text;
begin
  select encode(sha256(convert_to(prosrc,'UTF8')),'hex') into actual
    from pg_proc where oid=to_regprocedure('public.ivx_senior_queue_claim(text,text,boolean)');
  if actual is null or actual not in (
    '239c84f36e0e35e227eb8526c8b9664811fe103a66cb1ae9fbfe0152bdad47c1',
    'bc56c665fa4a3c3732bf9fd12c58c349c14480e5ac35a7df97c0957a7ef29f61') then
    raise exception 'Senior claim implementation changed';
  end if;
end $guard$;

create or replace function public.ivx_senior_queue_claim(p_job_id text,p_worker_instance_id text,p_resume boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_doc jsonb; v_jobs jsonb; v_job jsonb; v_index integer; v_now timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_worker_instance_id),'') is null then raise exception 'Process identity required'; end if;
  select value into v_doc from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json' for update;
  v_jobs := coalesce(v_doc->'jobs','[]'::jsonb);
  select v_jobs->i,i into v_job,v_index
    from generate_series(0,jsonb_array_length(v_jobs)-1) i
    where v_jobs->i->>'jobId'=p_job_id limit 1;
  if v_job is null then return null; end if;
  if p_resume then
    if coalesce(v_job->>'status','') not in ('queued','running','patching','testing','committing','deploying','verifying')
      or coalesce(v_job->'result'->>'commitSha','') !~ '^[a-fA-F0-9]{40}$'
      or coalesce(v_job->'result'->>'prMerged','false') = 'true'
      -- A crash may persist the commit before persisting the PR number. Only
      -- its exact branch and full SHA permit a lease for PR identity recovery.
      -- This claim does not authorize a merge or mark the job completed.
      or (v_job->'result'->>'prNumber' is null and (
        nullif(btrim(v_job->'result'->>'branch'),'') is null
        or v_job->'result'->>'commitSha' !~ '^[a-fA-F0-9]{40}$'))
      or coalesce((v_job->>'leaseExpiresAt')::timestamptz,'-infinity') > clock_timestamp() then return null; end if;
  elsif coalesce(v_job->>'status','')<>'queued'
    or nullif(v_job->'result'->>'commitSha','') is not null then return null; end if;
  if exists (select 1 from generate_series(0,jsonb_array_length(v_jobs)-1) i
    where v_jobs->i->>'ownerId'=v_job->>'ownerId'
    and v_jobs->i->>'jobId'<>p_job_id
    and v_jobs->i->>'status' not in ('queued','completed','failed','cancelled','blocked')) then return null; end if;
  v_job := v_job || jsonb_build_object('status',case when p_resume then 'committing' else 'running' end,'stage',case when p_resume then 'COMMITTING' else 'RUNNING' end,'startedAt',v_now,'lastHeartbeatAt',v_now,
    'attempts',coalesce((v_job->>'attempts')::integer,0)+case when p_resume then 0 else 1 end,'leaseWorkerInstanceId',p_worker_instance_id,'leaseExpiresAt',v_now+interval '120 seconds');
  v_doc := jsonb_set(v_doc,array['jobs',v_index::text],v_job);
  update public.ivx_durable_documents set value=v_doc,updated_at=v_now where doc_key='senior-developer-worker/queue.json';
  return v_job;
end;
$$;

