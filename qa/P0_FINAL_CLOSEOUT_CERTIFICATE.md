# IVX P0 FINAL CLOSEOUT CERTIFICATE — 2026-08-21

Real execution evidence only. Evidence file:
`qa/evidence/autonomous/ivx-p0-final-closeout-2026-08-21.md`

---

## FORGOT PASSWORD

| Item | Status |
|---|---|
| Code | **PASS** — implementation verified end-to-end (portal entry + validation + `resetPasswordForEmail` + redirect allow-list + reset page + password rules + update + anti-enumeration) |
| GitHub main SHA | UNVERIFIABLE — all GitHub tokens 401 (re-verified 6 fresh tokens this session) |
| Production SHA | `6ca1cd71f2b9602d079c141805f918279888e7da` — `reset-password.html` deployed and byte-identical to local |
| SHA parity | **FAIL** — forgot-password entry UI (`index.html`, `ivx-portal.js`, `ivx-lazy-bridge.js`) NOT deployed; production serves older files |
| Live reset request | PARTIAL — API executes; production email quota caps sending: `429 over_email_send_rate_limit` (rate_limit_email_sent=2/h, smtp_host=None, built-in SMTP) |
| Live recovery | **PASS** — real one-time recovery link → live 303 → `https://ivxholding.com/reset-password.html` → session accepted (executed in a real browser) |
| New-password update | **PASS** — live `auth.updateUser` on the deployed production page ("Password updated") |
| Login after reset | **PASS** — new password 200; old password rejected 400 (production auth) |
| TypeScript | PASS (runChecks: 0 errors) |
| Lint | PASS (0 errors, 1453 pre-existing warnings) |
| Playwright FP E2E | **PASS 5/5** (real production Supabase, network-intercepted `/auth/v1/recover` 200) |

**STATUS: NOT CERTIFIED** — deploy blocked (AWS key = documentation example key, GitHub 401). The live reset FLOW is certified working on production; the forgot-password ENTRY UI is code-complete, locally verified, and awaiting deploy.

## MAESTRO

| Item | Status |
|---|---|
| POSIX fix | **IN PLACE** — emulator script uses `set -eu` only; no `pipefail`/bashisms; adb reverse retained; all diagnostics written under `$GITHUB_WORKSPACE` matching upload-artifact paths |
| Workflow run | NOT EXECUTED — dispatch blocked (GitHub 401, no macOS/emulator in sandbox) |
| Android build / Metro / adb reverse / App launch / Login route / Sign In assertion / maestro-report.xml / Job conclusion | NOT EXECUTED — requires owner to push synced repo or re-dispatch `IVX E2E Acceptance Pipeline` |

**STATUS: NOT CERTIFIED** — fix verified in file; run #1729 correctly NOT treated as an application failure; no green run exists yet.

## PHASE 4 AUTONOMOUS

**NOT CERTIFIED** — blockers unchanged: Maestro green run + approved-SHA deploy + SHA parity.

## Stripe

#77 **FROZEN / DEFERRED BY OWNER** — no Stripe code touched, not a blocker.

## Executed this session (real, not narrative)

1. POSIX fix verified in `ivx-e2e.yml` emulator script; run #1729 reclassified as shell-failure, not app failure.
2. Full LIVE production forgot-password reset cycle on the deployed `reset-password.html` with a controlled QA user: recovery link → redirect → session → weak-password rejection → password updated → new login 200 → old login 400.
3. Playwright forgot-password suite 5/5 PASS against real production Supabase.
4. runChecks(expo) PASS; Lint 0 errors; TypeScript 0 errors.
5. 9 stale QA users deleted from production Supabase (incl. long-pending `iperez4242+qacert100@gmail.com`); total_users 275 → 266.
6. Root-cause discoveries: (a) stale `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env` (invalid — recommend owner updates it and the GitHub secret to the current `sb_publishable_…` key); (b) production password-reset email capped at 2/hour — owner must configure custom SMTP in Supabase; (c) an attempted page-code `setSession` change was found to race with supabase-js init — reverted; deployed page logic confirmed correct as-is.

## Minimum owner actions to certify

1. Push the synced repo / re-dispatch the E2E pipeline → Maestro gate runs the POSIX-fixed script (all 13 evidence points then produced by the run itself).
2. Provide a real AWS IAM key (S3 write + CloudFront invalidation) → deploy lands the forgot-password entry UI → re-verify live → FORGOT PASSWORD flips to CERTIFIED.
3. Configure custom SMTP in Supabase → lift the 2/hour reset-email cap (#98).
