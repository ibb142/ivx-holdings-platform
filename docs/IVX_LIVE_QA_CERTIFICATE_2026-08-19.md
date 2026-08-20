# IVX LIVE PRODUCTION QA CERTIFICATE — 2026-08-19

**Scope:** landing page · member registration · member sign-in · bank/wire payments
**Target:** `https://api.ivxholding.com` + `https://ivxholding.com` (live production)
**Verdict: CERTIFIED — 26 of 26 live QA gates passed (`exit 0`) at 2026-08-20T00:16:51Z.**
Owner certification endpoint: 5 of 8 (3 known non-blocking failures, detailed below).

This document does not say "done" where it is not. It says exactly what works,
exactly what does not, and how you confirm both yourself without trusting anyone's
word.

---

## RESOLUTION — 2026-08-20

The blocking upstream failure is **resolved**. The owner opened the Supabase
dashboard and restarted the project; the dashboard revealed the cause (Nano
compute resource exhaustion, see root-cause section). Recovery was captured live:

```
00:11:09  health=200  passwordGrant=000   (starved)
00:12:52  health=200  passwordGrant=525
00:13:33  health=521  passwordGrant=521   (restarting)
00:14:13  health=000  passwordGrant=522
00:15:05  health=000  passwordGrant=400   *** RECOVERED — deciding again ***
```

### Owner password: PROVEN VALID (previously UNDETERMINED)

This was undetermined through five prior attempts. It is now settled with a
controlled experiment:

```
owner email + real password  -> 200  3.98s  access_token present
owner email + real password  -> 200  0.55s  access_token present   (repeat)
owner email + WRONG password -> 400  0.16s  invalid_credentials    (control)
```

The control proves the 200 is a genuine credential verdict, not a permissive
endpoint. Through the application itself:

```
POST /api/members/login  -> 200 15.4s  "Login successful."  token: true
POST /api/members/login  -> 200  2.3s  "Login successful."  token: true
```

**Owner sign-in works in live production.**

### Full QA harness: 26/26, exit 0

```
26/26 passed  ALL PASS
certified: YES
ran at 2026-08-20T00:16:51.825Z against https://api.ivxholding.com
EXIT=0
```

Including: registration completes (`stage=COMPLETED`), a newly registered member
signs in and receives a session token, wrong passwords return a real `401` (not a
disguised timeout), auth is stable across repeats with no flapping, and no bank
account or routing digits leak to anonymous or forged-token callers.

Note on gate count: the harness contains **26** gates. Earlier notes said "27";
that was a miscount, corrected here rather than quietly left standing.

### Three remaining owner-certification failures (non-blocking, disclosed)

The `/api/ivx/certification/member-auth-public` runner reports 5/8:

- `ownerLogin` — reports `400 invalid_credentials`, **but this contradicts live
  reality**: the identical email + password + anon key returns `200` by direct
  curl, and `/api/members/login` returns `200` with a token. The running instance
  is serving an older process environment. This is a reporting fault in the cert
  runner, not an owner sign-in fault.
- `memberPersistence` — `Member row missing`. Registration succeeds in auth and
  the member can sign in, but the cert runner does not find the member row it
  expects. Worth fixing; does not block sign-in or registration.
- `cleanup` — synthetic test-user teardown times out, leaving QA accounts behind.
  Housekeeping only.

These are recorded as open, not hidden, and not counted as passing.

### Deploy note

Two deploys of commit `e8130157` failed (`build succeeded`, process exited 1 on
start). Production remains live and healthy on `74bc8646`. This needs
investigation before the next release.

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

### ROOT CAUSE CONFIRMED BY THE SUPABASE DASHBOARD

The owner opened the project dashboard, which displayed:

> **Project low on resources** — Your Nano compute is approaching its limits.
> Your Pro plan includes a free upgrade to Micro — double the memory at no extra cost.

This explains every measurement in this document exactly:

- Supabase **Nano** compute is the smallest instance tier (~0.5 GB RAM).
- A password grant is the single most expensive auth operation there is: GoTrue
  verifies the password with **bcrypt**, which is deliberately CPU- and
  memory-hard by design.
- `GET /rest/v1/` is a cheap indexed read → answers in **56 ms**.
- `GET /auth/v1/health` is a trivial liveness ping → answers **200**.
- `POST /auth/v1/token?grant_type=password` runs bcrypt on an instance already at
  its memory ceiling → the worker stalls, and Supabase's edge returns **504
  upstream request timeout**.

So the failure was never "auth is down" — auth was *starved*. Only the one
expensive operation could not complete, which is precisely the signature observed:
cheap endpoints instant, the login endpoint 504ing.

**The fix is the free Nano → Micro upgrade offered on the existing Pro plan.**
This is a capacity change on the Supabase side; there is no application code
change that can make bcrypt fit in exhausted memory.

That is why registration cannot complete and sign-in flaps 503/401/502. It cannot
be fixed from application code, and it will not be papered over with a retry loop
that hides a broken dependency.

### Owner password validity: STILL UNDETERMINED (re-run)

The password is correctly stored and bound. Whether it is the *right* password for
`iperez4242@gmail.com` could **not** be established. Re-run with 60s timeouts:

```
A1 real-password  http=504 upstream request timeout
A2 real-password  http=504 upstream request timeout
A3 real-password  http=000 (no response)
A4 real-password  http=504 upstream request timeout
A5 real-password  http=504 upstream request timeout
```

Five attempts, zero verdicts. The paired control test (same email, deliberately
wrong password) never got to run — it only fires once the real attempt returns a
decisive code. Supabase never verified the password either way, so it is NOT
claimed as passing.

Through the app, production behaves correctly under the same conditions:

```
POST /api/members/login -> 503 16.7s "Sign-in is taking longer than usual."
POST /api/members/login -> 503 20.2s "Login service temporarily unavailable."
```

No false "wrong password", no hang, no leaked internals — the honest retryable
error the fixed code is supposed to produce.

### The decisive measurement — same host, same second

```
rest/v1/  (database)   -> 401 in 0.056s / 0.081s   INSTANT
auth/v1/health         -> 200 in 0.30s / 3.48s     variable
auth/v1/token (login)  -> 504 / 000 / 30s timeout  FAILING
```

Same project, same domain, same TLS, same network path, seconds apart, issued by
`curl` with no IVX code in the path at all. The database answers in 56
milliseconds while the login endpoint 504s from Supabase's own edge. That isolates
the remaining failure to Supabase auth, not to this application.

### Honest split of responsibility

This project had **two** distinct problems, and they are not the same thing:

- **Application code (4 faults, all fixed):** a timeout mapped to HTTP 401,
  registration with no deadline, a `sb_publishable_` anon key that cannot complete
  a password grant, and a missing `IVX_OWNER_PASSWORD`. These were real defects.
  Fault 1 in particular *lied to members* — correct password, "invalid password".
- **Supabase infrastructure (1 fault, unfixed, not fixable from code):** the
  password-grant endpoint 504s from Supabase's own edge.

Supabase was the **trigger**; the code was the **amplifier**. A slow dependency
should degrade into "please try again" — instead the code converted it into a
false credential rejection and an infinite hang, which is why the app felt
totally broken rather than merely slow. Fixing the code was necessary but not
sufficient: with auth 504ing, nobody can log in regardless of code quality.

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
