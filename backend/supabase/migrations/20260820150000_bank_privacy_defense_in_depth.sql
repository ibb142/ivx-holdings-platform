-- IVX bank privacy defense in depth — 2026-08-20
-- Complements 20260820143000_bank_privacy_hardening.sql.

BEGIN;

-- Proof/factory tables are backend-only and must not create anonymous PostgREST surfaces.
ALTER TABLE IF EXISTS public.ivx_factory_e2e_proof ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ivx_factory_e2e_proof FROM anon;
REVOKE ALL ON TABLE public.ivx_factory_e2e_proof FROM authenticated;
GRANT ALL ON TABLE public.ivx_factory_e2e_proof TO service_role;

ALTER TABLE IF EXISTS public.ivx_factory_commit_proof_verify_commit_mrsjecfn_y2vlua ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ivx_factory_commit_proof_verify_commit_mrsjecfn_y2vlua FROM anon;
REVOKE ALL ON TABLE public.ivx_factory_commit_proof_verify_commit_mrsjecfn_y2vlua FROM authenticated;
GRANT ALL ON TABLE public.ivx_factory_commit_proof_verify_commit_mrsjecfn_y2vlua TO service_role;

ALTER TABLE IF EXISTS public.ivx_factory_commit_proof_verify_commit_mrsjqjkt_4diugr ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ivx_factory_commit_proof_verify_commit_mrsjqjkt_4diugr FROM anon;
REVOKE ALL ON TABLE public.ivx_factory_commit_proof_verify_commit_mrsjqjkt_4diugr FROM authenticated;
GRANT ALL ON TABLE public.ivx_factory_commit_proof_verify_commit_mrsjqjkt_4diugr TO service_role;

-- RLS helper functions are signed-in-only; anonymous callers have no reason to execute them.
REVOKE EXECUTE ON FUNCTION public.ivx_is_owner() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_admin_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.ivx_is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_access() TO authenticated;
ALTER FUNCTION public.is_owner() SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.get_user_role() SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.verify_admin_access() SET search_path = public, auth, pg_temp;

-- Views must honor the querying user's grants/RLS, never the view owner's privileges.
ALTER VIEW public.project_engagement SET (security_invoker = true);
ALTER VIEW public.ivx_project_integrity SET (security_invoker = true);
ALTER VIEW public.ivx_reels_integrity SET (security_invoker = true);
ALTER VIEW public.ivx_factory_dashboard SET (security_invoker = true);

COMMIT;
