-- Mission reconciliation reads every state, including preserved terminal work.
-- The queued-only index cannot serve those exact-prefix reads. Index identity
-- independently of state without copying payload/evidence into the index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ivx_autonomous_tasks_mission_identity_idx
  ON public.ivx_autonomous_tasks (idempotency_key text_pattern_ops);
