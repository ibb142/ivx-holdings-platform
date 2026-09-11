-- Production pending-run recovery must not fetch retained execution payloads
-- just to reject their workflow/task type. Keep discovery in a small covering
-- index with the same deterministic order as fetchPendingExecutions.
-- Execute as a standalone statement: CONCURRENTLY preserves live writes and
-- PostgreSQL rejects it inside a transaction instead of locking the hot table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ivx_agent_exec_pending_discovery
ON public.ivx_agent_executions
  (workflow, task_type, started_at ASC NULLS FIRST, task_id)
INCLUDE (run_id, agent_id, agent_number, final_status)
WHERE final_status IN ('pending', 'running');
