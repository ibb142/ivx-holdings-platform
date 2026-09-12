-- Anonymous approved-media reads must not invoke the authenticated owner helper.
-- Preserve both predicates and the existing public SELECT policy.
ALTER POLICY project_media_owner_all ON public.project_media TO authenticated;
