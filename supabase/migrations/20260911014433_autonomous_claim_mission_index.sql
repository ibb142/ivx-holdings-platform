-- Claims for the active mission must not scan every historical queue row.
-- text_pattern_ops makes a left-anchored LIKE usable independently of the
-- database collation. CONCURRENTLY avoids blocking queue writers while the
-- existing production table is indexed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ivx_autonomous_tasks_queued_scope_idx
  ON public.ivx_autonomous_tasks (idempotency_key text_pattern_ops, assigned_agent_number)
  WHERE state = 'QUEUED';
