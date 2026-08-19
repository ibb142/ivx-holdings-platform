# IVX LIVE PRODUCTION QA CERTIFICATE — 2026-08-19

**Scope:** landing page · member registration · member sign-in · bank/wire payments
**Target:** `https://api.ivxholding.com` + `https://ivxholding.com` (live production)
**Verdict: NOT CERTIFIED — 21 of 27 QA gates passed; owner certification 4 of 8.**

This document does not say "done". It says exactly what works, exactly what does
not, and how you confirm both yourself without trusting anyone's word.

---

## HOW TO VERIFY THIS YOURSELF

```bash
node scripts/ivx-live-qa.mjs          # human-readable
node scripts/ivx-live-qa.mjs --json   # machine-readable
```

It hits live production over the public internet, creates one throwaway QA
account, and exits `0` only if every gate passes. Nothing is hard-coded — every
PASS is computed from a live HTTP response in that run. If it disagrees with this
document, believe the script.

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

### Member registration — 4/5 PASS · Member sign-in — 4/8 PASS

```
PASS  register  rejects invalid input with 4xx
PASS  register  always answers (never hangs)      <- was broken, now fixed
PASS  register  answers within 35s
PASS  register  timeout is retryable, not a hard error
FAIL  register  creates the account (2xx)         -> http=503

PASS  signin    wrong password answers
PASS  signin    no internal timeout string leaked to the member
PASS  signin    401 is a real credential verdict  <- was broken, now fixed
FAIL  signin    wrong password is 401 (not 5xx)   -> http=503
FAIL  signin    newly registered member can sign in
FAIL  signin    sign-in returns a session token
FAIL  signin    auth is stable across repeats     -> 503, 401, 503
FAIL  signin    never returns 503 under normal load
```

---

## WHAT WAS BROKEN, AND WHAT WAS FIXED

### FAULT 1 — members with the CORRECT password were told it was wrong (FIXED)

```
POST /api/members/login  ->  http=401  t=14.2s
message: "Supabase sign-in timed out after 8000ms"
```

The inner 8s timeout **rejected** into the outer catch, and the route mapped every
non-success to HTTP 401. A slow upstream produced a **credential rejection** — a
member typing the right password was told it was wrong. Now it returns a retryable
503 (`auth_upstream_timeout`); a real bad password is still 401. Verified live:
`401 "Invalid email or password." t=3.1s`.

### FAULT 2 — registration hung forever (FIXED)

Measured live: **no response after 180 seconds**. The route had rate limiting but
no deadline. Now a 30s hard deadline returns a retryable 503. Registration always
answers.

### FAULT 3 — the anon key could never complete a password sign-in (FIXED)

```
apikey=garbage                 -> 401 0.07s  "Invalid API key"  (endpoint alive)
apikey=sb_publishable_HD3X...  -> 000 25.0s  NO RESPONSE EVER
apikey=<legacy JWT anon>       -> 400 1.76s  "Invalid login credentials"
GET /auth/v1/settings with sb_publishable_ -> 200 (key is VALID)
```

Production used a new-format `sb_publishable_` key: valid for settings, but
`grant_type=password` with it never returns. Swapped `SUPABASE_ANON_KEY` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` to the legacy JWT anon key
(`ref=kvclcdjmjghndxsngfzb`, matching the service-role key's ref).

### FAULT 4 — `IVX_OWNER_PASSWORD` was missing (FIXED)

Set in Render (verified `http=200`, length 21, exact match) and deployed at
`23:32:12`. The runtime reads it at `ivx-member-auth-certification.ts:62`, where
the dashboard value wins over any stored value.

Result — the binding check flipped:

```
BEFORE: ownerEmail=true ownerPasswordBinding=false   runtimeConfig FAIL
AFTER:  ownerEmail=true ownerPasswordBinding=true    runtimeConfig PASS
```

Owner certification went from 3/8 to 4/8. The remaining 4 failures are not
configuration — they are the upstream, below.

---

## WHY IT IS STILL NOT CERTIFIED — ROOT CAUSE ISOLATED

All four faults above are fixed and deployed. What remains is **not application
code and not configuration**. Supabase auth on project `kvclcdjmjghndxsngfzb` is
failing at the infrastructure level:

```
GET  /auth/v1/health                  -> 200  0.81s   (auth service is UP)
GET  /rest/v1/                        -> 401  0.07s   (data layer is INSTANT)
GET  /auth/v1/settings                -> 000  15.0s   (timeout)
POST /auth/v1/token?grant_type=password -> 400  9.75s  (works, but ~10s)
POST /auth/v1/token?grant_type=password -> 504 "upstream request timeout" x3
```

The database answers in 70 milliseconds. Auth health answers in under a second.
But **the password-grant endpoint returns 504 from Supabase's own edge** — their
gateway giving up on their own auth service. When it does answer, it takes ~10s.

That is why registration cannot complete and sign-in flaps 503/401/502. It cannot
be fixed from application code, and it will not be papered over with a retry loop
that hides a broken dependency.

### Owner password validity: UNDETERMINED

The password is correctly stored and bound. Whether it is the *right* password for
`iperez4242@gmail.com` could **not** be established — 3 attempts at a 90s timeout
all returned `504 upstream request timeout`, so Supabase never rendered a verdict.
This must be re-checked once auth is healthy. It is not claimed as passing here.

---

## WHAT WOULD MAKE IT 100%

1. **Fix Supabase auth on `kvclcdjmjghndxsngfzb`** — open the dashboard and check
   project status, plan/quota, and whether the instance is paused, throttled, or
   needs a restart. The failing operation is the password grant specifically;
   `/auth/v1/health` and the REST layer are fine, so this is isolated to GoTrue.
2. Re-run `node scripts/ivx-live-qa.mjs` — must exit `0` with 27/27.
3. Re-run `/api/ivx/certification/member-auth-public` — must return
   `certified: true` with 8/8, which also confirms the owner password.

### Also outstanding

- Two Supabase project refs appear in the repo (`kvclcdjmjghndxsngfzb` and
  `biikwnqdhsdzyxecekht`). Production consistently uses the former; the latter
  should be removed to prevent a future mismatch.

---

## VALIDATION OF THE CHANGES SHIPPED HERE

```
runChecks (TypeScript + lint + structure):  PASSED, 0 errors
regression tests (auth failure mapping):    14 pass, 0 fail
supabase env guard tests:                   18 pass, 0 fail
```

Deployed: `ff13d3f9` (auth mapping), `f1961f3b` (route status), `f6ee27eb`
(registration deadline), `6d9fc8e5` (QA harness), `eb5734f8` (tests),
`a4275960` (first certificate).

Regression locks live in `backend/ivx-member-auth-failure-mapping.test.ts`, so a
timeout can never again be returned as "invalid password" and registration can
never again ship without a deadline.
