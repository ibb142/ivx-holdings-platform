-- IVX Autonomous Senior Developer Worker — database migrations
-- Run against owner-controlled Supabase project.
-- All tables are owner-readable via RLS; service-role writes from the worker.

-- 1. Extend ivx_owner_ai_tasks with worker routing and task-type fields.
ALTER TABLE IF EXISTS public.ivx_owner_ai_tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS assigned_worker_id TEXT,
  ADD COLUMN IF NOT EXISTS approval_url TEXT,
  ADD COLUMN IF NOT EXISTS worker_data JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS files_changed TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS test_summary JSONB,
  ADD COLUMN IF NOT EXISTS commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS render_deploy_id TEXT,
  ADD COLUMN IF NOT EXISTS runtime_sha TEXT,
  ADD COLUMN IF NOT EXISTS proof_ledger_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ivx_owner_ai_tasks_task_type_status
  ON public.ivx_owner_ai_tasks (task_type, status)
  WHERE task_type = 'senior_dev';

CREATE INDEX IF NOT EXISTS idx_ivx_owner_ai_tasks_assigned_worker
  ON public.ivx_owner_ai_tasks (assigned_worker_id, status)
  WHERE assigned_worker_id IS NOT NULL;

-- 2. Per-run evidence table for the senior developer worker.
CREATE TABLE IF NOT EXISTS public.ivx_senior_dev_worker_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.ivx_owner_ai_tasks(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL DEFAULT 'IVX-SENIOR-DEV-01',
  repository TEXT,
  branch TEXT,
  base_commit_sha TEXT,
  files_inspected TEXT[] DEFAULT '{}',
  files_changed TEXT[] DEFAULT '{}',
  test_results JSONB DEFAULT '{}',
  lint_results JSONB DEFAULT '{}',
  typecheck_results JSONB DEFAULT '{}',
  build_results JSONB DEFAULT '{}',
  commit_sha TEXT,
  rollback_tag TEXT,
  render_deploy_id TEXT,
  runtime_sha TEXT,
  health_results JSONB DEFAULT '{}',
  live_feature_result JSONB DEFAULT '{}',
  proof_ledger_id TEXT,
  error_message TEXT,
  logs TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ivx_senior_dev_worker_runs_task_id
  ON public.ivx_senior_dev_worker_runs (task_id);

CREATE INDEX IF NOT EXISTS idx_ivx_senior_dev_worker_runs_worker_status
  ON public.ivx_senior_dev_worker_runs (worker_id, status);

-- 3. Checkpoint history for restart recovery.
CREATE TABLE IF NOT EXISTS public.ivx_senior_dev_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.ivx_owner_ai_tasks(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ivx_senior_dev_checkpoints_task_id
  ON public.ivx_senior_dev_checkpoints (task_id, created_at DESC);

-- 4. Owner approval records bound to task/action.
CREATE TABLE IF NOT EXISTS public.ivx_senior_dev_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.ivx_owner_ai_tasks(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL,
  scope TEXT,
  commit_sha TEXT,
  phrase TEXT NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ivx_senior_dev_approvals_task_action
  ON public.ivx_senior_dev_approvals (task_id, action);

-- 5. RLS policies: owner can read; service role bypasses RLS.
ALTER TABLE public.ivx_senior_dev_worker_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivx_senior_dev_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivx_senior_dev_approvals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ivx_senior_dev_worker_runs' AND policyname = 'owner_read_worker_runs'
  ) THEN
    CREATE POLICY owner_read_worker_runs ON public.ivx_senior_dev_worker_runs
      FOR SELECT USING (auth.uid()::text = (SELECT owner_id FROM public.ivx_owner_ai_tasks WHERE id = task_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ivx_senior_dev_checkpoints' AND policyname = 'owner_read_checkpoints'
  ) THEN
    CREATE POLICY owner_read_checkpoints ON public.ivx_senior_dev_checkpoints
      FOR SELECT USING (auth.uid()::text = (SELECT owner_id FROM public.ivx_owner_ai_tasks WHERE id = task_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ivx_senior_dev_approvals' AND policyname = 'owner_read_approvals'
  ) THEN
    CREATE POLICY owner_read_approvals ON public.ivx_senior_dev_approvals
      FOR SELECT USING (auth.uid()::text = owner_id);
  END IF;
END $$;