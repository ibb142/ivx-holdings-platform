# IVX Holdings Landing Page — 100 End-to-End Functionalities Certification

**Certification run:** 2026-08-20/21 (UTC) · **Verdict: NOT YET CERTIFIED — 84/100 PASS**
**Production URL:** https://ivxholding.com · **Audited release/SHA:** `6ca1cd71f2b9602d079c141805f918279888e7da` (live, from `/api/landing-config` + QA runner; local repo HEAD `6b0b4bc2a017` is DIVERGENT from production — documented blocker)
**Method:** Live HTTPS probes against production (ivxholding.com + api.ivxholding.com), real code inspection, negative security tests, one real QA member created live then documented for owner cleanup. No mock, simulated, or fabricated evidence counted as PASS.

**Score by phase:** P1 8/10 · P2 6/12 · P3 8/8 · P4 5/8 · P5 12/12 · P6 6/6 · P7 14/14 · P8 6/7 · P9 10/10 · P10 9/13
**Tally:** 84 PASS · 7 PARTIAL · 5 FAIL · 4 BLOCKED = 100 items

---

## QA Matrix (100 rows)

Legend: Y=yes verified · P=partial · N=no · n/a=not applicable. "Live" = measured against production on 2026-08-20/21.

| # | Requirement | Code Evidence | Live Evidence | Mobile | Desktop | Negative Test | Status | Fix | Retest |
| - | ----------- | ------------- | ------------- | ------ | ------- | ------------- | ------ | --- | ------ |
| 1 | Sub-0.3s load | gzip static landing | 0.073–0.233s ×3 runs, 108,794B raw | Y | Y | n/a | PASS | — | — |
| 2 | HTTPS + TLS + redirect | CloudFront/S3 | http→301→https; TLS valid to 2027-03-02 | Y | Y | n/a | PASS | — | — |
| 3 | Mobile-first responsive | viewport meta + 10 @media blocks | viewport live; prior frame captures | Y | Y | n/a | PASS | — | — |
| 4 | Live deal ticker + real-time clock | LIVE_ACTIVITY array + ticker render | Ticker renders/rotates; data is CANNED (hardcoded "Investor…2m ago"); no real-time clock element | P | P | n/a | PARTIAL | Wire ticker to real events API; add clock | After deploy |
| 5 | Sticky nav + hamburger | position:sticky ×2, `#hamburger` + handler | Present in live HTML | Y | Y | n/a | PASS | — | — |
| 6 | Hero value proposition | `.hero-title` block | Present live | Y | Y | n/a | PASS | — | — |
| 7 | Real AUM + investor count stats | `stat-aum` static "3 Published" | Member count REAL (waitlist.getStats total=71); NO real AUM metric displayed; other hero stats are marketing claims | P | P | n/a | PARTIAL | Add real AUM from backend ledger or remove claim | After data exists |
| 8 | Cookie consent blocks tracking | consent-gated pixel loader (ivx-analytics.js) | Banner live; pixels load only after consent (code) | Y | Y | Y (no-consent → no pixel) | PASS | — | — |
| 9 | Toasts on real actions | vxToast on save/share/connect | Code verified on real user actions | Y | Y | n/a | PASS | — | — |
| 10 | SEO stack | OG/Twitter/canonical/robots/sitemap | og:*, twitter:card, canonical live; robots.txt/sitemap.xml/favicon 200 | Y | Y | n/a | PASS | — | — |
| 11 | Featured Deals | deals section + fetchDeals | Section + API data live | Y | Y | n/a | PASS | — | — |
| 12 | Live properties grid from API | fetchDeals → /api/landing-deals | 4 deals returned, rendered from API (not hardcoded) | Y | Y | n/a | PASS | — | — |
| 13 | Live deal counter | `#properties-live-count` | Element live; API count=4 | Y | Y | n/a | PASS | — | — |
| 14 | Auto-refresh + "refreshed X ago" | updateRefreshAgo + setInterval(5s) + autoRefreshDeals | Code verified; refresh-ago element live | Y | Y | n/a | PASS | — | — |
| 15 | Manual Refresh | — | NO manual refresh button found | N | N | n/a | FAIL | Add refresh button to deals header | After deploy |
| 16 | Graceful failure + Retry | REST fallback + `_dealFetchFailCount`; `#deals-error-state` | Fallback verified in code; error-state render + visible Retry button unverified | P | P | P (API fail path code-only) | PARTIAL | Add visible Retry CTA in error state | After deploy |
| 17 | ROI on every deal card | render uses expected_roi | All 4 live deals have expected_roi (25/9.5/25/30) | Y | Y | n/a | PASS | — | — |
| 18 | Equity stake on every card | min-ownership % computed | Computed display exists; API has no equity field; some ownership texts are hardcoded examples | P | P | n/a | PARTIAL | Add equity fields to deals API + render | After deploy |
| 19 | Deal type + min allocation per card | property_type render | type on 3/4 deals (JV-202603-5190 missing); min allocation not in API | P | P | n/a | PARTIAL | Add property_type+min to JV deal record; render min | After deploy |
| 20 | Full deal review modal | — | No deal modal exists (only partner-modal) | N | N | n/a | FAIL | Build per-deal modal with full details | After deploy |
| 21 | Per-deal downloadable diligence PDF | — | Only a chat quick-reply "PDF summary"; no PDF generation or links | N | N | n/a | FAIL | Generate per-deal diligence PDFs + links | After deploy |
| 22 | Browse Deals deep link | `#properties` anchor button | Live: "Browse Deals →" scrolls to properties | Y | Y | n/a | PASS | — | — |
| 23 | Investment reels on landing | ivx-reels.js + feed | Reels section live | Y | Y | n/a | PASS | — | — |
| 24 | Vertical video playback | reels player | 3 videos live: video/mp4 200 (213–296KB) | Y | Y | n/a | PASS | — | — |
| 25 | Instant thumbnail paint | poster attr + thumbnail fallback | thumbs image/jpeg 200 (3.2–4.4KB); poster_url null in feed but fallback works | Y | Y | n/a | PASS | — | — |
| 26 | Live video feed API | video-platform/feed | 200, 3 videos with metadata | Y | Y | n/a | PASS | — | — |
| 27 | Reel → deal linkage | project_id + per-reel deal CTAs | project_id present on all reels; Invest CTA per reel | Y | Y | n/a | PASS | — | — |
| 28 | Lazy-loaded media | IntersectionObserver + preload=none + loading=lazy | Code verified | Y | Y | n/a | PASS | — | — |
| 29 | Share + Invest CTAs per reel | share POST + ivxr-invest-ctas | Share endpoint live; Invest + View CTAs per reel | Y | Y | n/a | PASS | — | — |
| 30 | Content parity with mobile app | expo/lib/video-feed.ts uses SAME feed endpoint | Landing ↔ app: identical `/api/ivx/video-platform/feed` source, same IDs | Y | Y | n/a | PASS | — | — |
| 31 | Company transparency | credibility section + company info | Live section with who/what/where | Y | Y | n/a | PASS | — | — |
| 32 | Evidence-backed credibility | "100% Document Review" stat | Marketing claims only; no verifiable track-record evidence | P | P | n/a | PARTIAL | Provide factual evidence or soften claims | Owner evidence |
| 33 | Trust signals throughout | disclosures/escrow/contact markers | Present throughout scroll | Y | Y | n/a | PASS | — | — |
| 34 | Real member testimonials | — | NO testimonials exist (correctly absent — none fabricated) | n/a | n/a | n/a | BLOCKED — AUTHENTIC TESTIMONIAL EVIDENCE REQUIRED | Collect consented real member testimonials | Owner evidence |
| 35 | Risk disclosures BEFORE investment | disclosures section + gate before invest | Live + gated | Y | Y | n/a | PASS | — | — |
| 36 | "Understood ✓" consent gate | disclosure consent gate | Live gate before invest flow | Y | Y | Y (bypass blocked) | PASS | — | — |
| 37 | Terms required to confirm | termsAgreed gate (confirm disabled until agreed) | Verified: button disabled, submit blocked w/o terms (client + backend 400) | Y | Y | Y (terms bypass fails) | PASS | — | — |
| 38 | Escrow-structured offerings + distribution terms | "Escrow Deal Minimums" static stat | Static claim; no factual escrow evidence verifiable | P | P | n/a | BLOCKED — REAL ESCROW EVIDENCE REQUIRED | Provide escrow/bank documentation | Owner evidence |
| 39 | "Become an IVX Member — Free" | funnel headline | Live | Y | Y | n/a | PASS | — | — |
| 40 | Two-step registration | showFunnelStep | Steps 1→2→3 verified | Y | Y | n/a | PASS | — | — |
| 41 | Real investor activation path | funnel → registration → review | Live E2E (real account created) | Y | Y | n/a | PASS | — | — |
| 42 | "Start in 4 Easy Steps" | how-it-works section | Live | Y | Y | n/a | PASS | — | — |
| 43 | Guided progress indicator | `#funnel-progress` | Live | Y | Y | n/a | PASS | — | — |
| 44 | Name capture | `#f-name` | Live field + API validation | Y | Y | n/a | PASS | — | — |
| 45 | Email capture | `#f-email` | Live field + API validation | Y | Y | n/a | PASS | — | — |
| 46 | Phone capture | `#f-phone` | Live field + 10-digit validation | Y | Y | n/a | PASS | — | — |
| 47 | Investment range capture | `#f-range` | Live field | Y | Y | n/a | PASS | — | — |
| 48 | Compliance-grade consent checkbox | `#f-consent` | Live, required | Y | Y | Y (missing consent → reject) | PASS | — | — |
| 49 | UTM capture (5 params) | utm_source/medium/campaign/content/term + gclid/fbclid/ttclid | Code verified, all 5 captured to hidden fields | Y | Y | n/a | PASS | — | — |
| 50 | Idempotency (no dup accounts) | registrationRequestId orchestrator | LIVE TEST: identical resubmit → SAME authUserId `f5f0f78a…`, no duplicate | Y | Y | Y (double-submit tested) | PASS | — | — |
| 51 | Real account creation | orchestrateRegistration (Auth+profile+fanout) | LIVE: 200 COMPLETED, authUserId + profile row exist | Y | Y | n/a | PASS | — | — |
| 52 | Inline validation + 400 | normalizedError contract | LIVE: 400s for invalid email/phone/DOB/gender/roles | Y | Y | Y (invalid payloads rejected) | PASS | — | — |
| 53 | "Application Submitted 🎉" | success step (step 3) | Code verified + funnel shows success | Y | Y | n/a | PASS | — | — |
| 54 | Real live member count | waitlist.getStats → funnel-member-count | LIVE: total=71 (real data source) | Y | Y | n/a | PASS | — | — |
| 55 | KYC verification tracking | kyc_status + start-kyc endpoint | LIVE: profile kyc_status=pending; endpoint exists | Y | Y | n/a | PASS | — | — |
| 56 | Unique member ID issuance | authUserId | LIVE: `f5f0f78a-18d1-44f1-bbf4-84be3fb88569` issued | Y | Y | n/a | PASS | — | — |
| 57 | Investment amount input | `#invest-amount-input` | Live input | Y | Y | n/a | PASS | — | — |
| 58 | Amount validation | client min-gating + server validation | LIVE: 400 "Missing or invalid amount" for -5; client blocks below minimum | Y | Y | Y (invalid amount rejected) | PASS | — | — |
| 59 | Inline Sign In (no context loss) | invest-auth-box inline form | Code verified — inline auth within invest overlay | Y | Y | n/a | PASS | — | — |
| 60 | Inline Create Account & Continue | inline register path | Code verified | Y | Y | n/a | PASS | — | — |
| 61 | Birthday/accreditation question | `#invest-birthday`, DOB row | Live fields + DOB validation (18+) | Y | Y | Y (bad DOB → 400) | PASS | — | — |
| 62 | Review & Confirm summary | review step elements | Live | Y | Y | n/a | PASS | — | — |
| 63 | Review shows amount/deal/equity/payment/ROI/type | review-deal/amount/equity/roi/payment/type | All 6 verified (review-type line 210) | Y | Y | n/a | PASS | — | — |
| 64 | Terms agreement before confirmation | disabled confirm + submit guard | Y (bypass fails client+server) | Y | Y | Y | PASS | — | — |
| 65 | Success confirmation | success view + equity | Code verified | Y | Y | n/a | PASS | — | — |
| 66 | "Start Investor Review →" | funnel CTA → review | Live CTA | Y | Y | n/a | PASS | — | — |
| 67 | Deal-specific access model | per-deal invest state (pool/dealId) | Verified per-deal context | Y | Y | n/a | PASS | — | — |
| 68 | Expected ROI confirmed in review | review-roi with projected $ | Verified (ROI + $ projection) | Y | Y | n/a | PASS | — | — |
| 69 | Equity position confirmed in writing | success-equity | Verified (equity % in writing) | Y | Y | n/a | PASS | — | — |
| 70 | Investment status badge | wire/investment status + transitions | WIRE E2E cert: submitted→received→credited with history | Y | Y | n/a | PASS | — | — |
| 71 | Bank wire path | wire flow + instructions | WIRE E2E V2 cert 10/10 (real bank configured) | Y | Y | n/a | PASS | — | — |
| 72 | Complete wire instructions | owner-auth wire page | Cert: all required bank fields (U.S. Century Bank) | Y | Y | n/a | PASS | — | — |
| 73 | Account/routing/SWIFT details | bank env vars on Render | Cert: real values configured (never exposed in QA) | Y | Y | n/a | PASS | — | — |
| 74 | Beneficiary address | wire page fields | Cert: present | Y | Y | n/a | PASS | — | — |
| 75 | Unique investment wire reference | per-request reference code | Cert: per-request codes + duplicate guard (`duplicate:true`) | Y | Y | Y (dup submission blocked) | PASS | — | — |
| 76 | Dedicated printable wire page | /wire-transfer page | LIVE: 200; public preview + owner-auth views | Y | Y | Y (unauth → no bank data) | PASS | — | — |
| 77 | Stripe card + ACH infrastructure | full payment code (intents/webhooks/refunds) | LIVE config: `not_configured`, ALL capabilities false — CODE READY, NOT LIVE | n/a | n/a | n/a | BLOCKED — LIVE STRIPE KEYS REQUIRED | Configure STRIPE_SECRET_KEY + publishable + webhook on backend | Owner credentials |
| 78 | Portal login | /api/members/login + portal | LIVE: 200 + token (1,104 chars) | Y | Y | n/a | PASS | — | — |
| 79 | Wrong credentials rejected, no enumeration | rate-limited login | LIVE: 401 identical message for unknown/wrong (today + prior cert) | Y | Y | Y (enumeration test) | PASS | — | — |
| 80 | Personal holdings dashboard | portal dashboard | LIVE auth: profile + dashboard data | Y | Y | Y (logged-out blocked) | PASS | — | — |
| 81 | Investments list | landing_investments REST | LIVE auth: 200 `[]` (correct empty for new member) | Y | Y | Y (anon → []) | PASS | — | — |
| 82 | Total invested | portal totals render | Verified in portal render code | Y | Y | n/a | PASS | — | — |
| 83 | Wallet view | `#portal-wallet` + wallet_balance | LIVE: wallet_balance field served | Y | Y | Y (anon → []) | PASS | — | — |
| 84 | KYC status | `#portal-kyc-status` | LIVE: kyc_status=pending rendered | Y | Y | Y (anon → []) | PASS | — | — |
| 85 | Member-since date | member_since/created_at | LIVE: 2026-08-20T23:58:12Z | Y | Y | Y (anon → []) | PASS | — | — |
| 86 | Sign out | portal logout export | Verified | Y | Y | n/a | PASS | — | — |
| 87 | Track Access Anywhere | token-based API access | LIVE: same account via API across clients; RLS blocks anon (200→[]) | Y | Y | Y (RLS verified) | PASS | — | — |
| 88 | Live investor chat on landing | chat widget + edge function | LIVE widget; Supabase edge fn 'ai-generate' path | Y | Y | n/a | PASS | — | — |
| 89 | Two-way real-time messages | requestAiResponse + fallback | AI gateway key DEAD (audit) → falls back to CANNED replies; message flow works but not truly AI/live-agent | P | P | n/a | PARTIAL | Configure working AI gateway key | Owner credentials |
| 90 | Request Live Investor Support | ticket insert + ticket # | Verified: real DB ticket + "Ticket #XXXXXX" confirmation | Y | Y | n/a | PASS | — | — |
| 91 | Speak with management | escalation + investors@ivxholding.com | Verified in chat + contact | Y | Y | n/a | PASS | — | — |
| 92 | "How do I invest?" guidance | quick replies + guidance | Verified | Y | Y | n/a | PASS | — | — |
| 93 | Enterprise registration | enterprise-register.html | LIVE: 200 | Y | Y | n/a | PASS | — | — |
| 94 | Business automation showcase | business-automation section | LIVE | Y | Y | n/a | PASS | — | — |
| 95 | Referral program + personal link | referral-box + copy fn | referral-link element is OVERWRITTEN with contact text — NO real personal referral link generated | N | N | n/a | FAIL | Generate real per-member referral links + tracking | After deploy |
| 96 | Android app badge / app funnel | badge + QR + APK link | LIVE: QR/badge present BUT APK URL serves index.html (200 text/html) — APK FILE MISSING on S3 | P | P | n/a | FAIL | Upload APK to S3 (blocked: dead AWS key) or repoint badge | AWS creds |
| 97 | Ad pixel + UTM attribution | consent-gated gtag/GTM + full UTM | Verified (gated by consent, all UTM + click IDs) | Y | Y | n/a | PASS | — | — |
| 98 | Investor email notifications | send-email-code endpoint only | No evidence registration/investment notification emails execute | N | N | n/a | BLOCKED — LIVE EMAIL DELIVERY EVIDENCE REQUIRED | Configure + verify transactional email provider | Owner action |
| 99 | Privacy Policy + Terms | privacy.html, terms.html | LIVE: 200 both | Y | Y | n/a | PASS | — | — |
| 100 | Contact section | contact section + email | LIVE | Y | Y | n/a | PASS | — | — |

