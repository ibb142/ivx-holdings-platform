SET LOCAL statement_timeout = '3s';
SET LOCAL lock_timeout = '1s';

CREATE STATISTICS IF NOT EXISTS public.ivx_autonomous_tasks_planning_lease_mcv (mcv)
ON state, (lease_holder IS NOT NULL), (lease_expires_at IS NULL)
FROM public.ivx_autonomous_tasks;

COMMENT ON STATISTICS public.ivx_autonomous_tasks_planning_lease_mcv IS
  'Planning must estimate queued holders and missing expiry jointly; independent column estimates incorrectly predict thousands of eligible historical leases.';

-- Populate with ANALYZE public.ivx_autonomous_tasks (state, lease_holder,
-- lease_expires_at) after this short metadata migration. Autovacuum maintains
-- the statistics on later analyze cycles; task and evidence rows are unchanged.
