# IVX END-TO-END INDEPENDENCE CERTIFICATE — v1.10.28

**Repository:** `ibb142/ivx-holdings-platform`
**Artifact:** `ivx-holdings-v1.10.28-e2e-independent.apk`
**SHA256:** `938dbce3114f246ab947df0584dad87eab3f589e024fb6e2cd9f7765d905be70`
**Size:** 84,332,351 bytes

Every line below is a measured command output. No claim appears without the
evidence that produced it, and the unfinished items are listed as plainly as the
finished ones.

---

## 0. THE ACTUAL LOCK-IN

`expo/metro.config.js` was six lines. Line 2 required the vendor toolkit at
module scope, and the file exported `withRorkMetro(config)` as the Metro
configuration.

**Consequence: no APK, no AAB and no web bundle could be produced on any machine
that did not have that package.** That is lock-in at the build layer, not a
branding detail.

A sibling file, `metro.config.independent.js`, carried the comment
*"This is now the live config… IVX is fully independent."* It was **not** the
live config. That comment was false.

---

## 1. IT WAS SILENTLY REVERTED — TWICE

Measured after a platform sync, not assumed:

```
expo/metro.config.js  -> back to require("@rork-ai/toolkit-sdk/metro")
expo/package.json     -> @rork-ai/toolkit-sdk reinjected into dependencies
expo/node_modules     -> package NOT present on disk
```

A revert of this kind is **invisible during local development**: the package is
not installed, so nothing breaks here. It only breaks on a machine that has it —
which is exactly the machine that ships your product.

This is why enforcement had to move off the sandbox and onto GitHub.

---

## 2. VENDOR REMOVED — VERIFIED ON GitHub `main`

Fetched back from `main` after the push, not read from the sandbox:

```
expo/package.json     deps rork: []    dev rork: []
expo/metro.config.js  vendor refs: 0
                      const { getDefaultConfig } = require("expo/metro-config");
                      module.exports = config;
```

---

## 3. BUILD PROVEN WITHOUT THE VENDOR

The package was **physically absent from disk** for the entire build:

```
node_modules/@rork-ai:  ABSENT
BUILD SUCCESSFUL in 1m 19s
apk_bytes = 84,332,351
```

---

## 4. SHIPPED BUNDLE IS CLEAN — ASCII *AND* UTF-16

Hermes stores non-ASCII strings as UTF-16LE, so an ASCII-only scan can report
clean while the strings are still present. Both encodings were checked:

```
@rork-ai          ascii=none   utf16=none
withRorkMetro     ascii=none   utf16=none
toolkit.rork      ascii=none   utf16=none
rork.com          ascii=none   utf16=none
RORK_PUBLIC       ascii=none   utf16=none
EXPO_PUBLIC_RORK  ascii=none   utf16=none
```

---

## 5. THE APP NEVER CALLS VENDOR SERVERS

Scanned across `app/`, `lib/`, `src/`, `components/`, `hooks/`, `constants/`:

```
vendor server URLs in runtime:   0
vendor env vars read at runtime: 0
```

---

## 6. THE BUNDLER HOT PATH IS VENDOR-FREE

`expo/scripts/ivx-metro-transformer.js` previously tried the vendor transformer
first and fell back to Expo's. That fallback made the vendor *look* optional
while keeping its code on the bundling hot path whenever it happened to be
installed — meaning **two machines could bundle identical source differently**.

It now delegates to Expo's transformer only, so every machine bundles the same.

---

## 7. ENFORCEMENT — SO IT CANNOT SILENTLY RETURN

`expo/__tests__/vendor-independence.test.ts` — 12 gates, running in every
existing pipeline and on every local `bun test`:

```
12 pass, 0 fail

Gate 1  vendor absent from dependencies, devDependencies, peerDependencies,
        optionalDependencies, and node_modules
Gate 2  metro.config.js has zero vendor references, is self-contained Expo,
        and LOADS with the vendor package absent
        transformer does not delegate to the vendor
Gate 3  zero vendor URLs and zero vendor env vars in the app runtime
```

The decisive gate is **"metro.config.js loads with the vendor package absent"**:
it executes the real config with nothing installed. The old config called
`require("@rork-ai/toolkit-sdk/metro")` at module scope and threw. It could not
survive this test.

Delivered as a test rather than only a workflow deliberately — see section 9.

---

## 8. VALIDATION

```
runChecks (TypeScript + lint + structure):  PASSED, 0 errors
bun test:                                   1229 pass, 3 pre-existing unrelated
Gradle:                                     BUILD SUCCESSFUL in 1m 19s
Published APK SHA256 == local SHA256:       MATCH (re-downloaded from the release)
```

---

## 9. WHAT IS BLOCKED — STATED PLAINLY

**Two CI workflow files could not be pushed.** GitHub refuses workflow writes
from a token without `workflow` scope:

```
.github/workflows/ivx-independence-gate.yml   -> refused (no workflow scope)
.github/workflows/ivx-owner-apk-release.yml   -> refused (no workflow scope)
```

Both tokens available to this environment lack that scope. The gate logic was
therefore delivered as a **test file**, which pushed successfully and runs inside
your existing CI — enforcement is live either way. Adding `workflow` scope to the
PAT allows the two workflow files to be pushed as written; they exist and are
complete.

**The build still executes in a Rork-operated sandbox.** Independence proves the
app *can* build anywhere. Running the same Gradle command in your own GitHub
Actions converts *can* into *has*. `ivx-owner-apk-release.yml` is already written
to do this, gated on the vendor being absent — it needs the token scope above.

**Rork retains developer access — as your developer only.** Zero Rork packages
ship inside the product.

**Not claimed here:** end-to-end owner sign-in with real credentials (the owner
password is not available to this environment), and individual current-SHA
certification of ROOT-001 → ROOT-200. Anything not listed above remains
`REVERIFY`.
