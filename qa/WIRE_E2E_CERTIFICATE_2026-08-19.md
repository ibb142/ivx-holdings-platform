# IVX Wire Transaction End-to-End Certificate — 10/10 PASS

**Certificate ID:** `IVX-WIRE-E2E-22471d7683619767`
**Date (UTC):** 2026-08-19 · **Score: 10/10 — PASS (live production)**
**Evidence:** `qa/WIRE_E2E_CERTIFICATE_2026-08-19.json` (full per-check HTTP request/response evidence, `evidenceSha256: 22471d7683619767f81b81463066a19f0d42f044b9d5de48f21887165b17ad2d`)
**Target:** `https://ivx-holdings-platform.onrender.com` (canonical `https://api.ivxholding.com`)
**Commit tested:** `645f64d6ed78781b1cd3d52ba085e311ec22b86c` · Render deploy `dep-da2fcmrtqb8s738n4u0g` · `/health` commit match verified before testing

Every check below executed live against production over HTTPS at certification time —
no cached results, no mocks, no synthetic output counted as proof.

---

## Live checks — 10/10 PASS

| # | Check | Status |
|---|-------|--------|
| 1 | Public wire-instructions preview (no auth) — 200, `authenticated:false`, sign-in CTA, zero routing/account exposure | PASS |
| 2 | Owner-auth wire-instructions — 200, `authenticated:true`, honest not-configured state (no fake bank details) | PASS |
| 3 | Submission validation — missing required fields rejected 400 | PASS |
| 4 | Wire submission recorded — `ok:true`, id `wire_mszcjw58_f06038c7fb`, `persisted:true`, `duplicate:false`, status `submitted` | PASS |
| 5 | Owner list read-after-write — durable record returned, `qa:true`, history length 1 | PASS |
| 6 | Duplicate guard — resubmission of same referenceCode+amount returns `duplicate:true`, same id, still exactly 1 row | PASS |
| 7 | Owner transition `submitted → received` — history appended (2 entries) | PASS |
| 8 | Owner transition `received → credited` — terminal state reached (3 history entries) | PASS |
| 9 | Security — invalid transition `credited → received` rejected 400; unauthenticated list/transition rejected 401 | PASS |
| 10 | QA purge — `removed:1, remaining:0`, post-purge QA row count 0 (verified live) | PASS |

**QA reference:** `IVX-QA-WIRE-CERT-1787098914` · QA email pattern `ivx.qa.wire.cert.20260819@ivxholding.com` (auto-flagged `qa:true`)

## What shipped (commit `645f64d6`)

- `backend/services/ivx-wire-submission-store.ts` — **new** durable Supabase-backed store
  (`ivx_durable_documents`), lifecycle `submitted → received → credited | rejected`,
  idempotent duplicate guard (referenceCode+amount while non-rejected), QA flag + purge,
  append-only event trail. Marker: `ivx-wire-submission-store-2026-08-18`.
- `backend/api/ivx-wire-transfer.ts` — `recordWireSubmission` now persists durably
  (old console-log TODO removed); owner SMS alert only on non-duplicate submissions.
- `backend/hono.ts` — owner endpoints `GET /api/ivx/wire-submissions`
  (`?status=&qa=&referenceCode=`), `POST /api/ivx/wire-submissions/transition`,
  `POST /api/ivx/wire-submissions/purge-qa`; upstream canonical anon-key
  landing-config block preserved (verified 0 upstream lines lost before push).
- Typecheck: `tsc --noEmit` — 0 errors in wire files (3 pre-existing errors in untouched
  files `ivx-voice-chat-api.ts` / `server.ts`, already live on main before this work).

## QA hygiene

The QA wire record was created, exercised through the full lifecycle
(`submitted → received → credited`), then purged: `removed: 1, remaining: 0`,
and a post-purge live query confirmed **0 QA rows remaining**. Real investor
records are never touched by the purge (QA-flag filter only).

## Honest notes (no inflated claims)

- `IVX_WIRE_*` bank env vars are **not configured** on Render: the owner-auth
  instructions endpoint correctly returns an explicit not-configured state rather
  than fake bank details. Public preview serves the branded fallback + sign-in CTA.
  Owner action required to configure real bank details.
- SMS owner alert skipped by design: `IVX_OWNER_RECOVERY_PHONE` not configured.
- Stripe payments remain honestly `not_configured` (separate concern, unchanged).

## Auth surface verified

- Owner endpoints authenticated with a real Supabase owner session
  (user `9b280e15-f9fd-459f-bf2d-530b1ed84cb1`) via `assertIVXOwnerOnly`.
- Negative checks: unauthenticated access 401, invalid lifecycle transition 400.
