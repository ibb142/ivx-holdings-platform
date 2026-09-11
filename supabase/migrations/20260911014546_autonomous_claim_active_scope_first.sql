-- Prefer explicitly active mission prefixes before considering unrelated
-- queue families. The indexed prefix lookup keeps each logical IA claim
-- bounded while preserving dependency, retry and row-lock gates.
do $migration$
declare
  definition text := pg_get_functiondef(
    'public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)'::regprocedure
  );
  previous_declaration text := $old$  v_active_prefixes text[];$old$;
  next_declaration text := $new$  v_active_prefixes text[];
  v_active_prefix text;$new$;
  previous_candidate text := $old$      v_row := null;
      select task.* into v_row
      from public.ivx_autonomous_tasks task
      where task.state='QUEUED'
        and coalesce((task.payload->>'retryNotBefore')::timestamptz, '-infinity') <= v_now
        and (v_agent_number is null or task.assigned_agent_number is null or task.assigned_agent_number=v_agent_number)
        and (
          cardinality(v_family_prefixes)=0
          or not exists (select 1 from unnest(v_family_prefixes) prefix where task.idempotency_key like prefix || '%')
          or exists (select 1 from unnest(v_active_prefixes) prefix where task.idempotency_key like prefix || '%')
        )
        and not exists (
          select 1
          from jsonb_array_elements_text(coalesce(task.payload->'dependencies','[]'::jsonb)) dependency(task_id)
          left join public.ivx_autonomous_tasks prerequisite on prerequisite.task_id=dependency.task_id
          where prerequisite.task_id is null or prerequisite.state not in ('VERIFIED','NO_ACTION_REQUIRED')
        )
      order by
        case task.priority when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
        task.due_at asc nulls last, task.business_value desc,
        task.execution_order asc, task.created_at asc, task.task_id asc
      limit 1
      for update skip locked;$old$;
  next_candidate text := $new$      v_row := null;
      foreach v_active_prefix in array v_active_prefixes
      loop
        select task.* into v_row
        from public.ivx_autonomous_tasks task
        where task.state='QUEUED'
          and coalesce((task.payload->>'retryNotBefore')::timestamptz, '-infinity') <= v_now
          and (v_agent_number is null or task.assigned_agent_number is null or task.assigned_agent_number=v_agent_number)
          and task.idempotency_key like v_active_prefix || '%'
          and not exists (
            select 1
            from jsonb_array_elements_text(coalesce(task.payload->'dependencies','[]'::jsonb)) dependency(task_id)
            left join public.ivx_autonomous_tasks prerequisite on prerequisite.task_id=dependency.task_id
            where prerequisite.task_id is null or prerequisite.state not in ('VERIFIED','NO_ACTION_REQUIRED')
          )
        order by
          case task.priority when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
          task.due_at asc nulls last, task.business_value desc,
          task.execution_order asc, task.created_at asc, task.task_id asc
        limit 1
        for update skip locked;
        exit when v_row.task_id is not null;
      end loop;

      if v_row.task_id is null then
        select task.* into v_row
        from public.ivx_autonomous_tasks task
        where task.state='QUEUED'
          and coalesce((task.payload->>'retryNotBefore')::timestamptz, '-infinity') <= v_now
          and (v_agent_number is null or task.assigned_agent_number is null or task.assigned_agent_number=v_agent_number)
          and (
            cardinality(v_family_prefixes)=0
            or not exists (select 1 from unnest(v_family_prefixes) prefix where task.idempotency_key like prefix || '%')
          )
          and not exists (
            select 1
            from jsonb_array_elements_text(coalesce(task.payload->'dependencies','[]'::jsonb)) dependency(task_id)
            left join public.ivx_autonomous_tasks prerequisite on prerequisite.task_id=dependency.task_id
            where prerequisite.task_id is null or prerequisite.state not in ('VERIFIED','NO_ACTION_REQUIRED')
          )
        order by
          case task.priority when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
          task.due_at asc nulls last, task.business_value desc,
          task.execution_order asc, task.created_at asc, task.task_id asc
        limit 1
        for update skip locked;
      end if;$new$;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_index index_state on index_state.indexrelid = relation.oid
    where relation.oid = pg_catalog.to_regclass('public.ivx_autonomous_tasks_queued_scope_idx')
      and index_state.indisvalid
      and index_state.indisready
  ) then
    raise exception 'Required queued-scope index is absent or invalid';
  end if;
  if strpos(definition, 'foreach v_active_prefix in array v_active_prefixes') > 0 then
    return;
  end if;
  if strpos(definition, previous_declaration) = 0 then
    raise exception 'Expected active-prefix declaration was not found; review deployed claim function';
  end if;
  if strpos(definition, previous_candidate) = 0 then
    raise exception 'Expected queue candidate query was not found; review deployed claim function';
  end if;
  definition := replace(definition, previous_declaration, next_declaration);
  definition := replace(definition, previous_candidate, next_candidate);
  execute definition;
end;
$migration$;
