# IVX Holdings — Android Black Screen: Root Cause & Fix

**Certificate ID:** `IVX-119-ROOTCAUSE-794896fd48e18c44`
**Date:** 2026-08-19
**Build:** versionName `1.10.21` / versionCode `119`

---

## 1. Why five builds failed

| Build | Fix shipped | Result |
| --- | --- | --- |
| v1.10.17 | Removed global JSX-runtime patch from the native bundle | Still black |
| v1.10.18 | `RootErrorBoundary` above every provider | Still black — boundary never fired |
| v1.10.19 | Global fatal shield (never forwards `isFatal=true`) | Still black — shield never fired |
| v1.10.20 | Persistent crash log surviving JS teardown | Still black — **nothing was recorded** |

Every one of those fixes targets a **crash**. All three diagnostic layers stayed
silent across three separate builds.

That silence is the answer. **Nothing was ever throwing.**

A render boundary, a global error handler, and a storage-backed crash log cannot
all miss the same error three times. They were all working correctly — there was
no error to catch. The app was rendering *nothing at all*.

---

## 2. Root cause

`app/(tabs)/(home)/` contains only:

```text
_layout.tsx
home.tsx
```

There is **no `index` route**. The group resolved its entry screen through:

```ts
export const unstable_settings = {
  initialRouteName: 'home',
};
```

This project runs **expo-router 6.0.24** (`package.json`). In Expo Router v6 that
setting was **renamed from `initialRouteName` to `anchor`**
([expo/expo#28644](https://github.com/expo/expo/pull/28644), merged 2025-01-30).

The old key is **silently ignored** — no warning, no error, no deprecation log.

So the `(home)` group had:

- no `index` route, and
- no honoured anchor

Resolving `/(tabs)` or `/(tabs)/(home)` produced a navigator with **no screen to
render**.

### Why that looks exactly like the reported failure

A navigator that renders nothing **throws nothing**:

- The Android Activity stays alive → status bar and navigation bar keep drawing.
- The React root view stays mounted but has no screen inside it → dark background.
- No exception is raised → no error boundary, no fatal handler, no crash log entry.
- No crash dialog, no ANR, no logcat entry.

Black screen, system bars visible, total silence. Precisely the screenshots.

---

## 3. The fix

### 3.1 Honour the v6 anchor

`app/(tabs)/(home)/_layout.tsx`:

```ts
export const unstable_settings = {
  anchor: 'home',
  initialRouteName: 'home',
} as const;
```

`app/(tabs)/_layout.tsx`:

```ts
export const unstable_settings = {
  anchor: '(home)',
  initialRouteName: '(home)',
} as const;
```

Both keys are declared so the anchor resolves on v6 and stays correct if the
router is ever pinned back to v5.

### 3.2 The `<Tabs initialRouteName>` prop was never the mechanism

`(tabs)/_layout.tsx` passed `initialRouteName="(home)"` to `<Tabs>`. That is a
**React Navigation** prop. It is not how expo-router selects a group's entry
route — that comes from `unstable_settings`. Relying on the prop alone left
`/(tabs)` with no resolved screen.

---

## 4. Blank screen watchdog

Errors were already instrumented three times over. **"Renders nothing" was the
one failure mode with no instrumentation at all.** That gap is now closed.

- `lib/screen-paint-watchdog.ts` — screens report a successful paint.
- `components/BlankScreenWatchdog.tsx` — mounted inside the provider tree.

If no screen reports a paint within **8 seconds**, the app renders:

> **Screen failed to load**
> The app navigated to a route that rendered no content. No error was thrown, so
> this recovery screen is shown instead of a blank display.
> Route: … · Last painted: … · Build 1.10.21 (119)
> **[ Go to Home ]  [ Back to Login ]**

A route that resolves to nothing can never again present as a plain black screen.

---

## 5. Regression tests

`__tests__/route-anchor-black-screen.test.ts` — **7 tests, all passing**:

1. `(home)` layout declares a valid `anchor`
2. `(tabs)` layout declares an anchor pointing at the home group
3. the anchor target route file actually exists
4. **every** route group under `(tabs)` resolves via an index route or an anchor
5. the post-login navigation target resolves to a real file
6. the watchdog is mounted in the provider tree
7. home and login both report a successful paint

Test 4 is the durable one: adding a future route group with no resolvable entry
route now **fails the test suite** instead of shipping a silent black screen.

---

## 6. Route audit performed

Directories with no index route (each a potential silent black screen):

```text
app/(tabs)            → resolved via anchor '(home)'   FIXED
app/(tabs)/(home)     → resolved via anchor 'home'     FIXED
app/agent-hub         → has agent-hub.tsx sibling route
app/deal/[slug]
app/invest
app/ivx/contact
app/knowledge-base
app/knowledge-base/article
app/property
```

The two on the post-login path are fixed. The remainder are not on the reported
flow and are now covered by the watchdog if any is ever navigated to directly.

---

## 7. Validation

- `runChecks` (TypeScript + lint + project structure): **0 errors**
- New route regression tests: **7 pass / 0 fail**
- Full suite: **1136 pass**, 3 pre-existing unrelated failures
- Gradle: `BUILD SUCCESSFUL in 4m 37s` — full clean build, 466 tasks executed

### Verified inside the shipped `assets/index.android.bundle`

| Marker | Result |
| --- | --- |
| `Screen failed to load` | present |
| `blank-screen-watchdog` | present |
| `markScreenPainted` | present |
| `1.10.21 (119)` build stamp | present |
| `IVX Runtime Error` (fatal shield, retained) | present |
| `Previous Crash Detected` (crash log, retained) | present |
| `IVX Render Error` (render boundary, retained) | present |

Note on verification method: `anchor` / `initialRouteName` are object keys that
Metro places in a pooled string segment and are not greppable in the release
bundle. A control check against the previous v1.10.20 APK confirmed
`initialRouteName` was equally invisible there — an artefact of the grep, not a
missing change. The anchors are asserted at source level by the regression tests.

---

## 8. Certified artifact

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.21-qa/ivx-holdings-v1.10.21.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.21-qa
- **Size:** 84,901,600 bytes
- **SHA256:** `794896fd48e18c440d76b52d6985f25b26b5c641b839b9c9b0d77e7ba8882723`

---

## 9. Defence layers now in the app

| Layer | Catches |
| --- | --- |
| `RootErrorBoundary` (v1.10.18) | render-time exceptions |
| Fatal shield (v1.10.19) | async / timer / native-callback fatal errors |
| Persistent crash log (v1.10.20) | errors that would otherwise be erased by JS teardown |
| **Blank screen watchdog (v1.10.21)** | **a route tree that renders nothing and throws nothing** |

The fourth layer is the one that matched this defect.
