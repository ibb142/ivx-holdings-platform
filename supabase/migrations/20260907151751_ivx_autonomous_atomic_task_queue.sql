-- IVX autonomous fleet: normalized, row-atomic task queue.
--
-- The previous fleet ledger stored every task inside one JSON document. Its
-- mutex was process-local, so two Render processes could claim or overwrite
-- the same work. These rows and RPCs make creation idempotent and leasing,
-- starts, heartbeats and evidence transitions transactional in PostgreSQL.

create table if not exists public.ivx_autonomous_tasks (
  task_id text primary key,
  idempotency_key text not null,
  state text not null,
  assigned_agent_number integer,
  lease_holder text,
  worker_instance_id text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  priority text not null default 'medium',
  execution_order integer not null default 0,
  business_value smallint not null default 3,
  due_at timestamptz,
  payload jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ivx_autonomous_tasks_state_check check (state in (
    'RECEIVED','VALIDATING','PLANNING','WAITING_FOR_APPROVAL','QUEUED',
    'LEASED','RUNNING','PAUSED','RETRYING','BLOCKED','CANCELLED','FAILED',
    'EXECUTION_COMPLETED','QA_IN_PROGRESS','QA_FAILED','READY_FOR_DEPLOYMENT',
    'DEPLOYING','DEPLOYED','PRODUCTION_VERIFYING','VERIFIED','EXPIRED','STALE',
    'NO_ACTION_REQUIRED'
  )),
  constraint ivx_autonomous_tasks_priority_check check (priority in ('critical','high','medium','low')),
  constraint ivx_autonomous_tasks_agent_check check (assigned_agent_number is null or assigned_agent_number between 1 and 112),
  constraint ivx_autonomous_tasks_business_value_check check (business_value between 1 and 5),
  constraint ivx_autonomous_tasks_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload ? 'taskId'
    and payload->>'taskId' = task_id
  )
);

create unique index if not exists ivx_autonomous_tasks_active_idempotency_idx
  on public.ivx_autonomous_tasks (idempotency_key)
  where state not in ('CANCELLED','EXPIRED');
create index if not exists ivx_autonomous_tasks_claim_idx
  on public.ivx_autonomous_tasks (state, assigned_agent_number, priority, execution_order, created_at)
  where state = 'QUEUED';
create index if not exists ivx_autonomous_tasks_lease_idx
  on public.ivx_autonomous_tasks (state, last_heartbeat_at, lease_expires_at)
  where lease_holder is not null;
create index if not exists ivx_autonomous_tasks_instance_idx
  on public.ivx_autonomous_tasks (worker_instance_id, last_heartbeat_at)
  where worker_instance_id is not null;

