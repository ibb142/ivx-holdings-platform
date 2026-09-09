-- Keep per-agent transaction fencing without occupying a connection while
-- another replica owns the same lane. Preserve the deployed retry contract.
do $migration$
declare
  definition text := pg_get_functiondef('public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)'::regprocedure);
  previous text := $old$      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('ivx-autonomous-worker:' || v_worker_id, 0)
      );$old$;
  replacement text := $new$      if not pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended('ivx-autonomous-worker:' || v_worker_id, 0)
      ) then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'workerId',v_worker_id,'agentNumber',v_agent_number,'ok',true,
          'task',null,'error',null,'stolen',false,'claimContended',true
        ));
        continue;
      end if;$new$;
begin
  if strpos(definition, replacement) > 0 then return; end if;
  if strpos(definition, previous) = 0 then
    raise exception 'Expected per-agent claim lock was not found; review deployed function before migration';
  end if;
  execute replace(definition, previous, replacement);
end;
$migration$;
