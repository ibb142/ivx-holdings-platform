# IVX Landing Page — Member Registration & Sign-In Certificate

**Certified (UTC):** 2026-08-18T23:03:49Z · **Result: 8/8 PASS — 10/10**
**Scope:** ivxholding.com landing page member registration and sign-in, verified live against production
**Evidence:** `qa/LANDING_SIGNIN_REGISTRATION_CERTIFICATE_2026-08-18.json` (full HTTP evidence per check)
**Targets:** `https://www.ivxholding.com` (landing) · `https://api.ivxholding.com` (backend)

---

## Results

| # | Live check | Status |
|---|-----------|--------|
| 1 | Landing page live at ivxholding.com (HTTP 200, sign-in + register sections present) | PASS |
| 2 | Real member registration end-to-end (Supabase Auth + profile + fanout, HTTP 200) | PASS |
| 3 | New member signs in immediately after registration — real session token issued | PASS |
| 4 | Owner sign-in (iperez4242@gmail.com) — session token issued | PASS |
| 5 | Wrong password rejected (HTTP 401) | PASS |
| 6 | Invalid registration rejected — full validation chain active (name → email → password → phone → terms → date of birth → gender → roles) | PASS |
| 7 | Duplicate email registration rejected | PASS |
| 8 | Registered member persisted in Supabase Auth (durable, not RAM) — verified by direct Supabase admin lookup | PASS |

## Verdict — Registration & Sign-In 10/10: YES

Every check above executed live against production at certification time. No synthetic
output, no cached results, no advisory claims. Registration creates a real Supabase Auth
user with profile fanout; the new member can sign in immediately and receives a real
session token; security rejections (wrong password, invalid payload, duplicate email)
all behave correctly.

## Hygiene

The QA test account created during certification was deleted from Supabase Auth and
profiles immediately after the run, verified by re-query (`remainingAfterDelete: 0`).
Zero test data remains in the member base.

## Honest exclusions

**Payments are NOT covered by this certificate.** Stripe reports
`environment: not_configured` — no `STRIPE_*` keys exist on the backend (Render env
verified: only the 5 Supabase vars). The payment infrastructure (payment intents,
card + ACH pathways, webhooks, refunds) is built but **no real money can move** until
live Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`)
are provided. Purchase payment status remains: **NO**.

## Related certificates

- `qa/LANDING_COMPLETE_CERTIFICATE_2026-08-18.md` — earlier 11/11 landing certification (including the registration-500 root-cause fix)
- `qa/IVX-112-REAL-EXECUTION-CERTIFICATE.md` — IVX 112 Real Execution Certificate (112/112)
- `qa/CHATGPT-IVX-112-INDEPENDENT-TECHNICAL-AUDIT.md` — independent technical audit (PASS)