create table if not exists public.ivx_autonomous_task_events (
  event_id bigserial primary key,
  event_type text not null,
  task_id text,
  worker_instance_id text,
  event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ivx_autonomous_task_events_created_idx
  on public.ivx_autonomous_task_events (created_at desc);
create index if not exists ivx_autonomous_task_events_task_idx
  on public.ivx_autonomous_task_events (task_id, created_at desc)
  where task_id is not null;

alter table public.ivx_autonomous_tasks enable row level security;
alter table public.ivx_autonomous_task_events enable row level security;
revoke all on table public.ivx_autonomous_tasks from public, anon, authenticated;
revoke all on table public.ivx_autonomous_task_events from public, anon, authenticated;
revoke all on sequence public.ivx_autonomous_task_events_event_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.ivx_autonomous_tasks to service_role;
grant select, insert on table public.ivx_autonomous_task_events to service_role;
grant usage, select on sequence public.ivx_autonomous_task_events_event_id_seq to service_role;

-- Preserve the durable ledger as history while retiring duplicate active keys.
-- This copy is idempotent and leaves the original JSON document untouched.
with source_tasks as (
  select task as payload
  from public.ivx_durable_documents document
  cross join lateral jsonb_array_elements(document.value) task
  where document.doc_key = 'task-engine/tasks.json'
    and jsonb_typeof(document.value) = 'array'
    and nullif(task->>'taskId', '') is not null
    and nullif(task->>'idempotencyKey', '') is not null
    and task->>'state' in (
      'RECEIVED','VALIDATING','PLANNING','WAITING_FOR_APPROVAL','QUEUED',
      'LEASED','RUNNING','PAUSED','RETRYING','BLOCKED','CANCELLED','FAILED',
      'EXECUTION_COMPLETED','QA_IN_PROGRESS','QA_FAILED','READY_FOR_DEPLOYMENT',
      'DEPLOYING','DEPLOYED','PRODUCTION_VERIFYING','VERIFIED','EXPIRED','STALE',
      'NO_ACTION_REQUIRED'
    )
), active_ranked as (
  select payload,
    row_number() over (
      partition by payload->>'idempotencyKey'
      order by
        case payload->>'state'
          when 'VERIFIED' then 100 when 'NO_ACTION_REQUIRED' then 100
          when 'PRODUCTION_VERIFYING' then 90 when 'DEPLOYED' then 90
          when 'DEPLOYING' then 85 when 'READY_FOR_DEPLOYMENT' then 85
          when 'QA_IN_PROGRESS' then 80 when 'EXECUTION_COMPLETED' then 75
          when 'RUNNING' then 60 when 'LEASED' then 50 when 'RETRYING' then 40
          when 'BLOCKED' then 35 when 'QUEUED' then 30 else 0 end desc,
        coalesce(nullif(payload->>'createdAt','')::timestamptz, now()) asc,
        payload->>'taskId' asc
    ) as active_rank
  from source_tasks
  where payload->>'state' not in ('CANCELLED','EXPIRED')
), prepared as (
  select case when active_rank = 1 then payload else payload || jsonb_build_object(
    'state', 'CANCELLED',
    'error', 'duplicate retired during postgres_atomic migration',
    'leaseHolder', null,
    'leaseExpiresAt', null,
    'updatedAt', now()::text
  ) end as payload
  from active_ranked
  union all
  select payload from source_tasks where payload->>'state' in ('CANCELLED','EXPIRED')
)
insert into public.ivx_autonomous_tasks (
  task_id, idempotency_key, state, assigned_agent_number, lease_holder,
  lease_expires_at, last_heartbeat_at, priority, execution_order,
  business_value, due_at, payload, created_at, updated_at
)
select
  payload->>'taskId',
  payload->>'idempotencyKey',
  payload->>'state',
  case when coalesce(payload->>'assignedAgentNumber','') ~ '^[0-9]+$'
    then (payload->>'assignedAgentNumber')::integer else null end,
  nullif(payload->>'leaseHolder',''),
  nullif(payload->>'leaseExpiresAt','')::timestamptz,
  nullif(payload->>'lastHeartbeatAt','')::timestamptz,
  case when payload->>'priority' in ('critical','high','medium','low') then payload->>'priority' else 'medium' end,
  case when coalesce(payload->>'executionOrder','') ~ '^-?[0-9]+$' then (payload->>'executionOrder')::integer else 0 end,
  greatest(1, least(5, case when coalesce(payload->>'businessValue','') ~ '^[0-9]+$' then (payload->>'businessValue')::integer else 3 end)),
  nullif(payload->>'dueAt','')::timestamptz,
  payload,
  coalesce(nullif(payload->>'createdAt','')::timestamptz, now()),
  coalesce(nullif(payload->>'updatedAt','')::timestamptz, now())
from prepared
on conflict (task_id) do nothing;

create or replace function public.ivx_autonomous_tasks_create_batch(p_tasks jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_input jsonb;
  v_payload jsonb;
  v_existing jsonb;
  v_results jsonb := '[]'::jsonb;
  v_duplicate boolean;
begin
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;
  for v_input in select value from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) loop
    if nullif(v_input->>'taskId','') is null or nullif(v_input->>'idempotencyKey','') is null then
      v_results := v_results || jsonb_build_array(jsonb_build_object('ok',false,'task',null,'duplicate',false,'error','taskId and idempotencyKey are required'));
      continue;
    end if;
    v_existing := null;
    select task.payload into v_existing
    from public.ivx_autonomous_tasks task
    where task.idempotency_key = v_input->>'idempotencyKey'
      and task.state not in ('CANCELLED','EXPIRED')
    order by task.created_at asc
    limit 1
    for update;
    v_duplicate := found;
    if not v_duplicate then
      begin
        insert into public.ivx_autonomous_tasks (
          task_id,idempotency_key,state,assigned_agent_number,lease_holder,
          lease_expires_at,last_heartbeat_at,priority,execution_order,
          business_value,due_at,payload,created_at,updated_at
        ) values (
          v_input->>'taskId', v_input->>'idempotencyKey', v_input->>'state',
          case when coalesce(v_input->>'assignedAgentNumber','') ~ '^[0-9]+$' then (v_input->>'assignedAgentNumber')::integer else null end,
          nullif(v_input->>'leaseHolder',''), nullif(v_input->>'leaseExpiresAt','')::timestamptz,
          nullif(v_input->>'lastHeartbeatAt','')::timestamptz,
          case when v_input->>'priority' in ('critical','high','medium','low') then v_input->>'priority' else 'medium' end,
          case when coalesce(v_input->>'executionOrder','') ~ '^-?[0-9]+$' then (v_input->>'executionOrder')::integer else 0 end,
          greatest(1,least(5,case when coalesce(v_input->>'businessValue','') ~ '^[0-9]+$' then (v_input->>'businessValue')::integer else 3 end)),
          nullif(v_input->>'dueAt','')::timestamptz, v_input,
          coalesce(nullif(v_input->>'createdAt','')::timestamptz,now()),
          coalesce(nullif(v_input->>'updatedAt','')::timestamptz,now())
        );
        v_existing := v_input;
      exception when unique_violation then
        select task.payload into v_existing
        from public.ivx_autonomous_tasks task
        where task.idempotency_key = v_input->>'idempotencyKey'
          and task.state not in ('CANCELLED','EXPIRED')
        order by task.created_at asc limit 1;
        v_duplicate := true;
      end;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('ok',v_existing is not null,'task',v_existing,'duplicate',v_duplicate,'error',case when v_existing is null then 'idempotent insert failed' else null end));
  end loop;
  if jsonb_array_length(v_results) > 0 then
    insert into public.ivx_autonomous_task_events(event_type,event)
    values ('tasks_created_batch',jsonb_build_object('requested',jsonb_array_length(p_tasks),'results',jsonb_array_length(v_results)));
  end if;
  return v_results;
