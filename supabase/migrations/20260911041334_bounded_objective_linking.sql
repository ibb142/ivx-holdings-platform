-- Objective metadata must not wait behind active execution or rewrite history.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '4s';
CREATE INDEX IF NOT EXISTS ivx_autonomous_tasks_unlinked_ready_idx
  ON public.ivx_autonomous_tasks (created_at, task_id)
  WHERE (payload->>'objectiveId' IS NULL OR payload->>'objectiveId' = '')
    AND lease_holder IS NULL AND worker_instance_id IS NULL
    AND state IN ('RECEIVED','VALIDATING','PLANNING','QUEUED','RETRYING');

CREATE OR REPLACE FUNCTION public.ivx_autonomous_tasks_link_objective(p_objective_id text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer; v_ids jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  IF nullif(btrim(p_objective_id), '') IS NULL THEN
    RAISE EXCEPTION 'Objective identity required' USING ERRCODE = '22023';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT task_id FROM public.ivx_autonomous_tasks
    WHERE (payload->>'objectiveId' IS NULL OR payload->>'objectiveId' = '')
      AND lease_holder IS NULL AND worker_instance_id IS NULL
      AND state IN ('RECEIVED','VALIDATING','PLANNING','QUEUED','RETRYING')
    ORDER BY created_at, task_id
    LIMIT 112 FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE public.ivx_autonomous_tasks task SET
      payload = task.payload || jsonb_build_object('objectiveId',p_objective_id,'updatedAt',v_now::text),
      updated_at = v_now, version = task.version + 1
    FROM candidates WHERE task.task_id = candidates.task_id
    RETURNING task.task_id
  )
  SELECT count(*)::integer, coalesce(jsonb_agg(task_id),'[]'::jsonb)
    INTO v_count,v_ids FROM updated;
  IF v_count > 0 THEN
    INSERT INTO public.ivx_autonomous_task_events(event_type,event)
      VALUES ('orphan_tasks_linked_to_objective',jsonb_build_object(
        'objectiveId',p_objective_id,'linked',v_count,'taskIds',v_ids,'batchLimit',112));
  END IF;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ivx_autonomous_tasks_link_objective(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ivx_autonomous_tasks_link_objective(text) TO service_role;
