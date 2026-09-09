-- SLO/reconciler reads filter by state without the lease/QUEUED predicates
-- required by the existing partial indexes. EXPLAIN showed a full table scan.
-- Fail promptly if a writer holds the table; never wait indefinitely in recovery.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
CREATE INDEX IF NOT EXISTS ivx_autonomous_tasks_state_updated_idx
  ON public.ivx_autonomous_tasks (state, updated_at DESC);
