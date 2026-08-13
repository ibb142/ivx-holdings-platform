-- ═══════════════════════════════════════════════════════════════
-- IVX Holdings — Row Level Security Policies (items 157-158)
-- Apply least-privilege: public reads published data only,
-- authenticated users access their own data, service role has full access.
-- Marker: ivx-rls-policies-2026-08-13
-- ═══════════════════════════════════════════════════════════════

-- ═══ ENABLE RLS ON ALL TABLES ═══

ALTER TABLE IF EXISTS public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.investor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.treasury_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wire_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.lead_capture ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.member classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.treasury_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.withdrawals ENABLE ROW LEVEL SECURITY;

-- ═══ PUBLIC READ POLICIES (non-sensitive published data) ═══

-- Properties: public can read published deals only
CREATE POLICY "public_read_published_properties" ON public.properties
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

-- Deals: public can read published/live deals only
CREATE POLICY "public_read_published_deals" ON public.deals
  FOR SELECT TO anon, authenticated
  USING (status = 'published' OR status = 'live');

-- ═══ AUTHENTICATED USER POLICIES (own data only — least privilege) ═══

-- Members: users can read/update their own profile
CREATE POLICY "user_read_own_member" ON public.members
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_update_own_member" ON public.members
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Investor profiles: users can read/update their own
CREATE POLICY "user_read_own_investor_profile" ON public.investor_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_update_own_investor_profile" ON public.investor_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- KYC documents: users can only access their own — NEVER public (item 155)
CREATE POLICY "user_read_own_kyc" ON public.kyc_documents
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_insert_own_kyc" ON public.kyc_documents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Investments: users can read their own investments only
CREATE POLICY "user_read_own_investments" ON public.investments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Transactions: users can read their own transactions only
CREATE POLICY "user_read_own_transactions" ON public.transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Treasury accounts: users can read their own accounts only
CREATE POLICY "user_read_own_treasury" ON public.treasury_accounts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Treasury ledger: users can read their own ledger entries only
CREATE POLICY "user_read_own_treasury_ledger" ON public.treasury_ledger
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Wire submissions: users can read/insert their own only (item 153-154)
CREATE POLICY "user_read_own_wires" ON public.wire_submissions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_insert_own_wire" ON public.wire_submissions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Withdrawals: users can read/insert their own only
CREATE POLICY "user_read_own_withdrawals" ON public.withdrawals
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_insert_own_withdrawal" ON public.withdrawals
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Chat messages: users can read/insert their own messages only
CREATE POLICY "user_read_own_chat" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_insert_own_chat" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Member classifications: users can read their own only
CREATE POLICY "user_read_own_classification" ON public.member_classifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ═══ LEAD CAPTURE: public can insert, only authenticated can read ═══

CREATE POLICY "public_insert_leads" ON public.lead_capture
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_read_leads" ON public.lead_capture
  FOR SELECT TO authenticated
  USING (true);

-- Waitlist: public can insert, only authenticated can read
CREATE POLICY "public_insert_waitlist" ON public.waitlist
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_read_waitlist" ON public.waitlist
  FOR SELECT TO authenticated
  USING (true);

-- ═══ AUDIT LOGS: only service role can read/write (item 167) ═══

CREATE POLICY "service_role_all_audit_logs" ON public.audit_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ═══ STORAGE BUCKET POLICIES (item 158) ═══

-- Public bucket: marketing images, logos, deal photos (read-only public)
CREATE POLICY "public_read_storage_public" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'public');

-- Private bucket: KYC documents, investor files (authenticated, own files only)
CREATE POLICY "authenticated_read_own_files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'private' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "authenticated_write_own_files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'private' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Deal documents bucket: authenticated investors can read published deal docs
CREATE POLICY "authenticated_read_deal_docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'deal-documents');

-- ═══ DENY ALL BY DEFAULT ═══
-- Any table with RLS enabled but no matching policy denies all access.
-- This is the correct security posture — explicit allow only.

-- ═══ VERIFICATION QUERIES ═══
-- Run these to verify RLS is working correctly:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
-- SELECT * FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
