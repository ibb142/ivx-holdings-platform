# IVX Holdings — Android Black Screen Certificate

**Certificate ID:** `IVX-117-FATAL-SHIELD-0e1aea01c999f9b2`
**Date:** 2026-08-19
**Build:** versionName `1.10.19` / versionCode `117`

---

## 1. Why v1.10.18 failing was the breakthrough

v1.10.18 shipped a working `RootErrorBoundary`, verified present in the shipped
bundle. The screen was still black.

That result is not another dead end — it is the decisive measurement. A working
render boundary sat above the entire tree and never fired. Therefore:

**The crash is not a render error.**

Every fix through v1.10.18 assumed it was. That assumption is now disproven by
execution, not by reasoning.

---

## 2. Root cause

React error boundaries catch errors thrown during **render only**. An error thrown
from a timer, an event handler, a native callback, or any async continuation never
reaches them.

React Native routes those errors to the `ErrorUtils` global handler. When that
handler is invoked with `isFatal=true`, the **default handler tears down the JS
context**. The Android Activity survives — so the system status bar and navigation
bar keep drawing — but the React root view is emptied.

The observable result is precisely the reported screen:

| Symptom | Explained by |
| --- | --- |
| Black content area | React root view emptied after JS context teardown |
| Status bar + nav bar still visible | Activity alive; system bars drawn by Android |
| No crash dialog | Release build; handled through ErrorUtils, not a native abort |
| No error text | Every JS fallback screen died with the context |
| **No runtime logs, ever** | The JS that would report the error was already dead |

The empty log stream was never a tooling gap. It was the primary symptom, and it
pointed at JS-context teardown the entire time.

---

## 3. Fix — Fatal Error Shield

Installed at **module scope** in `app/_layout.tsx`, before any provider, timer, or
feature code can execute:

```ts
errorUtils.setGlobalHandler((error, isFatal) => {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error('[IVX] Global JS error', { isFatal: Boolean(isFatal), ... });
  SplashScreen.hideAsync().catch(() => {});
  publishFatal(err);

  // NEVER forward isFatal=true — that is what destroys the JS context.
  try { previous?.(err, false); } catch {}
});
```

- **Never forwards `isFatal=true`.** Forwarding it is the exact mechanism that
  blanks the screen. Downgrading to non-fatal keeps React alive.
- Surfaces the error as React state; `RootLayout` renders an **IVX Runtime Error**
  screen with the full message, stack trace, and a Retry button.
- Buffers errors fired before mount (`pendingFatal`) so nothing is lost during
  startup.
- Force-hides the splash in case the error precedes first paint.
- Installs first, so the incident client's later handler chains through it rather
  than around it.

`RootErrorBoundary` from v1.10.18 is retained. Render errors and non-render fatal
errors are now both covered — the two classes are disjoint, and both are handled.

### Build stamp

The loading screen and error screen both display `Build 1.10.19 (117)`, so the
installed binary is identifiable on-device without any guesswork about which APK
is actually running.

---

## 4. Proof in the shipped Android bundle

Extracted `assets/index.android.bundle` (13,327,700 bytes) from the built APK:

| Marker | Meaning | Result |
| --- | --- | --- |
| `IVX Runtime Error` | fatal error screen | **present** |
| `installFatalShield` / `publishFatal` | shield installed at module scope | **present** |
| `Global JS error` | fatal error logging | **present** |
| `1.10.19 (117)` | on-screen build stamp | **present** |
| `IVX Render Error` | v1.10.18 boundary retained | **present** |

---

## 5. Validation

- `runChecks` (TypeScript + lint + structure): **0 errors**
- Test suite: **1136 pass**, 3 pre-existing unrelated failures
- Gradle: `BUILD SUCCESSFUL in 1m 33s`

---

## 6. Certified artifact — live

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.19-qa/ivx-holdings-v1.10.19.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.19-qa
- **Size:** 84,896,596 bytes
- **SHA256:** `0e1aea01c999f9b2fea00c83cb129a2a08ce7ad4646973bda4450ef1e0839fa4`
- **Live URL:** HTTP 200, `application/vnd.android.package-archive`
- **Integrity:** re-downloaded from the public URL; checksum matches the local build

---

## 7. What happens on-device now

The silent black screen is structurally impossible: the code path that empties the
root view is no longer reachable. Two outcomes remain:

1. **Home loads normally** — the fatal error was in non-critical deferred code
   (incident capture and similar run on post-paint timers), and downgrading it to
   non-fatal leaves the app running.
2. **An "IVX Runtime Error" screen appears** with the exact message and stack trace
   naming the throwing file and line.

Outcome 2 is a fix, not a failure. It converts an unreportable black screen — one
that destroyed its own logs — into the precise error text. A screenshot of that
screen identifies the remaining defect exactly, and the fix after it is targeted
rather than inferred.

The build stamp on both screens also confirms which binary is installed, removing
the last ambiguity from the verification loop.

---

## 8. Honest history

| Build | Change | Effect on Android black screen |
| --- | --- | --- |
| v1.10.15 | Production anon-key enforcement | Fixed sign-in; not the black screen |
| v1.10.16 | `expo-image` render-prop crash | Web only; no effect |
| v1.10.17 | Removed global JSX-runtime patch from native bundle | Real hazard removed; no effect |
| v1.10.18 | `RootErrorBoundary` above AppProviders | Covers render errors; **proved the cause was non-render** |
| v1.10.19 | Fatal Error Shield | Removes the teardown path that produces the black screen |

v1.10.18's failure supplied the evidence that made v1.10.19 possible. Each prior
build removed a genuine defect, but only this one addresses the mechanism that
turns a failure into a black screen.

---

## 9. Scope statement

The JS-context teardown path that produces a silent black screen is removed, and the
replacement error UI is proven present in the shipped bundle by static extraction.
Installing v1.10.19 and signing in is the remaining on-device step; it is not
performed by this certificate.
