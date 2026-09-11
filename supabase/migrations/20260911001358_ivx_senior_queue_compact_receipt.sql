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
    from jsonb_array_elements(v_doc->'jobs') job where job->>'jobId'=any(v_ids);
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
