-- Owner text queue: fenced leases, atomic message publication and shared worker
-- observations. Senior engineering jobs remain owned by their existing runner.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table public.ivx_owner_ai_tasks
  add column if not exists queue_lease_token uuid,
  add column if not exists queue_lease_until timestamptz;

create table if not exists public.ivx_owner_ai_queue_workers (
  worker_id text primary key,
  source_sha text not null,
  instance_id text not null,
  state text not null check (state in ('ready','paused','degraded','draining')),
  last_seen_at timestamptz not null default now()
);
alter table public.ivx_owner_ai_queue_workers enable row level security;
revoke all on public.ivx_owner_ai_queue_workers from public, anon, authenticated;
grant select, insert, update, delete on public.ivx_owner_ai_queue_workers to service_role;

-- Lock the same durable controls written by the dashboard. Missing or malformed
-- authorization cannot be interpreted as permission to execute.
create or replace function public.ivx_owner_ai_queue_authorized()
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_control jsonb; v_emergency boolean;
begin
  select value->'control' into v_control from public.ivx_durable_documents
    where doc_key='app-completion/campaign-state.json' for share;
  select active into v_emergency from public.ivx_agent_controls
    where control_name='emergency_stop' for share;
  return coalesce(jsonb_typeof(v_control->'paused')='boolean'
    and jsonb_typeof(v_control->'stopped')='boolean'
    and v_control->>'paused'='false' and v_control->>'stopped'='false'
    and v_emergency is false, false);
end;
$$;

