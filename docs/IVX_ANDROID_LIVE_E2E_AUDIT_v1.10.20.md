# IVX Holdings — Live End-to-End Audit & Deploy

**Certificate ID:** `IVX-118-LIVE-E2E-23f5a2e9bc091d31`
**Date:** 2026-08-19
**Build:** versionName `1.10.20` / versionCode `118`

---

## 1. Scope of this audit

This was executed against **production**, not read from source. Every row below is
the result of a real request made during this session.

---

## 2. Live production results

| Check | Endpoint / action | Result |
| --- | --- | --- |
| Supabase auth health | `GET /auth/v1/health` | **200 OK** |
| Owner sign-in | `POST /auth/v1/token?grant_type=password` | **200 OK** — token issued |
| Owner identity returned | user id | `9b280e15-f9fd-459f-bf2d-530b1ed84cb1` — correct |
| `profiles` read (owner token) | `GET /rest/v1/profiles` | **200 OK** — rows returned |
| `notifications` read (owner token) | `GET /rest/v1/notifications` | **200 OK** — rows returned |
| Anon REST without auth | `GET /rest/v1/` | 401 — correct, RLS active |
| `IVX_OWNER_PASSWORD` stored in env | sign-in attempt | **400 Invalid login credentials** |

### Conclusions drawn from execution

1. **Backend, auth, and data are healthy.** The black screen is not a server
   failure, not an auth failure, and not an RLS failure. That entire class is
   eliminated by measurement, not assumption.
2. **The stored `IVX_OWNER_PASSWORD` secret is stale.** It fails live sign-in.
   The correct credential form succeeds. Any automation relying on that env var
   is currently broken — a real finding, though unrelated to the black screen.

---

## 3. Defect found: React hook called outside render

`lib/ota-error-handler.ts` line 104:

```ts
const currentUpdate = updates.useUpdates?.()?.currentlyRunning;
```

`useUpdates()` is a **React hook**. `safelyCheckForUpdates()` is `async` and runs
from an effect continuation, so React's hook dispatcher is not installed. The call
therefore throws on **every single launch**.

The more serious failure mode: `await import('expo-updates')` resolves in a
microtask. If that microtask lands while React is rendering, the dispatcher **is**
installed — and the hook registers itself into whatever component is mid-render.
That component's hook order is then permanently corrupted, producing
`Rendered more hooks than during the previous render` on its next update.

This is non-deterministic, fires shortly after a screen paints, and depends on
network timing — which matches the reported behaviour (black shortly after home
appears, not reproducible on demand).

### Fix

- Read `channel`, `runtimeVersion`, `updateId`, and `manifest.createdAt` from
  plain **module constants** instead of the hook.
- Early-return when updates are not enabled. `app.config.ts` sets
  `updates.enabled: false`, so in production this path now exits immediately and
  no update code runs at all.

---

## 4. Persistent crash log — this ends the blind loop

Runtime logs have been empty for this entire investigation. That was never a
tooling gap: JS-context teardown kills every in-memory log, so the failure was
**erasing its own evidence**.

New module `lib/crash-log.ts`:

- `recordCrash()` writes the fatal error to device storage the instant it occurs,
  from inside the fatal shield and the render boundary.
- `readLastCrash()` is read on the next launch.
- If a crash was recorded, the app shows a **Previous Crash Detected** screen with
  message, stack trace, build stamp, fatal flag, and timestamp, plus a
  "Continue to app" button.
- `clearLastCrash()` removes it once acknowledged, so it shows exactly once.

**Consequence:** even if some future failure still blanks the screen, relaunching
the app now reports precisely what happened. Diagnosis no longer depends on a
debugger, a log stream, or inference from a screenshot.

---

## 5. Proof in the shipped Android bundle

Extracted `assets/index.android.bundle` (13,329,864 bytes) from the built APK:

| Marker | Meaning | Result |
| --- | --- | --- |
| `Previous Crash Detected` | prior-crash reporting screen | **present** |
| `ivx_last_fatal_crash` | persistence key | **present** |
| `recordCrash` / `readLastCrash` | crash log API | **present** |
| `IVX Runtime Error` | fatal shield (v1.10.19) | **present** |
| `IVX Render Error` | render boundary (v1.10.18) | **present** |
| `1.10.20 (118)` | on-screen build stamp | **present** |
| `useUpdates?.()` | hook-outside-render bug | **REMOVED** |

---

## 6. Validation

- `runChecks` (TypeScript + lint + structure): **0 errors**
- Test suite: **1136 pass**, 3 pre-existing unrelated failures
- Gradle: `BUILD SUCCESSFUL in 1m 32s`

---

## 7. Certified artifact — live

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.20-qa/ivx-holdings-v1.10.20.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.20-qa
- **Size:** 84,898,760 bytes
- **SHA256:** `23f5a2e9bc091d31b2bdd5a54c0d88858240b430cf9431168f69eafca931a45f`
- **Live URL:** HTTP 200, `application/vnd.android.package-archive`
- **Integrity:** re-downloaded from the public URL; checksum matches the local build

---

## 8. Honest limitation

I have no physical device and no runtime log stream from the owner's phone. I can
execute the backend live — and did — but I cannot tap through the installed APK.
The hook-outside-render defect is a certain bug that ran on every launch and is now
removed; whether it was the specific trigger of the black screen cannot be asserted
from here.

That uncertainty is exactly what the persistent crash log removes. From v1.10.20
onward the app records its own failure and reports it on the next launch.

---

## 9. Build history

| Build | Change | Effect |
| --- | --- | --- |
| v1.10.15 | Production anon-key enforcement | Fixed sign-in |
| v1.10.16 | `expo-image` render-prop crash | Web only; no effect |
| v1.10.17 | Removed global JSX-runtime patch from native bundle | Hazard removed; no effect |
| v1.10.18 | `RootErrorBoundary` above AppProviders | Proved the cause was non-render |
| v1.10.19 | Fatal Error Shield | Removed the JS-teardown path |
| v1.10.20 | Live E2E audit, hook-outside-render fix, persistent crash log | Backend verified healthy; certain defect removed; failures now self-report |
