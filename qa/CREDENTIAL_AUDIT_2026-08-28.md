# IVX Credential Audit — End-to-End QA (2026-08-28)

Scope: full workspace scan for hardcoded secrets, credential source mapping, fail-closed auth verification, CI exposure check. Method: git-tracked file greps (`git grep`, `git ls-files`), pattern sweeps (ghp_/github_pat_/rnd_/sk-/AKIA/xox/Twilio SID/JWT literals), workflow review, auth-path code review.

## Fixes applied (2026-08-28, this session)
- [x] C2 FIXED: both `shoot-chat-*.mjs` scripts now read `IVX_OWNER_EMAIL`/`IVX_OWNER_PASSWORD` from env and EXIT 1 (fail-closed) if unset; hardcoded values removed. Syntax-verified; secret guard clean; security tests 34/34 PASS.
- [x] Report self-redacted: this file no longer carries live secret values.
- [ ] ROTATION (owner-only): Render API key + IVX owner password must still be rotated — exposure already exists in git history.
- [ ] PURGE (owner/CI): `git rm -r --cached .rork/history` + history scrub (BFG/filter-repo). Guard blocks `.rork/history` on new commits.
- [ ] RELABEL: local `.env` files hold an anon JWT under `IVX_AI_SYSTEM_SECRET` and the public Supabase demo key under `SUPABASE_SERVICE_ROLE_KEY`.

## Verdict: 2 CRITICAL leaks (git-tracked, repo is public) — rotate + purge required.

## CRITICAL findings

### C1. Live Render API key committed to git
- Value: `rnd_1H0X***REDACTED***` (REAL, was live against service `srv-d7t9ivreo5us73ftose0`; full value remains in the leaked files below — never re-paste it)
- Where (git-tracked, 72 occurrences):
  - `.rork/history/main/00mtcg2xjg001_4d63e57a5giuxedvbfrzu_assistant.json` (19)
  - `.rork/history/main/00mtcm74tl000_eda505nli0ccvf1u6egbs_assistant.json` (39)
  - `.rork/history/main/00mtcj7axj000_69qipxq6c6i4csy4lbmpy_assistant.json` (13)
  - `.rork/history/main/00mtclum4a000_mkx8y9k83a969tvygwky1_assistant.json` (1)
- Root cause: Rork chat transcripts contain pasted tokens in plaintext. The pre-commit guard (`scripts/ivx-secret-guard.mjs`, hooked via `.githooks/pre-commit`) now BLOCKS `.rork/history/` and secret patterns on staged files — but these 4 files were tracked BEFORE the guard existed.
- Required action: rotate the Render key in Render dashboard; `git rm -r --cached .rork/history`; purge from git history (filter-repo/BFG); add `.rork/` to `.gitignore`.

### C2. Real owner password hardcoded in tracked scripts
- Value: `X146c***REDACTED***` (full value remains in the leaked files below — never re-paste it) at line 9 of BOTH:
  - `qa-archive/historical/scripts/shoot-chat-fix-proof.mjs`
  - `qa-archive/historical/scripts/shoot-chat-real-proof.mjs`
- Required action: replace hardcoded `const PASSWORD` with `process.env.IVX_OWNER_PASSWORD` + fail-closed guard; rotate owner password (it was exposed in a public repo); purge from history.

## Local (untracked) secret stores — verified correctly ignored
- `expo/.env`, `android-ivx-holdings/.env` — `git check-ignore` confirms ignored (`expo/.gitignore:42`, `android-ivx-holdings/.gitignore:36`). Contents present on disk only:
  - `IVX_OWNER_PASSWORD` (real — same value as C2; rotating per C2 covers both)
  - `IVX_TWILIO_ACCOUNT_SID=ACb44cb1d853b03144f7799d5eea09f63a` + `IVX_TWILIO_AUTH_TOKEN` (real-format; NOT in any tracked file — clean)
  - `SUPABASE_SERVICE_ROLE_KEY` — value is the public Supabase DEMO key (issuer `supabase-demo`), not a production secret
  - `IVX_AI_SYSTEM_SECRET` — value is actually a Supabase anon JWT (role `anon`, ref `kvclcjdmjghndxsngfzb`), mislabeled; the real system secret lives only in private envs

## Credential source map (where everything lives)
- GitHub Actions: 54 workflows reference `${{ secrets.* }}`; ZERO raw literal secrets, ZERO `echo` of secrets found in `.github/workflows/` — clean.
- Backend runtime: private envs (Render service env-vars, per-key PUT) > encrypted Supabase `ivx_owner_variables` store (AES-256-GCM, key = sha256(JWT_SECRET), AAD `ivx_owner_variables:v1`) — bridge in `backend/services/ivx-owner-variables.ts`, runtime reads via `readRuntimeVariable` (env-first, warn-loud on fallback).
- Test fixtures: fake tokens only (`ghp_abcdef…`, `rnd_abcdef…`, `AKIAEXAMPLEKEY123456`, `AKIAIOSFODNN7EXAMPLE` = AWS documentation example, documented dead in qa/evidence) — safe.
- AWS: `AWS_ACCESS_KEY_ID` env is the doc example key — never a real credential (verified in 3 prior live deploy attempts).

