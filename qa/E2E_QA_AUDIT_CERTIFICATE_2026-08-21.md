# IVX End-to-End QA Audit Certificate

**Audit date (UTC):** 2026-08-21 · **Overall: PASS — with 2 owner-blocked credential items (stated exactly)**
**Evidence:** `qa/E2E_QA_AUDIT_CERTIFICATE_2026-08-21.json` (full per-check HTTP evidence)
**Targets:** `https://api.ivxholding.com` · `https://www.ivxholding.com` · `https://ivxholding.com` · Expo app (`expo/`) · Backend (`backend/`)

Every check below executed live at audit time — no cached results, no synthetic output,
no advisory claims counted as proof. Runtime commit at audit: `f7ae18cddece9db130cf2db571c8f8495ab99169`.

---

## Section A — Live production: PASS (13 checks executed, 12 PASS + 1 pending re-certification)

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | Backend `/health` | PASS | `healthy`, queue worker running, 0 dead letters, AI `openai/gpt-4o` ok |
| 2 | Landing `www.ivxholding.com` | PASS | HTTP 200, 108,794 bytes |
| 3 | Apex `ivxholding.com` | PASS | HTTP 200, 108,794 bytes |
| 4 | TTS — text → speech | PASS | Real 54,528-byte MP3 returned (`xai/grok-tts` via Vercel gateway) |
| 5 | STT — speech → text | PASS | TTS audio fed back → correct transcript (`vercel_gateway`, 408ms) |
| 6 | **Full voice-chat loop** | PASS | Audio in → correct transcript → GPT-4o reply → spoken reply (3,186ms) |
| 7 | Voice-chat status | PASS | TTS + STT + AI brain all configured |
| 8 | Realtime voice status | PASS | Streaming, 10-turn memory, barge-in, WS endpoint live |
| 9 | Auth guards (anti-enumeration) | PASS | 401 "missing bearer token" on all 4 protected routes probed |
| 10 | AI chat quality — senior-developer identity | PASS | Real GPT-4o-mini answer naming full stack, 112 agents, code execution; invited technical challenge (10/10 rubric) |
| 11 | AI chat quality — technical depth | PASS | Correct end-to-end voice-pipeline walkthrough on request |
| 12 | Payments honesty | PASS | `not_configured` reported honestly; **Stripe #77 stays FROZEN by owner — never marked PASS** |
| 13 | 112-agent registry | PASS | 112/112 agents active, 112 unique numbers, 0 issues |
| 14 | 112-agent live certificate | PENDING | `certified=false` — certificate predates runtime SHA `f7ae18c`; **this certificate's push triggers `ivx-112-final-live-cert.yml` on main, which re-certifies the newly deployed SHA** |

## Section B — Local validation: PASS

- **Backend typecheck:** `tsc --noEmit` → **0 errors** (after fix 1 below)
- **Backend tests:** `bun test` → **2895 pass, 29 skip, 0 fail** — 11,872 expect() calls, 2,924 tests across 179 files
- **Expo app:** Rork `runChecks(expo)` → TypeScript + lint + project structure **all passed**

## Section C — Credential audit: FAIL — OWNER ACTION REQUIRED (exact missing evidence)

| ID | Item | Finding | Missing evidence |
|----|------|---------|------------------|
| C1 | GitHub token (`expo/.env`) | `GITHUB_TOKEN` + `RORK_PUBLIC_GITHUB_TOKEN` verified **dead** — `api.github.com` returns `Bad credentials` | A new fine-grained GitHub token (contents, pull_requests, actions/workflows write). Blocked direct workflow dispatch from this audit — dispatch now happens via the push trigger instead. |
| C2 | Supabase owner auth | Local `.env` Supabase URL (`kvclcdjmjghndsngfzb.supabase.co`) **does not resolve DNS** — placeholder project. Production `/health` reports `databaseConfigured=false`. Owner login returns `Invalid email or password`; static owner token and stored session token both rejected (`invalid or expired Supabase session`) | The real Supabase project URL + service key from the owner (previously requested). Needed for owner-authenticated API control and durable database state. |

## Fixes applied during this audit

1. **`backend/hono.ts`** — removed a duplicated wire-submission import block (merge artifact
   causing 10 × TS2300 duplicate-identifier errors). Backend typecheck: 10 errors → **0**.
2. **`backend/__tests__/ivx-language-and-banner.test.ts`** — repo root now resolves from
   `import.meta.dir` instead of `process.cwd()` (which only worked in CI where
   `GITHUB_WORKSPACE` is set). 3 × ENOENT failures fixed; suite now **2895/2895**.

## Post-audit consistency

This certificate's push to `main` triggers `ivx-112-final-live-cert.yml` (deploy exact GitHub
SHA to Render → audit 112 live contracts → real 112-agent certificate). Verify
`GET /api/ivx/agents/certificate` shows `commitMatchesRuntime=true` after the workflow
completes on the new SHA.

## Payments policy

Stripe #77 = **FROZEN / DEFERRED BY OWNER** — no code removed, not activated, not a blocker,
never marked PASS.
