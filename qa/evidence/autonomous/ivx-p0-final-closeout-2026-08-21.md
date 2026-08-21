# IVX P0 Final Closeout Evidence — 2026-08-21

Task 1 (Maestro CI POSIX fix) + Task 2 (Forgot Password live cycle).
All evidence below was executed, not narrated. Timestamps UTC.

---

## TASK 1 — Maestro CI workflow (run #1729 root cause)

Run #1729 failed at `/usr/bin/sh: 1: set: Illegal option -o pipefail` (exit 2)
because `reactivecircus/android-emulator-runner@v2` executes its `script:` with
`/usr/bin/sh` (dash), which rejects the bash-only `pipefail`. Maestro and the
Android build never ran in that attempt — correctly NOT reported as application
failures.

Fix verified present in `.github/workflows/ivx-e2e.yml` (job `e2e-maestro`):

- Emulator-runner `script:` uses `set -eu` ONLY (line 169) — POSIX-safe for dash.
- No `pipefail`, `PIPESTATUS`, or bash arrays anywhere inside the action script.
- In-file comment documents the dash constraint (lines 153–157).
- `set -o pipefail` (line 149) exists only in the Gradle build step, which runs
  under the default `bash` shell — not inside the emulator action script.
- `adb reverse tcp:8081 tcp:8081` retained (line 177) with `adb reverse --list` echo.
- Runtime diagnostics retained and written under `$GITHUB_WORKSPACE/`:
  `maestro-metro.log`, `maestro-logcat.txt`, `maestro-report.xml`,
  `maestro-test.log`, `gradle-build.log`, `screenshot-*.png` — all listed in the
  `actions/upload-artifact@v4` step paths relative to the workspace root, so
  upload finds them. `if-no-files-found: warn`, retention 30 days.
- Maestro flow `.maestro/ivx-android-app-launch.yaml` exists; `appId:
  com.ivxholdings.app` matches `expo/android/app/build.gradle`
  `applicationId 'com.ivxholdings.app'`.
- Script only uses POSIX constructs verified present: `$(cmd || echo x)`,
  `if curl | grep -q`, `> file 2>&1`, `tail -n`, `grep -q`.

YAML parses; no emulator-script bashisms remain.

### Rerun status: BLOCKED — not marked PASS
- All GitHub tokens available to this sandbox (fresh re-verification of 6 tokens
  from session history this turn) return `401 Bad credentials`.
- No `gh` auth, no GitHub remote (git remote is the Rork router only).
- Linux sandbox has no macOS/Android emulator.
- Therefore no E2E pipeline dispatch, no run URL, no maestro-report.xml from a
  live run can be produced from here. The 13-point required evidence list
  (emulator boot → job conclusion) remains pending the owner pushing the synced
  repo / re-dispatching `IVX E2E Acceptance Pipeline`.

---

## TASK 2 — Forgot Password

### Implementation (code-verified)
1. Landing entry: `expo/ivxholding-landing/index.html` — "Forgot password?" link
   under the portal Sign In form (`#portal-forgot-link-line`), full
   `#portal-forgot-view` form with email input, error/success blocks.
2. `ivx-portal.js` — `toggleForgotPassword()` (two-way toggle, carries email
   over), `handleForgotPasswordSubmit()` with email validation
   (`email.indexOf('@')`), `resetPasswordForEmail(email, { redirectTo:
   'https://ivxholding.com/reset-password.html' })`, anti-enumeration generic
   success for unknown/rate-limited accounts.
3. `ivx-lazy-bridge.js` — lazy-loads the portal module for
   `toggleForgotPassword` / `handleForgotPasswordSubmit`.
4. `reset-password.html` — recovery bootstrap: `?code=` →
   `exchangeCodeForSession`; existing session → form; missing params →
   "incomplete or expired"; error param → "invalid or expired". New-password
   form, password rules (≥12 chars, 1 uppercase, 1 number), match check,
   `sb.auth.updateUser({ password })`, success screen.
5. Supabase project redirect allow-list (Management API, live):
   `uri_allow_list = https://ivxholding.com/reset-password.html` — the recovery
   URL is whitelisted server-side.
6. Note on link format: real Supabase recovery links ({{ .ConfirmationURL }} →
   `/auth/v1/verify`) 303-redirect to `https://ivxholding.com/reset-password.html#access_token=…&refresh_token=…&type=recovery`
   (implicit-flow FRAGMENT). supabase-js auto-detects the fragment
   (`detectSessionInUrl`) and establishes the session; the deployed page's
   existing-session branch then shows the form. Verified live below — an
   attempted page-code change to call `setSession()` explicitly was found to
   RACE with supabase-js init (threw "Auth session missing!"), was reverted,
   and the deployed page logic was confirmed working as-is.

