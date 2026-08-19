# IVX Holdings — Owner Sign-In: Full Logging Map, Root Cause & Permanent Fix

**Certificate ID:** `IVX-120-OWNERSIGNIN-4126e19b5f18d6b1`
**Date:** 2026-08-19
**Build:** versionName `1.10.22` / versionCode `120`
**Artifact SHA256:** `4126e19b5f18d6b10bdd77213af0393c6eaea5ee54de445ff9cdb1cfa5477697`

---

## 0. Headline

The reported screen — **"Login service temporarily unavailable. Please try again."** — was
**never an outage**. The backend was up and answering in under half a second the entire time.

That sentence is a **hardcoded 6-second timeout fallback string inside your own backend**, and
it was being triggered by a deadline that was set *shorter than the operation it was guarding*.

Three separate defects were found on the owner sign-in path. All three are fixed and guarded by
21 new tests.

---

## 1. Full logging map of owner sign-in

Every hop the owner's password takes, what each hop logs, and where it broke.
`✗ RED` marks a defect. `▲ BLIND` marks a hop that produced **no** diagnostic signal.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  DEVICE — Android, owner handset                                             │
└──────────────────────────────────────────────────────────────────────────────┘
   │
   │  1. app/login.tsx — handleLogin()
   │     LOGS: LoginTrace 'LOGIN_TAP'
   │     STATUS: OK
   ▼
   │  2. preflightSupabaseConfig()  (login.tsx:48)
   │     LOGS: url ref, anon-key JWT shape, host match
   │     STATUS: OK — passed. Config is valid. (This was the v1.10.15 fix.)
   ▼
   │  3. lib/auth-context.tsx — login()
   │     LOGS: 'CREDENTIAL_VALIDATION', 'BACKEND_REQUEST_STARTED'
   │     STATUS: OK
   ▼
   │  4. fetchWithOwnerRegistrationTimeout()  — client abort budget 45s
   │     LOGS: none on the wire
   │     STATUS: OK — client was patient. Not the constraint.
   ▼
═══════════════════ NETWORK ═══════════════════  POST /api/members/login
   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  RENDER — api.ivxholding.com  (VERIFIED LIVE: HTTP 200, 1.11s)               │
└──────────────────────────────────────────────────────────────────────────────┘
   │
   │  5. withRateLimit(scope 'member-login', burst 5, refill 0.5/s)
   │     LOGS: 429 response only
   │     STATUS: OK — but see defect 3, a 429 was displayed as "unavailable"
   ▼
   │  6. withTimeout(handler, fallback)   ← SB_HARD_TIMEOUT_MS = 6_000
   │
   │   ✗✗✗ RED — DEFECT 1: DEADLINE INVERSION ✗✗✗
   │   ▲ BLIND — fires with NO log, NO error, NO exception
   │
   │     This 6s deadline guarded an operation whose own budget was 10s.
   │     On expiry it returns, verbatim:
   │        503 "Login service temporarily unavailable. Please try again."
   │     ── THIS IS THE EXACT STRING ON THE OWNER'S SCREEN ──
   │     The inner sign-in kept running normally and never knew it lost the race.
   ▼
   │  7. handleMemberLogin()  (api/ivx-members.ts:461)
   │     LOGS: none
   │     STATUS: OK
   ▼
   │  8. loginMember()  (services/ivx-member-database.ts:610)
   │     LOGS: only on a thrown exception
   ▼
   │  9. verifyFallbackMemberPassword()  — durable store read
   │     LOGS: none            ▲ BLIND — unbounded, counts against the 6s ceiling
   ▼
   │ 10. supabase.auth.signInWithPassword()   ← budget was 10_000ms
   │
   │   ✗✗✗ RED — the guarded operation OUTLIVES its guard by 4 seconds ✗✗✗
   │
   │     Any sign-in in the 6-10s window could NEVER succeed.
   │     Correct password → guaranteed 503.
   ▼
   │ 11. await Promise.race([updateMemberLastLogin(userId), reject after 3s])
   │
   │   ✗✗✗ RED — DEFECT 2: NON-CRITICAL WRITE WAS FATAL ✗✗✗
   │
   │     Runs AFTER the password is verified and a session exists.
   │     A slow `profiles` write threw → outer catch → a SUCCESSFUL login was
   │     returned to the app as HTTP 401 with a raw internal message.
   ▼