end;
$$;

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
  v_changed integer := 0;
begin
  if nullif(btrim(p_worker_instance_id),'') is null then raise exception 'worker instance identity is required'; end if;
  if jsonb_typeof(coalesce(p_requests,'[]'::jsonb)) <> 'array' then raise exception 'p_requests must be a JSON array'; end if;
  p_lease_seconds := greatest(30,least(coalesce(p_lease_seconds,300),1800));

  update public.ivx_autonomous_tasks task set
    state='QUEUED', lease_holder=null, worker_instance_id=null,
    lease_expires_at=null, updated_at=v_now, version=task.version+1,
    payload=task.payload || jsonb_build_object('state','QUEUED','leaseHolder',null,'leaseExpiresAt',null,'updatedAt',v_now::text)
  where task.state='LEASED' and task.lease_expires_at < v_now;
  get diagnostics v_recovered = row_count;

  with stale as (
    select task.task_id,
      coalesce((task.payload->>'retryCount')::integer,0)+1 as next_retry,
      coalesce((task.payload->>'maxRetries')::integer,3) as max_retries
    from public.ivx_autonomous_tasks task
    where task.state='RUNNING' and task.last_heartbeat_at < v_now - interval '30 minutes'
    for update skip locked
  )
  update public.ivx_autonomous_tasks task set
    state=case when stale.next_retry > greatest(1,stale.max_retries) then 'FAILED' else 'QUEUED' end,
    lease_holder=null, worker_instance_id=null, lease_expires_at=null,
    updated_at=v_now, version=task.version+1,
    payload=task.payload || jsonb_build_object(
      'state',case when stale.next_retry > greatest(1,stale.max_retries) then 'FAILED' else 'QUEUED' end,
      'retryCount',stale.next_retry,'leaseHolder',null,'leaseExpiresAt',null,
      'updatedAt',v_now::text,
      'error',case when stale.next_retry > greatest(1,stale.max_retries) then 'stale RUNNING task exceeded maxRetries' else null end
    )
  from stale where task.task_id=stale.task_id;
  get diagnostics v_changed = row_count;
  v_recovered := v_recovered + v_changed;

  for v_request in select value from jsonb_array_elements(coalesce(p_requests,'[]'::jsonb)) loop
    v_worker_id := nullif(v_request->>'workerId','');
    v_agent_number := case when coalesce(v_request->>'agentNumber','') ~ '^[0-9]+$' then (v_request->>'agentNumber')::integer else null end;
    v_steal_prefix := nullif(v_request->'options'->>'stealPrefix','');
    select coalesce(array_agg(value),array[]::text[]) into v_family_prefixes
      from jsonb_array_elements_text(coalesce(v_request->'options'->'missionScope'->'familyPrefixes','[]'::jsonb));
    select coalesce(array_agg(value),array[]::text[]) into v_active_prefixes
      from jsonb_array_elements_text(coalesce(v_request->'options'->'missionScope'->'activePrefixes','[]'::jsonb));
    v_stolen := false;
    v_row := null;
    if v_worker_id is not null then
      select task.* into v_row
      from public.ivx_autonomous_tasks task
      where task.state='QUEUED'
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
      limit 1 for update skip locked;

      if not found and v_steal_prefix is not null then
        select task.* into v_row
        from public.ivx_autonomous_tasks task
        where task.state='QUEUED' and task.idempotency_key like v_steal_prefix || '%'
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
        limit 1 for update skip locked;
        v_stolen := found;
      end if;
    end if;

    if v_row.task_id is null then
      v_results := v_results || jsonb_build_array(jsonb_build_object('workerId',v_worker_id,'agentNumber',v_agent_number,'ok',v_worker_id is not null,'task',null,'error',case when v_worker_id is null then 'workerId is required' else null end,'stolen',false));
    else
      v_payload := v_row.payload || jsonb_build_object(
        'state','LEASED','leaseHolder',v_worker_id,
        'leaseExpiresAt',(v_now + make_interval(secs=>p_lease_seconds))::text,
        'lastHeartbeatAt',v_now::text,'updatedAt',v_now::text
      );
      update public.ivx_autonomous_tasks task set
        state='LEASED', lease_holder=v_worker_id, worker_instance_id=p_worker_instance_id,
        lease_expires_at=v_now + make_interval(secs=>p_lease_seconds),
        last_heartbeat_at=v_now, updated_at=v_now, payload=v_payload, version=task.version+1
      where task.task_id=v_row.task_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object('workerId',v_worker_id,'agentNumber',v_agent_number,'ok',true,'task',v_payload,'error',null,'stolen',v_stolen));
    end if;
  end loop;
  insert into public.ivx_autonomous_task_events(event_type,worker_instance_id,event)
  values ('tasks_claimed_batch',p_worker_instance_id,jsonb_build_object('requested',jsonb_array_length(p_requests),'leased',(
    select count(*) from jsonb_array_elements(v_results) result where result->'task' <> 'null'::jsonb
  ),'recovered',v_recovered));
  return v_results;
