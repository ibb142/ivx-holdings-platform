-- Refuse to replace a concurrently changed implementation; allow exact reapplication.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $guard$
declare f record; actual text;
begin
  for f in select * from (values
    ('public.ivx_senior_queue_patch(jsonb)','9c85a22abc1cec0197c891cdeefefc5ec882388bf521a3fb88d9d70aaa3c92ab','9a89090ac92f7b8a3e6dc4b4f439b150a0a56852665eafb2c1e5791b403163c6'),
    ('public.ivx_senior_queue_patch_receipt(jsonb)','70cb437523d52f6c82a0ef440330123a2e9fb1130bf1577269b46c1b72008224','5d509096d17a546d95ed5d34cd2be7694408c8df276a6e4339bc6d48daf48521')
  ) versions(signature,previous_hash,patched_hash) loop
    select encode(sha256(convert_to(prosrc,'UTF8')),'hex') into actual
      from pg_proc where oid=to_regprocedure(f.signature);
    if actual is null or actual not in (f.previous_hash,f.patched_hash) then
      raise exception 'Queue implementation changed: %',f.signature;
    end if;
  end loop;
end $guard$;

-- Walk integer positions before projecting full job payloads. This preserves the
-- CAS, lease, retention and archive contract without spilling each JSON set to disk.
set local lock_timeout='2s';
set local statement_timeout='8s';
create or replace function public.ivx_senior_queue_patch(p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_doc jsonb; v_jobs jsonb; v_change jsonb; v_current jsonb; v_next jsonb;
  v_index integer; v_now timestamptz := clock_timestamp(); v_worker text;
  v_archived jsonb; v_archive_key text; v_inserted integer;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 250 then raise exception 'Invalid queue changes'; end if;
  insert into public.ivx_durable_documents(doc_key,value,updated_at)
    values ('senior-developer-worker/queue.json','{"jobs":[],"durable":true}'::jsonb,v_now) on conflict(doc_key) do nothing;
  select value into v_doc from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json' for update;
  v_jobs := coalesce(v_doc->'jobs','[]'::jsonb);
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_next := v_change->'next'; v_current := null; v_index := null;
    if nullif(v_next->>'jobId','') is null then raise exception 'Job identity required'; end if;
    select v_jobs->i,i into v_current,v_index
      from generate_series(0,jsonb_array_length(v_jobs)-1) i
      where v_jobs->i->>'jobId'=v_next->>'jobId' limit 1;
    if coalesce(v_current,'null'::jsonb) is distinct from coalesce(v_change->'expected','null'::jsonb) then
      raise exception using errcode='40001', message='Queue job changed concurrently';
    end if;
    if v_current is not null and v_next->>'ownerId' is distinct from v_current->>'ownerId' then raise exception 'Job owner is immutable'; end if;
    v_worker := nullif(v_change->>'workerInstanceId','');
    if v_worker is not null and v_current->>'status' in ('completed','failed','cancelled','blocked') then
      raise exception using errcode='55000', message='Terminal job no longer belongs to a worker';
    end if;
    -- A missing identity is not permission to bypass a currently running lease.
    -- Owner cancellation and expired-lease recovery remain explicit exceptions.
    if v_current is not null and v_current->>'status' not in ('queued','completed','failed','cancelled','blocked')
      and v_worker is null and v_next->>'status' <> 'cancelled'
      and not (coalesce((v_current->>'leaseExpiresAt')::timestamptz,'-infinity') <= clock_timestamp()
        and v_next->>'status' in ('queued','failed') and nullif(v_next->>'leaseWorkerInstanceId','') is null) then
      raise exception using errcode='55000', message='Worker lease identity required';
    end if;
    if v_current->>'status' = 'queued' and v_next->>'status' not in ('queued','completed','failed','cancelled','blocked') then
      raise exception using errcode='55000', message='Queued work requires the atomic claim RPC';
    end if;
    if v_current->>'status' in ('completed','failed','cancelled','blocked')
      and v_next->>'status' not in ('queued','completed','failed','cancelled','blocked') then
      raise exception using errcode='55000', message='Terminal job cannot be reactivated by a late phase update';
    end if;
    if v_worker is not null then
      if v_current->>'leaseWorkerInstanceId' is distinct from v_worker
        or coalesce((v_current->>'leaseExpiresAt')::timestamptz,'-infinity') <= clock_timestamp() then
        raise exception using errcode='55000', message='Worker lease lost';
      end if;
      v_next := v_next || jsonb_build_object('leaseWorkerInstanceId',v_worker,'leaseExpiresAt',v_now + interval '120 seconds');
    end if;
    if v_next->>'status' in ('completed','failed','cancelled','blocked') then
      -- This timestamp is the current terminal transition, never a guessed
      -- historical completion time for an already terminal legacy record.
      if nullif(v_next->>'finishedAt','') is null and (v_current is null or
        v_current->>'status' not in ('completed','failed','cancelled','blocked')) then
        v_next := v_next || jsonb_build_object('finishedAt',v_now);
      end if;
      if v_worker is not null then
        v_next := v_next || jsonb_build_object('leaseWorkerInstanceId',null,'leaseExpiresAt',null);
      end if;
    end if;
    if v_current is null then
      if nullif(v_next->>'idempotencyKey','') is not null and exists (
        select 1 from generate_series(0,jsonb_array_length(v_jobs)-1) i
          where v_jobs->i->>'idempotencyKey'=v_next->>'idempotencyKey'
          and v_jobs->i->>'status' not in ('completed','failed','cancelled','blocked')
      ) then raise exception using errcode='23505', message='Active idempotency key already exists'; end if;
      v_jobs := v_jobs || jsonb_build_array(v_next);
    else v_jobs := jsonb_set(v_jobs,array[v_index::text],v_next); end if;
  end loop;
  -- Archive exactly the rows which retention will remove. The full job,
  -- checkpoints and result are committed in the same transaction as removal.
  for v_archived in
    with archived_indices as materialized (
      select i from generate_series(0,jsonb_array_length(v_jobs)-1) i
      where v_jobs->i->>'status' in ('completed','failed','cancelled','blocked')
      order by v_jobs->i->>'createdAt' desc,v_jobs->i->>'jobId' offset 200
    )
    select v_jobs->i from archived_indices
  loop
    v_archive_key := 'senior-developer-worker/archive/' || (v_archived->>'jobId') || '/' ||
      encode(sha256(convert_to(v_archived::text,'UTF8')),'hex') || '.json';
    insert into public.ivx_durable_documents(doc_key,value,updated_at)
      values(v_archive_key,jsonb_build_object('job',v_archived,'archivedAt',v_now,'reason','terminal_retention'),v_now)
      on conflict(doc_key) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      insert into public.ivx_durable_events(doc_key,event,created_at)
        values('senior-developer-worker/queue.json',jsonb_build_object('type','terminal_job_archived',
          'jobId',v_archived->>'jobId','checkpoint',v_archive_key,'status',v_archived->>'status'),v_now);
    end if;
  end loop;
  -- Retain every active job and the most recent 200 terminal jobs.
  with retained_indices as materialized (
    select i from generate_series(0,jsonb_array_length(v_jobs)-1) i
      where v_jobs->i->>'status' not in ('completed','failed','cancelled','blocked')
    union all
    (select i from generate_series(0,jsonb_array_length(v_jobs)-1) i
      where v_jobs->i->>'status' in ('completed','failed','cancelled','blocked')
      order by v_jobs->i->>'createdAt' desc,v_jobs->i->>'jobId' limit 200)
  ), ordered_indices as materialized (
    select i from retained_indices order by v_jobs->i->>'createdAt'
  )
  -- This single ordered input has no joins or filters that could reorder it.
  -- Aggregate payloads only after sorting small indices, never full job rows.
  select coalesce(jsonb_agg(v_jobs->i),'[]'::jsonb) into v_jobs from ordered_indices;
  v_doc := v_doc || jsonb_build_object('jobs',v_jobs,'durable',true,'updatedAt',v_now);
  update public.ivx_durable_documents set value=v_doc,updated_at=v_now where doc_key='senior-developer-worker/queue.json';
  return v_doc;
end;
$$;

revoke execute on function public.ivx_senior_queue_patch(jsonb) from public,anon,authenticated;
grant execute on function public.ivx_senior_queue_patch(jsonb) to service_role;
notify pgrst,'reload schema';

-- Reuse the authoritative CAS/lease mutation exactly once, then project its
-- acknowledgement inside PostgreSQL. Older callers keep the original RPC.
create or replace function public.ivx_senior_queue_patch_receipt(p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_doc jsonb; v_ids text[]; v_jobs jsonb; v_removed jsonb;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Invalid queue changes';
  end if;
  if jsonb_array_length(p_changes) > 250 then raise exception 'Invalid queue changes'; end if;
  select array_agg(change->'next'->>'jobId') into v_ids from jsonb_array_elements(p_changes) change;
  if exists (select 1 from unnest(v_ids) id where nullif(btrim(id),'') is null)
    or cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) id) then
    raise exception 'Distinct job identities required';
  end if;
  v_doc := public.ivx_senior_queue_patch(p_changes);
  select coalesce(jsonb_agg(job),'[]'::jsonb) into v_jobs
    from jsonb_path_query(v_doc, '$.jobs[*] ? (@.jobId == $ids[*])',
      jsonb_build_object('ids',coalesce(to_jsonb(v_ids),'[]'::jsonb))) job;
  -- The underlying retention policy can remove an old terminal job immediately.
  select coalesce(jsonb_agg(id),'[]'::jsonb) into v_removed from unnest(v_ids) id
    where not exists (select 1 from jsonb_array_elements(v_jobs) job where job->>'jobId'=id);
  return jsonb_build_object('kind','ivx-senior-patch-receipt-v1',
    'updatedAt',v_doc->'updatedAt','jobs',v_jobs,'removedJobIds',v_removed);
end;
$$;
revoke execute on function public.ivx_senior_queue_patch_receipt(jsonb) from public,anon,authenticated;
grant execute on function public.ivx_senior_queue_patch_receipt(jsonb) to service_role;
notify pgrst, 'reload schema';
