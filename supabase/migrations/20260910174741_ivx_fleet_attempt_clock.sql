-- Preserve first start for history and timestamp each newly fenced attempt.
set local lock_timeout='1s';
set local statement_timeout='5s';
CREATE OR REPLACE FUNCTION public.ivx_autonomous_tasks_start_batch(p_leases jsonb, p_worker_instance_id text, p_lease_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      v_payload := v_row.payload || jsonb_build_object('state','RUNNING','startedAt',coalesce(v_row.payload->>'startedAt',v_now::text),'attemptStartedAt',v_now::text,'lastHeartbeatAt',v_now::text,'leaseExpiresAt',(v_now+make_interval(secs=>p_lease_seconds))::text,'updatedAt',v_now::text);
      update public.ivx_autonomous_tasks task set state='RUNNING',worker_instance_id=p_worker_instance_id,last_heartbeat_at=v_now,lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),updated_at=v_now,payload=v_payload,version=task.version+1 where task.task_id=v_row.task_id;
      v_started := v_started + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('taskId',v_row.task_id,'workerId',v_lease->>'workerId','ok',true,'task',v_payload,'error',null));
    end if;
  end loop;
  if v_started > 0 then insert into public.ivx_autonomous_task_events(event_type,worker_instance_id,event) values ('tasks_started_batch',p_worker_instance_id,jsonb_build_object('started',v_started)); end if;
  return v_results;
end;
$function$;

notify pgrst, 'reload schema';
