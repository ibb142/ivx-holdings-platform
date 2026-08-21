# IVX P0 Closeout Evidence — 2026-08-21

Task 1: Maestro CI fix (run #1729 root cause) · Task 2: Forgot Password landing.
Rule: REAL QA / NO NARRATIVE — every status below is backed by a command that ran.

---

## TASK 1 — Maestro CI: /usr/bin/sh (dash) root cause

Run #1729 failure: `/usr/bin/sh: 1: set: Illegal option -o pipefail`, exit 2.
`reactivecircus/android-emulator-runner@v2` executes `script:` with /usr/bin/sh
(dash), which rejects bash-only `set -o pipefail`. Maestro and the app build
never ran in that attempt — correctly NOT reported as application failures.

### Fix applied (`.github/workflows/ivx-e2e.yml`, job `e2e-maestro`)

- Rewritten as an Android emulator job (ubuntu-latest) per the audited pipeline.
- Emulator `script:` is POSIX-only: `set -eu` — no `pipefail`, no `PIPESTATUS`,
  no bash arrays. Maestro failure path uses `if maestro …; then … else …; exit 1; fi`.
- `adb reverse tcp:8081 tcp:8081` kept (+ `adb reverse --list` proof).
- Runtime diagnostics kept and written under `$GITHUB_WORKSPACE` (not
  `$RUNNER_TEMP`) so `actions/upload-artifact` finds them:
  maestro-report.xml, maestro-test.log, maestro-metro.log, maestro-logcat.txt,
  gradle-build.log, screenshot-01-launch.png, screenshot-02-*.png.
- Pipeline: Metro starts on host → Android bundle warmed + size-verified
  (≥1 MB) → `./gradlew assembleDebug` (committed expo/android, debug appId
  com.ivxholdings.app, no suffix — verified build.gradle) → emulator boots →
  install → `am start -W com.ivxholdings.app/.MainActivity` → Maestro.
- Open-access root cause stays fixed: `EXPO_PUBLIC_IVX_OPEN_ACCESS_MODE=false`
  pinned at job level (inlined by Metro at serve time, so it reaches the
  debug build's bundle).
- New flow `expo/.maestro/ivx-android-app-launch.yaml`: launchApp clearState →
  extendedWaitUntil visible "Sign In" (60 s ceiling; login title + button label
  verified in app/login.tsx).
- YAML validation: both files parse clean (PyYAML safe_load).

### Rerun status

BLOCKED — GitHub credentials dead at runtime (all tokens 401; re-verified
2026-08-21: `api.github.com/repos/ibb142/ivx-holdings-platform` → 401 "Bad
credentials"). No Android emulator exists in this Linux sandbox. The workflow
must be pushed and dispatched by the owner to produce run evidence
(emulator boot, BUILD SUCCESSFUL, adb reverse, app launch, "Sign In"
assertion, maestro-report.xml, job conclusion).

---

## TASK 2 — Forgot Password

### Code verification (all 13 requirements)

1. Implementation exists — app: `expo/app/forgot-password.tsx`,
   `expo/app/reset-password.tsx`; landing: `ivxholding-landing/index.html`
   (portal-forgot-view + form), `ivxholding-landing/ivx-portal.js`
   (handleForgotPasswordSubmit → supabase.auth.resetPasswordForEmail),
   `ivxholding-landing/reset-password.html`. PASS
2. Email validation — app: validateEmail/sanitizeEmail (auth-helpers);
   landing: JS branch "Enter a valid email" + native `required`. PASS
3. Supabase reset request — resetPasswordForEmail → POST /auth/v1/recover
   with redirectTo. PASS
4. Redirect/recovery URL — `lib/auth-password-recovery.ts` resolves
   https://ivxholding.com/reset-password.html (API hosts rejected);
   landing uses origin + '/reset-password.html'. PASS
5. Expired/invalid recovery handling — app: error/`error_description` shown,
   "incomplete or expired"; landing: same + exchange failure message. PASS
6. New-password screen — reset-password.tsx + reset-password.html form
   (new-password, confirm-password, submit-btn). PASS
7. Password validation — app: validatePassword; landing: ≥12 chars,
   uppercase, digit, match check. PASS
8. Successful password update — supabase.auth.updateUser (AAL2 backend
   fallback in app). PASS
9. Sign in with new password — verified live (below). PASS
10. Old password no longer authenticates — verified live (below). PASS
11. TypeScript — `bunx tsc --noEmit` (expo) exit 0. PASS
12. Lint — `bun run lint` exit 0 (0 errors). PASS
13. Playwright — `ivx-forgot-password.spec.ts` 5/5 PASS against the landing
    build with real production Supabase config:
    toggle views, JS email validation, real POST /auth/v1/recover → 200
    (network-intercepted, anti-enumeration success copy), no-params rejected,
    invalid code rejected. PASS

### Live production test (2026-08-21, https://ivxholding.com)

- Real QA account created via public signup: qa-reset-20260821a@ivxholding.com.
- Old-password sign-in: 200.
- Real reset request POST /auth/v1/recover (page path, redirected to
  /reset-password.html): 200 (Playwright-intercepted against production
  Supabase; a direct repeat later hit the 1/h rate limit — 429, expected).
- Deployed reset-password.html with a REAL QA session:
  bootstrap "Recovery session verified" + recovered email shown: PASS
  weak password ("at least 12 characters") rejected: PASS
  mismatched passwords rejected: PASS
  password update via deployed page: PASS (success section)
  sign-in with NEW password: 200 PASS
  sign-in with PREVIOUS password: 400 PASS (old password dead)
- Deployed page invalid/expired handling (fresh contexts, waited):
  no params → "incomplete or expired" PASS
  ?code=definitely-invalid-code → "Could not verify your recovery link" PASS
- Not live-tested: the emailed recovery-link leg (exchangeCodeForSession).
  No controlled inbox exists in this environment and both stored
  service_role keys are dead legacy JWTs (401 on /auth/v1/admin/users from
  expo/.env AND android-ivx-holdings/.env), so admin generate_link is
  unavailable. The deployed page's own session→updateUser path (the code path
  that runs after the email link lands) IS verified live above.
- QA account cannot be deleted from here (no valid service key). Owner can
  remove qa-reset-20260821a@ivxholding.com in the Supabase dashboard.

### Bugs found and fixed in this pass

1. CSP blocks inline handlers on the landing (script-src has no
   'unsafe-inline'). Production works only because of a runtime-only
   `ivx-csp-actions-20260818-4.js` layer that was never committed to source —
   deploying the source would have killed My Portal / Sign In / Forgot
   Password. Fixed: the proven production CSP-actions file is now in source
   (`expo/ivxholding-landing/ivx-csp-actions-20260818-4.js`) and wired into
   index.html; CSP meta updated to the production policy (adds r2.dev to
   img-src/media-src). Local Playwright (5/5 PASS) proves the fixed source.
2. `expo/.env` EXPO_PUBLIC_SUPABASE_ANON_KEY was a dead legacy JWT (401 on
   /auth/v1/health). Replaced with the live publishable key (200). The
   platform-level env var of the same name is still the dead key — owner
   action required for Rork-side builds.
3. `expo/.env` SUPABASE_URL / IVX_SUPABASE_URL contained pasted
   documentation text ("Supabase acces…"), not a URL. Fixed to the project URL.
4. Both stored SUPABASE_SERVICE_ROLE_KEY values are dead legacy JWTs (401).
   Owner action: rotate and store the current sb_secret_ key.

### Deployment status (the certification blocker)

- Live index.html (no portal-forgot form) and live ivx-portal.js (10,327 B,
  no forgot handler) are OLDER than source (14,016 B with handler). The
  Forgot Password entry is NOT deployed; reset-password.html IS deployed and
  is byte-identical to source (md5 d07a1917…).
- commit: done locally (see git log). push/merge to GitHub: BLOCKED (all
  tokens 401, re-verified). deploy (S3/CloudFront): BLOCKED (AWS credentials
  dead/absent at runtime — documented in prior certifications).
- Production runs commit 6ca1cd71f2b9602d079c141805f918279888e7da; exact-SHA
  parity therefore FAIL until push+deploy are possible.

### Gates re-run after every change

expo tsc exit 0 · expo lint exit 0 (0 errors) · runChecks(appPath "expo")
PASS · Playwright forgot-password 5/5 PASS.

STRIPE: untouched, FROZEN / DEFERRED BY OWNER. Not a blocker, not counted.
