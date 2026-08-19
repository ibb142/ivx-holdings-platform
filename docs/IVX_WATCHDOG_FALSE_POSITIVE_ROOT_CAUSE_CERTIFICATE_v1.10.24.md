# IVX Holdings — The Watchdog Was the Black Screen: Forensics, Root Cause & Fix

**Certificate ID:** `IVX-122-WATCHDOG-FP-5512ddcd1462c9d5`
**Date:** 2026-08-19
**Build:** versionName `1.10.24` / versionCode `122`
**Artifact SHA256:** `5512ddcd1462c9d523d848e314f4658eb4ef21992fd7ea121633ac20defa4a79`
**Evidence:** `Screen_Recording_20260819_134647_IVX Holdings.mp4` — 20.08s, 40 frames @2fps

---

## 1. The app printed its own contradiction

Frame 5 of the recording, read directly off the device:

```text
Screen failed to load
The app navigated to a route that rendered no content.
Route:        /home
Last painted: /home        <-- the same route it is accusing
Build 1.10.23 (121)
```

The overlay accused `/home` of rendering nothing while reporting `/home` as the
last screen that painted. **Both statements cannot be true.**

Frames 1 and 9 settle it: Home content — *Buy Property Shares, JV Partnerships,
Smart Investing, Investor Dashboard, Performance Center, Featured Deals* — was
rendered and visible immediately before and after the overlay appeared.

**Home was not broken in v1.10.23. The watchdog shipped to protect Home was
covering a working Home with a false error screen.**

A false "Screen failed to load" over working UI is a worse defect than the blank
screen it guards against. It was introduced by the previous fix.

---

## 2. Frame-by-frame timeline

| frames | time | measured | state |
| --- | --- | --- | --- |
| 1-2 | 0.0-0.5s | top 4 / mid 13 / nav 34 | Home content rendered, app switcher |
| 3-7 | 1.0-3.0s | mid 8-9 | **false "Screen failed to load" overlay** |
| 8-11 | 3.5-5.0s | top 13 / mid 11 / nav 5 | Home content again, post-tap transition |
| 12-40 | 5.5-19.5s | `rgb(12,8,14)` = `#0A0A0F` | **empty container, 14 seconds** |

Sampled at frames 13, 20, 30 and 40 — all identical `rgb(12,8,14)`. That is
`Colors.background`, with no text and no content: an empty container, not the
overlay (which draws a title, three metadata lines and two buttons).

---

## 3. Defect 1 — the watchdog asked a question that cannot be answered in a tab bar

### The check that shipped in v1.10.23

```ts
export function hasRouteFailedToPaint(route: string, enteredAt: number): boolean {
  const paintedAt = getRoutePaintedAt(route);
  if (paintedAt === null) return true;
  return paintedAt < enteredAt;      // "did this route paint SINCE we entered it"
}
```

### Why that fires on healthy screens

**Fact 1 — Expo Router keeps tab screens mounted.** `app/(tabs)/home.tsx:330`:

```ts
useEffect(() => { markScreenPainted('/home'); }, []);
```

An empty dependency array fires **once per mount**. Switching tabs and returning
does not remount Home, so Home reports its paint exactly once, ever.

**Fact 2 — the watchdog re-armed on every navigation.**
`components/BlankScreenWatchdog.tsx:51`:

```ts
const enteredAt = Date.now();   // re-armed on EVERY pathname change
```

Therefore every return to an already-mounted Home compared one **old** paint
stamp against a **fresh** entry stamp. `paintedAt < enteredAt` was true, and
8 seconds later the overlay dropped over a fully rendered screen.

**React effect ordering made it structural.** Child effects run **before** parent
effects. The watchdog is mounted in the root layout; Home is a descendant. So the
screen's paint stamp is *always* `<=` the watchdog's entry stamp. **The
comparison could only ever produce false accusations — never a true one on a
screen that actually painted.**

### Fix — paint is liveness, not freshness

Screens register on paint and deregister on unmount:

```ts
useEffect(() => {
  markScreenPainted('/home');
  return () => markScreenUnmounted('/home');
}, []);
```

```ts
export function hasRouteFailedToPaint(route: string): boolean {
  if (!isRouteInstrumented(route)) return false;
  return !isRoutePainted(route);   // no timestamps — nothing left to race
}
```

The entry timestamp is gone from the module entirely (asserted by test).

**Detection is preserved, not weakened:**

- a route that renders nothing never registers → still caught
- a blank **re-entry** is still caught, because the previous visit cleared its
  record on unmount
- a mounted screen that painted is **never** accused, however long ago it painted

---

## 4. Defect 2 — recovery navigated Home onto Home, then went blank for 14 seconds

```ts
const goHome = useCallback(() => {
  dismissedRouteRef.current = pathname;    // pinned FOREVER
  router.replace('/(tabs)/home');          // while pathname was ALREADY /home
}, [router, pathname]);
```

**Two failures in four lines.**

1. Replacing the accused route with itself is a no-op navigation that leaves the
   identical view on screen. Frames 12-40 measured `#0A0A0F` for 14 seconds —
   the empty container, unchanged by the recovery button.
