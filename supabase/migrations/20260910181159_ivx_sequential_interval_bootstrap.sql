-- Read bounded adjacent heap pages during the one-time archive projection.
-- Physical locations are scan checkpoints only; logical proof identity remains
-- (agent_number, identity). A table rewrite restarts the idempotent scan.
set local lock_timeout='1s';
set local statement_timeout='5s';

alter table public.ivx_work_evidence_archive_state
  add column projection_page_cursor bigint not null default 0,
  add column projection_source_filenode oid;

create function public.ivx_backfill_work_interval_pages(p_pages integer default 256) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_state public.ivx_work_evidence_archive_state%rowtype;
  v_filenode oid; v_start bigint; v_end bigint; v_total bigint;
  v_lower tid; v_upper tid; v_read integer; v_inserted integer; v_restarted boolean;
begin
  if p_pages is null or p_pages < 1 or p_pages > 1024 then raise exception 'Page batch size must be between 1 and 1024'; end if;
  select * into v_state from public.ivx_work_evidence_archive_state where singleton for update;
  if not found then raise exception 'Archive state is missing'; end if;
  if v_state.projection_backfill_complete then return jsonb_build_object('complete',true,'read',0,'inserted',0); end if;
  -- Compatible with normal reads and inserts; prevents a concurrent heap rewrite
  -- between observing the file identity and committing this page checkpoint.
  lock table public.ivx_work_evidence_archive in access share mode;
  v_filenode := pg_catalog.pg_relation_filenode('public.ivx_work_evidence_archive'::regclass);
  v_restarted := v_state.projection_source_filenode is not null and v_state.projection_source_filenode is distinct from v_filenode;
  v_start := case when v_state.projection_source_filenode is distinct from v_filenode then 0 else v_state.projection_page_cursor end;
  v_total := pg_catalog.pg_relation_size('public.ivx_work_evidence_archive'::regclass) / current_setting('block_size')::bigint;
  v_end := least(v_start+p_pages,v_total);
  v_lower := format('(%s,0)',v_start)::tid;
  v_upper := format('(%s,0)',v_end)::tid;
  with batch as materialized (
    select a.agent_number,a.recorded_at,a.measurement as m
    from public.ivx_work_evidence_archive a where a.ctid >= v_lower and a.ctid < v_upper
  ), inserted as (
    insert into public.ivx_work_evidence_intervals(agent_number,identity,outcome,started_at,completed_at,productive_seconds)
    select (m->>'agent')::integer,m->>'identity',m->>'outcome',(m->>'start')::timestamptz,(m->>'end')::timestamptz,(m->>'seconds')::numeric
    from batch where m is not null and (m->>'agent')::integer=agent_number
      and (m->>'end')::timestamptz <= recorded_at + interval '5 seconds'
    on conflict (agent_number,identity) do nothing returning 1
  ) select (select count(*) from batch),(select count(*) from inserted) into v_read,v_inserted;
  -- The insert trigger captures concurrent commits, including inserts into old
  -- pages. Source UPDATE/DELETE is forbidden by the archive's immutable trigger.
  update public.ivx_work_evidence_archive_state set projection_page_cursor=v_end,
    projection_source_filenode=v_filenode,projection_backfill_complete=v_end>=v_total where singleton;
  return jsonb_build_object('complete',v_end>=v_total,'read',v_read,'inserted',v_inserted,
    'pagesCompleted',v_end,'pagesTotal',v_total,'restarted',v_restarted);
end;
$$;
revoke execute on function public.ivx_backfill_work_interval_pages(integer) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
