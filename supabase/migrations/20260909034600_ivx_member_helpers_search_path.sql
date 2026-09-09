-- Inspected function bodies use only built-ins, NEW fields and qualified public calls.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='15s';
ALTER FUNCTION public.fn_norm_msg_sender() SET search_path='';
ALTER FUNCTION public.ivx_member_contact_verification_ok(boolean,boolean,timestamptz) SET search_path='';
ALTER FUNCTION public.ivx_refresh_member_platform_access_row() SET search_path='';
