-- Keep the existing document format, but serialize edits and claims in Postgres.
-- All changes are scoped to the existing senior developer queue/proof ledger.
create or replace function public.ivx_senior_queue_patch(p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_doc jsonb; v_jobs jsonb; v_change jsonb; v_current jsonb; v_next jsonb;
  v_index integer; v_now timestamptz := clock_timestamp(); v_worker text;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 250 then raise exception 'Invalid queue changes'; end if;
  insert into public.ivx_durable_documents(doc_key,value,updated_at)
    values ('senior-developer-worker/queue.json','{"jobs":[],"durable":true}'::jsonb,v_now) on conflict(doc_key) do nothing;
  select value into v_doc from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json' for update;
  v_jobs := coalesce(v_doc->'jobs','[]'::jsonb);
  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_next := v_change->'next'; v_current := null; v_index := null;
    if nullif(v_next->>'jobId','') is null then raise exception 'Job identity required'; end if;
    select value,(ordinality-1)::integer into v_current,v_index from jsonb_array_elements(v_jobs) with ordinality
      where value->>'jobId'=v_next->>'jobId' limit 1;
    if coalesce(v_current,'null'::jsonb) is distinct from coalesce(v_change->'expected','null'::jsonb) then
      raise exception using errcode='40001', message='Queue job changed concurrently';
    end if;
    if v_current is not null and v_next->>'ownerId' is distinct from v_current->>'ownerId' then raise exception 'Job owner is immutable'; end if;
    v_worker := nullif(v_change->>'workerInstanceId','');
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
    if v_current is null then
      if nullif(v_next->>'idempotencyKey','') is not null and exists (
        select 1 from jsonb_array_elements(v_jobs) j where j->>'idempotencyKey'=v_next->>'idempotencyKey'
          and j->>'status' not in ('completed','failed','cancelled','blocked')
      ) then raise exception using errcode='23505', message='Active idempotency key already exists'; end if;
      v_jobs := v_jobs || jsonb_build_array(v_next);
    else v_jobs := jsonb_set(v_jobs,array[v_index::text],v_next); end if;
  end loop;
  -- Retain every active job and the most recent 200 terminal jobs.
  select coalesce(jsonb_agg(value order by value->>'createdAt'),'[]'::jsonb) into v_jobs from (
    select value from jsonb_array_elements(v_jobs) where value->>'status' not in ('completed','failed','cancelled','blocked')
    union all
    (select value from jsonb_array_elements(v_jobs) where value->>'status' in ('completed','failed','cancelled','blocked') order by value->>'createdAt' desc limit 200)
  ) retained;
  v_doc := v_doc || jsonb_build_object('jobs',v_jobs,'durable',true,'updatedAt',v_now);
  update public.ivx_durable_documents set value=v_doc,updated_at=v_now where doc_key='senior-developer-worker/queue.json';
  return v_doc;
end;
$$;

revoke execute on function public.ivx_senior_queue_patch(jsonb) from public,anon,authenticated;
grant execute on function public.ivx_senior_queue_patch(jsonb) to service_role;
notify pgrst,'reload schema';
