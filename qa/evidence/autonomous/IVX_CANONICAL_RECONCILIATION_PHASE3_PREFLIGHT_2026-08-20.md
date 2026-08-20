# IVX CANONICAL RECONCILIATION + PHASE 3 PRE-FLIGHT — 2026-08-20

Audit rebased on current GitHub HEAD. No secret values in this document.

## A. Canonical source matrix

| Slot | SHA | Source |
|---|---|---|
| CANONICAL_FEATURE_SHA | `e54fb8a7fa5ff3ea3d1da4882fb4dc5933ba0c77` | PR #192 head, re-fetched live |
| CANONICAL_MAIN_SHA | `6ca1cd71f2b9602d079c141805f918279888e7da` | `git/ref/heads/main` |
| LOCAL_RORK_SHA | `307d5df305c0eab25d81985c3ebbc158ffd8d048` | non-canonical |
| RENDER_PRODUCTION_SHA | `6ca1cd71f2b9602d079c141805f918279888e7da` | live `GET /version` |

PR #192: `fix: make IVX 112 senior certification fail closed` — state **open**, **draft: true**,
merged false, base `main`, mergeable `true`, mergeable_state `unstable`, 61 commits, 36 files.

Local Rork SHA lookup in canonical repo → HTTP **422 "No commit found"**. The Rork workspace is
**NON-CANONICAL**. No cherry-pick, force-push, or merge performed.

Prior audit SHA `519890876c41` is now **HISTORICAL** (feature moved ahead by 6 commits).

## B. Current feature SHA
`e54fb8a7fa5ff3ea3d1da4882fb4dc5933ba0c77`

## C. Current main SHA
`6ca1cd71f2b9602d079c141805f918279888e7da`

## D. Current production SHA
`6ca1cd71f2b9602d079c141805f918279888e7da` — equals main, **≠ canonical feature SHA**.

## E. CI matrix on CURRENT feature SHA (14 check runs, combined state `failure`)

| Gate | Status | Verdict |
|---|---|---|
| Phase 1 Autonomous Governance — HARD GATE | completed/success | PASS |
| Phase 2 Agent Capability + Least Privilege — HARD GATE (x2) | completed/success | PASS |
| Senior quality gate regression suite | completed/success | PASS |
| scan-secrets (Secret Leak Scanner) | completed/success | PASS |
| qa-suite | completed/success | PASS |
| Playwright E2E (web surface) — HARD GATE | completed/success | PASS |
| Landing register/sign-in/wire live — HARD GATE | completed/success | PASS |
| Lint — HARD GATE | completed/success | PASS |
| TypeScript typecheck — HARD GATE | completed/success | PASS |
| **Maestro E2E (mobile surface) — HARD GATE** | **queued** | **NOT PASS (queued ≠ pass)** |
| Header rules - ivxholding | completed/failure | FAIL (Netlify) |
| Pages changed - ivxholding | completed/failure | FAIL (Netlify) |
| Redirect rules - ivxholding | completed/failure | FAIL (Netlify) |

The 3 `ivxholding` failures are one Netlify site deploy, not backend gates.
`Governed autonomous audit` failed on `519890876c41` but is **absent from the current HEAD run
set** — labeled **HISTORICAL**, not a current failure.

## F. Wire source security result — PASS

`backend/api/ivx-wire-transfer.ts` @ `e54fb8a7` is **byte-identical** to `519890876c41`
(sha256 `6e1b412a77db434e…`), as is `server.ts` (`7ad120ea79bc3da1…`). The 6 new commits touched
only agent least-privilege files. Re-verified directly on current HEAD:

- `handleSecureWireInstructions`: JWT via `resolveWireAuthenticatedMember`, 401 fails closed,
  identity from `member.*`, body `userId` never used
- `handleSecureWireSubmission`: same + `isWireReferenceForMember` → 403 on foreign reference
- `server.ts`: `productionFetch` intercepts `/wire-instructions`, `/wire-submission`,
  `/wallet/debit` before the legacy Hono router

Current secure source was **not** modified or replaced with older local code.
`SOURCE_FIXED = true`.

## G. Live production wire result — FAIL (stale deploy, SHA `6ca1cd71`)

| Test | Expected | Actual | Verdict |
|---|---|---|---|
| A anon GET wire-instructions | 401, no bank values | 200 preview; **no routing/account** | PARTIAL (no data leak; wrong status) |
| B fake bearer GET wire-instructions | 401/403, no bank values | 200 preview; **no routing/account** | PARTIAL (no data leak; wrong status) |
| C anon POST wire-submission | 401 | **200, persisted** | **FAIL** |
| D fake bearer POST wire-submission | 401/403 | **200, persisted** | **FAIL** |
| E auth USER_A, body `userId`=VICTIM | identity stays USER_A | **200; stored userId = VICTIM** | **FAIL — impersonation** |
| F foreign reference code | 403 | **200, persisted** | **FAIL** |

E is the most serious: the record persisted under the body-supplied victim id, not the
authenticated owner id. No funds moved. All 6 probes were `qa:true`, purged owner-authenticated
(`removed:2` x3), and re-verified absent; the single remaining record (`IVX-QAPROBE-0001`,
17:09Z) predates this audit and was untouched.

