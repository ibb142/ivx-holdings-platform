---
name: "IVX IA final certification — terminal-state fix + 12-section honest PASS/FAIL verdict"
overview: "Complete the final IVX IA certification: fix the one remaining code defect (terminal-state completion rules so a commit-only CODE_CHANGE ends COMPLETED), then run all existing test suites, live probes, and security greps to produce an honest 10-line PASS/FAIL verdict backed by live evidence — no new features, no refactor."
createdAt: 2026-07-21T18:08:36.341Z
---
# IVX IA final certification — terminal-state fix + 12-section honest PASS/FAIL verdict

Complete the final IVX IA certification: fix the one remaining code defect (terminal-state completion rules so a commit-only CODE_CHANGE ends COMPLETED), then run all existing test suites, live probes, and security greps to produce an honest 10-line PASS/FAIL verdict backed by live evidence — no new features, no refactor.

## Certification approach

Only ONE code change is needed: the terminal-state fix (section 2), already designed in the prior plan at `.rork/plans/ivx-terminal-state-completion-rules-comm_1784656772038.plan.md`. Every other section is certification by running existing test suites, live probes, and security greps — no new features, no refactor, no architecture change, no production data change. Honest PASS/FAIL per section, with blockers + corrective actions for any FAIL.

## Section 1 — Autonomous Coder Certification (live probe)

- Re-mint owner token via `POST https://api.ivxholding.com/api/ivx/owner-passwordless-login` `{"email":"iperez4242@gmail.com"}`.
- Cancel all prior orphaned jobs.
- Submit ONE chat prompt: "Add a one-line comment // IVX convergence proof 2026-07-21 final above the line export const PILOT_LABEL in backend/services/ivx-autonomous-coder-pilot.ts. Run targeted tests. Commit to GitHub. Do not deploy."
- Poll the job to terminal in the background (no mid-job deploy/restart).
- Return: Task ID, files changed, tests executed, typecheck, commit SHA, GitHub verification (curl GitHub API), Render deploy ID (null — not requested), runtime commit (`/health`), `/health` response, total execution time.

## Section 2 — Terminal State Fix (the one code change)

Files changed (3):
- `backend/services/ivx-task-state-machine.ts` — add `COMPLETED` terminal state + legal transitions from `CODE_CHANGED`/`TESTING`/`READY_TO_DEPLOY`/`QA_IN_PROGRESS`/`ANALYZING`; add `to === 'COMPLETED'` branch in `assertCanTransition()` accepting `deployRequested`, `typecheckPassed`, `commitVerified`, `taskType`. Dev task NO_DEPLOY: requires filesChanged>0 + testsRun + testsPassed + typecheckPassed + commitVerified; deploy/feature-verification NOT required when `!deployRequested`. READ_ONLY: findings only. QA_ONLY: testsRun only. DEPLOY_ONLY: commitVerified + deployId + productionHealthOk. Keep `VERIFIED` branch unchanged for full deploy path.
- `backend/services/ivx-senior-developer-worker.ts` — add `deployRequested: boolean` to `IVXWorkerJobResult`; target `COMPLETED` (not `VERIFIED`) when `finalStatus === 'COMPLETE' && !deployRequested`; pass new guard fields; in the downgrade branch, do NOT downgrade when the refused reason is a non-requested stage; map `COMPLETED` → job status `completed` at lines 1469/1520/1620/1681/1745.
- `backend/services/ivx-autonomous-coder.ts` — add `deployRequested: boolean` to `IVXAutonomousCoderResult`; set from prompt intent (true if `deployFn` invoked, false if "do not deploy" or deploy skipped). No engine-loop changes.

7 regression tests in `backend/services/ivx-task-state-machine.test.ts`:
1. Commit requested, deploy not requested → COMPLETED after commit verification.
2. Deploy requested → not COMPLETED/VERIFIED until deploy + production verify pass.
3. Read-only task → COMPLETED with no patch/commit/deploy.
4. QA-only task → COMPLETED after targeted tests.
5. Commit succeeds but tests fail → FAILED.
6. Commit succeeds and GitHub verification passes → COMPLETED.
7. Non-requested production verification missing → no failure.
Plus update the `has exactly 17 states` test to 18.

## Section 3 — IVX IA Chat Routing Certification

- Run `bun test backend/services/ivx-owner-ai-intent-router.test.ts` + `ivx-multimodal-routing.test.ts` + `ivx-pre-execution-feasibility-gate.test.ts` + `ivx-senior-developer-autonomous-mode.test.ts` + `ivx-response-control.test.ts`.
- Verify routing paths via the test assertions: Code Change → `code_change` executionMode; QA → `qa_only`; Read Only → `read_only`; Deployment → `deploy` (only with owner approval); Owner Approval → gated by confirmText; Factory Mode → `factory`; Module Creation → factory subpath. Confirm "find and fix" never routes to deploy-only.

## Section 4 — Owner Authentication

- Run `bun test expo/__tests__/ivx-enterprise-auth-recovery.test.ts` + `ivx-owner-auth-transitions.test.ts` + `ivx-admin-route-protection.test.ts` + `backend/ivx-owner-registration-supabase-mismatch.test.ts`.
- Live: re-mint owner token (correct login), verify `/health` with token, verify a protected endpoint rejects without token (non-owner rejection).
- Report PASS/FAIL per check (correct login, incorrect password, forgot password, password reset, logout, login again, session persistence, app restart, owner dashboard, admin hub, owner variables, owner permissions, non-owner rejection). For checks not exercisable from sandbox (app restart, owner dashboard UI), mark VERIFIED VIA TEST SUITE and cite the passing test.

