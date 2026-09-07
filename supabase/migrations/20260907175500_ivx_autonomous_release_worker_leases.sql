-- Return every active lease owned by one physical runtime instance in a single
-- transaction. Render sends SIGTERM during rolling deploys; releasing here lets
-- the replacement process claim all 112 logical lanes without waiting for TTL.

create or replace function public.ivx_autonomous_tasks_release_worker(
  p_worker_instance_id text
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_released integer := 0;
begin
  if nullif(btrim(p_worker_instance_id),'') is null then
    raise exception 'worker instance identity is required';
  end if;

  with released as (
    update public.ivx_autonomous_tasks task
    set state='QUEUED',
        lease_holder=null,
        worker_instance_id=null,
        lease_expires_at=null,
        last_heartbeat_at=null,
        updated_at=v_now,
        version=task.version+1,
        payload=task.payload || jsonb_build_object(
          'state','QUEUED',
          'leaseHolder',null,
          'leaseExpiresAt',null,
          'lastHeartbeatAt',null,
          'updatedAt',v_now::text,
          'shutdownReleasedAt',v_now::text
        )
    where task.worker_instance_id=p_worker_instance_id
      and task.state in ('LEASED','RUNNING')
      and task.lease_holder is not null
    returning task.task_id
  )
  select count(*)::integer into v_released from released;

  insert into public.ivx_autonomous_task_events(event_type,worker_instance_id,event)
  values ('worker_leases_released',p_worker_instance_id,jsonb_build_object('released',v_released));

  return jsonb_build_object(
    'ok',true,
    'released',v_released,
    'workerInstanceId',p_worker_instance_id,
    'at',v_now
  );
end;
$$;

revoke execute on function public.ivx_autonomous_tasks_release_worker(text) from public, anon, authenticated;
grant execute on function public.ivx_autonomous_tasks_release_worker(text) to service_role;
