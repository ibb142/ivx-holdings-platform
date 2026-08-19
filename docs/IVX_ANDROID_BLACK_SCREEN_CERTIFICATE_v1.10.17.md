# IVX Holdings — Android Home Black Screen Certificate

**Certificate ID:** `IVX-115-ANDROID-BLACKSCREEN-c757e3d4f33b8b49`
**Date:** 2026-08-19
**Build:** versionName `1.10.17` / versionCode `115`
**Result:** FIXED — proven removed from the shipped Android bundle

---

## 1. Why the previous build did not fix it

v1.10.16 fixed a real crash, but **on the wrong platform.**

The crash I diagnosed was:

```
TypeError: renderFunction[1] is not a function
    at AnimationManager
```

`AnimationManager` lives in `expo-image/src/**web**/AnimationManager.tsx`. It is a
web-only module. The runtime log I read came from the web preview bundle
(`main.bundle?platform=web`).

The owner's recording is an **Android APK**. On Android, `expo-image` resolves to
`ExpoImage.tsx` (the native module) and `AnimationManager` never executes. That fix
could not possibly have changed the Android behaviour.

This is stated plainly because the earlier certificate implied broader coverage than
the evidence supported.

---

## 2. Actual Android root cause

`lib/text-node-guard.ts` installs a **global React runtime patch** on every platform:

- rewrites `react/jsx-runtime` (`jsx`, `jsxs`)
- rewrites `react/jsx-dev-runtime` (`jsxDEV`)
- replaces `React.createElement`

Every patched call routes the element's children through `React.Children.map`.

`React.Children.map` cannot round-trip anything that is not a valid React node:

- **function children are silently dropped** — the map callback is never invoked
- **variadic children get collapsed** into a single array argument

So any component in the tree that passes children as a render-prop, a tuple, or a
function had its children structurally corrupted before render. When such a component
then called its child, it threw mid-render and the screen went black.

### Why this had zero upside on Android

The only thing this guard suppresses is react-native-web's console.error:

```
Unexpected text node: ... A text node cannot be a child of a <View>
```

emitted from `react-native-web/dist/exports/View/index.js`.

**react-native-web does not exist in a native build.** On Android the guard silenced
nothing and rewrote the React runtime for every element the app renders. That is an
app-wide crash risk traded for a cosmetic, web-only console message.

### Why the screen painted first, then went black

`AppProviders` installs the guard on a **3-second deferred timer**. The app renders
normally until that timer fires; from then on every newly rendered element passes
through the corrupting patch. This matches the recording exactly: home renders fully
at ~49.5s, goes black at ~50.0s, never recovers.

---

## 3. Fix applied

`installTextNodeGuard()` is now **web-only** — an explicit no-op on iOS and Android.

```ts
if (Platform.OS !== 'web') {
  installed = true;
  return;
}
```

Web keeps the guard (with the render-prop protection added in v1.10.16). Native never
patches the React runtime at all.

---

## 4. Proof the patch is gone from the shipped Android APK

Extracted `assets/index.android.bundle` from the built APK:

| Check | Result |
| --- | --- |
| `installTextNodeGuard` present | yes (the no-op entry point) |
| **`patchedCreateElement` present** | **ABSENT** |
| Bundle size | 13,326,068 bytes |

`patchedCreateElement` is the function that replaced `React.createElement`. Because
`Platform.OS` is statically known on Android, **Metro dead-code-eliminated the entire
patch out of the bundle**. It is not merely skipped at runtime — the code is physically
not in the shipped app.

This is the decisive evidence: the mechanism that caused the black screen cannot
execute on Android because it no longer exists there.

---

## 5. Regression lock

`__tests__/text-node-guard-render-props.test.ts` — **10/10 PASS**, including two new
native-specific tests:

| Test | Verifies |
| --- | --- |
| `installTextNodeGuard` leaves the React runtime untouched on native | `React.createElement` identity is unchanged after install |
| A render-prop tuple survives `createElement` on native | `children[0]` and `children[1]` both intact, function still callable |

Plus the 8 existing render-prop and stray-text tests.

---

## 6. Validation

- `runChecks` (TypeScript + lint + structure): **0 errors**
- Full suite: **1136 pass**, 3 pre-existing failures
- The 3 failures were previously proven pre-existing by stashing the change and
  re-running: the `IVX Owner AI natural-routing guards` test times out at 5000ms
  identically with and without this fix. Unrelated to the home screen.

---

## 7. Certified artifact — deployed live

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.17-qa/ivx-holdings-v1.10.17.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.17-qa
- **Size:** 84,894,964 bytes
- **SHA256:** `c757e3d4f33b8b493d9e6b09aceffd66e1d0f8edef9942a6dd9f1ffab17a181e`
- **Live URL check:** HTTP 200, `application/vnd.android.package-archive`
- **Download integrity:** re-downloaded from the public URL; checksum matches the
  locally built artifact exactly

Build log: `BUILD SUCCESSFUL in 1m 32s`.

---

## 8. Carried forward

- v1.10.15 — owner sign-in "Invalid API key" (production anon-key enforcement), 12/12 PASS
- v1.10.15 — preview bundling error `Invalid call at line 402: import(id)`
- v1.10.16 — web-side expo-image render-prop crash

---

## 9. Scope statement

The defect mechanism is removed from the Android artifact by static proof (the patch
function is absent from the shipped bundle), and the corrected behaviour is locked by
unit tests. On-device confirmation requires installing v1.10.17 and signing in; that
physical-device step is not performed by this certificate.