`PRODUCTION_STALE = true`. The current GitHub source is **not** vulnerable.

## H. APK artifact + secret scan

| Field | Value |
|---|---|
| filename | `app-release.apk` |
| sha256 | `860a03ccfef44f8e973240e9e1304024ca94443d7c8bfdf4cb8f592335b8c570` |
| bytes | 15,537,625 |
| source Git SHA | `307d5df305c0…` — **LOCAL RORK, not in canonical GitHub (422)** |
| build command | `runChecks(android-ivx-holdings)` → `gradlew assembleRelease` |
| build timestamp | 2026-08-20 19:01:29 |
| scan tool | inline python exact-value + regex-class sweep |
| files scanned | 458 APK entries (53,230,324 bytes) + 2,103 incl. intermediates |
| forbidden patterns scanned | 8 classes (`gh[pousr]_`, `github_pat_`, `rnd_`, `service_role`, `vck_`, `sk-`, `AKIA`, PEM) |
| exact-value scan validity | **10/10** forbidden keys held searchable token-shaped values |
| **forbidden_secret_matches** | **0** |

Scan result PASSES, but the artifact was built from **non-canonical source**, so it cannot
support final certification of `e54fb8a7`. A CI-built artifact from the canonical SHA is required.

## I. Credential binding matrix (live, sanitized)

| Provider | Endpoint | HTTP | Status |
|---|---|---|---|
| GitHub | `api.github.com/user` | 401 | PRESENT_BUT_UNAUTHORIZED — `"Bad credentials"` |
| Render | `api.render.com/v1/services` | **200 with recovered key** / 401 with `.env` value | BOUND_AND_VALID (key valid; `.env` copy is prose) |
| Supabase (prod backend) | `/api/members/login` | 200 | BOUND_AND_VALID |
| Supabase (local anon) | `/auth/v1/settings` | 401 | PRESENT_BUT_UNAUTHORIZED — `"Invalid API key"` |
| AI provider | `ai-gateway /v1/models` | 401 | PRESENT_BUT_UNAUTHORIZED — `"Authentication failed"` |
| Twilio | `api.twilio.com/Accounts` | 401 | PRESENT_BUT_UNAUTHORIZED — code 20003 |
| AWS | key id = `AKIAIOSFODNN7EXAMPLE` | n/a | MISSING_BINDING (AWS public doc example key) |

**Env files are platform-managed and regenerate.** Repairs written earlier this session were
reverted: `RENDER_API_KEY` is prose again (len 44), `SUPABASE_URL`/`IVX_SUPABASE_URL` back to 739
chars, `RENDER_SERVICE_ID` 1058 chars. Editing `.env` is therefore **not** a durable fix — these
must be corrected in the Rork environment-variable settings. This also explains the Render A/B
result: the recovered key returns 200, the `.env` copy returns 401.

None of these 401s indicate defective application code.

## J. Phase 3 readiness — PHASE3_NOT_READY

Phase 1 and Phase 2 evidence **accepted, not rebuilt**. Phase 2 controls re-verified present at
current HEAD across all 4 in-scope files (112 agents, no wildcard private reads, Division B
isolation, CRM read/write/update scoping, code-draft limits, sandbox isolation, role-scoped
research, no `money_movement` / `trade_execution` / `legal_execution`, production deploy
unavailable, evidence tool per agent). No engineering tools were granted to manufacture 112/112.

Phase 3 gate (§8) requires repository/production identity to be clear first. It is not:
production runs a different SHA than the approved source, and PR #192 is still a draft.
Phase 3 positive/negative execution batteries were therefore **NOT RUN** — running them against
a stale runtime would produce evidence bound to the wrong `sourceSha`. No queued/simulated
result has been converted to SUCCESS.

## K. Actual blockers

1. **GitHub credential 401** — cannot push/merge; `MERGE_OWNER_APPROVAL_REQUIRED` (PR #192 is draft).
2. **Maestro E2E hard gate still `queued`** on `e54fb8a7`.
3. **3 Netlify checks failing** on `e54fb8a7` (`ivxholding` site deploy).
4. **Render tracks `main`, autoDeploy on** — any deploy today rebuilds `6ca1cd71`. Retargeting to
   an exact feature SHA is a production config change; not authorized, not performed.
5. **Env vars are prose in platform storage** — must be fixed in Rork env settings, not `.env`.
6. Supabase anon key, AI gateway key, Twilio token invalid; AWS never bound.
7. Supabase `service_role` rotation still outstanding (74 occurrences in public git history).

## L. Certificate status

- `SOURCE_CODE_CERTIFIED` — **YES** for the wire/edge-routing scope at `e54fb8a7`
  (source verified + local regression 2959 pass / 0 fail, security contract 28/28, tsc 0)
- `PRODUCTION_STALE` — **YES**
- `DEPLOYMENT_BLOCKED_AUTH` — **YES** (plus blocked CI and branch-target)
- `PHASE3_NOT_READY` — **YES**
- `PRODUCTION_CERTIFIED` — **NO**

Production SHA ≠ approved SHA; wire negative tests C–F fail live; a hard gate is queued; the
scanned artifact is not from the canonical SHA. Certification withheld.