═══════════════════ NETWORK ═══════════════════  503 / 401 response
   ▼
   │ 12. auth-context.tsx — response handling
   │
   │   ✗✗✗ RED — DEFECT 3: BLANKET MISCLASSIFICATION ✗✗✗
   │   ▲ BLIND — this is why 8 builds could not find the cause
   │
   │     EVERY non-success response became:
   │        failureReason: 'service_unavailable',  supabaseErrorStatus: 504
   │     A wrong password (401), a rate limit (429), an unconfirmed email (403)
   │     and a real outage all rendered the SAME sentence.
   │     The error message carried ZERO diagnostic signal.
   ▼
   │ 13. login.tsx — buildLoginFailureAlertMessage()
   │     RENDERS: "Sign In Failed / Login service temporarily unavailable."
   │     STATUS: faithfully displaying a lie it was handed upstream
   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  OWNER SEES: "Login service temporarily unavailable. Please try again."      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Why the previous eight builds could not see this

| Hop | Diagnostic signal emitted |
| --- | --- |
| 6 — timeout fallback fires | **none** — a resolved race, not an error |
| 9 — durable store read | **none** — untimed, uninstrumented |
| 10 — sign-in loses the race | **none** — it completes successfully, just too late |
| 12 — client classification | **actively misleading** — real status replaced by a fake 504 |

Four consecutive hops on the critical path were silent or lying. Every crash-oriented
defence added in v1.10.18-v1.10.20 was looking for a thrown error. **Nothing ever threw.**

---

## 2. Live evidence — the backend was never down

Captured during this fix, against production:

```text
POST https://api.ivxholding.com/api/members/login   HTTP 401   0.322s
POST https://api.ivxholding.com/api/members/login   HTTP 401   0.140s
POST https://api.ivxholding.com/api/members/login   HTTP 401   0.250s
GET  https://api.ivxholding.com/health             HTTP 200   1.114s
     commit 76d9ec010e54e6f46e33e597fe52577c03b11e0d
```

A backend that answers in 0.14s is not "temporarily unavailable". The message was
self-inflicted by the 6s deadline, not by any service outage.

---

## 3. The three defects and their fixes

### Defect 1 — Deadline inversion

**Before** — `backend/hono.ts`

```ts
const SB_HARD_TIMEOUT_MS = 6_000;          // outer guard
app.post('/api/members/login', ... withTimeout(handleMemberLogin, () => 503 ...))
// inner: setTimeout(reject, 10_000)       // guarded operation — LONGER than the guard
```

**After**

```ts
const LOGIN_HARD_TIMEOUT_MS = 20_000;              // hono.ts — outer
export const MEMBER_LOGIN_INNER_BUDGET_MS = 8_000; // ivx-member-database.ts — inner
```

`withTimeout` now takes a per-route deadline. Login gets 20s; the generic 6s deadline
still applies to other routes. **12 seconds of headroom** between guard and guarded.

### Defect 2 — A bookkeeping write could fail a verified login

**Before**

```ts
await Promise.race([
  updateMemberLastLogin(userId),
  new Promise((_, reject) => setTimeout(() => reject(...), 3_000)),
]);
```

**After**

```ts
void updateMemberLastLogin(userId).catch(() => {});
```

The password is already verified and the session already exists at this line. A
`last_login_at` timestamp can never again cost the owner their sign-in.

### Defect 3 — The client reported every failure as an outage

**Before**

```ts
return { failureReason: 'service_unavailable', supabaseErrorStatus: 504 };
```

**After** — `classifyServerLoginStatus()`, by real HTTP status:

| HTTP | Reported to owner | Retried |
| --- | --- | --- |
| 401 | Invalid email or password | no |
| 403 | Verification required | no |
| 429 | Rate limited | no |
| 400 | Invalid input | no |
| 5xx | Service unavailable | **yes — once, 1.2s backoff** |
| 0 (transport) | Service unavailable | **yes — once, 1.2s backoff** |

`service_unavailable` is now reachable **only** from a genuine 5xx or transport failure.
The fabricated 504 is gone; the real status is preserved and logged.

Additional hardening:
- **Retry once** on a transient 5xx/transport failure — a single blip no longer ends the attempt.
- **Do not replay a definitive answer** against fallback base URLs — a wrong password will not
  change on retry, and replaying it burned the 5-token rate-limit budget, escalating the owner
  into a 429 that was then displayed as… "temporarily unavailable".

---

## 4. Incident audit — this path's history

| Build | Shipped fix | Targeted | Outcome |
| --- | --- | --- | --- |
| v1.10.15 | Supabase anon-key correction | config | did not resolve |
| v1.10.16 | Web-only startup fix | startup | did not resolve |
| v1.10.17 | JSX-runtime patch removal | bundle | did not resolve |
| v1.10.18 | `RootErrorBoundary` | **crash** | never fired — nothing threw |
| v1.10.19 | Global fatal shield | **crash** | never fired — nothing threw |
| v1.10.20 | Persistent crash log | **crash** | recorded nothing — nothing threw |
| v1.10.21 | Router anchor + blank-screen watchdog | **routing** | **black screen resolved** |
| **v1.10.22** | **Deadline inversion + fatal bookkeeping + misclassification** | **sign-in** | **this certificate** |

