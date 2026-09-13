-- Owner-requested, one-time data recovery. Not a schema migration or a rerun.
-- Source run was independently confirmed completed/failure before execution:
-- https://github.com/ibb142/ivx-holdings-platform/actions/runs/34761777846
-- At 14:46:43Z a concurrent recovery had already failed the unstarted retry.
-- Close only the remaining primary; preserve the other recovery. Never mark PASS.
begin;
set local lock_timeout = '1000ms';
-- Includes existing aggregate/audit triggers, not just the two row updates.
set local statement_timeout = '45000ms';
set local jit = off;
do $$
declare
  previous public.ivx_agent_states%rowtype;
  affected integer;
  reason text := 'OWNER_STALE_RECOVERY: source GitHub run 34761777846 completed/failure; no verified tool output; orphaned primary/retry closed as failed. Recovery wall time is not productive work.';
begin
  select * into strict previous from public.ivx_agent_states
    where agent_number = 10 for update nowait;
  if previous.agent_id <> 'ivx_holdings_10'
     or previous.last_task_id is distinct from 'live112-34761777846-010-retry'
     or previous.availability <> 'available' or previous.status <> 'active'
     or previous.last_heartbeat is distinct from '2026-09-13T14:13:10.814585Z'::timestamptz
     or previous.last_heartbeat > now() - interval '15 minutes' then
    raise exception 'IA-10 changed or is not stale; no recovery applied';
  end if;
  -- Existing state triggers refresh this controller. Refuse to reactivate it.
  if not exists (select 1 from public.ivx_autonomous_supabase_control
    where singleton_id=1 and enabled=true and safe_writes_enabled=true
      and controller='AUTONOMOUS' and authority_mode='OWNER_DELEGATE') then
    raise exception 'Controller paused or changed; no recovery applied';
  end if;
  if exists (select 1 from public.ivx_autonomous_tasks where assigned_agent_number=10
    and state in ('LEASED','RUNNING','PLANNING','EXECUTION_COMPLETED','QA_IN_PROGRESS','READY_FOR_DEPLOYMENT','DEPLOYING','PRODUCTION_VERIFYING')
    and lease_holder is not null and (lease_expires_at is null or lease_expires_at > now())) then
    raise exception 'IA-10 has a live atomic lease; no recovery applied';
  end if;
  if not exists (select 1 from public.ivx_agent_executions
    where task_id='live112-34761777846-010-retry' and agent_number=10
      and final_status='failed' and real_tool_used=false and verified_output=false
      and finished_at='2026-09-13T14:13:10.814585Z'::timestamptz) then
    raise exception 'Retry recovery changed; no primary recovery applied';
  end if;
  update public.ivx_agent_executions set final_status='failed', finished_at=now(),
    error=concat_ws(' | ',nullif(error,''),reason)
    where agent_number=10 and agent_id=previous.agent_id and finished_at is null
      and real_tool_used=false and verified_output=false and simulated=false
      and task_id='live112-34761777846-010-primary' and final_status='running'
      and started_at='2026-09-13T14:09:25.702Z'::timestamptz;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Expected exactly one unchanged orphan primary'; end if;
  -- The existing execution trigger updates the state. Restore its genuine
  -- heartbeat/provenance rather than counting administrative recovery as work.
  update public.ivx_agent_states set availability='available',
    status=previous.status, health=previous.health, last_heartbeat=previous.last_heartbeat,
    last_task_id=previous.last_task_id, last_source_reference=previous.last_source_reference,
    last_evidence_sha=previous.last_evidence_sha, last_duration_ms=previous.last_duration_ms,
    retry_count=previous.retry_count, last_error=concat_ws(' | ',previous.last_error,reason), last_failed_run=now(), updated_at=now()
    where agent_id=previous.agent_id;
  insert into public.ivx_agent_alerts(alert_type,agent_id,severity,detail)
    values ('stale_execution_recovered',previous.agent_id,'warning',reason);
end;
$$;
commit;
