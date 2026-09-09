-- The helper reads auth.users by a qualified name. Pin name resolution without
-- changing its service-role-only execute grants or exposing authentication data.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
ALTER FUNCTION public.ivx_query_auth_user_by_email(text) SET search_path = '';
