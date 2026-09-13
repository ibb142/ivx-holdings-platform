-- Read only, revision-pinned pages. The existing doc_key primary key locates
-- the document; only the requested entries cross the database connection.
set local lock_timeout = '2s';
set local statement_timeout = '8s';
create or replace function public.ivx_senior_ledger_page(
  p_limit integer default 25, p_offset integer default 0, p_version timestamptz default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_doc jsonb; v_version timestamptz; v_entries jsonb; v_page jsonb; v_total integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50
    or p_offset is null or p_offset < 0 or p_offset > 200
    or (p_version is not null and not isfinite(p_version))
  then raise exception using errcode = '22023', message = 'Invalid ledger page request'; end if;

  select value, updated_at into v_doc, v_version
  from public.ivx_durable_documents
  where doc_key = 'senior-developer-worker/proof-ledger.json';
  if p_version is not null and p_version is distinct from v_version
  then raise exception using errcode = '40001', message = 'Ledger changed while paging; retry from the first page'; end if;

  v_entries := coalesce(v_doc->'entries', '[]'::jsonb);
  if jsonb_typeof(v_entries) <> 'array'
  then raise exception using errcode = '22023', message = 'Invalid ledger entries'; end if;
  v_total := jsonb_array_length(v_entries);
  v_page := jsonb_path_query_array(v_entries,
    format('$[%s to %s]', p_offset, p_offset + p_limit - 1)::jsonpath);
  return jsonb_build_object('entries', v_page, 'total', v_total, 'offset', p_offset,
    'nextOffset', case when p_offset + jsonb_array_length(v_page) < v_total
      then p_offset + jsonb_array_length(v_page) else null end,
    'updatedAt', v_version);
end;
$$;
revoke execute on function public.ivx_senior_ledger_page(integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.ivx_senior_ledger_page(integer,integer,timestamptz) to service_role;
notify pgrst, 'reload schema';
