SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
ALTER TABLE public.analytics_identity_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analytics_identity_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analytics_identity_links TO authenticated;
GRANT ALL ON TABLE public.analytics_identity_links TO service_role;
DROP POLICY IF EXISTS ivx_analytics_owner_access ON public.analytics_identity_links;
CREATE POLICY ivx_analytics_owner_access ON public.analytics_identity_links FOR ALL TO authenticated USING ((select public.ivx_is_owner())) WITH CHECK ((select public.ivx_is_owner()));