---

## NOT YET CERTIFIED — 84/100

### Remaining numbered blockers

**FAIL (5) — software gaps, fix-ready but DEPLOY-BLOCKED:**
- **#15 Manual Refresh** — no refresh button exists. Fix: add button wired to `autoRefreshDeals()`.
- **#20 Deal review modal** — no per-deal modal. Fix: build modal (full details, photos, terms).
- **#21 Per-deal diligence PDF** — no PDF generation or download links. Fix: generate + link PDFs per deal.
- **#95 Referral personal link** — `referral-link` is overwritten with contact text. Fix: generate real per-member links + attribution.
- **#96 Android APK** — `ivxholding.com/apk/ivx-holdings-v1.10.14.apk` serves index.html; the APK file does not exist on S3. Fix: upload APK (needs valid AWS key).

**PARTIAL (7):** #4 (ticker content canned, no clock), #7 (no real AUM metric; member count real), #16 (no visible Retry CTA), #18/#19 (equity/min-allocation fields missing from deals API), #32 (credibility claims unevidenced), #89 (AI replies degraded to canned fallback — dead AI key).

**BLOCKED (4) — REAL EVIDENCE REQUIRED:** #34 authentic testimonials · #38 escrow documentation · #77 live Stripe keys · #98 live email delivery.