2. `dismissedRouteRef` was pinned to that path permanently. The effect returns
   early whenever `dismissedRouteRef.current === pathname`, and nothing ever
   cleared it. **One tap on "Go to Home" made Home unjudgeable for the rest of
   the process.**

### Fix

```ts
const alreadyHome = pathname === '/home' || pathname === '/(tabs)/home';
router.replace(alreadyHome ? ROOT_ROUTE : '/(tabs)/home');
```

Bouncing through the root re-resolves the tab tree via `app/index.tsx`, which
redirects on auth state, so the screen genuinely remounts instead of no-opping.

```ts
if (dismissedRouteRef.current !== null && dismissedRouteRef.current !== pathname) {
  dismissedRouteRef.current = null;   // left the dismissed route — re-arm
}
```

A dismissal now suppresses only the current continuous stay on that route.

---

## 5. Secondary correction — login's route key never matched

`app/login.tsx:2240` reported `markScreenPainted('login')` while the watchdog
judges `usePathname()`, which reports `/login`. Normalisation made these compare
equal by luck, not by design. Login now reports `/login` explicitly, and the
mismatch is asserted against.

---

## 6. Honest accounting of the fix sequence

| Build | What it fixed | What it introduced |
| --- | --- | --- |
| v1.10.21 | removed the colliding index route | left the anchor as the sole resolution path |
| v1.10.23 | removed the `(home)` group; made Home a leaf screen | **a watchdog that accused working screens** |
| **v1.10.24** | **watchdog false positive + dead recovery button** | — |

The v1.10.23 structural fix (Defect 1 of that build) is **correct and retained**:
`(tabs)/(home)` is still absent from the shipped bundle, verified below. What
failed was the *detector* added alongside it.

---

## 7. Permanent guards — 7 new tests

`expo/__tests__/home-route-blank-screen.test.ts` → `Defect 3` block:

1. a mounted Home that painted long ago is never flagged, however long ago
2. **the printed contradiction is unrepresentable** — a route reported as painted
   can never simultaneously be accused
3. the blank check contains no entry timestamp at all (asserted against source)
4. both screens deregister their paint on unmount
5. login reports the router pathname `/login`
6. recovery never navigates the accused route onto itself
7. a dismissal is cleared once the user leaves that route

The v1.10.23 detection tests were **kept and rewritten against liveness** — a
blank Home is still caught even though login already painted, and a blank
re-entry is still caught after the previous visit deregisters.

---

## 8. Validation

- `runChecks` (TypeScript + lint + project structure): **0 errors**
- Home + routing + crash-shield suites: **40 pass / 0 fail**
- Full suite: **1186 pass**, 3 pre-existing unrelated failures (count unchanged)
- Gradle: **BUILD SUCCESSFUL**

### Verified inside the shipped `assets/index.android.bundle`

| Marker | Result |
| --- | --- |
| build stamp `1.10.24 (122)` | present |
| `markScreenUnmounted` (liveness deregistration) | present |
| `isRoutePainted` (liveness check) | present |
| `(tabs)/(home)` group path | **0 occurrences — v1.10.23 fix retained** |
| `Screen failed to load` (watchdog UI) | present |
| `watchdog-go-home` (recovery action) | present |
| `IVX Runtime Error` (fatal shield) | present |
| `Previous Crash Detected` (crash log) | present |
| `IVX Render Error` (render boundary) | present |
| `invalid_credentials` / `rate_limited` (v1.10.22) | present |

A raw `enteredAt` substring hit in the bundle was traced to coincidental
concatenation of unrelated UI strings (`"…Not enough shares available at
request: Not entered"` + `"AtokenSegmentCount…"`), not the removed comparison.
Minified local identifiers are renamed, as expected.

---

## 9. Certified artifact

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.24-qa/ivx-holdings-v1.10.24.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.24-qa
- **HTTP:** 200 · **Size:** 84,906,592 bytes (re-downloaded from the public URL)
- **SHA256:** `5512ddcd1462c9d523d848e314f4658eb4ef21992fd7ea121633ac20defa4a79` —
  local and downloaded checksums match

---

## 10. Defence layers on the Home path

| Layer | Catches |
| --- | --- |
| `RootErrorBoundary` (v1.10.18) | render-time exceptions |
| Fatal shield (v1.10.19) | async / timer / native-callback fatals |
| Persistent crash log (v1.10.20) | errors erased by JS teardown |
| Blank-screen watchdog (v1.10.21) | a route tree that renders nothing and throws nothing |
| Login deadline + honest errors (v1.10.22) | a guard shorter than the work it guards |
| Leaf-screen home route (v1.10.23) | a tab whose entry screen must be guessed |
| **Liveness-based paint + live recovery (v1.10.24)** | **the watchdog itself accusing a working screen, and a recovery button that recovers nothing** |

## 11. Note on the backend

Defects 1 and 2 of v1.10.22 (login deadline inversion, fatal bookkeeping write)
are backend changes and activate on the next Render deploy of that commit. They
are independent of this client-side fix, which is active on install.
