-- IVX bank-grade privilege hardening
-- Applied live against project kvclcdjmjghndxsngfzb on 2026-08-20 and committed here so
-- production never depends on manual SQL.
--
-- Every statement is idempotent and safe to re-run.
--
-- CLASSIFICATION OF EXTERNALLY CALLABLE SECURITY DEFINER FUNCTIONS
-- ----------------------------------------------------------------
--   PUBLIC PRODUCT REQUIRED - keep EXECUTE for authenticated:
--     is_owner()            - referenced by 83 RLS policies; revoking breaks every
--                             member query on those tables. Returns a boolean about the
--                             CALLER only.
--     ivx_is_owner()        - same, 83 policy references.
--     get_user_role()       - returns the caller's OWN role; used by the app auth context.
--     verify_admin_access() - returns a boolean about the CALLER; used by the app auth
--                             context and backend owner auth.
--
--   PRIVILEGED INTERNAL - revoke from anon/authenticated:
--     is_admin()            - zero RLS references, zero callers in the codebase.
--     is_owner_of(uuid)     - zero references. NOTE: this function ignores its
--                             check_user_id argument entirely and reports whether the
--                             CALLER is an admin. Any future use as a row-ownership check
--                             would silently authorise admins for every row. Left in place
--                             (dropping it is out of scope for this security pass) but no
--                             longer reachable by client roles.
--     is_owner_of(text)     - zero references; trivial self-comparison, no elevation needed.
--
--   PRIVILEGED INTERNAL, GATED IN-BODY (cannot simply revoke):
--     get_landing_analytics() - see below.

begin;

-- ---------------------------------------------------------------------------
-- 1. get_landing_analytics(): member-visible lead PII leak.
--
-- The function is SECURITY DEFINER with EXECUTE granted to `authenticated`, and it
-- returns the 100 most recent landing_submissions rows including email, phone,
-- full_name, company_name and geo. Any ordinary logged-in member could therefore dump
-- lead PII, bypassing the RLS on landing_submissions (which restricts SELECT to owners).
--
-- EXECUTE cannot simply be revoked: the owner control tower calls this RPC while
-- authenticated as an ordinary `authenticated` JWT, so a blanket revoke would break
-- legitimate owner product functionality. Instead the owner check moves INSIDE the
-- function body, which is the correct pattern for a SECURITY DEFINER function that must
-- stay callable. Behaviour for owners is byte-for-byte unchanged; non-owners now get a
-- hard, non-enumerating error.
-- ---------------------------------------------------------------------------
create or replace function public.get_landing_analytics()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  -- Authorisation gate. Must be first: this function reads lead PII.
  if not public.ivx_is_owner() then
    raise exception 'insufficient_privilege'
      using hint = 'landing analytics requires an owner or staff role';
  end if;

  select jsonb_build_object(
    'overview', jsonb_build_object(
      'total_leads', coalesce((select count(*) from public.landing_submissions), 0),
      'total_views', 0,
      'total_visitors', 0,
      'registered_leads', 0,
      'waitlist_leads', 0,
      'hot_leads', 0
    ),
    'geo', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'country', coalesce(country, ''),
          'region', coalesce(region, ''),
          'city', coalesce(city, ''),
          'count', count(*)
        )
      )
      from public.landing_submissions
      group by country, region, city
    ), '[]'::jsonb),
    'sources', '[]'::jsonb,
    'leads', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select
          id, created_at, full_name, first_name, last_name, email, phone,
          company_name, interested_in, source, utm_source, utm_medium,
          utm_campaign, page_url, country, region, city, status, metadata
        from public.landing_submissions
        order by created_at desc
        limit 100
      ) t
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Revoke EXECUTE on privileged-internal helpers with no product dependency.
-- ---------------------------------------------------------------------------
revoke execute on function public.is_admin() from anon, authenticated;
revoke execute on function public.is_owner_of(uuid) from anon, authenticated;
revoke execute on function public.is_owner_of(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-assert the money/identity function lockdown so it lives in version control
--    rather than only in the live catalog. These are already correct in production;
--    the statements are declarative protection against a future regression.
-- ---------------------------------------------------------------------------
revoke execute on function public.ivx_query_auth_user_by_email(user_email text)
  from anon, authenticated;
revoke execute on function public.ivx_exec_sql(sql_text text) from anon, authenticated;
revoke all on function public.atomic_wallet_operation(
  p_user_id uuid, p_amount numeric, p_operation text, p_reason text,
  p_description text, p_reference_id text, p_reference_type text, p_fee numeric
) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Explicit search_path on the remaining mutable SECURITY DEFINER trigger function.
--    A mutable search_path lets a caller with CREATE on any schema in the path shadow a
--    referenced object and execute code as the definer.
-- ---------------------------------------------------------------------------
alter function "rosario-001".trigger_set_timestamp() set search_path to 'public', 'pg_temp';

-- ---------------------------------------------------------------------------
-- 5. wire_transfers: remove the anon table-level grant.
--    RLS already returns zero rows to anon, but anon retained a SELECT grant, so the
--    table answered HTTP 200 instead of a hard denial. Defense in depth - wire data
--    should not be reachable by an unauthenticated role at all.
-- ---------------------------------------------------------------------------
revoke all on table public.wire_transfers from anon;

commit;
