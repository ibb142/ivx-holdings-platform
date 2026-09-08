-- Same full-jitter policy as ivx-retry-policy.ts: 1s base, 30s cap,
-- maxRetries counts retries after the first attempt; 15-minute elapsed budget.
-- Existing row locks, worker uniqueness, mission scope and owner gates remain.
create or replace function public.ivx_fleet_retry_payload(p_payload jsonb, p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_used integer := coalesce((p_payload->>'retryCount')::integer,0);
  v_max integer := greatest(0,coalesce((p_payload->>'maxRetries')::integer,3));
  v_started timestamptz := coalesce((p_payload->>'retryStartedAt')::timestamptz,p_now);
  v_delay integer;
  v_reason text;
begin
  v_delay := floor(random() * least(30000,1000 * power(2,least(30,greatest(0,v_used)))));
  if v_used < 0 or v_used >= v_max then v_reason := 'attempt_budget';
  elsif v_started > p_now or p_now + v_delay * interval '1 millisecond' >= v_started + interval '15 minutes'
    then v_reason := 'time_budget';
  end if;
  return p_payload || jsonb_build_object(
    'state',case when v_reason is null then 'RETRYING' else 'FAILED' end,
    'retryCount',case when v_reason is null then v_used+1 else v_used end,
    'retryStartedAt',v_started::text,
    'retryNotBefore',case when v_reason is null then (p_now+v_delay*interval '1 millisecond')::text else null end,
    'leaseHolder',null,'leaseExpiresAt',null,'lastHeartbeatAt',null,'blocker',null,
    'error',case when v_reason is null then null else 'retry '||v_reason||' exhausted' end,
    'completedAt',case when v_reason is null then null else p_now::text end,'updatedAt',p_now::text
  );
end;
$$;
revoke execute on function public.ivx_fleet_retry_payload(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.ivx_fleet_retry_payload(jsonb,timestamptz) to service_role;

create or replace function public.ivx_autonomous_tasks_claim_batch(
  p_requests jsonb,
  p_worker_instance_id text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request jsonb;
  v_row public.ivx_autonomous_tasks%rowtype;
  v_payload jsonb;
  v_results jsonb := '[]'::jsonb;
  v_worker_id text;
  v_agent_number integer;
  v_steal_prefix text;
  v_family_prefixes text[];
  v_active_prefixes text[];
  v_stolen boolean;
  v_now timestamptz := clock_timestamp();
  v_recovered integer := 0;
begin
  if nullif(btrim(p_worker_instance_id),'') is null then
    raise exception 'worker instance identity is required';
  end if;
  if jsonb_typeof(coalesce(p_requests,'[]'::jsonb)) <> 'array' then
    raise exception 'p_requests must be a JSON array';
  end if;
  p_lease_seconds := greatest(30,least(coalesce(p_lease_seconds,300),1800));

  -- A dead process cannot renew its five-minute lease. Recover every leased
  -- execution state at expiration, including the old multi-step QA states.
  with stale as (
    select task.task_id,
      case when task.state = 'LEASED'
        then task.payload || jsonb_build_object('state','QUEUED')
        else public.ivx_fleet_retry_payload(task.payload, v_now)
      end as next_payload
    from public.ivx_autonomous_tasks task
    where task.state in (
      'LEASED','RUNNING','EXECUTION_COMPLETED','QA_IN_PROGRESS',
      'READY_FOR_DEPLOYMENT','DEPLOYING','DEPLOYED','PRODUCTION_VERIFYING'
    ) and (task.lease_expires_at < v_now or (
      task.lease_expires_at is null and
      (task.last_heartbeat_at is null or task.last_heartbeat_at < v_now - interval '5 minutes')
    ))
    for update skip locked
  )
  update public.ivx_autonomous_tasks task
  set state = stale.next_payload->>'state',
      lease_holder = null, worker_instance_id = null,
      lease_expires_at = null, last_heartbeat_at = null,
      updated_at = v_now, version = task.version + 1,
      payload = stale.next_payload || jsonb_build_object(
        'leaseHolder',null,'leaseExpiresAt',null,'lastHeartbeatAt',null,'updatedAt',v_now::text
      )
  from stale where task.task_id = stale.task_id;
  get diagnostics v_recovered = row_count;

  -- Retry waits are durable and never occupy an IA. Refill itself promotes due
  -- work, so recovery does not depend on an in-process timer surviving restart.
  with due as (
    select task.task_id,
      case when (task.payload->>'retryStartedAt')::timestamptz <= v_now - interval '15 minutes'
        then 'FAILED' else 'QUEUED' end as next_state
    from public.ivx_autonomous_tasks task
    where task.state = 'RETRYING'
      and coalesce((task.payload->>'retryNotBefore')::timestamptz, '-infinity') <= v_now
    for update skip locked
  )
  update public.ivx_autonomous_tasks task
  set state=due.next_state, lease_holder=null, worker_instance_id=null,
      lease_expires_at=null, last_heartbeat_at=null, updated_at=v_now, version=task.version+1,
      payload=task.payload || jsonb_build_object(
        'state',due.next_state,'leaseHolder',null,'leaseExpiresAt',null,'lastHeartbeatAt',null,
        'updatedAt',v_now::text,
        'error',case when due.next_state='FAILED' then 'retry time_budget exhausted' else null end,
        'completedAt',case when due.next_state='FAILED' then v_now::text else null end
      )
  from due where task.task_id=due.task_id;

  for v_request in
    select value from jsonb_array_elements(coalesce(p_requests,'[]'::jsonb))
  loop
    v_worker_id := nullif(v_request->>'workerId','');
    v_agent_number := case when coalesce(v_request->>'agentNumber','') ~ '^[0-9]+$'
      then (v_request->>'agentNumber')::integer else null end;
    v_steal_prefix := nullif(v_request->'options'->>'stealPrefix','');
    select coalesce(array_agg(value),array[]::text[]) into v_family_prefixes
      from jsonb_array_elements_text(coalesce(v_request->'options'->'missionScope'->'familyPrefixes','[]'::jsonb));
    select coalesce(array_agg(value),array[]::text[]) into v_active_prefixes
      from jsonb_array_elements_text(coalesce(v_request->'options'->'missionScope'->'activePrefixes','[]'::jsonb));
    v_stolen := false;
    v_row := null;

    if v_worker_id is not null then
      -- All processes contending for one logical IA serialize on this key.
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('ivx-autonomous-worker:' || v_worker_id, 0)
      );

      select task.* into v_row
      from public.ivx_autonomous_tasks task
      where task.lease_holder = v_worker_id
        and task.state in (
          'LEASED','RUNNING','EXECUTION_COMPLETED','QA_IN_PROGRESS',
          'READY_FOR_DEPLOYMENT','DEPLOYING','DEPLOYED','PRODUCTION_VERIFYING'
        )
        and (task.lease_expires_at is null or task.lease_expires_at > v_now)
      order by task.last_heartbeat_at desc nulls last, task.updated_at desc
      limit 1
      for update;

      if found then
        -- The owning process keeps the task. Returning no new task prevents a
        -- second process from executing the same logical lane.
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'workerId',v_worker_id,'agentNumber',v_agent_number,'ok',true,
          'task',null,'error',null,'stolen',false,'alreadyActiveTaskId',v_row.task_id
        ));
        continue;
      end if;

      v_row := null;
      select task.* into v_row
      from public.ivx_autonomous_tasks task
      where task.state='QUEUED'
        and coalesce((task.payload->>'retryNotBefore')::timestamptz, '-infinity') <= v_now
        and (v_agent_number is null or task.assigned_agent_number is null or task.assigned_agent_number=v_agent_number)
        and (
          cardinality(v_family_prefixes)=0
          or not exists (select 1 from unnest(v_family_prefixes) prefix where task.idempotency_key like prefix || '%')
          or exists (select 1 from unnest(v_active_prefixes) prefix where task.idempotency_key like prefix || '%')
        )
        and not exists (
          select 1
          from jsonb_array_elements_text(coalesce(task.payload->'dependencies','[]'::jsonb)) dependency(task_id)
          left join public.ivx_autonomous_tasks prerequisite on prerequisite.task_id=dependency.task_id
          where prerequisite.task_id is null or prerequisite.state not in ('VERIFIED','NO_ACTION_REQUIRED')
        )
      order by
        case task.priority when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
        task.due_at asc nulls last, task.business_value desc,
        task.execution_order asc, task.created_at asc, task.task_id asc
      limit 1
      for update skip locked;

      if not found and v_steal_prefix is not null then
        select task.* into v_row
        from public.ivx_autonomous_tasks task
        where task.state='QUEUED'
        and coalesce((task.payload->>'retryNotBefore')::timestamptz, '-infinity') <= v_now
          and task.idempotency_key like v_steal_prefix || '%'
          and (
            cardinality(v_family_prefixes)=0
            or not exists (select 1 from unnest(v_family_prefixes) prefix where task.idempotency_key like prefix || '%')
            or exists (select 1 from unnest(v_active_prefixes) prefix where task.idempotency_key like prefix || '%')
          )
          and not exists (
            select 1
            from jsonb_array_elements_text(coalesce(task.payload->'dependencies','[]'::jsonb)) dependency(task_id)
            left join public.ivx_autonomous_tasks prerequisite on prerequisite.task_id=dependency.task_id
            where prerequisite.task_id is null or prerequisite.state not in ('VERIFIED','NO_ACTION_REQUIRED')
          )
        order by
          case task.priority when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
          task.due_at asc nulls last, task.business_value desc,
          task.execution_order asc, task.created_at asc, task.task_id asc
        limit 1
        for update skip locked;
        v_stolen := found;
      end if;
    end if;

    if v_row.task_id is null then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'workerId',v_worker_id,'agentNumber',v_agent_number,
        'ok',v_worker_id is not null,'task',null,
        'error',case when v_worker_id is null then 'workerId is required' else null end,
        'stolen',false
      ));
    else
      v_payload := v_row.payload || jsonb_build_object(
        'state','LEASED','leaseHolder',v_worker_id,
        'leaseExpiresAt',(v_now + make_interval(secs=>p_lease_seconds))::text,
        'lastHeartbeatAt',v_now::text,'updatedAt',v_now::text
      );
      update public.ivx_autonomous_tasks task
      set state='LEASED', lease_holder=v_worker_id,
          worker_instance_id=p_worker_instance_id,
          lease_expires_at=v_now + make_interval(secs=>p_lease_seconds),
          last_heartbeat_at=v_now, updated_at=v_now,
          payload=v_payload, version=task.version+1
      where task.task_id=v_row.task_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'workerId',v_worker_id,'agentNumber',v_agent_number,'ok',true,
        'task',v_payload,'error',null,'stolen',v_stolen
      ));
    end if;
  end loop;

  insert into public.ivx_autonomous_task_events(event_type,worker_instance_id,event)
  values ('tasks_claimed_batch',p_worker_instance_id,jsonb_build_object(
    'requested',jsonb_array_length(p_requests),
    'leased',(select count(*) from jsonb_array_elements(v_results) result where result->'task' <> 'null'::jsonb),
    'alreadyActive',(select count(*) from jsonb_array_elements(v_results) result where result ? 'alreadyActiveTaskId'),
    'recovered',v_recovered
  ));
  return v_results;
end;
$$;

revoke execute on function public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)
  from public, anon, authenticated;
grant execute on function public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)
  to service_role;