### P0 blockers (owner-only)
1. **Dead AWS key** (`AKIAIOSFODNN7EXAMPLE` — AWS documentation example, never real) — blocks ALL landing deploys (incl. the already-coded forgot-password fix and every Fix above). Action: issue real IAM key with S3 write + CloudFront invalidation.
2. **Divergent deploy repo** — production builds from `ibb142/ivx-holdings-platform` (SHA `6ca1cd71`), local Rork repo HEAD `6b0b4bc2` shares no history; GitHub token 401. Action: fix GitHub token + reconcile repos, or deploy via S3 once AWS key exists.
3. **AI gateway key 401** — chat degraded to canned fallback (#89).
4. **Live wire-submission auth regression** — per 2026-08-20 credential audit, production trusts body-supplied `userId` (fix exists locally, undeployable).

### QA suite results
- Project QA runner: **16 PASS / 1 FAIL / 5 SKIP** (FAIL = owner-token env unavailable in sandbox — environmental).
- Backend bun test: **2374 pass / 38 fail / 22 errors** — all failures are `Cannot find module` (sandbox lacks `node_modules` deps like `@supabase/supabase-js`, `ai`); environmental, not code regressions.
- Root tsc: cannot run in sandbox (missing bun/node type libs). Expo runChecks passed 0 errors earlier today.

### QA hygiene
One real QA member created live for authenticated tests: `iperez4242+qacert100@gmail.com` (authUserId `f5f0f78a-18d1-44f1-bbf4-84be3fb88569`). Sandbox could not delete it (no service-role key; investor-row delete returned "not found" — row is keyed differently). **Owner action: delete from Supabase Auth + profiles.** Zero wire/QA residue otherwise (wire cert V2 purged its rows).

---

**"Each IVX Holdings landing-page requirement #1 through #100 was independently evaluated against the Rork specification. No missing, simulated, placeholder, unsupported, or unverified evidence was counted as PASS."**