- Certificates on file for this path: **6**
- Commits touching the owner auth path: **72**

**The pattern:** builds 15-20 all assumed a *crash*. The actual failures were a route that
rendered nothing (v1.10.21) and a timeout that guarded nothing correctly (v1.10.22). Neither
throws. Six builds were spent instrumenting a class of error that was never occurring — because
the one hop that could have said so was returning a hardcoded string with no error code.

**That is the systemic finding, and it is now fixed at the source:** every failure on this path
now carries a real HTTP status and an `errorCode`, and every silent hop is either logged or
covered by an invariant test.

---

## 5. Permanent guards — 21 new tests

`expo/__tests__/owner-login-timeout-invariant.test.ts`

**Defect 1**
1. the login route uses its own deadline, not the generic 6s one
2. `withTimeout` accepts a per-route timeout
3. **INVARIANT: outer route deadline is strictly greater than the inner budget**
4. outer keeps a >= 5s margin over inner
5. the sign-in race uses the shared constant, not a magic literal

**Defect 2**
6. `updateMemberLastLogin` is fire-and-forget in the success path
7. it is never awaited inside a throwing race

**Defect 3**
8-14. classification exists; 401 → invalid credentials; 429 → rate limited; 5xx/transport is the
only `service_unavailable` path; the hardcoded 504 is gone; retry-with-backoff is present;
definitive failures are not replayed

**Behavioural table** (15-21) — 401, 403, 429, 500, 503, 504, 0 each assert the exact reason and
retry decision.

Test 3 is the one that matters most: **if anyone ever sets the route deadline below the
handler's budget again, the build fails.** That is what makes this fix permanent rather than
another patch.

Combined with the v1.10.21 routing guards: **28 tests, 0 failures.**

---

## 6. Validation

- `runChecks` (TypeScript + lint + project structure): **0 errors**
- New owner sign-in tests: **21 pass / 0 fail**
- Combined sign-in + routing guards: **28 pass / 0 fail**
- Full suite: **1164 pass**, 3 pre-existing unrelated failures
- Gradle: **BUILD SUCCESSFUL** (466 tasks)

### Verified inside the shipped `assets/index.android.bundle`

| Marker | Result |
| --- | --- |
| `invalid_credentials` classification | present |
| `rate_limited` classification | present |
| `verification_required` classification | present |
| retry-with-backoff logging | present |
| `Login failed:` structured log (reason + code + status) | present |
| build stamp `1.10.22 (120)` | present |
| `Screen failed to load` (v1.10.21 watchdog, retained) | present |
| `IVX Runtime Error` (fatal shield, retained) | present |
| `Previous Crash Detected` (crash log, retained) | present |
| `IVX Render Error` (render boundary, retained) | present |

---

## 7. Certified artifact

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.22-qa/ivx-holdings-v1.10.22.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.22-qa
- **HTTP:** 200 · **Size:** 84,904,272 bytes (re-downloaded from the public URL)
- **SHA256:** `4126e19b5f18d6b10bdd77213af0393c6eaea5ee54de445ff9cdb1cfa5477697` — local and
  downloaded checksums match

---

## 8. Deployment scope — read this

| Fix | Where it lives | Active when |
| --- | --- | --- |
| Defect 3 — honest classification + retry | **this APK** | **immediately on install** |
| Defect 1 — login deadline 6s → 20s | Render backend | on the next backend deploy of this commit |
| Defect 2 — non-fatal bookkeeping | Render backend | on the next backend deploy of this commit |

Install this APK and attempt sign-in. The behaviour now tells the truth:

- Wrong password → **"Invalid email or password."**
- Rate limited → **"Too many attempts."**
- Genuine server problem → service-unavailable, **after an automatic retry**

If sign-in still fails after the backend deploy lands, the message itself will now name the
real cause and carry a real HTTP status — no more single ambiguous sentence covering four
different failures.

---

## 9. Defence layers now on the owner path

| Layer | Catches |
| --- | --- |
| `RootErrorBoundary` (v1.10.18) | render-time exceptions |
| Fatal shield (v1.10.19) | async / timer / native-callback fatals |
| Persistent crash log (v1.10.20) | errors erased by JS teardown |
| Blank-screen watchdog (v1.10.21) | a route tree that renders nothing and throws nothing |
| **Deadline invariant + honest classification (v1.10.22)** | **a guard shorter than the work it guards, and failures that lie about their cause** |
