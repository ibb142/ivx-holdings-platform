# IVX Holdings — Home Black Screen QA Certificate

**Certificate ID:** `IVX-114-HOME-BLACKSCREEN-fdcaca7c0453debb`
**Date:** 2026-08-19
**Build:** versionName `1.10.16` / versionCode `114`
**Result:** FIXED — root cause identified, corrected, regression-locked, deployed

---

## 1. Reported defect

After a successful owner sign-in, the home screen appeared for roughly half a second
and then went completely black and never recovered.

---

## 2. Video evidence (owner screen recording, 59.6s)

Frames extracted at 1fps and 4fps from the supplied recording:

| Timestamp | Observation |
| --- | --- |
| ~02s | Sign In screen, empty form |
| ~12s | Email being entered |
| ~25s | Password field populated (21-character credential — correct form) |
| ~40s | "Remember Me" checked, Sign In pressed, button shows spinner |
| ~49.5s | **Home screen renders fully** — Buy Property Shares, JV Partnerships, Smart Investing, Investor Dashboard tiles all visible and correctly styled |
| ~50.0s | **Screen goes fully black** |
| 50.0s → 59.6s | Remains black through end of recording |

Critical deduction: the home screen **rendered successfully first**. This was never a
navigation, routing, or data-loading failure — it was a crash occurring immediately
after first paint.

---

## 3. Runtime log evidence

`rork-agent logs runtime --errors` returned exactly **one** distinct error signature,
repeated 24 times:

```
TypeError: renderFunction[1] is not a function
    at wrapNodeWithCallbacks (...)
    at Array.map (<anonymous>)
    at AnimationManager (...)
The above error occurred in the <AnimationManager> component.
React will try to recreate this component tree from scratch using
the error boundary you provided, CardBoundary.
```

`AnimationManager` belongs to `expo-image` (3.0.11). `CardBoundary` is the per-card
boundary in `components/InvestorFirstFeed.tsx` — the home feed.

---

## 4. Root cause

This was **app code, not a library bug.**

`lib/text-node-guard.ts` patches the JSX runtime to stop react-native-web logging
"Unexpected text node". For every component that is not a text host, it ran
`React.Children.map` over that component's children to wrap stray strings in `<Text>`.

`expo-image` does not pass renderable nodes as children. It passes a **render-prop
tuple**:

```ts
children = [animationKey: string, renderFunction: (cb) => (className, style) => Element]
```

`AnimationManager` later reads `children[1]` and calls it.

`React.Children.map` cannot round-trip that shape:

1. Element `[0]` is a string → the guard wrapped it in `<Text>`.
2. Element `[1]` is a **function** → not a valid React child, so React never invokes
   the map callback for it and **silently drops it**.

The tuple came back as `[<Text>, undefined]`. Because the wrapped `<Text>` element
became both `children[0]` and the derived `node.animationKey`, expo-image's identity
check `renderFunction[0] === node.animationKey` passed, and it then called
`children[1]` — which was now `undefined`.

Every image on the home feed threw simultaneously, taking the screen down to black.

### Why the screen rendered first, then died

`AppProviders` installs the guard on a **3-second deferred timer** after launch. By the
time the owner signed in at ~50s the patch was long since active, so the home screen
painted once and crashed as soon as its image cards mounted — matching the recording
frame-for-frame.

---

## 5. Fix applied

`lib/text-node-guard.ts` — added `containsFunctionChild()`. `sanitizeChildren()` now
returns children untouched, by reference, whenever a function is present at the top
level (or one level nested).

This is correct by construction: a raw string inside a render-prop tuple is never
rendered as a text node, so there is nothing for the guard to protect against there.
Genuine stray-text sanitizing is fully preserved for all other children.

---

## 6. Regression lock

New suite `__tests__/text-node-guard-render-props.test.ts` — **8/8 PASS**:

| Test | Verifies |
| --- | --- |
| Detects the expo-image `[key, renderFunction]` tuple | Detection logic |
| Leaves the tuple completely untouched | Same object reference returned |
| The exact expo-image access pattern still works | `children[0]` matches, `children[1]()` callable |
| A bare function child is preserved | No dropping |
| Still wraps genuine stray text children | No loss of original protection |
| Still drops whitespace-only children | No loss of original protection |
| Non-function children arrays still sanitized | Guard not disabled wholesale |
| AnimationManager-like types still sanitize candidates | Type-level guard intact |

`test-preload.ts` gained `Text` / `TextInput` / `View` in the shared react-native mock
so guard modules load under the test runner.

---

## 7. Validation

- `runChecks` (TypeScript + lint + structure): **0 errors**
- Full suite: **1136 pass**, 3 pre-existing failures
- The 3 failures were proven pre-existing by stashing the fix and re-running: the
  `IVX Owner AI natural-routing guards` test times out at 5000ms identically with and
  without this change. Unrelated to the home screen.

---

## 8. Shipped-bundle verification

Extracted `assets/index.android.bundle` from the built APK:

- `containsFunctionChild` present in shipped bundle: **yes**
- Bundle size: 13,326,148 bytes

The fix is confirmed compiled into the artifact, not merely present in source.

---

## 9. Certified artifact — deployed live

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.16-qa/ivx-holdings-v1.10.16.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.16-qa
- **Size:** 84,895,044 bytes
- **SHA256:** `fdcaca7c0453debbf1dd477357cc5b1d52ac6d1d2dfbf03e2730b0b157b1d9ac`
- **Live URL check:** HTTP 200, `application/vnd.android.package-archive`
- **Download integrity:** re-downloaded from the public URL; checksum matches the
  locally built artifact exactly.

Build log: `BUILD SUCCESSFUL in 44s`.

---

## 10. Carried forward from v1.10.15

This build also contains the previously certified fixes:

- Owner sign-in "Invalid API key" (production anon-key enforcement) — 12/12 PASS
- Cross-platform preview bundling error `Invalid call at line 402: import(id)`

---

## 11. Honest scope statement

The crash was reproduced from captured runtime logs and the owner's recording, and the
corrected logic is proven by direct unit tests against the exact expo-image access
pattern. Confirmation that the home screen now stays up on the owner's physical device
requires installing v1.10.16 and signing in — that on-device step has not been
performed by this certificate.
