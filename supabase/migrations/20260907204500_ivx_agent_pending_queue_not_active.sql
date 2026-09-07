-- A pending row is queued work, not active execution. Allow multiple queued
-- tasks while retaining the invariant of one RUNNING execution per agent.
begin;
drop index if exists public.uq_ivx_agent_one_active_execution;
create unique index if not exists uq_ivx_agent_one_running_execution
  on public.ivx_agent_executions (agent_id)
  where final_status = 'running';
commit;