## Section 5 — Member Authentication

- Run `bun test backend/` filtered to member/investor/buyer/realtor/staff test files.
- Report PASS/FAIL per check (members, investors, buyers, realtors, staff, password reset, email verification, session restore, logout, recovery flow). Where no dedicated test exists, mark NOT COVERED with a corrective action (add test), do NOT claim PASS.

## Section 6 — Enterprise QA

- Run `bun test backend/` (full 1711-test suite) and `bun test expo/__tests__/` (where runnable).
- Report PASS/FAIL per module (auth, authorization, chat, properties, deals, investors, members, buyers, media, notifications, documents, variables, settings, admin hub, owner dashboard, landing page, reels, search, messages). Any module with zero test coverage → FAIL with corrective action.

## Section 7 — Chat QA

- Run `bun test backend/public-chat-ai.test.ts` + `public-chat-supabase-store.ts` + `public-chat-vision.test.ts` + `backend/ivx-landing-payment-sync.test.ts` + any expo chat tests.
- Report PASS/FAIL per check (no duplicate messages, no disappearing, ordering, keyboard, attachments, images, videos, reconnect, background, resume, pagination, history, typing, streaming, long conversations). Gaps → FAIL with corrective action.

## Section 8 — Deployment QA

- `curl https://api.ivxholding.com/health` → commit + status.
- `curl https://api.github.com/repos/ibb142/rork-global-real-estate-invest/commits/HEAD` → GitHub HEAD SHA.
- Compare runtime commit === GitHub HEAD. Report PASS/FAIL on commit match.
- APK: report current version (v1.4.31 per session), version code (63), download URL (`https://ivxholding.com/apk/ivx-holdings-v1.4.31.apk`). No APK rebuild unless requested.

## Section 9 — Security QA

- Grep `expo/` for `SUPABASE_SERVICE_ROLE_KEY` usage in client bundles — verify only referenced in server-only paths (API routes, env-config warnings), not inlined into client code.
- Grep `expo/` for `rork.app` / `rork-sdk` / Rork runtime URLs — expect zero matches in production code paths.
- Grep all source for hardcoded passwords — expect zero.
- Verify owner approval phrases (CONFIRM_IVX_GITHUB_WRITE, _RENDER_DEPLOY, _APK_UPLOAD, _FACTORY_MODE, _SAFE_CODE_PATCH, _GIT_DEPLOY_OPERATOR, _LANDING_UPLOAD, _RENDER_SERVICE_UPDATE, _SUPABASE_MIGRATION) are enforced in backend action endpoints.
- Verify MFA optional/OFF by default via `ivx-enterprise-auth-recovery.test.ts` Phase 11 test.
- Report PASS/FAIL per check.

## Section 10 — Performance QA

- From the sandbox: run the backend test suite and report wall-clock time + memory via `bun test` (no dedicated perf suite exists). Mark properly: PERFORMANCE QA = NOT FULLY EXERCISABLE FROM SANDBOX (no load testing harness). Do NOT claim PASS without evidence. Provide corrective action: add a perf/load test harness as a follow-up.

## Section 11 — Final Evidence

Return verified: repository (`ibb142/rork-global-real-estate-invest`), branch (`main`), commit SHA (from GitHub HEAD + runtime `/health`), Render deploy ID (from live deploy after section 2), runtime SHA (from `/health`), APK version (v1.4.31), APK download URL, `/health` response, tests passed/failed (from `bun test backend/`), typecheck (from `bun x tsc --noEmit` if time permits, else scoped), production verification (from live probe).

## Section 12 — Final Certification

Mark COMPLETE only if sections 1-11 all PASS with live evidence. Return the 10-line verdict:
- AUTONOMOUS CODER: PASS / FAIL
- IVX IA CHAT: PASS / FAIL
- OWNER AUTH: PASS / FAIL
- MEMBER AUTH: PASS / FAIL
- CHAT: PASS / FAIL
- ENTERPRISE QA: PASS / FAIL
- DEPLOYMENT: PASS / FAIL
- SECURITY: PASS / FAIL
- APK: PASS / FAIL
- PRODUCTION: PASS / FAIL
- FINAL STATUS: CERTIFIED FOR PRODUCTION / NOT CERTIFIED

For every FAIL: exact blocker, affected file(s), root cause, corrective action, estimated completion.

## Execution order

1. Implement section 2 (terminal-state fix) — 3 files + 7 tests.
2. `bun install` in `/home/user/rork-app` and `/home/user/rork-app/expo`.
3. `bun test backend/services/ivx-task-state-machine.test.ts` → all pass.
4. `bun test backend/` → 1711+ pass / 0 fail.
5. Commit the 3 files via `github_commit_file` (CONFIRM_IVX_GITHUB_WRITE) — single commit.
6. Deploy via `render_trigger_deploy` (CONFIRM_IVX_RENDER_DEPLOY). Wait for health.
7. Sections 3-10: run test suites + greps + live probes, collect honest PASS/FAIL.
8. Section 1: live chat prompt → poll to terminal → expect STATUS: COMPLETED.
9. Section 11: collect final evidence.
10. Section 12: deliver verdict.

## Acceptance

The same live autonomous task ends as STATUS: COMPLETED (not FAILED), with real commit SHA, deploy ID null, tests passed, and a honest 10-line certification verdict backed by live evidence.