-- Snapshot pagination orders the durable task ledger by created_at.
-- Without this index, every page scans and sorts the entire payload table.
-- Keep lock acquisition and index construction bounded in production.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
CREATE INDEX IF NOT EXISTS ivx_autonomous_tasks_created_at_idx
  ON public.ivx_autonomous_tasks (created_at ASC);