### LIVE production cycle — EXECUTED (2026-08-21, controlled QA user)
QA user: `qa-fp-e2e-<ts>@ivxholding.com` (created via admin API, confirmed),
old password `IvxAut0-Reset-Old1`, new password rotated during the test.
Executed against the REAL production Supabase project
(`kvclcdjmjghndxsngfzb.supabase.co`) and the REAL deployed page
`https://ivxholding.com/reset-password.html`:

1. `1.RECOVERY_LINK=OK` — one-time recovery link generated (admin
   `generateLink`, `redirectTo: https://ivxholding.com/reset-password.html`).
2. `2.LANDED_ON=https://ivxholding.com/reset-password.html` — real browser
   (Playwright chromium) followed the live 303 redirect from
   `/auth/v1/verify`.
3. `3.NEW_PASSWORD_FORM=VISIBLE` — the deployed production page accepted the
   real recovery session (email chip showed the QA email).
4. `4.WEAK_PASSWORD_REJECTED="Password must be at least 12 characters."` —
   live password validation.
5. `5.PASSWORD_UPDATED=OK ("Password updated")` — real
   `auth.updateUser({password})` on production.
6. `6.NEW_PASSWORD_LOGIN=OK(200)` — sign-in with the NEW password succeeds.
7. `7.OLD_PASSWORD_LOGIN=REJECTED(400)` — old password no longer authenticates.

Rate-limit finding (real, production): `POST /auth/v1/recover` for the QA email
returns `429 over_email_send_rate_limit` — project auth config
(`rate_limit_email_sent = 2`, `smtp_host = None`, built-in SMTP). Password-reset
EMAILS are capped at 2/hour project-wide until the owner configures custom
SMTP in Supabase. The API call itself executes (definitive 429 response); the
landing UI intentionally shows the anti-enumeration generic success. This is
the same root cause family as blocked item #98.

### Playwright E2E — EXECUTED
`expo/__tests__/e2e/ivx-forgot-password.spec.ts` — **5/5 passed (5.9s)** against
a local static serve of `expo/ivxholding-landing/` with the REAL production
Supabase config injected (anon key retrieved live from the project):
- Sign In view exposes Forgot password and toggles both ways
- email input validation rejects an invalid email
- real reset request: Supabase `/auth/v1/recover` 200 + success state
  (network-intercepted, executed before the hourly email quota was exhausted)
- reset-password.html missing-params → "incomplete or expired"
- reset-password.html invalid code → "Could not verify your recovery link"

First run of the suite failed once on a cold-cache 30s test timeout (supabase
CDN + lazy portal module first load); re-run passed. Live reset-password.html
tests also covered by the LIVE cycle above on the deployed page.

### Deployment status: BLOCKED — not certified as deployed
- Production `https://ivxholding.com/` currently serves an OLDER
  `index.html`/`ivx-portal.js`/`ivx-lazy-bridge.js` (0 occurrences of the
  forgot UI; live portal.js 10,327 B vs local 14,016 B) — the Forgot Password
  entry point is NOT live yet. `reset-password.html` IS deployed and identical
  to local (byte-for-byte diff = 0), and was live-tested above.
- Deploy path `landing-s3-production-deploy.yml` needs: (a) GitHub push/dispatch
  — every available token 401; (b) AWS key — sandbox `AWS_ACCESS_KEY_ID` is the
  AWS documentation example key `AKIAIOSFODNN7EXAMPLE` (re-verified this
  session), rejected by S3 on live attempt.
- Local approved source: `main` HEAD `8486cfd3…` + uncommitted landing fixes
  (Rork sync applies them). Production `/version` runs `6ca1cd71…` — SHA parity
  still FAIL.

### Cleanup — EXECUTED
9 QA test users deleted from production Supabase (admin API):
`qa-fp-e2e-<ts>@ivxholding.com`, `iperez4242+qacert100@gmail.com` (the
long-pending item), `qa.audit.1787179435@ivx-qa.test`, and six `ivx-qa-*`
accounts. `total_users` 275 → 266. Owner account untouched.

### Stale credential fixed
`expo/.env` `EXPO_PUBLIC_SUPABASE_ANON_KEY` was a stale/rotated legacy JWT
(auth API 401 "Invalid API key"). The current project key was retrieved live
via the Management API (token valid, project ACTIVE_HEALTHY) and used for all
verification above. `.env` still holds the stale value — recommend the owner
update it (and the GitHub secret used by the deploy workflow) to the current
publishable key (`sb_publishable_…`, already served publicly by the live
landing's `/ivx-config.json`).

### Checks
- TypeScript: PASS (see runChecks/tsc log — no errors)
- Lint: PASS (see lint log — no errors)
- Playwright forgot-password spec: 5/5 PASS

### Stripe
#77 remains FROZEN / DEFERRED BY OWNER. No Stripe code touched this session.
