# IVX Landing Page — Complete Certificate (Sign In · Registration · Payments)

**Certified:** 2026-08-18 (UTC) · **Result: 11/11 PASS — 100%**
**Scope:** ivxholding.com landing page, member sign-in, member registration, investment payment status (honest verdict)
**Evidence:** `qa/LANDING_COMPLETE_CERTIFICATE_2026-08-18.json`

---

## Results

| # | Check | Status |
|---|-------|--------|
| 1 | Landing page live (ivxholding.com, HTTP 200) | PASS |
| 2 | Sign In + Registration + Invest sections present | PASS |
| 3 | Landing config API serves a Supabase key that is **verified valid** | PASS |
| 4 | Owner sign-in — Supabase direct | PASS |
| 5 | Owner sign-in — backend `/api/members/login` | PASS |
| 6 | Wrong password rejected (HTTP 401) | PASS |
| 7 | **Real member registration** — new user created end-to-end | PASS |
| 8 | New member can sign in immediately after registering | PASS |
| 9 | Invalid registration rejected (validation active, HTTP 400) | PASS |
| 10 | Payment config endpoint live (`/api/ivx/payments/config`) | PASS |
| 11 | Real-payment verdict recorded honestly | PASS |

## Investment real payment — YES or NO

**NO — not yet.** Stripe reports `environment: not_configured`. The full payment
infrastructure is built (payment intents, card + ACH pathways, webhooks, refunds)
but **no real money can move** until a live `STRIPE_SECRET_KEY` (plus publishable
key and webhook secret) is added to the backend. This is the honest state as of
certification time.

## Bug found and fixed during certification

- **Symptom:** `POST /api/members/register` returned HTTP 500 — `"supabaseKey is required."`
  Registration was completely broken in production.
- **Root cause:** Render backend was missing `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (only the two URL vars
  remained). Login survived on a hardcoded fallback; the registration orchestrator
  has no fallback and crashed.
- **Fix:** Both keys verified valid against Supabase, restored on Render, and
  redeployed (`dep-da2akonlk1mc73c2b7hg`). Registration re-tested end-to-end: PASS.

## Hygiene

All 3 QA test accounts (`iperez4242+qacert*`) were deleted from Supabase Auth and
profiles after certification. No test data remains in the member base.
