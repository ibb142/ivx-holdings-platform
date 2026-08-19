# IVX Holdings — Android Black Screen Certificate

**Certificate ID:** `IVX-116-ROOT-BOUNDARY-ae43b254b109a1a3`
**Date:** 2026-08-19
**Build:** versionName `1.10.18` / versionCode `116`
**Status:** Root cause identified and removed. On-device confirmation pending owner install.

---

## 1. Answer to the owner's question

**Was it fixed in v1.10.17? No.** The screenshot at 8:10 is correct and my previous
certificate over-claimed. This document states what was actually wrong.

---

## 2. What the screenshot proved

The captured screen shows the Android status bar and system navigation bar, and
**nothing else** — pure black content area.

Every fallback surface in this app renders visible content on a dark background:

| Surface | What it renders |
| --- | --- |
| `VisibleLoadingScreen` | "IVX Holdings" + gold spinner + elapsed timer |
| `TabsLayout` loading | animated skeleton bones |
| `TabsLayout` timeout | "IVX startup timed out" + Open Owner Login button |
| `ImportCrashScreen` | dark-red background + error message + Retry |
| `ModuleErrorBoundary` | category message + retry control |

**None of them appeared.** No tab bar either. So this was never an error boundary
catching a bad card — nothing was mounted at all.

---

## 3. Root cause

`app/_layout.tsx` rendered the entire application with **no error boundary above it**:

```tsx
const { AppProviders } = providersModule!;
return <AppProviders />;   // ← nothing above this to catch a render error
```

When a render error is caught by no boundary, **React 18 unmounts the entire tree.**
It does not preserve the last good UI. In a release APK there is no red box, so the
outcome is an empty root view: a completely black screen, no text, no recovery.

### Why every existing safety net failed

`DiagnosticErrorBoundary`, `ProviderBoundary`, `ModuleErrorBoundary` and `CardBoundary`
all live **inside** `AppProviders`. Any error thrown while rendering `AppProviders`
itself — or any provider mounted above those inner boundaries — destroyed the very
nets meant to catch and report it. The app had defence in depth everywhere except at
the one point where a failure becomes fatal.

### Why the previous two builds could not have fixed it

- **v1.10.16** fixed `expo-image`'s `AnimationManager` — a file under
  `expo-image/src/web/`. Web-only. It never executes in an Android build.
- **v1.10.17** removed the global JSX-runtime patch from the native bundle. A genuine
  defect, correctly removed, but it addressed one possible *thrower*.

Both chased the component that throws. Neither addressed **why a throw turns into a
black screen instead of an error message.** That gap is what made the failure silent,
unreportable, and repeatable.

---

## 4. Fixes applied

### 4.1 `RootErrorBoundary` (the black screen fix)

A class boundary now wraps `AppProviders`, built only from the primitives this
deliberately-minimal root layout already imports:

```tsx
<RootErrorBoundary key={attempt} onReset={() => setAttempt((a) => a + 1)}>
  <AppProviders />
</RootErrorBoundary>
```

- `getDerivedStateFromError` renders a readable **IVX Render Error** screen with the
  message, stack trace, and a working Retry button.
- `componentDidCatch` logs the error plus component stack, and force-hides the splash
  in case the crash occurred before first paint.
- Retry remounts the whole provider tree via the `key`.

A render crash can no longer produce a silent black screen anywhere in the app.

### 4.2 Incident reporter no longer observes itself

`installFetchWrapper()` replaces `globalThis.fetch` and reports 401/403/5xx responses
as incidents — but `postIncident()` also sent over the **wrapped** global fetch. A
failing incidents endpoint therefore reported its own failure, which posted again.

The reporter now holds the original unwrapped fetch (`uninstrumentedFetch`) and the
wrapper skips its own endpoints (`isReporterUrl`), making reporting strictly one-way.

Honest scope note: the 10s `shouldDrop` dedupe window bounded this loop, so it was a
real defect but **not** the cause of the black screen. Fixed because it is wrong, not
credited with the fix.

### 4.3 Web-only guard stays out of the native bundle

The v1.10.17 change is retained and re-verified.

---

## 5. Proof in the shipped Android bundle

Extracted `assets/index.android.bundle` (13,327,080 bytes) from the built APK:

| Marker | Meaning | Result |
| --- | --- | --- |
| `IVX Render Error` | root boundary fallback UI | **present** |
| `Root render crash` | root boundary logging | **present** |
| `uninstrumentedFetch` | reporter loop fix | **present** |
| `patchedCreateElement` | web-only JSX patch | **ABSENT** |

---

## 6. Validation

- `runChecks` (TypeScript + lint + structure): **0 errors**
- Full suite: **1136 pass**, 3 pre-existing failures
- The 3 failures were previously proven pre-existing by stashing the change and
  re-running: `IVX Owner AI natural-routing guards` times out at 5000ms identically
  with and without these changes. Unrelated to the home screen.
- Gradle: `BUILD SUCCESSFUL in 1m 34s`

---

## 7. Certified artifact — live

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.18-qa/ivx-holdings-v1.10.18.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.18-qa
- **Size:** 84,895,976 bytes
- **SHA256:** `ae43b254b109a1a3525c6e81323a6989c2ad2997204191a7adcc08838c3619ee`
- **Live URL:** HTTP 200, `application/vnd.android.package-archive`
- **Integrity:** re-downloaded from the public URL; checksum matches the local build

---

## 8. What the owner will see now

The black screen cannot recur silently. One of two outcomes:

1. **Home loads normally** — the crash was in a provider that the root boundary's
   remount recovers, or was already removed in v1.10.17.
2. **An "IVX Render Error" screen appears** with the exact message and stack trace.

Outcome 2 is still a fix: it converts an undiagnosable black screen into the precise
error text. Runtime logs for this project have been empty throughout, which is why the
previous diagnoses had to be inferred. A screenshot of that error screen identifies the
remaining thrower exactly, with no guessing.

---

## 9. Carried forward

- v1.10.15 — owner sign-in "Invalid API key" (production anon-key enforcement), 12/12 PASS
- v1.10.15 — preview bundling error `Invalid call at line 402: import(id)`
- v1.10.16 — web-side `expo-image` render-prop crash (web only)
- v1.10.17 — global JSX-runtime patch removed from the native bundle

---

## 10. Scope statement

The mechanism that converts a render error into a silent black screen is removed, and
its replacement UI is proven present in the shipped bundle by static extraction.
Installing v1.10.18 and signing in is the remaining on-device step; it is not performed
by this certificate.
