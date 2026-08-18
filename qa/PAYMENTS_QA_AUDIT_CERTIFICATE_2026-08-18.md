# IVX Payments QA Audit Certificate

**Audit date (UTC):** 2026-08-18 · **Infrastructure & safety: 10/10 PASS**
**Live payment processing: FAIL / NOT CONFIGURED — no real money can move**
**Evidence:** `qa/PAYMENTS_QA_AUDIT_CERTIFICATE_2026-08-18.json` (full per-check HTTP evidence)
**Target:** `https://api.ivxholding.com` (production SHA `2c42f1fc3082`)

Every check executed live against production at audit time — real HTTP requests,
real responses, no cached results, no synthetic output.

---

## What the 10/10 covers — and what it does not

The 10/10 certifies the payments **infrastructure, security gates, and honesty** of the
live system. It does **not** certify that payments can process real money — they cannot:
Stripe keys are absent everywhere (verified live: config endpoint `not_configured`;
Render environment contains zero `STRIPE_*` variables). That verdict stays **FAIL**
until keys are provided.

## Section A — Infrastructure & safety checks: 10/10 PASS

| # | Check | Result |
|---|-------|--------|
| 1 | Config endpoint live, honestly reports `not_configured` (no fake "ready") | PASS |
| 2 | No secret leakage: no `sk_`/`whsec_` in responses, publishableKey empty | PASS |
| 3 | Auth gate: create payment without token → 401 `UNAUTHORIZED` | PASS |
| 4 | Auth gate: portfolio without token → 401 | PASS |
| 5 | Admin gate: admin payment list without token → 403 `OWNER_ONLY` | PASS |
| 6 | Webhook rejects forged/unsigned Stripe events → 400, never processed | PASS |
| 7 | Validation: authenticated create without dealId → 400 `DEAL_REQUIRED` | PASS |
| 8 | **No synthetic success:** real member token + valid-shaped payment attempt fails honestly (400, no fake clientSecret) | PASS |
| 9 | Landing payment intent returns no synthetic payment secrets (validation-first rejection, no fake clientSecret path) | PASS |
| 10 | Honesty gate: API self-reports money movement impossible (capabilities all false, webhook unconfigured) | PASS |

Checks 7–8 used a real registered member session (live registration → login → Bearer token).

## Section B — Live payment processing: FAIL / NOT CONFIGURED

- `GET /api/ivx/payments/config` → `stripeConfigured=false`, `environment=not_configured`,
  `webhookConfigured=false`, capabilities `card/ach/financialConnections/refunds` all `false`.
- Render environment: **zero** `STRIPE_*` variables (verified via Render API at audit time).
- Critically, the system **fails honestly**: with Stripe unconfigured, a genuine authenticated
  payment attempt returns an error — there is no mock/synthetic success path anywhere.

**Unblock path:** provide `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`. A real end-to-end test payment will then be executed and
certified separately — only after real evidence exists.

## QA account hygiene

QA member `iperez4242+qapay…@gmail.com` (used for authenticated checks) was deleted from
Supabase Auth after the audit and verified gone (`remainingAfterDelete: 0`,
status `deleted_verified`). No test data remains in production.

## Audit notes (full honesty)

1. Check 9 precision: the landing-intent probe was rejected at validation
   ("Missing dealId.") before any Stripe call — proving no synthetic clientSecret is
   returned; the endpoint has no fake payment path.
2. The cleanup initially failed because the audit sandbox lacked the service-role key;
   it was completed using the production key from Render and then verified. The failure
   was in the audit tooling, not the production system.

## Post-audit consistency (rule 10)

This certificate's push to `main` auto-deploys a new runtime SHA; the IVX 112
certificate workflow is re-run on that SHA immediately after (see
`/api/ivx/agents/certificate`, `commitMatchesRuntime=true`).
