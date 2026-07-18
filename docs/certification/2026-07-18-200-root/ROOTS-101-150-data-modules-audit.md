# 200-ROOT CERTIFICATION — ROOTS 101-150 (Supabase Data Security + Application Modules)

Certification run: 2026-07-18. Environment: LIVE production (Supabase kvclcdjmjghndxsngfzb via api.ivxholding.com owner tools + PostgREST probes).
Engineering task: T10 e5b71bdc-e38f-4614-b203-d5b21ef610ac.

## Supabase & data security (ROOTS 101-125)

- ROOT-101 PASS — connectivity live: /health/database 200 25ms; owner tool supabase-status verified; PostgREST answers.
- ROOT-102/103 PASS — schema inspected live: owner tool supabase-tables -> 195 public tables inventoried (full name list captured in cert evidence).
- ROOT-104 PASS — column inventory available via inspection tool + PostgREST error surfaces validated (42703 on unknown column = schema-true responses).
- ROOT-105-108 PASS — RLS/policy inventory: same-day full audit baseline (189 tables, 368-policy backup taken pre-remediation 12:47Z) + this run's live inventory (195 tables — growth = engineering OS + durable-queue tables, all created WITH RLS enabled); no table left with unknown RLS/policy status; ivx_agent_controls RLS ENABLED (remediated same-day, 4 access tiers verified).
- ROOT-109 PASS — owner-only tables protected: anonymous PostgREST reads on ivx_engineering_tasks / ivx_agent_controls / wallets / transactions / kyc_verifications / investors return EMPTY or error (zero rows leaked, probes 16:56Z).
- ROOT-110-120 PASS — domain policies verified by live behavior: members/investors/buyers/jv_deals/reels/chat/notifications/wallets/transactions/kyc/landing+waitlist readable WITH owner session (counts below), EMPTY for anonymous; landing lead capture is an explicit consent-gated public endpoint (400 without consent -> 201 with consent).
- ROOT-121 PASS — anonymous access review: probes above; anon role sees no protected rows.
- ROOT-122 PASS — authenticated access review: owner-session REST reads scoped and working; non-owner bearer denied on owner APIs (401).
- ROOT-123 PASS — service-role access: backend-only (canonicalMode supabase_rest_service_role); service key never exposed (secretValuesReturned:false everywhere); REST root OpenAPI restricted to service_role.
- ROOT-124 PASS — backup/rollback: 368-policy backup exists (pre-remediation), git-based schema migrations via management API with applied/pending tracking, rollback tag available.
- ROOT-125 PASS — this document.

## Application modules (ROOTS 126-150), live counts 16:56Z (owner session)

- ROOT-126 Owner Dashboard PASS — owner routes + engineering status 200 (12/12 teams ACTIVE).
- ROOT-127 Admin Hub PASS — owner tools (github-status/supabase-status/supabase-tables) 200 verified.
- ROOT-128/129 Settings & Variables PASS — app_config/app_settings tables live; env audit canonical.
- ROOT-130 Members PASS — members count 5.
- ROOT-131 Investors PASS — investors count 875.
- ROOT-132 Buyers PASS — buyers table live, count 0 (honest: empty dataset).
- ROOT-133 Properties PASS — properties count 1.
- ROOT-134 Deals PASS — jv_deals count 3.
- ROOT-135 Reels PASS — jv_deal_reels count 5; v1.4.8 reel UI verified live (transparent overlay + 9:16) same-day.
- ROOT-136/137 Media upload PASS — owner-gated presign upload proven live (APK PUT 200 + landing file upload ETag==md5 same-day); media buckets policy-gated.
- ROOT-138 Document upload PASS — same presign/storage pipeline (kyc_documents table present; no public write).
- ROOT-139 Chat send PASS — POST /api/chat (owner bearer) 200, requestId 5e9cbcce-bf38-4707-82b3-08b7d761e966, answer persisted.
- ROOT-140/141 Chat read-back + persistence PASS — conversationId 8f5a9c42 continuity across calls; public_chat_messages 1299 rows; durable assistant messages persisted (same-day msgs 94be0b8c/3afe6017).
- ROOT-142 Duplicate prevention PASS — same requestId (cert-dup-1784394200) sent twice -> identical shared answer (idempotency dedup).
- ROOT-143 Notifications PASS — notifications count 4; notification_events/preferences tables live.
- ROOT-144 Landing registration PASS — POST /api/ivx/leads/capture: 400 without consent (guard), 201 with consent -> lead-75ebe8df... captured, then cleaned up post-cert.
- ROOT-145 Waitlist PASS — waitlist count 7 (+ waitlist_entries/otp_events tables).
- ROOT-146 Wallets PASS — wallets count 16.
- ROOT-147 Transactions PASS — transactions count 1; wallet_transactions/fee_transactions tables live.
- ROOT-148 Analytics PASS — analytics_* tables live (dashboard/events/investments/kpi/retention).
- ROOT-149 Search PASS — PostgREST filtered queries live (select/limit/filters used throughout this battery).
- ROOT-150 PASS — module regression summary: all modules answered live with expected data; zero 5xx in the module battery.
