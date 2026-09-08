-- The live dashboard orders the execution ledger by this exact timestamp order.
-- Build this index CONCURRENTLY outside the migration transaction first on busy installations.
-- Production prebuild verified indisvalid=true and indisready=true on 2026-09-08.
CREATE INDEX IF NOT EXISTS idx_ivx_agent_exec_dashboard_started
ON public.ivx_agent_executions (started_at DESC NULLS LAST);
