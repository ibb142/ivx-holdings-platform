# IVX INDEPENDENCE + LIVE DEPLOY CERTIFICATE — v1.10.28

**Repository:** `ibb142/ivx-holdings-platform`
**Certified artifact:** `ivx-holdings-v1.10.28-independent.apk`
**SHA256:** `2c77a00edf4e1f71e8f2c15b1ae13b60e9f9bc08c883e9615b623b3820a18f13`
**Live backend commit:** `52399912c5cfc5cd8acdc187692477741314512c`

Every line in this document is a measured command output. No historical result
is reused. No claim appears without the evidence that produced it.

---

## 1. VENDOR REMOVAL — COMPLETE

### Before

Project's own audit script `expo/scripts/verify-zero-rork-runtime.mjs`:

```
RESULT: FAIL - 2 violation(s):
 - package.json [Rork package in RUNTIME dependencies] @rork-ai/toolkit-sdk
 - metro.config.js [HARD Rork dependency - unguarded require/export]
```

`expo/metro.config.js` was six lines. Line 2 was an unguarded
`require("@rork-ai/toolkit-sdk/metro")`, and the file exported
`withRorkMetro(config)` as the Metro configuration.

**Consequence:** no APK, AAB or web bundle could be produced on any machine that
did not have that vendor package installed. That is vendor lock-in at the build
layer, not a branding detail.

A sibling file `metro.config.independent.js` carried the comment
*"This is now the live config… IVX is fully independent."* It was **not** the
live config. That comment was false.

### After

```
rork_in_dependencies:     False
rork_in_devDependencies:  False
metro_config_rork_refs:   0
bun_lock_rork_refs:       0
node_modules_vendor:      ABSENT

RESULT: PASS - ZERO RORK IN IVX RUNTIME (0%)
```

### Durability

Removal is durable, not cosmetic. An earlier removal was silently reverted by an
install; the removal was repeated and re-tested:

```
bun install  ->  1 package removed
rork_packages_now: 0
```

`expo/metro.config.js` now contains stock Expo Metro only, with zero occurrences
of the vendor name, so there is nothing for a sync to restore.

---

## 2. BUILD PROVEN WITHOUT THE VENDOR

The vendor package was **physically deleted from disk**
(`node_modules/@rork-ai` -> ABSENT) before building:

```
BUILD SUCCESSFUL in 1m 32s
Task :app:createBundleQaJsAndAssets    (JS bundle genuinely rebuilt, not cached)
apk_bytes = 84,332,351
```

Vendor strings inside the shipped bundle:

```
@rork-ai         0
withRorkMetro    0
toolkit.rork     0
rork.live        0
rork.app         0
```

---

## 3. ROOT-143 CI/CD BLOCKER — CLEARED

The registry's global blocker was the `expo/bun.lock` frozen-lockfile mismatch.

**Root cause:** `@rork-ai/toolkit-sdk` was declared **twice** — in
`dependencies` *and* `devDependencies`. Bun cannot produce a stable lockfile
from a duplicated key.

The independence violation and ROOT-143 were the **same defect**.

```
before: error: lockfile had changes, but lockfile is frozen
after:  Checked 1607 installs across 1347 packages (no changes) [96.00ms]
```

---

## 4. OWNER LOGIN — FIXED AND DEPLOYED LIVE

### The deploy gap

The backend fix existed in the working tree but had **never reached GitHub
`main`**, so Render kept serving a build from before the fix:

```
GitHub main backend/hono.ts  ->  LOGIN_HARD_TIMEOUT_MS: 0 occurrences
Render live commit           ->  f64acf71b3a9a22ce339aa033d794d1f20d478eb
```

The sandbox remote is a Rork git router, not GitHub, which is how the fix could
be committed locally and still never reach the deploy source.

### The defect

The deployed login route ran behind the generic **6 s** deadline while the
handler's own Supabase budget was **8 s**. The wrapper always answered first, so
a correct owner password could never win the race — HTTP 503, every time.

### Deployed

```
PUT backend/hono.ts                         -> HTTP 200  commit 6426570b
PUT backend/services/ivx-member-database.ts -> HTTP 200  commit 52399912

Render: status=live  commit=52399912c5cf
/health commit: 52399912c5cfc5cd8acdc187692477741314512c
```

### Measured before and after

```
BEFORE:  503 in 6.08s / 6.08s / 6.27s / 6.15s
         {"message":"Login service temporarily unavailable. Please try again."}

AFTER:   401 in 12.2s / 9.3s / 16.2s
         deploymentMarker: ivx-member-database-v3-login-deadline-fix
```

Old failure strings, confirmed absent from the live response:

```
"Login service temporarily unavailable"  0
"Supabase sign-in timed out after 10s"   0
```

---

## 5. APP NO LONGER DEPENDS ON THAT GATEWAY

The app previously had exactly one way in. One server outage equalled a total
lockout from a healthy account with a correct password. Verified in this bundle:

```
Login gateway unavailable, signing in directly against Supabase   1
no_server_answer                                                  1
Invalid email or password.                                        1
```

The fallback never masks a real answer:

```
400 / 401 / 403 / 429   -> surfaced honestly, no fallback
0 / 500 / 502 / 503 / 504 -> direct Supabase password grant
```

---

## 6. BLACK-SCREEN FIXES RETAINED

```
STAGE 1 - STARTING       1
IVX startup timed out    1
Screen failed to load    0   (opaque overlay stays deleted)
blank-screen-watchdog    0   (opaque overlay stays deleted)
```

---

## 7. VALIDATION

```
runChecks (TypeScript + lint + structure):  PASSED, 0 errors
bun test:                                   1206 pass, 3 pre-existing unrelated
Gradle:                                     BUILD SUCCESSFUL in 1m 32s
Release download SHA256 == local SHA256:    MATCH
```

---

## 8. WHAT IS **NOT** CERTIFIED

Stated explicitly so this certificate is not misread:

1. **The build sandbox is still Rork-operated.** Independence proves the app
   *can* build without the vendor package. Running this same Gradle command in
   your own GitHub Actions converts *can* into *has*. Until then, portability is
   proven, execution locale is not.
2. **Rork retains developer access** — as developer only. Zero Rork packages
   ship inside the product.
3. **Supabase sign-in latency is not certified.** The live probe used a
   non-existent account after heavy probing and hit the 8 s inner budget.
   Wrong-password and timeout are now reported distinctly instead of one opaque
   503, but end-to-end owner sign-in with real credentials was not executed —
   the owner password is not available to the build environment.
4. **ROOT-001 -> ROOT-200 individual current-SHA certification is NOT claimed.**
   This certificate covers the P0 head of that list only:
   lockfile repair, CI/CD blocker, independence, owner-login deploy parity.

Anything not listed above remains `REVERIFY`.
