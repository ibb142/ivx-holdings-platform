-- Fence physical processes as well as logical IA identities. A stale replica
-- may not start, renew, or finish a lease after another process takes over.
create or replace function public.ivx_autonomous_tasks_start_batch(
  p_leases jsonb,
  p_worker_instance_id text,
  p_lease_seconds integer default 300
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_lease jsonb; v_row public.ivx_autonomous_tasks%rowtype; v_payload jsonb;
  v_results jsonb := '[]'::jsonb; v_now timestamptz := clock_timestamp(); v_started integer := 0;
begin
  if nullif(btrim(p_worker_instance_id),'') is null then raise exception 'worker instance identity is required'; end if;
  p_lease_seconds := greatest(30,least(coalesce(p_lease_seconds,300),1800));
  for v_lease in select value from jsonb_array_elements(coalesce(p_leases,'[]'::jsonb)) loop
    v_row := null;
    select task.* into v_row from public.ivx_autonomous_tasks task where task.task_id=v_lease->>'taskId' limit 1 for update;
    if v_row.task_id is null then
      v_results := v_results || jsonb_build_array(jsonb_build_object('taskId',v_lease->>'taskId','workerId',v_lease->>'workerId','ok',false,'task',null,'error','Task not found.'));
    elsif v_row.lease_holder is distinct from v_lease->>'workerId' then
      v_results := v_results || jsonb_build_array(jsonb_build_object('taskId',v_row.task_id,'workerId',v_lease->>'workerId','ok',false,'task',v_row.payload,'error','Not the lease holder.'));
    elsif v_row.worker_instance_id is distinct from p_worker_instance_id or v_row.lease_expires_at is null or v_row.lease_expires_at <= clock_timestamp() then
      v_results := v_results || jsonb_build_array(jsonb_build_object('taskId',v_row.task_id,'workerId',v_lease->>'workerId','ok',false,'task',null,'error','Worker lease lost or expired.'));
    elsif v_row.state <> 'LEASED' then
      v_results := v_results || jsonb_build_array(jsonb_build_object('taskId',v_row.task_id,'workerId',v_lease->>'workerId','ok',false,'task',v_row.payload,'error','Cannot start from state ' || v_row.state || '.'));
    else
      v_payload := v_row.payload || jsonb_build_object('state','RUNNING','startedAt',coalesce(v_row.payload->>'startedAt',v_now::text),'lastHeartbeatAt',v_now::text,'leaseExpiresAt',(v_now+make_interval(secs=>p_lease_seconds))::text,'updatedAt',v_now::text);
      update public.ivx_autonomous_tasks task set state='RUNNING',worker_instance_id=p_worker_instance_id,last_heartbeat_at=v_now,lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),updated_at=v_now,payload=v_payload,version=task.version+1 where task.task_id=v_row.task_id;
      v_started := v_started + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('taskId',v_row.task_id,'workerId',v_lease->>'workerId','ok',true,'task',v_payload,'error',null));
    end if;
  end loop;
  if v_started > 0 then insert into public.ivx_autonomous_task_events(event_type,worker_instance_id,event) values ('tasks_started_batch',p_worker_instance_id,jsonb_build_object('started',v_started)); end if;
  return v_results;
end;
$$;

create or replace function public.ivx_autonomous_tasks_heartbeat_batch(
  p_leases jsonb,
  p_worker_instance_id text,
  p_lease_seconds integer default 300
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_lease jsonb; v_row public.ivx_autonomous_tasks%rowtype; v_payload jsonb;
  v_rejected jsonb := '[]'::jsonb; v_now timestamptz := clock_timestamp(); v_refreshed integer := 0;
begin
  if nullif(btrim(p_worker_instance_id),'') is null then raise exception 'worker instance identity is required'; end if;
  p_lease_seconds := greatest(30,least(coalesce(p_lease_seconds,300),1800));
  for v_lease in select value from jsonb_array_elements(coalesce(p_leases,'[]'::jsonb)) loop
    v_row := null;
    select task.* into v_row from public.ivx_autonomous_tasks task where task.task_id=v_lease->>'taskId' limit 1 for update;
    if v_row.task_id is null then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('taskId',v_lease->>'taskId','error','Task not found.'));
    elsif v_row.lease_holder is distinct from v_lease->>'workerId' then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('taskId',v_row.task_id,'error','Not the lease holder.'));
    elsif v_row.worker_instance_id is distinct from p_worker_instance_id or v_row.lease_expires_at is null or v_row.lease_expires_at <= clock_timestamp() then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('taskId',v_row.task_id,'error','Worker lease lost or expired.'));
    elsif v_row.state not in ('LEASED','RUNNING') then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('taskId',v_row.task_id,'error','Cannot heartbeat state ' || v_row.state || '.'));
    else
      v_payload := v_row.payload || jsonb_build_object('lastHeartbeatAt',v_now::text,'leaseExpiresAt',(v_now+make_interval(secs=>p_lease_seconds))::text,'updatedAt',v_now::text);
      update public.ivx_autonomous_tasks task set worker_instance_id=p_worker_instance_id,last_heartbeat_at=v_now,lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),updated_at=v_now,payload=v_payload,version=task.version+1 where task.task_id=v_row.task_id;
      v_refreshed := v_refreshed + 1;
    end if;
  end loop;
  return jsonb_build_object('ok',jsonb_array_length(v_rejected)=0,'refreshed',v_refreshed,'rejected',v_rejected,'workerInstanceId',p_worker_instance_id,'at',v_now);
