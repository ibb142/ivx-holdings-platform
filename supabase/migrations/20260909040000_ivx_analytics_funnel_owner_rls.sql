SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s';
ALTER TABLE public.analytics_funnel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analytics_funnel FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analytics_funnel TO authenticated;
GRANT ALL ON TABLE public.analytics_funnel TO service_role;
DROP POLICY IF EXISTS ivx_analytics_owner_access ON public.analytics_funnel;
CREATE POLICY ivx_analytics_owner_access ON public.analytics_funnel FOR ALL TO authenticated USING ((select public.ivx_is_owner())) WITH CHECK ((select public.ivx_is_owner()));