create or replace function public.ivx_owner_ai_worker_pulse(
  p_worker_id text, p_source_sha text, p_instance_id text, p_state text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_allowed boolean; v_state text;
begin
  if length(coalesce(p_worker_id,'')) not between 1 and 200
    or p_source_sha !~ '^[0-9a-f]{40}$'
    or length(coalesce(p_instance_id,'')) not between 1 and 300
    or p_state not in ('ready','paused','degraded','draining') then
    raise exception 'Invalid worker observation';
  end if;
  v_allowed := public.ivx_owner_ai_queue_authorized();
  v_state := case when p_state='ready' and not v_allowed then 'paused' else p_state end;
  insert into public.ivx_owner_ai_queue_workers(worker_id,source_sha,instance_id,state,last_seen_at)
    values(p_worker_id,p_source_sha,p_instance_id,v_state,clock_timestamp())
    on conflict(worker_id) do update set source_sha=excluded.source_sha,
      instance_id=excluded.instance_id,state=excluded.state,last_seen_at=excluded.last_seen_at;
  return jsonb_build_object('authorized',v_allowed,'state',v_state,'observedAt',clock_timestamp());
end;
$$;

create or replace function public.ivx_owner_ai_queue_recover()
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  if not public.ivx_owner_ai_queue_authorized() then return 0; end if;
  with expired as (
    select id from public.ivx_owner_ai_tasks
    where status='RUNNING' and coalesce(task_type,'general')<>'senior_dev'
      and trace_id not like 'senior-dev-%'
      and coalesce(queue_lease_until,coalesce(heartbeat_at,updated_at,created_at)+interval '3 minutes')<=clock_timestamp()
    order by created_at limit 10 for update skip locked
  )
  update public.ivx_owner_ai_tasks t set status='RETRYING',claimed_by=null,
    queue_lease_token=null,queue_lease_until=null,next_retry_at=clock_timestamp(),
    checkpoint_history=coalesce(t.checkpoint_history,'[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('checkpoint','LEASE_RECOVERED','at',clock_timestamp())),
    updated_at=clock_timestamp()
  from expired where t.id=expired.id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.ivx_owner_ai_queue_claim(p_worker_id text, p_limit integer default 2)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_tasks jsonb; v_recovered integer;
begin
  if not public.ivx_owner_ai_queue_authorized() then
    return jsonb_build_object('authorized',false,'tasks','[]'::jsonb,'recovered',0);
  end if;
  if not exists(select 1 from public.ivx_owner_ai_queue_workers where worker_id=p_worker_id
    and state='ready' and last_seen_at>clock_timestamp()-interval '75 seconds') then
    raise exception 'Worker observation is absent or stale';
  end if;
  v_recovered := public.ivx_owner_ai_queue_recover();
  with candidates as (
    select id from public.ivx_owner_ai_tasks
    where status in ('QUEUED','RETRYING') and coalesce(task_type,'general')<>'senior_dev'
      and trace_id not like 'senior-dev-%'
      and (next_retry_at is null or next_retry_at<=clock_timestamp())
    order by created_at limit greatest(1,least(coalesce(p_limit,2),2)) for update skip locked
  ), claimed as (
    update public.ivx_owner_ai_tasks t set status='RUNNING',claimed_by=p_worker_id,
      queue_lease_token=gen_random_uuid(),queue_lease_until=clock_timestamp()+interval '90 seconds',
      heartbeat_at=clock_timestamp(),updated_at=clock_timestamp(),
      checkpoint_history=coalesce(t.checkpoint_history,'[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('checkpoint','LEASE_CLAIMED','at',clock_timestamp()))
    from candidates where t.id=candidates.id returning t.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into v_tasks from claimed;
  return jsonb_build_object('authorized',true,'tasks',v_tasks,'recovered',v_recovered);
end;
$$;

create or replace function public.ivx_owner_ai_queue_update(
  p_task_id uuid,p_worker_id text,p_lease_token uuid,p_operation text,p_payload jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_task public.ivx_owner_ai_tasks%rowtype; v_status text;
begin
  if p_operation is null or p_operation not in ('heartbeat','checkpoint','failure','release') then
    raise exception 'Invalid lease operation';
  end if;
  -- A release is always allowed to return work without performing the task.
  if p_operation<>'release' and not public.ivx_owner_ai_queue_authorized() then return false; end if;
  select * into v_task from public.ivx_owner_ai_tasks where id=p_task_id for update;
  if not found or v_task.status<>'RUNNING' or v_task.claimed_by is distinct from p_worker_id
    or v_task.queue_lease_token is distinct from p_lease_token or p_lease_token is null
    or v_task.queue_lease_until is null or v_task.queue_lease_until<=clock_timestamp() then return false; end if;
  if p_operation in ('failure','release') then
    v_status := case when p_operation='release' then 'RETRYING' else p_payload->>'status' end;
    if v_status is null or v_status not in ('RETRYING','FAILED') then raise exception 'Invalid failure transition'; end if;
    update public.ivx_owner_ai_tasks set status=v_status,claimed_by=null,
      queue_lease_token=null,queue_lease_until=null,
      next_retry_at=case when v_status='RETRYING' then coalesce((p_payload->>'next_retry_at')::timestamptz,clock_timestamp()) else null end,
      retry_count=case when p_operation='failure' then retry_count+1 else retry_count end,
      dead_letter=case when p_operation='failure' then coalesce((p_payload->>'dead_letter')::boolean,false) else dead_letter end,
      error_code=case when p_operation='failure' then p_payload->>'error_code' else error_code end,
      error_message=case when p_operation='failure' then left(p_payload->>'error_message',500) else error_message end,
      http_status=case when p_operation='failure' then (p_payload->>'http_status')::integer else http_status end,
      failure_source=case when p_operation='failure' then p_payload->>'failure_source' else failure_source end,
      checkpoint_history=checkpoint_history||jsonb_build_array(jsonb_build_object(
        'checkpoint',case when p_operation='release' then 'WORKER_RELEASED' else coalesce(p_payload->>'checkpoint','RETRYING') end,'at',clock_timestamp())),
      updated_at=clock_timestamp()
      where id=p_task_id;
  else
    update public.ivx_owner_ai_queue_workers set last_seen_at=clock_timestamp()
      where worker_id=p_worker_id and state='ready';
    update public.ivx_owner_ai_tasks set heartbeat_at=clock_timestamp(),
      queue_lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp(),
      checkpoint=coalesce(p_payload->>'checkpoint',checkpoint),
      checkpoint_history=case when p_payload ? 'checkpoint' then checkpoint_history
        ||jsonb_build_array(jsonb_build_object('checkpoint',p_payload->>'checkpoint','at',clock_timestamp())) else checkpoint_history end,
      answer=coalesce(p_payload->>'answer',answer),model=coalesce(p_payload->>'model',model),
      provider=coalesce(p_payload->>'provider',provider),durations=coalesce(p_payload->'durations',durations),
      chaos=case when p_payload ? 'chaos' then p_payload->'chaos' else chaos end
      where id=p_task_id;
  end if;
  return true;
end;
$$;

-- Message insert and task verification commit together. Repeating an ambiguous
-- completion observes the same verified task and cannot insert a second reply.
create or replace function public.ivx_owner_ai_queue_complete(
  p_task_id uuid,p_worker_id text,p_lease_token uuid,p_sender_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_task public.ivx_owner_ai_tasks%rowtype; v_message uuid;
begin
  if not public.ivx_owner_ai_queue_authorized() then return jsonb_build_object('applied',false); end if;
  select * into v_task from public.ivx_owner_ai_tasks where id=p_task_id for update;
  if not found or p_lease_token is null or v_task.queue_lease_token is distinct from p_lease_token
    or v_task.claimed_by is distinct from p_worker_id then return jsonb_build_object('applied',false); end if;
  if v_task.status='VERIFIED' then
    return jsonb_build_object('applied',true,'duplicate',true,'messageId',v_task.assistant_message_id);
  end if;
  if v_task.status<>'RUNNING' or v_task.queue_lease_until is null or v_task.queue_lease_until<=clock_timestamp()
    or length(btrim(coalesce(v_task.answer,'')))=0 then return jsonb_build_object('applied',false); end if;
  if v_task.conversation_id is not null then
    v_message := v_task.id;
    insert into public.messages(id,conversation_id,sender_id,text)
      values(v_message,v_task.conversation_id::uuid,p_sender_id,v_task.answer)
      on conflict(id) do nothing;
    if not exists(select 1 from public.messages where id=v_message
      and conversation_id=v_task.conversation_id::uuid and sender_id=p_sender_id and text=v_task.answer) then
      raise exception 'Reply identity conflict';
    end if;
  end if;
  update public.ivx_owner_ai_tasks set status='VERIFIED',checkpoint='VERIFIED',
    assistant_message_id=v_message::text,http_status=200,error_code=null,error_message=null,failure_source=null,
    checkpoint_history=checkpoint_history||jsonb_build_array(jsonb_build_object('checkpoint','VERIFIED','at',clock_timestamp())),
    updated_at=clock_timestamp() where id=p_task_id;
  return jsonb_build_object('applied',true,'duplicate',false,'messageId',v_message);
end;
$$;

revoke all on function public.ivx_owner_ai_queue_authorized() from public,anon,authenticated;
revoke all on function public.ivx_owner_ai_worker_pulse(text,text,text,text) from public,anon,authenticated;
revoke all on function public.ivx_owner_ai_queue_recover() from public,anon,authenticated;
revoke all on function public.ivx_owner_ai_queue_claim(text,integer) from public,anon,authenticated;
revoke all on function public.ivx_owner_ai_queue_update(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.ivx_owner_ai_queue_complete(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.ivx_owner_ai_queue_authorized() to service_role;
grant execute on function public.ivx_owner_ai_worker_pulse(text,text,text,text) to service_role;
grant execute on function public.ivx_owner_ai_queue_recover() to service_role;
grant execute on function public.ivx_owner_ai_queue_claim(text,integer) to service_role;
grant execute on function public.ivx_owner_ai_queue_update(uuid,text,uuid,text,jsonb) to service_role;
grant execute on function public.ivx_owner_ai_queue_complete(uuid,text,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
