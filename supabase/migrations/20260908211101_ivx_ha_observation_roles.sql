-- One database snapshot for presence, assignment, execution and HA observations.
-- Read-only and service-role only; no synthetic work or productivity is written.
create or replace function public.ivx_fleet_dashboard_observation()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'measuredAt', statement_timestamp(),
    'states', coalesce((select jsonb_agg(jsonb_build_object(
      'agentNumber', agent_number, 'lastHeartbeatAt', last_heartbeat
    )) from public.ivx_agent_states where agent_number between 1 and 112), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(a) from (
      select assigned_agent_number as "agentNumber", count(*)::integer as "taskCount"
      from public.ivx_autonomous_tasks
      where assigned_agent_number between 1 and 112
        and state not in ('VERIFIED','NO_ACTION_REQUIRED','FAILED','CANCELLED','EXPIRED')
      group by assigned_agent_number
    ) a), '[]'::jsonb),
    'activeTasks', coalesce((select jsonb_agg(payload) from (
      select payload from public.ivx_autonomous_tasks
      where state in ('RUNNING','LEASED') and lease_expires_at > statement_timestamp()
      order by task_id limit 1001
    ) t), '[]'::jsonb),
    'instances', coalesce((select jsonb_agg(i) from (
      select distinct on (worker_instance_id) worker_instance_id as "instanceId",
        event->>'instance_role' as role, event->>'commit_sha' as "commitSha",
        event->>'service_id' as "serviceId", created_at as "lastSeenAt",
        event->>'process_role' as "processRole", coalesce((event->>'shared_worker_queue')::boolean,false) as "sharedWorkerQueue",
        coalesce((event->>'shared_state')::boolean,false) as "sharedState", coalesce((event->>'draining')::boolean,false) as draining
      from public.ivx_autonomous_task_events
      where event_type = 'fleet_slo_sample' and created_at > statement_timestamp() - interval '60 seconds'
        and event->>'instance_role' in ('api','worker')
      order by worker_instance_id, created_at desc
    ) i where not i.draining), '[]'::jsonb)
  );
$$;
revoke all on function public.ivx_fleet_dashboard_observation() from public, anon, authenticated;
grant execute on function public.ivx_fleet_dashboard_observation() to service_role;
comment on function public.ivx_fleet_dashboard_observation() is
  'Atomic read-only fleet observation. Assignment and heartbeat are never productivity evidence.';
notify pgrst, 'reload schema';
