-- Run separately from the mission index, as one top-level statement.
-- Keep unknown-expiry and queued holders eligible; do not change task ownership.
-- Require pg_index.indisvalid AND pg_index.indisready before relying on it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ivx_autonomous_tasks_held_planning_idx
ON public.ivx_autonomous_tasks ((CASE
  WHEN state = 'QUEUED' OR lease_expires_at IS NULL THEN 'infinity'::timestamptz
  ELSE lease_expires_at END))
INCLUDE (task_id, idempotency_key, assigned_agent_number, state, created_at, lease_expires_at, lease_holder)
WHERE lease_holder IS NOT NULL;
