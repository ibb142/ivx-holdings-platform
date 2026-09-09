-- The fleet observation counted assignments through a full task-table scan.
-- Cover the exact nonterminal predicate without reading large task payloads.
-- On the live queue, build this index CONCURRENTLY before recording migration;
-- The catalog guard records an existing index without taking a task-table DDL lock.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
DO $$
BEGIN
  IF to_regclass('public.ivx_autonomous_tasks_dashboard_assignment_idx') IS NULL THEN
    CREATE INDEX ivx_autonomous_tasks_dashboard_assignment_idx
      ON public.ivx_autonomous_tasks (assigned_agent_number)
      WHERE assigned_agent_number BETWEEN 1 AND 112
        AND state NOT IN ('VERIFIED','NO_ACTION_REQUIRED','FAILED','CANCELLED','EXPIRED');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = to_regclass('public.ivx_autonomous_tasks_dashboard_assignment_idx')
      AND indisvalid AND indisready
  ) THEN
    RAISE EXCEPTION 'Fleet assignment index is not ready and valid';
  END IF;
END $$;
