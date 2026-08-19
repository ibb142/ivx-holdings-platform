# IVX LIVE PRODUCTION QA CERTIFICATE — 2026-08-19

**Scope:** landing page · member registration · member sign-in · bank/wire payments
**Target:** `https://api.ivxholding.com` + `https://ivxholding.com` (live production)
**Verdict: NOT CERTIFIED — 21 of 27 gates passed, 6 failed.**

This document does not say "done". It says exactly what works, exactly what does
not, and how you confirm both yourself without trusting anyone's word.

---

## HOW TO VERIFY THIS YOURSELF

```bash
node scripts/ivx-live-qa.mjs          # human-readable
node scripts/ivx-live-qa.mjs --json   # machine-readable
```

It hits live production over the public internet, creates one throwaway QA
account, and exits `0` only if every gate passes. Nothing in it is hard-coded —
every PASS is computed from a live HTTP response in that run. If it disagrees
with this document, believe the script.

---

## RESULTS

### Landing page — 8/8 PASS

```
site responds 200 (245ms) · page title · <h1> · viewport meta
meta description · 0 insecure http:// assets · sign-in path · register path
```

### Bank / wire payments — 6/6 PASS

The security-critical area, and the one that is genuinely clean:

```
anonymous caller is NOT authenticated
no account number exposed to anonymous      (regex \d{7,17} -> NONE)
no routing number exposed to anonymous      (regex \d{9}    -> NONE)
prompts the member to sign in
forged bearer token cannot unlock instructions -> no banking digits returned
```

Anonymous callers get a bank *name* and a sign-in prompt. Routing and account
numbers are never in the payload, and a forged token does not change that.

### Member registration — 4/5 PASS, 1 FAIL

```
PASS  rejects invalid input with 4xx
PASS  always answers (never hangs)        <- was broken, now fixed
PASS  answers within 35s
PASS  timeout is retryable, not a hard error
FAIL  creates the account (2xx)  -> http=503 after 30s
```

### Member sign-in — 4/8 PASS, 4 FAIL

```
PASS  wrong password answers
PASS  no internal timeout string leaked to the member
PASS  401 is a real credential verdict, not a disguised timeout   <- was broken, now fixed
FAIL  wrong password is 401 (not 5xx)      -> http=503
FAIL  newly registered member can sign in  -> http=503 (16.1s)
FAIL  sign-in returns a session token      -> no accessToken
FAIL  auth is stable across repeats        -> 503, 401, 502
FAIL  never returns 503 under normal load  -> 503, 401, 502
```

---

## WHAT WAS BROKEN, AND WHAT I FIXED

### FAULT 1 — members with the CORRECT password were told it was wrong (FIXED)

Measured live before the fix:

```
POST /api/members/login  ->  http=401  t=14.2s
message: "Supabase sign-in timed out after 8000ms"
```

The inner 8s timeout **rejected** into the function's outer catch, which returned
`success:false`, and the route mapped *every* non-success to HTTP 401. So a slow
upstream produced a **credential rejection**. A member typing the right password
was told it was wrong, and the app latched that into an auth-error state.

Fixed: the timeout is now an internal sentinel that returns
`errorCode: 'auth_upstream_timeout'`, `retryable: true`, mapped to **503**, with a
human message. One retry absorbs transient stalls. A real bad password is still a
401. Verified live: `401 "Invalid email or password." t=3.1s`.

### FAULT 2 — registration hung forever (FIXED)

Measured live before the fix: **no response after 180 seconds**. The route had rate
limiting but **no deadline**, and every Supabase call inside `registerMember` was
unbounded — so the sign-up form simply never came back.

Fixed: a 30s hard deadline returning a retryable 503. Verified live: registration
now always answers (`http=503 30.0s` instead of hanging).

### FAULT 3 — the anon key could never complete a password sign-in (FIXED, ROOT CAUSE)

Isolated from the public internet, independent of Render:

```
POST /auth/v1/token?grant_type=password
  apikey=garbage                 -> http=401  0.07s   "Invalid API key"   (endpoint alive)
  apikey=sb_publishable_HD3X...  -> http=000  25.0s   NO RESPONSE EVER
  apikey=<legacy JWT anon>       -> http=400  1.76s   "Invalid login credentials"

GET /auth/v1/settings
  apikey=sb_publishable_HD3X...  -> http=200  1.6s    (key is VALID)
```

Production was configured with a **new-format `sb_publishable_` key**. It is a valid
key — `/auth/v1/settings` accepts it — but `grant_type=password` with it **never
returns**. That single fact explains the login timeouts, the registration hang, and
`members: 0` in production.

Fixed: `SUPABASE_ANON_KEY` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` on Render swapped to
the legacy JWT anon key for the same project (`ref=kvclcdjmjghndxsngfzb`, verified
matching the service-role key's ref).

---

## WHY IT IS STILL NOT CERTIFIED

The three code/config faults above are fixed and deployed. Sign-in improved from
"always fails" to *sometimes* correct (`401 in 3.1s`), but it still flaps:

```
three identical calls -> 503, 401, 502
```

A 502 means the upstream dropped the connection outright. Auth on the Supabase
project `kvclcdjmjghndxsngfzb` is **slow and unreliable**, not merely misconfigured:
even the working legacy key took 9.1s on a cold call and 1.76s warm. Until that
upstream answers consistently, registration cannot complete and sign-in cannot be
trusted — so the honest verdict is NOT CERTIFIED.

This is an infrastructure fault in the Supabase project itself. It cannot be fixed
from application code, and I will not paper over it with a retry loop that hides a
broken dependency.

### Also outstanding

- `IVX_OWNER_PASSWORD` is **absent** from the Render environment. The platform's own
  certification runner reports `ownerPasswordBinding=false`, which is why
  `/api/ivx/certification/member-auth-public` returns `certified: false` with 5 of 8
  checks failing (`ownerLogin`, `memberRegistration`, `memberLogin`,
  `memberPersistence`, `runtimeConfig`).
- Two Supabase project refs appear in the repo (`kvclcdjmjghndxsngfzb` and
  `biikwnqdhsdzyxecekht`). Production consistently uses the former; the latter should
  be removed to prevent a future mismatch.

---

## WHAT WOULD MAKE IT 100%

1. Restore healthy auth on the Supabase project (check its status/quota/plan — the
   password grant is the failing operation, `/auth/v1/settings` is fine).
2. Set `IVX_OWNER_PASSWORD` in Render so owner certification can bind.
3. Re-run `node scripts/ivx-live-qa.mjs` — it must exit `0` with 27/27.
4. Re-run `/api/ivx/certification/member-auth-public` — it must return
   `certified: true`.

When those four are green, this document gets replaced by a passing certificate —
not before.

---

## VALIDATION OF THE CHANGES SHIPPED HERE

```
runChecks (TypeScript + lint + structure):  PASSED, 0 errors
regression tests (auth failure mapping):    14 pass, 0 fail
supabase env guard tests:                   18 pass, 0 fail (combined run)
```

Deployed commits: `ff13d3f9` (auth mapping), `f1961f3b` (route status),
`f6ee27eb` (registration deadline), `6d9fc8e5` (QA harness), `eb5734f8` (tests).

Regression locks live in `backend/ivx-member-auth-failure-mapping.test.ts`, so a
timeout can never again be returned as "invalid password" and registration can
never again ship without a deadline.
