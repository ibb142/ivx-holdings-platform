# IVX Holdings — The Black Screen Was Route `/`

**Certificate ID:** `IVX-123-ROOT-ROUTE-0c1254341d8ac3ab`
**Date:** 2026-08-19
**Build:** versionName `1.10.25` / versionCode `123`
**SHA256:** `0c1254341d8ac3abf0b685c0c2491630490c9f1dc8cd1a5f3304e0c96fec724e`

---

## 1. The defect, printed from source

```text
1. the watchdog was allowed to judge '/'
   lib/screen-paint-watchdog.ts:60
   INSTRUMENTED_ROUTES = new Set<string>(['/', '/home', '/login']);

2. NOTHING in the app ever reported a paint for '/'
   app/login.tsx:2240       markScreenPainted('/login')
   app/(tabs)/home.tsx:336  markScreenPainted('/home')
   -> keys reported: /home, /login.  '/' NEVER reported.

3. route '/' rendered ZERO pixels on every branch
   app/index.tsx:55  return <Redirect href="/(tabs)/home" />
   app/index.tsx:61  return <Redirect href="/login" />
   app/index.tsx:65  return <Redirect href="/(tabs)/home" />

4. v1.10.24's recovery navigated the user straight onto it
   components/BlankScreenWatchdog.tsx:44,94
   const ROOT_ROUTE = '/';
   router.replace(alreadyHome ? ROOT_ROUTE : '/(tabs)/home');
```

**`<Redirect />` renders `null`.** From the moment route `/` mounted until the
router committed a destination, the app painted the root view's `#0A0A0F`
background and nothing else. If the destination never committed — auth still
resolving, router not yet mounted, or the tabs auth guard firing a competing
`router.replace('/login')` — that empty container stayed on screen with no
error, no log, no crash.

**That is the 14 continuous seconds of `rgb(12,8,14)` measured in frames 12-40
of the device recording.** A route whose entire job was to render nothing.

## 2. Why it was also a guaranteed false accusation

`/` was judged by the watchdog but could never report a paint. Landing on it for
8 seconds **always** produced "Screen failed to load" — by construction, every
time. v1.10.24's recovery button navigated there deliberately to force a
remount, so: tap recovery → land on `/` → accused again 8s later. That loop was
introduced by the previous fix.

## 3. Fix — structural

`app/index.tsx` now always renders visible branded content, with the redirect as
a **sibling** of that content rather than a replacement for it:

```tsx
return (
  <View style={styles.container} testID="index-route">
    <Text style={styles.brand}>IVX</Text>
    <ShimmerIndicator size="large" color="#FFD700" />
    <Text style={styles.status}>
      {destination === null ? 'Preparing your account…' : 'Opening IVX Holdings…'}
    </Text>
    {destination !== null ? <Redirect href={destination as never} /> : null}
  </View>
);
```

```tsx
useEffect(() => {
  markScreenPainted('/');
  return () => markScreenUnmounted('/');
}, []);
```

The route cannot be an empty container on any branch, and recovery can no longer
loop into an unanswerable accusation.

## 4. The invariant that would have caught this

```ts
for (const route of routes) {
  expect({ route, reported: ... }).toEqual({ route, reported: true });
  expect({ route, released: ... }).toEqual({ route, released: true });
}
```

Every route the watchdog may judge must have a screen reporting a paint for that
exact key. `/` violated it for three builds. Now enforced at build time.

**The test caught a bug in itself on first run:** scanning raw source, a doc
comment that merely mentioned the call satisfied the invariant — a false pass
that would have let this defect through a second time. It now strips comments
and scans code only.

6 new tests, including runtime proof that `/` is judged blank before mount, safe
once painted, and judged again after unmount.

## 5. Validation

- `runChecks` (TypeScript + lint + structure): **0 errors**
- Home + routing + crash-shield: **46 pass / 0 fail** (was 40)
- Full suite: **1192 pass**, 3 pre-existing unrelated failures (unchanged)
- Gradle: **BUILD SUCCESSFUL in 1m 36s**

### Verified inside the shipped bundle

| Marker | Result |
| --- | --- |
| build stamp `1.10.25 (123)` | present |
| `index-route` (root route always paints) | present |
| `markScreenUnmounted` | present |
| `(tabs)/(home)` | **0 — v1.10.23 fix retained** |
| `Screen failed to load` / `watchdog-go-home` | present |
| `IVX Runtime Error` / `Previous Crash Detected` / `IVX Render Error` | present |
| `invalid_credentials` / `rate_limited` | present |
| `IVX startup timed out` | present |

The two new status strings contain a `…`, so Hermes stores them in its **UTF-16
string table** — an ASCII grep returns 0 and would have looked like a missing
fix. Decoded directly from the shipped binary:

```text
'Opening IVX Holdings'    utf16_offset=4019396  -> "Opening IVX Holdings…"
'Preparing your account'  utf16_offset=4027120  -> "Preparing your account…"
```

## 6. Certified artifact

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.25-qa/ivx-holdings-v1.10.25.apk
- **HTTP 200** · **84,907,280 bytes** (re-downloaded from the public URL)
- **SHA256 local = downloaded:** `0c1254341d8ac3abf0b685c0c2491630490c9f1dc8cd1a5f3304e0c96fec724e`

## 7. Honest fix history

| Build | Fixed | Introduced |
| --- | --- | --- |
| v1.10.23 | removed the `(home)` group | a watchdog that accused working screens |
| v1.10.24 | the false positive | recovery that navigated into an unpaintable route |
| **v1.10.25** | **route `/` — the black screen itself** | — |
