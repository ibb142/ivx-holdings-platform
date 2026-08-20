# IVX SOURCE-OF-TRUTH + PRODUCTION SECURITY RECONCILIATION — 2026-08-20

No secret values appear in this document.

## 1. Canonical repo + branch

- CANONICAL_REPO: `ibb142/ivx-holdings-platform` (public, default branch `main`)
- CANONICAL_BRANCH: `fix/senior-certification-hard-gates`
- Local Rork workspace remote is `rork-git-router.rork-direct.workers.dev/git/j2l8t44588ix9ns7b57mu`
  — **not** the canonical GitHub repo. The Rork workspace is NOT canonical.

## 2. Four-way SHA matrix

| Slot | SHA | Notes |
|---|---|---|
| LOCAL_HEAD (Rork) | `c42705712a44` | branch `main`, 7 dirty files (all `.rork/history` transcripts) |
| GITHUB_FEATURE_HEAD | `519890876c41` | `fix/senior-certification-hard-gates`, 2026-08-20T18:48:34Z |
| GITHUB_MAIN_HEAD | `6ca1cd71f2b9` | 2026-08-20T01:42:40Z |
| RENDER_PRODUCTION_SHA | `6ca1cd71f2b9` | from live `GET /version` |

Feature vs main: **ahead 55, behind 0**, 31 files changed. Local Rork history does not
contain `6ca1cd71` — divergent. No deploy, cherry-pick or force push performed.

## 3. Wire finding verified against canonical GitHub code

`backend/api/ivx-wire-transfer.ts` @ `519890876c41` — **SECURE**. Exports
`resolveWireAuthenticatedMember`, `handleSecureWireInstructions`,
`handleSecureWireSubmission`, `recordWireSubmission`.

- verified Supabase JWT server-side via `client.auth.getUser(token)` — YES
- anonymous/invalid token → `401` fails closed — YES
- identity derived from `member.userId` / `member.email` / `member.name`; body `userId`
  never reaches `recordWireSubmission` — YES
- `isWireReferenceForMember(referenceCode, member.userId)` → `403` on mismatch — YES
- bank/routing/account read from env, never in source; instructions require auth — YES

`server.ts` @ `519890876c41` — `productionFetch` intercepts `/api/ivx/wire-instructions`,
`/api/ivx/wire-submission`, `/api/ivx/wallet/debit` **before** the legacy Hono router.

**CORRECTION TO MY PREVIOUS REPORT:** I earlier called the wire code vulnerable based on a
regex that missed the delegated `resolveWireAuthenticatedMember` helper. That was wrong.
**The feature branch is not vulnerable.** `SOURCE_FIXED=true`.

`main` @ `6ca1cd71` (what production runs) — **STALE**: `server.ts` has `productionFetch`
but does **not** import or route to any `handleSecureWire*`; `ivx-wire-transfer.ts` is
3,989 bytes exporting only `recordWireSubmission`, no auth resolver.
`PRODUCTION_STALE=true`.

## 4. Live production negative tests (SHA `6ca1cd71`)

| Test | Expected | Actual | Verdict |
|---|---|---|---|
| anon `GET /wire-instructions` | no routing/account | `200`, preview only, no routing/account | PASS |
| anon `POST /wire-submission` | `401` | **`200` — persisted** | **FAIL** |
| fake bearer `POST /wire-submission` | `401` | **`200` — persisted** | **FAIL** |

Production accepts unauthenticated wire submissions and body-supplied `userId`.
Test hygiene: both probes were QA-flagged and purged via owner-authenticated
`purge-qa` (`removed: 2`), re-listed and confirmed absent. The 1 remaining record
predates this audit (different domain, 17:09Z) and was not touched.

## 5. Release APK forbidden-secret scan — PASS

Real `assembleRelease` build: `app-release.apk`, 15,537,625 bytes, 458 entries,
3 dex files.

- exact-value scan of every held credential across 53,230,324 bytes: **forbidden_secret_matches = 0**
- scan validity: **10/10** forbidden keys held real searchable token-shaped values
  (a prose value would have made "0 hits" meaningless — explicitly checked)
- pattern sweep of APK + 2,103 build files: `ghp_`/`github_pat_`/`rnd_`/`service_role`/
  `vck_`/`sk-`/`AKIA` → **0**

**CORRECTION TO MY PREVIOUS REPORT:** I earlier claimed the GitHub token and AI keys were
compiled into `Config.class`/`Config.dex`. Re-scanned with exact values: **0 matches** in
the APK and 0 in 1,107 intermediate artifacts. That claim was wrong and is withdrawn.
`Config.kt` holds empty-string constants and is platform-generated/read-only.

