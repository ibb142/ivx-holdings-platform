-- Claims for the active mission must not scan every historical queue row.
-- text_pattern_ops makes a left-anchored LIKE usable independently of the
-- database collation. Keep this statement transaction-compatible because the
-- production migration executor wraps migrations in a transaction. On a busy
-- installation, prebuild the same index CONCURRENTLY before applying this
-- migration; IF NOT EXISTS then turns this tracked migration into a no-op.
CREATE INDEX IF NOT EXISTS ivx_autonomous_tasks_queued_scope_idx
  ON public.ivx_autonomous_tasks (idempotency_key text_pattern_ops, assigned_agent_number)
  WHERE state = 'QUEUED';