## Fail-closed verification (code-audited)
- `backend/api/owner-only.ts`: `assertIVXOwnerOnly` → 401 on missing/invalid bearer; `checkIVXAISystemKey` → false on absent/mismatched key; `IVXOwnerApprovalError` → 403 with blocker on owner-approval failure. No open fallbacks.
- Response redaction: `maskCredential`, `detectSecretLeak`, `assertNoSecretsInResponse` in `backend/services/ivx-pre-execution-feasibility-gate.ts` (pinned by `backend/__tests__/ivx-security-gate6.test.ts`).
- Pre-commit guard: `.githooks/pre-commit` → `scripts/ivx-secret-guard.mjs --staged` (blocks `.rork/history`, `.rork/plans`, token/key patterns; install via `scripts/ivx-protect-secrets.sh`).
- Tracked-source scan (this audit): no real vck_/sk-/AKIA/ghp_/rnd_ material in app source outside the two findings above.

## Action checklist (owner-gated)
1. ROTATE: Render API key + IVX owner password (both publicly exposed).
2. PURGE: `git rm -r --cached .rork/history qa-archive/historical/scripts/shoot-chat-*.mjs`; BFG/filter-repo history purge; force-protect via `.gitignore`.
3. FIX: replace hardcoded passwords with env + fail-closed guard in the 2 archive scripts.
4. RELABEL: fix `IVX_AI_SYSTEM_SECRET` mislabeling in local `.env` files (holds an anon JWT, not a system secret).

## END-TO-END LIVE VERIFICATION (2026-08-29, with owner-provided `expo/.env`)

Every credential in the owner-supplied env was tested against its real service (values never echoed).

### Credential matrix (live check results)
| Credential | Test | Result |
|---|---|---|
| `GITHUB_TOKEN` (ghp_, 40c) | `GET /user` | **DEAD — Bad credentials (revoked)** |
| `RORK_PUBLIC_GITHUB_TOKEN` (ghp_, 40c) | `GET /user` | **DEAD — Bad credentials** |
| `IVX_OWNER_TOKEN` / `IVX_OWNER_TOKEN_SESSION` (JWT) | `GET /user` | **DEAD — Bad credentials** |
| `RENDER_API_KEY` (rnd_…) | `GET /v1/services` | **LIVE — and identical to leak C1 → still NOT rotated (CRITICAL open)** |
| `SUPABASE_ACCESS_TOKEN` | `GET /v1/projects` | LIVE (200) |
| `IVX_OWNER_SUPABASE_ACCESS_TOKEN` | `GET /v1/projects` | DEAD (401) |
| `SUPABASE_SERVICE_ROLE_KEY` vs `kvclcdjmjghndxsngfzb.supabase.co` | `GET /rest/v1/` | 401 — confirmed demo/mismatch key, not a production secret |
| `SUPABASE_URL`, `IVX_SUPABASE_URL`, `RENDER_SERVICE_ID` entries | inspection | corrupted multi-line placeholder text in `expo/.env` (real values live only in Render env config) |
| `IVX_OWNER_PASSWORD` | prefix match vs leak C2 | **UNROTATED — still the leaked value (CRITICAL open)** |

### Repo divergence discovered (delivery blocker)
- Rork router mirror `main` = `963463160` (all enterprise repair fixes) — NOT on GitHub.
- GitHub `main` = `f4066a05` (parent `fd575c060`; fork point `1da5d45b1`) — contains NONE of the router-side fixes.
- Production (Render `srv-d7t9ivreo5us73ftose0`, GitHub-linked, autoDeploy off) runs `f4066a05`; `/version` reports it.
- Deploy of the certified SHA via Render API → HTTP 404 (`does not have a commit 963463160…`) — correct: the commit does not exist on GitHub.
- All GitHub write credentials are revoked → branch+PR delivery, merge, and production fix deployment are **BLOCKED** until the owner supplies a valid `GITHUB_TOKEN` (or restores router→GitHub sync).

### Leak containment status (re-verified against GitHub `f4066a05`)
- C1 (Render key in `.rork/history/main/*.json`): **NOT on GitHub** (raw fetch 404) — leak confined to the Rork router mirror; rotation still required because the same key is LIVE (see matrix).
- C2 (owner password in `qa-archive/historical/scripts/shoot-chat-*.mjs`): the env-based fail-closed FIX exists only on the router mirror; **GitHub main @ `f4066a05` still carries the hardcoded password (1 verified hit)** — CRITICAL live on the public repo until the fix branch is delivered.

### End-to-end verdict
- Verifiable-live credentials: Render key (leaked+unrotated), Supabase access token (clean), owner password (leaked+unrotated).
- Dead credentials: 2× GitHub PATs, 2× owner JWTs, 1× Supabase owner token, 1× service-role demo key.
- Owner actions remain: (1) issue a valid GitHub token to unblock delivery; (2) rotate Render key; (3) rotate owner password; (4) purge `.rork/history` + archive scripts from GitHub history once write access exists.
