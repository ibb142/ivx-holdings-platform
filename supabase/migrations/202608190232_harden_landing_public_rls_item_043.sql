-- IVX Landing War Room Item 043
-- Public Supabase access must use anon + RLS; broad authenticated/public access is prohibited.
-- Applied live on 2026-08-19 after the migration runner itself failed on a schema_migrations.checksum constraint.

-- Public deals: only published rows are visible publicly; only owner can write.
drop policy if exists "jv_deals_select_all" on public.jv_deals;
drop policy if exists "jv_deals_delete_auth" on public.jv_deals;
drop policy if exists "jv_deals_insert_auth" on public.jv_deals;
drop policy if exists "jv_deals_update_auth" on public.jv_deals;
drop policy if exists "owner full access" on public.jv_deals;
drop policy if exists "jv_deals_authenticated_read_published" on public.jv_deals;
drop policy if exists "jv_deals_owner_write" on public.jv_deals;
create policy jv_deals_authenticated_read_published on public.jv_deals for select to authenticated using (published = true and coalesce(deleted_at::text,'')='');
create policy jv_deals_owner_write on public.jv_deals for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

drop policy if exists "landing_deals_select_all" on public.landing_deals;
drop policy if exists "landing_deals_delete_auth" on public.landing_deals;
drop policy if exists "landing_deals_insert_auth" on public.landing_deals;
drop policy if exists "landing_deals_update_auth" on public.landing_deals;
drop policy if exists "landing_deals_public_read_published" on public.landing_deals;
drop policy if exists "landing_deals_owner_write" on public.landing_deals;
create policy landing_deals_public_read_published on public.landing_deals for select to public using (published = true);
create policy landing_deals_owner_write on public.landing_deals for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

-- Sensitive landing records: public insert where required, owner-only read/manage.
drop policy if exists "landing_submissions_all" on public.landing_submissions;
drop policy if exists "landing_submissions_auth_select" on public.landing_submissions;
drop policy if exists "landing_submissions_owner_all" on public.landing_submissions;
create policy landing_submissions_owner_all on public.landing_submissions for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

drop policy if exists "landing_investments_auth_all" on public.landing_investments;
drop policy if exists "Admin can read all investments" on public.landing_investments;
drop policy if exists "landing_investments_owner_all" on public.landing_investments;
create policy landing_investments_owner_all on public.landing_investments for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

drop policy if exists "waitlist_entries_all" on public.waitlist_entries;
drop policy if exists "waitlist_entries_auth_select" on public.waitlist_entries;
drop policy if exists "waitlist_entries_auth_update" on public.waitlist_entries;
drop policy if exists "waitlist_entries_owner_all" on public.waitlist_entries;
create policy waitlist_entries_owner_all on public.waitlist_entries for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

drop policy if exists "waitlist_otp_events_all" on public.waitlist_otp_events;
drop policy if exists "otp_events_auth_select" on public.waitlist_otp_events;
drop policy if exists "waitlist_otp_events_owner_all" on public.waitlist_otp_events;
create policy waitlist_otp_events_owner_all on public.waitlist_otp_events for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

-- Internal config/deployment data: owner-only.
drop policy if exists "landing_page_config_all" on public.landing_page_config;
drop policy if exists "landing_page_config_auth_all" on public.landing_page_config;
drop policy if exists "landing_page_config_owner_all" on public.landing_page_config;
create policy landing_page_config_owner_all on public.landing_page_config for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

drop policy if exists "landing_deployments_all" on public.landing_deployments;
drop policy if exists "landing_deployments_auth_all" on public.landing_deployments;
drop policy if exists "landing_deployments_owner_all" on public.landing_deployments;
create policy landing_deployments_owner_all on public.landing_deployments for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());

-- SEO landing pages: public sees published only, owner writes.
drop policy if exists "ivx_landing_pages_all" on public.ivx_landing_pages;
drop policy if exists "ivx_landing_pages_public_read" on public.ivx_landing_pages;
drop policy if exists "ivx_landing_pages_owner_all" on public.ivx_landing_pages;
create policy ivx_landing_pages_public_read on public.ivx_landing_pages for select to public using (status = 'published');
create policy ivx_landing_pages_owner_all on public.ivx_landing_pages for all to authenticated using (ivx_is_owner()) with check (ivx_is_owner());
