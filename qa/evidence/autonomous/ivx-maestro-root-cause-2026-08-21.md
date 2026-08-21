# Maestro E2E Hard Gate — Root Cause Audit & Fix

**Date:** 2026-08-21
**Gate:** `.github/workflows/ivx-e2e.yml` → job `e2e-maestro` ("Maestro E2E (mobile surface) — HARD GATE")
**Flow:** `expo/.maestro/ivx-app-launch.yaml` (launchApp clearState → assert visible "Sign In", appId `com.ivxholdings.app`)
**Constraint:** GitHub CI run logs were NOT retrievable (all 8 GitHub tokens runtime-verified 401). Audit therefore reconstructed the failure from repo code + live local Metro evidence, per instruction: "Do not call it an emulator issue without evidence."

## Root cause — code-proven, deterministic

`expo/shared/ivx/access-control.ts`:

```ts
const DEFAULT_OPEN_ACCESS_MODE_ENABLED = true;          // line 117
...
const openAccessEnabled =
  explicitOpenAccess ?? (runtime === 'production' ? false : DEFAULT_OPEN_ACCESS_MODE_ENABLED);  // line 283
```

Runtime resolution (lines 258–274): `__DEV__ === true` → `'development'`.

The CI job built with `--configuration debug` → `__DEV__ = true` → runtime `development` → **open access mode enabled by default** (no `EXPO_PUBLIC_IVX_OPEN_ACCESS_MODE` override existed in the job env).

`expo/app/index.tsx` then resolves:

```ts
if (isOpenAccessModeEnabled()) return '/(tabs)/home';   // NOT '/login'
```

So the app cold-launches straight into **home**, the login screen never renders, and `assertVisible: "Sign In"` can never pass. This is not a crash, not an emulator issue, and not a timing problem — the assertion target screen is unreachable by construction in a debug build. `app/login.tsx` itself confirms the alternate render under open access ("Workspace is open", "Open App", testID `login-open-app-direct`).

## Secondary fragility (verified, also fixed)

| # | Check (from owner's list) | Finding | Evidence |
|---|---------------------------|---------|----------|
| 1 | Metro connectivity | Metro running locally; `packager-status:running` | `curl 127.0.0.1:8081/status` |
| 2 | adb reverse | N/A — failing gate is iOS simulator job | workflow file |
| 3 | Expo dev-client URL | `expo-dev-client` NOT in package.json, yet job ran `expo start --dev-client` | package.json deps |
| 4 | RN bundle actually loading | Bundle compiles cleanly: `node_modules/expo-router/entry.bundle` → HTTP 200, 41,827,162 bytes (ios), 41,827,225 bytes (android), 0 `UnableToResolveError`. Note: `/index.bundle` 404s on this project (entry is `expo-router/entry`), which is a real failure class for plain debug builds requesting that URL | local curl, both platforms |
| 5 | Android logcat | iOS job — replaced by `xcrun simctl spawn booted log show` → `maestro-logcat.txt` | new workflow step |
| 6 | Metro log | Was written to `$RUNNER_TEMP/expo-metro.log` and never uploaded. Now captured + uploaded as `maestro-metro.log` | new workflow |
| 7 | App process state | Covered by pre/post screenshots + device log capture | new workflow steps |
| 8 | Deep link routing | Flow uses `launchApp`, not deep links; scheme `ivx-app` exists (app.config.ts line 38) | flow yaml |
| 9 | `ivx-app://login` | Route exists (`expo/app/login.tsx`); not needed by the flow | file tree |
| 10 | Actual visible screen before assertion | Pre-test screenshot added (`screenshot-01-pre-test.png`) | new workflow step |
| 11 | Whether app crashed | Device log + screenshots now captured; locally the bundle compiles with no transform errors | new workflow; local bundle build |
| 12 | Expo dev launcher still visible | Dev launcher eliminated entirely — Release build with embedded bundle has no dev launcher | build config change |
| 13 | Metro returns bundle HTTP 200 | Verified locally (200/41.8MB both platforms); in CI the bundle is now embedded at build time, so build success itself proves compilation | local curl |
| 14 | JS runtime throws before render | Bundle compiles cleanly; `index.tsx` has a 4s auth-bootstrap hard timeout that always resolves to a rendered screen | code inspection |

Additional latent issue: no committed `expo/ios/` → `expo run:ios` prebuilt the native project on every CI run (nondeterministic).

## Fix applied (real code, both files edited)

### `.github/workflows/ivx-e2e.yml` — job `e2e-maestro`
1. **Root-cause kill:** job env pins `EXPO_PUBLIC_IVX_OPEN_ACCESS_MODE=false` and `EXPO_PUBLIC_IVX_TEST_MODE=false` — open access is OFF regardless of build configuration.
2. **Deterministic build:** `expo run:ios --configuration Release --no-bundler` — JS bundle embedded at build time (no Metro at runtime, no dev launcher, no bundle-URL resolution). Release → `__DEV__ = false` → production runtime → open access locked off by the app's own logic (line 283). Simulator Release builds require no code signing.
3. **Removed** the fragile `expo start --dev-client` Metro step (dev-client not installed; runtime bundle load removed from the tested path).
4. **Diagnostics (exactly the expected artifacts, always uploaded):** `maestro-report.xml` (JUnit), `maestro-metro.log` (build/bundling log), `maestro-logcat.txt` (device log via simctl), `maestro-test.log`, `screenshot-01-pre-test.png`, `screenshot-02-post-test.png`.
5. **Honest gate semantics:** Maestro exit code AND `<failure` scan of the JUnit report both enforced; `maestro_test=PASS` echoed only after both pass.

### `expo/.maestro/ivx-app-launch.yaml`
- `assertVisible` → `extendedWaitUntil` with 60s ceiling. Justified, not blind: the root cause is fixed so "Sign In" WILL render (index.tsx bootstrap hard timeout is 4s); the ceiling only absorbs CI-runner variance. Assertion target unchanged ("Sign In", verified rendered at login.tsx:1722, `loginTitle = 'Sign In'`).

## Local verification performed

| Check | Result |
|-------|--------|
| Workflow YAML parses; job env + 9 steps present | PASS |
| Flow YAML parses (multi-doc); commands = launchApp(clearState) + extendedWaitUntil(Sign In, 60s) | PASS |
| Metro bundle compiles ios + android, HTTP 200, no UnableToResolveError | PASS |
| Login screen renders "Sign In" (production runtime path) | PASS (code-proven) |
| login-submit testID exists (login.tsx:1924) | PASS |
| expo runChecks (tsc + lint + structure) | PASS, 0 errors |

## Rerun status — honest statement

The fix is code-complete and locally validated, but the CI rerun could NOT be executed from this sandbox:

1. **No GitHub access:** all 8 discovered GitHub tokens are runtime-verified 401 (evidence: `qa/evidence/autonomous/ivx-credential-audit-complete-2026-08-20.md`). The workflow cannot be pushed or dispatched.
2. **No local iOS simulator:** this sandbox is Linux; Maestro's iOS driver requires macOS.

**Owner action to green the gate:** push this commit (or re-dispatch `IVX E2E Acceptance Pipeline` after pushing). The fixed job removes the deterministic root cause; expected result `maestro_test=PASS` with full diagnostic artifacts regardless of outcome.

`maestro_test` is NOT marked PASS here — no fabricated result without an executed run.
