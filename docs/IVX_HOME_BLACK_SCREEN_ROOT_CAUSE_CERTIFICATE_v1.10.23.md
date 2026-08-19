# IVX Holdings — Home Black Screen: Video Forensics, Root Cause & Permanent Fix

**Certificate ID:** `IVX-121-HOMEBLANK-de67b0f820afe47c`
**Date:** 2026-08-19
**Build:** versionName `1.10.23` / versionCode `121`
**Artifact SHA256:** `de67b0f820afe47c638f78766a51f00a99588f8fd153f3e6c6ab0119caa1b732`
**Evidence:** `Screen_Recording_20260819_131641_IVX Holdings.mp4` — 47.86s, 96 frames decoded

---

## 1. Video forensics — the pixel values name the defect

The recording was decoded end to end and three screen regions were measured
independently on every frame (mean luminance, 0-255):

```text
phase        time          status bar   middle   nav bar   interpretation
login form   29.0-31.0s        7          16        20     form + keyboard, normal
PHASE A      31.2-32.7s       13          10         4     #0A0A0F painted, ZERO content
PHASE B      33.0-47.9s        0           0         0     pure #000000, 15 seconds
```

**Phase A is the defect.** A middle-screen luminance of exactly **10** is `#0A0A0F`
— `Colors.background` in `constants/colors.ts:101`. The app navigated to Home,
painted the container background, and rendered **no screen inside it**.

Nothing threw. Nothing logged. Nothing crashed. The container was doing its job
perfectly; there was simply no child to draw.

Phase B (pure black across the status bar too) is the display after the empty
frame — the tail of the same failure, not a second one.

---

## 2. Line-by-line audit of the Home route

| # | Hop | File | Verdict |
| --- | --- | --- | --- |
| 1 | `handleLogin` | `app/login.tsx` | OK |
| 2 | `navigateAfterSuccessfulLogin` | `app/login.tsx:631` | OK — sets target |
| 3 | `router.replace('/(tabs)/(home)/home')` | `app/login.tsx:644` | OK — fires |
| 4 | Tabs layout mounts | `app/(tabs)/_layout.tsx:142` | OK — renders `<Tabs>` |
| 5 | Tab `(home)` selected | `app/(tabs)/_layout.tsx:157` | **points at a GROUP** |
| 6 | Group entry resolution | `app/(tabs)/(home)/_layout.tsx:24` | **✗ RED — resolves to nothing** |
| 7 | `<Stack>` renders | `app/(tabs)/(home)/_layout.tsx:30` | paints `contentStyle` bg, no child |
| 8 | `home.tsx` never mounts | `app/(tabs)/(home)/home.tsx:326` | `markScreenPainted` never runs |
| 9 | Blank-screen watchdog | `components/BlankScreenWatchdog.tsx:26` | **✗ RED — cannot fire** |

---

## 3. Defect 1 — the home tab was the only tab that had to *guess* its screen

### The structural trap

```text
app/(tabs)/(home)/_layout.tsx
app/(tabs)/(home)/home.tsx      <- no index.tsx
```

A route group **carries no path segment**. Therefore
`app/(tabs)/(home)/index.tsx` resolves to `/` — the identical path to
`app/index.tsx`. The two collide, which is why the index route was removed in
v1.10.21.

That left the home tab as the **only route in the entire app** whose entry screen
had to be resolved from an `anchor` string rather than from a real file on disk.
Every other tab is a plain leaf:

```text
(tabs)/market.tsx      (tabs)/portfolio.tsx    (tabs)/profile.tsx
(tabs)/chat.tsx        (tabs)/aura.tsx         (tabs)/crm.tsx
```

None of them was ever exposed to this failure. Only Home.

### What renders when that resolution comes up empty

```tsx
<Stack screenOptions={{ contentStyle: { backgroundColor: Colors.background } }}>
  {/* no resolved child */}
</Stack>
```

A `Stack` with no resolved child paints `contentStyle.backgroundColor` and
nothing else. `Colors.background === '#0A0A0F'`.

**Measured Phase A middle luminance: 10. `0x0A` = 10.** The pixel value and the
source constant are the same number.

### Fix — remove the group entirely

```text
app/(tabs)/(home)/home.tsx   ->  app/(tabs)/home.tsx
app/(tabs)/(home)/           ->  deleted
name="(home)"                ->  name="home"
anchor: '(home)'             ->  anchor: 'home'
initialRouteName="(home)"    ->  initialRouteName="home"
```

The home tab now points directly at a leaf screen file. **There is nothing left
to resolve, so it cannot resolve to nothing.** This removes the failure class
rather than patching an instance of it.

20 files were migrated to the new route path in the same pass. Zero references to
the old group path remain anywhere under `app/` — asserted by test.

---

## 4. Defect 2 — the watchdog was structurally incapable of firing after login

v1.10.21 shipped a blank-screen watchdog **specifically** so a silent blank
screen could never happen again. It did not fire once during the 15 seconds of
black in the recording. Here is why:

```ts
setTimeout(() => {
  if (hasNeverPainted()) setIsBlank(true);
}, 8000);
```

```ts
export function hasNeverPainted(): boolean {
  return lastPaintedAt === null;   // ONE process-wide flag
}
```

And `app/login.tsx:2240`:

```ts
markScreenPainted('login');
```