end;
$$;

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

create or replace function public.ivx_autonomous_tasks_link_objective(p_objective_id text)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
  update public.ivx_autonomous_tasks task set
    payload=task.payload || jsonb_build_object('objectiveId',p_objective_id,'updatedAt',clock_timestamp()::text),
    updated_at=clock_timestamp(), version=task.version+1
  where task.payload->>'objectiveId' is null or task.payload->>'objectiveId'='';
  get diagnostics v_count=row_count;
  if v_count > 0 then insert into public.ivx_autonomous_task_events(event_type,event) values ('orphan_tasks_linked_to_objective',jsonb_build_object('objectiveId',p_objective_id,'linked',v_count)); end if;
  return v_count;
end;
$$;

revoke execute on function public.ivx_autonomous_tasks_create_batch(jsonb) from public, anon, authenticated;
revoke execute on function public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer) from public, anon, authenticated;
revoke execute on function public.ivx_autonomous_tasks_start_batch(jsonb,text,integer) from public, anon, authenticated;
revoke execute on function public.ivx_autonomous_tasks_heartbeat_batch(jsonb,text,integer) from public, anon, authenticated;
revoke execute on function public.ivx_autonomous_task_compare_and_set(jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke execute on function public.ivx_autonomous_tasks_link_objective(text) from public, anon, authenticated;
grant execute on function public.ivx_autonomous_tasks_create_batch(jsonb) to service_role;
grant execute on function public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer) to service_role;
grant execute on function public.ivx_autonomous_tasks_start_batch(jsonb,text,integer) to service_role;
grant execute on function public.ivx_autonomous_tasks_heartbeat_batch(jsonb,text,integer) to service_role;
grant execute on function public.ivx_autonomous_task_compare_and_set(jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.ivx_autonomous_tasks_link_objective(text) to service_role;

comment on table public.ivx_autonomous_tasks is 'IVX 112 autonomous fleet row queue; backend service-role only; claims are atomic.';
comment on table public.ivx_autonomous_task_events is 'Append-only evidence for IVX autonomous fleet queue transitions.';
select pg_notify('pgrst','reload schema');