end;
$$;

create or replace function public.ivx_autonomous_task_compare_and_set(
  p_task jsonb,
  p_expected_states jsonb,
  p_lease_holder text default null,
  p_worker_instance_id text default null,
  p_event_type text default 'task_updated'
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_row public.ivx_autonomous_tasks%rowtype; v_state text; v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(coalesce(p_task,'null'::jsonb)) <> 'object' or nullif(p_task->>'taskId','') is null then
    return jsonb_build_object('ok',false,'task',null,'error','task payload and taskId are required');
  end if;
  select task.* into v_row from public.ivx_autonomous_tasks task where task.task_id=p_task->>'taskId' limit 1 for update;
  if v_row.task_id is null then return jsonb_build_object('ok',false,'task',null,'error','Task not found.'); end if;
  if jsonb_typeof(coalesce(p_expected_states,'[]'::jsonb)) <> 'array' or not exists (
    select 1 from jsonb_array_elements_text(p_expected_states) expected(state) where expected.state=v_row.state
  ) then return jsonb_build_object('ok',false,'task',v_row.payload,'error','Task state changed concurrently from expected state.'); end if;
  if p_lease_holder is not null and v_row.lease_holder is distinct from p_lease_holder then
    return jsonb_build_object('ok',false,'task',v_row.payload,'error','Not the lease holder.');
  end if;
  if p_lease_holder is not null and (v_row.worker_instance_id is distinct from p_worker_instance_id
    or v_row.lease_expires_at is null or v_row.lease_expires_at <= clock_timestamp()) then
    return jsonb_build_object('ok',false,'task',null,'error','Worker lease lost or expired.');
  end if;
  v_state := p_task->>'state';
  update public.ivx_autonomous_tasks task set
    state=v_state,
    assigned_agent_number=case when coalesce(p_task->>'assignedAgentNumber','') ~ '^[0-9]+$' then (p_task->>'assignedAgentNumber')::integer else null end,
    lease_holder=nullif(p_task->>'leaseHolder',''),
    worker_instance_id=case when nullif(p_task->>'leaseHolder','') is null then null else coalesce(nullif(p_worker_instance_id,''),task.worker_instance_id) end,
    lease_expires_at=nullif(p_task->>'leaseExpiresAt','')::timestamptz,
    last_heartbeat_at=nullif(p_task->>'lastHeartbeatAt','')::timestamptz,
    priority=case when p_task->>'priority' in ('critical','high','medium','low') then p_task->>'priority' else task.priority end,
    execution_order=case when coalesce(p_task->>'executionOrder','') ~ '^-?[0-9]+$' then (p_task->>'executionOrder')::integer else task.execution_order end,
    business_value=greatest(1,least(5,case when coalesce(p_task->>'businessValue','') ~ '^[0-9]+$' then (p_task->>'businessValue')::integer else task.business_value end)),
    due_at=nullif(p_task->>'dueAt','')::timestamptz,
    payload=p_task,
    updated_at=coalesce(nullif(p_task->>'updatedAt','')::timestamptz,v_now),
    version=task.version+1
  where task.task_id=v_row.task_id;
  insert into public.ivx_autonomous_task_events(event_type,task_id,worker_instance_id,event)
  values (coalesce(nullif(p_event_type,''),'task_updated'),v_row.task_id,coalesce(nullif(p_worker_instance_id,''),v_row.worker_instance_id),jsonb_build_object('fromState',v_row.state,'toState',v_state,'leaseHolder',p_lease_holder));
  return jsonb_build_object('ok',true,'task',p_task,'error',null);
end;
$$;

revoke execute on function public.ivx_autonomous_tasks_start_batch(jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.ivx_autonomous_tasks_start_batch(jsonb,text,integer) to service_role;
revoke execute on function public.ivx_autonomous_tasks_heartbeat_batch(jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.ivx_autonomous_tasks_heartbeat_batch(jsonb,text,integer) to service_role;
revoke execute on function public.ivx_autonomous_task_compare_and_set(jsonb,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.ivx_autonomous_task_compare_and_set(jsonb,jsonb,text,text,text) to service_role;
notify pgrst, 'reload schema';
