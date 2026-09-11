-- Anonymous SELECT must evaluate only the approved-video policy. The owner
-- helper is intentionally executable by authenticated users, never by anon.
-- Preserve the helper, approval filter, and every existing write restriction.
ALTER POLICY project_videos_owner_all ON public.project_videos TO authenticated;
