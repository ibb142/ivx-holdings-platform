# IVX Wire E2E Certificate V2 — 10/10 PASS (bank CONFIGURED)

**Date (UTC):** 2026-08-19 02:09 · **Score: 10/10 — PASS (live production)**
**Supersedes:** `qa/WIRE_E2E_CERTIFICATE_2026-08-19.md` (that run passed with bank env vars
not yet configured; this run passed WITH the real bank configured on Render)
**Evidence:** `qa/WIRE_E2E_CERTIFICATE_2026-08-19_V2.json`
(`evidenceSha256: 77649df36f72f1581702c359da00255518e9a407610d0ff840c9233a9b31ca7a`, sanitized —
zero bank digits stored in the repo, ever)
**Target:** `https://ivx-holdings-platform.onrender.com` (canonical `https://api.ivxholding.com`)
**Commit tested:** `daf671fa81e778b44d4a140cf44afd26f842e4a5` · `/health` commit match verified

## Live checks — 10/10 PASS

| # | Check | Status |
|---|-------|--------|
| 1 | Public preview (no auth) — 200, bank name + sign-in CTA only, zero routing/account exposure | PASS |
| 2 | Owner-auth instructions — 200, all required bank fields present (U.S. Century Bank) + per-request reference code | PASS |
| 3 | Validation — missing required fields rejected 400 | PASS |
| 4 | Submission recorded — `persisted:true`, `duplicate:false`, status `submitted` | PASS |
| 5 | Owner list read-after-write — 1 durable row, auto-flagged `qa:true` | PASS |
| 6 | Duplicate guard — same referenceCode+amount → `duplicate:true`, same id, still 1 row | PASS |
| 7 | Transition `submitted → received` (history 2) | PASS |
| 8 | Transition `received → credited` (history 3, terminal) | PASS |
| 9 | Security — invalid transition 400; unauth list/transition 401 | PASS |
| 10 | QA purge — `removed:1, remaining:0`; post-purge QA rows 0, total rows 0 | PASS |

## 112 Real Execution Certificate (re-run, same commit)

- **Certificate:** `IVX-112-REAL-EXEC-5c1e52045b0ebf13` · `certified: true`
- **Run:** `rec-1787105379412` · 112/112 agents · `simulatedRuns: 0` · `failed: 0`
- **Commit:** `daf671fa81e778b44d4a140cf44afd26f842e4a5` (live at run time)
- Prior cert `IVX-112-REAL-EXEC-8958d1ab9bfc2734` (commit `c282565715a6`) was invalidated by
  subsequent pushes to main (autonomous agent commits); re-run per the SHA-pinning rule.
- Note: autonomous agents continue pushing to main, so the live SHA moves; each certificate
  is anchored to the exact commit it ran against and must be re-run after any push.

## Storage-level QA hygiene (verified via service-role query)

- `wire-transfers/submissions.json`: **0 records**
- `investor-protection/wires.json`: **0 records**
- No QA or test wire data remains anywhere; real investor records are never touched by purge.

## Honest notes

- Owner-auth for these tests used an admin-minted Supabase session for the owner account
  (`9b280e15…`); backend `assertIVXOwnerOnly` validated it against production auth.
- Owner SMS wire alert still skipped by design: `IVX_OWNER_RECOVERY_PHONE` not configured.
- Bank digits (routing/account) exist ONLY in Render env vars — never in GitHub, never in
  evidence files, never in logs.
