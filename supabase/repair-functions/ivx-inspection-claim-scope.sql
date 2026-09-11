-- Scope inspection eligibility without putting inspections ahead of real repairs.
-- Existing activePrefixes retain their Landing-only priority and stealing order.
do $repair$
declare
  definition text := pg_get_functiondef('public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)'::regprocedure);
  needle text := $old$where task.state='QUEUED'$old$;
  replacement text := $new$where task.state='QUEUED'
          -- ivx-inspection-claim-scope-v1
          and (
            v_request->'options'->'missionScope'->>'inspectionSourceSha' is null
            or (task.idempotency_key not like 'module-audit:%'
              and task.idempotency_key not like 'autonomous-secondary:%')
            or (
              v_request->'options'->'missionScope'->>'inspectionSourceSha' ~* '^[a-f0-9]{40}$'
              and (task.idempotency_key like 'module-audit:' || lower(v_request->'options'->'missionScope'->>'inspectionSourceSha') || ':%'
                or task.idempotency_key like 'autonomous-secondary:' || lower(v_request->'options'->'missionScope'->>'inspectionSourceSha') || ':%')
            )
          )$new$;
begin
  set local lock_timeout = '3s';
  set local statement_timeout = '8s';
  if strpos(definition, 'ivx-inspection-claim-scope-v1') > 0 then return; end if;
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 3
    or strpos(definition, 'foreach v_active_prefix in array v_active_prefixes') = 0
    or strpos(definition, 'pg_try_advisory_xact_lock') = 0 then
    raise exception 'Unexpected claim function; inspection scope repair refused';
  end if;
  execute replace(definition, needle, replacement);
end;
$repair$;