Residual risk (not a binary finding): `RORK_PUBLIC_GITHUB_TOKEN` and `RORK_PUBLIC_IVX_AI_KEY`
are stored under client-exposed prefixes. They are not in this binary, but the prefix
contract means they are eligible for client inlining. They should be re-homed as
server-only vars.

## 6. Environment governance

One canonical file per runtime is NOT yet true: `expo/.env` and
`android-ivx-holdings/.env` are byte-comparable duplicates carrying backend secrets.
Both are untracked and gitignored (verified). Backend secrets must not live in the
mobile env file.

Repaired this pass (both files): `SUPABASE_URL` and `IVX_SUPABASE_URL` were 739-char prose;
extracted the real origin (len 40). This was the cause of the earlier `000` auth failures.

## 7. Provider credential binding status

| Provider | Status | Evidence |
|---|---|---|
| Render | BOUND_AND_VALID | `GET /v1/services` → 200; service id resolves to `ivx-holdings-platform` |
| Supabase (backend, prod) | BOUND_AND_VALID | prod `/api/members/login` → 200, owner session issued |
| Supabase (local anon key) | PRESENT_BUT_UNAUTHORIZED | `auth/v1/token` → 401 `Invalid API key` — key does not match project origin |
| GitHub | PRESENT_BUT_UNAUTHORIZED | api.github.com auth → 401 (repo readable anonymously; **push blocked**) |
| AI provider | PRESENT_BUT_UNAUTHORIZED | prod `/health` → `ai.ok:false`; 2 distinct keys → 401 |
| Twilio | PRESENT_BUT_UNAUTHORIZED | REST auth → 401 |
| AWS | MISSING_BINDING | key id is `AKIAIOSFODNN7EXAMPLE`, AWS's public doc example — never a real credential |

GitHub 401 is a credential-binding fact only; it is not evidence of broken application code.

## 8. Security regression (local workspace)

- full backend suite: **2959 pass / 0 fail / 29 skip**, 11,702 assertions, 183 files
- `ivx-bank-grade-security-contract.test.ts`: **28 pass / 0 fail**
- root TypeScript: **0 errors**; expo static checks: **0 errors**; android build: **succeeded**

## 9. Deployment

**NOT PERFORMED.** Blocked by three independent conditions:

1. **CI not green on `519890876c41`** — 14 check runs: 9 success, 4 failure
   (`Redirect rules - ivxholding`, `Header rules - ivxholding`, `Pages changed - ivxholding`
   — all one Netlify deploy failure; plus `Governed autonomous audit — no production mutation`),
   and `Maestro E2E (mobile surface) — HARD GATE` still **queued**. Combined status: `failure`.
2. **Render tracks the wrong branch** — service `ivx-holdings-platform`, repo matches
   canonical, but `branch = main`, `autoDeploy = yes`. Deploying today rebuilds `6ca1cd71`.
   Retargeting to the feature branch is a production config change and was not authorized.
3. **GitHub push auth = 401** — the fix cannot be merged from here.

No merge to `main` was performed.

## 10. Certificate verdict

**IVX SOURCE-OF-TRUTH + PRODUCTION SECURITY CERTIFICATE — NOT ISSUED**

- CODE FIX (canonical feature branch `519890876c41`) = **PASS**
- RELEASE APK FORBIDDEN-SECRET SCAN = **PASS (0)**
- LOCAL REGRESSION = **PASS**
- CI ON EXACT SHA = **FAIL** (4 failing checks, 1 hard gate queued)
- DEPLOYMENT = **BLOCKED_AUTH + BLOCKED_CI + BLOCKED_BRANCH_TARGET**
- PRODUCTION = **NOT CERTIFIED** (live exploit reproduced and confirmed)

The code is fixed. Production is stale and exploitable. These are separate facts.

## Unresolved blockers (owner action)

1. GitHub credential with push rights — nothing reaches production without it.
2. Green the 4 failing checks and let Maestro finish on `519890876c41`.
3. Decide the deploy path: merge feature → `main`, or authorize retargeting Render's branch.
4. Rotate the Supabase `service_role` key (74 occurrences in public git history).
5. Re-home `RORK_PUBLIC_GITHUB_TOKEN` / `RORK_PUBLIC_IVX_AI_KEY` as server-only vars.
6. Issue real AWS keys; restore AI gateway and Twilio credentials.
