-- Visitor sessions are authenticated by the backend's client-id/session binding.
-- A Supabase member bearer is not authorization to read another visitor's chat.
-- Keep service-role persistence working; preserve every existing conversation.
do $repair$
declare
  target text;
begin
  set local lock_timeout = '3s';
  set local statement_timeout = '8s';
  foreach target in array array['public_chat_sessions','public_chat_messages','ivx_ai_conversations']
  loop
    if to_regclass(format('public.%I', target)) is null then
      raise exception 'Required visitor chat table is missing: %', target;
    end if;
    execute format('alter table public.%I enable row level security', target);
    -- Restrictive policy remains a barrier if a generic recovery script later
    -- restores table grants or adds a permissive authenticated policy.
    execute format('drop policy if exists ivx_private_visitor_chat_boundary on public.%I', target);
    execute format('create policy ivx_private_visitor_chat_boundary on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', target);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', target);
    execute format('grant select, insert, update, delete on table public.%I to service_role', target);
  end loop;
end;
$repair$;

notify pgrst, 'reload schema';
