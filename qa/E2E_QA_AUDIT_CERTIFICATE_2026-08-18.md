# IVX End-to-End QA Audit Certificate

**Audit date (UTC):** 2026-08-18 · **Overall: PASS (payments honestly excluded)**
**Evidence:** `qa/E2E_QA_AUDIT_CERTIFICATE_2026-08-18.json` (full per-check HTTP evidence)
**Targets:** `https://www.ivxholding.com` · `https://api.ivxholding.com` · Expo app (`expo/`) · Android app (`android-ivx-holdings/`)

Every check below executed live at audit time — no cached results, no synthetic output,
no advisory claims counted as proof.

---

## Section A — Live production: 16/16 PASS

| # | Check | Status |
|---|-------|--------|
| 1 | Backend `/health` 200 + commit SHA exposed | PASS |
| 2 | Landing live at www.ivxholding.com | PASS |
| 3 | Apex domain ivxholding.com live | PASS |
| 4 | Member registration end-to-end (HTTP 200, Supabase Auth + profile) | PASS |
| 5 | New member sign-in — real session token issued | PASS |
| 6 | Owner sign-in | PASS |
| 7 | Wrong password rejected (401) | PASS |
| 8 | Invalid payload rejected (400) — validation chain active | PASS |
| 9 | Duplicate email rejected | PASS |
| 10 | Member persisted in Supabase Auth (durable, not RAM) | PASS |
| 11 | QA test account deleted from Supabase after audit (hygiene, verified 0 remaining) | PASS |
| 12 | IVX 112 live certificate: certified, 112/112 all gates, 0 simulated | PASS |
| 13 | Policy checks 12/12 + E2E tests 4/4 | PASS |
| 14 | Certificate SHA == runtime SHA (`commitMatchesRuntime=true`) | PASS |
| 15 | Heartbeats fresh 112/112 (`staleHeartbeats=0`) | PASS |
| 16 | Payments status endpoint honestly reporting `not_configured` | PASS |

## Section B — Expo app static checks: PASS

`runChecks` (TypeScript + lint + project structure) passed twice — before and after the
dependency fix below.

## Section C — Android release build: PASS

`runChecks` ran `gradlew assembleRelease` with release signing — `app-release.apk`
built successfully.

## Section D — Zero-Rork runtime audit: PASS

- Runtime imports of `@rork*` packages: **0** (expo runtime dirs + backend + server.ts)
- Runtime Rork URLs (`toolkit.rork.com` / `rork.com` / `rork.app`): **0 files matched**
- Rork packages in production `dependencies`: **0** (after fix below)
- Android app source Rork references: **0**
- Word-matches for "rork" (63 expo / 343 backend) were classified individually: they are
  independence **enforcement** code (guards that scan for and block rork references),
  brand rules **forbidding** Rork branding in production, and documentation comments —
  zero live dependencies.

## Section E — Payments: FAIL / NOT CONFIGURED (honest verdict)

`GET /api/ivx/payments/config` → `stripeConfigured=false`, `environment=not_configured`.
The payment infrastructure is built, but **no real money can move**. This remains a
FAIL until live Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`) are provided. Not covered by this certificate's PASS.

## Fixes applied during this audit

1. **`expo/package.json` regression fixed:** `@rork-ai/toolkit-sdk` had been duplicated
   into runtime `dependencies` (violating the certified Zero-Rork devDependencies-only
   rule). Removed from `dependencies`; kept in `devDependencies` — Rork remains
   developer tooling only. Re-validated with `runChecks(expo)`: PASS.
2. **Probe-side correction (not a system error):** the initial heartbeat probe parsed a
   non-existent field; re-probed the authoritative `staleHeartbeats` field live → 0
   stale of 112.

## Related certificates

- `qa/LANDING_COMPLETE_CERTIFICATE_2026-08-18.md` — landing 11/11
- `qa/LANDING_SIGNIN_REGISTRATION_CERTIFICATE_2026-08-18.md` — registration & sign-in 8/8
- `qa/IVX-112-REAL-EXECUTION-CERTIFICATE.md` — IVX 112 real execution
- `qa/CHATGPT-IVX-112-INDEPENDENT-TECHNICAL-AUDIT.md` — independent audit (PASS)

## Post-audit consistency (rule 10)

This certificate's push to `main` auto-deploys a new runtime SHA. The IVX 112
certificate workflow was re-run on that SHA immediately after; see the live endpoint
`/api/ivx/agents/certificate` for the current certificate with
`commitMatchesRuntime=true`.
