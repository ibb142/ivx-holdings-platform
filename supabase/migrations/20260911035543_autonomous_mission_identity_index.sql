-- Mission reconciliation reads every state, including preserved terminal work.
-- The queued-only index cannot serve those exact-prefix reads. Index identity
-- independently of state without copying payload/evidence into the index.
-- The managed migration runner is transactional. Bound both lock acquisition
-- and construction; a timeout rolls back the migration without changing rows.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '4s';
CREATE INDEX IF NOT EXISTS ivx_autonomous_tasks_mission_identity_idx
  ON public.ivx_autonomous_tasks (idempotency_key text_pattern_ops);