The login screen paints on every single sign-in. From that moment
`hasNeverPainted()` returns `false` for the remaining lifetime of the process.

**Every navigation after login was structurally invisible to the watchdog.** It
was asking *"has anything ever painted?"* while being relied upon to mean *"is
the screen in front of the user alive?"* Those are different questions, and only
on a cold launch do they give the same answer.

### Fix — per-route paint, re-armed on every navigation

```ts
export function hasRouteFailedToPaint(route: string, enteredAt: number): boolean {
  if (!isRouteInstrumented(route)) return false;
  const paintedAt = getRoutePaintedAt(route);
  if (paintedAt === null) return true;
  return paintedAt < enteredAt;      // a stale paint cannot mask a blank re-entry
}
```

The watchdog now records when each route was **entered** and asks whether **that
route** painted **since**. Uninstrumented routes are explicitly never accused, so
a working screen can never be covered by a false error overlay.

### Fix 2b — the paint key would never have matched anyway

Home reported `markScreenPainted('(tabs)/home')` while `usePathname()` reports
`/home` — because groups carry no path segment. Even the corrected watchdog would
have misjudged Home. It now reports `/home`, and the mismatch is asserted against.

---

## 5. Why v1.10.21 did not end this

v1.10.21 correctly identified that the group had no index route and correctly
removed the colliding file. What it did **not** do was recognise that removing
the index left the anchor as the *sole* resolution mechanism for that route — and
that an anchor which fails to resolve produces no error to observe.

The v1.10.21 guard test asserted `anchor: 'home'` was *present in the source*. It
was present. It was also insufficient. **A test that asserts a string exists in a
file cannot prove the router honours it at runtime.**

The v1.10.23 tests assert structure instead of strings:

- the anchor value must name a file that **exists on disk**
- **every directory containing a `_layout.tsx` must contain at least one screen**

That second invariant is the general form of this entire bug class: a layout with
no screen is a container that paints its background and nothing else.

---

## 6. Permanent guards — 15 new tests

`expo/__tests__/home-route-blank-screen.test.ts`

**Defect 1 — structure**
1. the `(home)` route group no longer exists
2. home is a real leaf screen file
3. the tabs layout registers the leaf screen name `home`
4. the anchor points at a leaf screen, not a group
5. no reference in `app/` points at the deleted group path (comments excluded)
6. **every layout directory contains at least one screen file** — the generalised invariant

**Defect 2 — detectability**
7. home reports the router pathname, not the file path
8. the watchdog no longer arms on the process-wide flag
9. **the regression itself: a blank Home is detected even though login already painted**
10. a home that paints after entry is not flagged
11. a stale paint from a previous visit does not mask a blank re-entry
12. uninstrumented routes are never accused of being blank
13. home and login are instrumented
14. route keys normalise across trailing/leading slashes
15. paint tracking is per route, not a single global flag

The v1.10.21 and v1.10.22 suites were **updated** to the new structure, not
deleted — `route-anchor-black-screen.test.ts` now verifies the anchor target file
exists, and `crash-shield.test.ts` reflects that Home's crash coverage comes from
the `(tabs)` segment boundary plus its in-screen `ModuleErrorBoundary`.

---

## 7. Validation

- `runChecks` (TypeScript + lint + project structure): **0 errors**
- Home + routing + login + crash-shield + feed suites: **99 pass / 0 fail**
- Full suite: **1179 pass**, 3 pre-existing unrelated failures (count unchanged)
- Gradle: **BUILD SUCCESSFUL**

### Verified inside the shipped `assets/index.android.bundle`

| Marker | Result |
| --- | --- |
| build stamp `1.10.23 (121)` | present |
| `blank-screen-watchdog` render ID | present |
| `watchdog-go-home` recovery action | present |
| **`(tabs)/(home)` group path** | **0 occurrences — group is gone** |
| `Screen failed to load` (watchdog UI) | present |
| `IVX Runtime Error` (fatal shield) | present |
| `Previous Crash Detected` (crash log) | present |
| `IVX Render Error` (render boundary) | present |
| `invalid_credentials` (v1.10.22 login fix) | present |
| `rate_limited` (v1.10.22 login fix) | present |

---

## 8. Certified artifact

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.23-qa/ivx-holdings-v1.10.23.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.23-qa
- **HTTP:** 200 · **Size:** 84,906,172 bytes (re-downloaded from the public URL)
- **SHA256:** `de67b0f820afe47c638f78766a51f00a99588f8fd153f3e6c6ab0119caa1b732` —
  local and downloaded checksums match

---

## 9. Defence layers on the Home path

| Layer | Catches |
| --- | --- |
| `RootErrorBoundary` (v1.10.18) | render-time exceptions |
| Fatal shield (v1.10.19) | async / timer / native-callback fatals |
| Persistent crash log (v1.10.20) | errors erased by JS teardown |
| Blank-screen watchdog (v1.10.21) | a route tree that renders nothing and throws nothing |
| Login deadline + honest errors (v1.10.22) | a guard shorter than the work it guards |
| **Leaf-screen home route + per-route paint (v1.10.23)** | **a tab whose entry screen must be guessed, and a blank screen after login** |

## 10. Note on the backend

Defects 1 and 2 of v1.10.22 (login deadline inversion, fatal bookkeeping write)
are backend changes and activate on the next Render deploy of that commit. They
are independent of this Home fix, which is entirely client-side and active on
install.
