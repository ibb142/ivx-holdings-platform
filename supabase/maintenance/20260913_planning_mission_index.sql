-- Run as one top-level statement, outside migration transactions.
-- After completion, require pg_index.indisvalid AND pg_index.indisready.
-- IF NOT EXISTS does not repair an index left invalid by interrupted maintenance.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ivx_autonomous_tasks_mission_planning_idx
ON public.ivx_autonomous_tasks (idempotency_key text_pattern_ops, created_at, task_id)
INCLUDE (assigned_agent_number, state);
