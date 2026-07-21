---
name: "IVX terminal-state completion rules — commit-only CODE_CHANGE must end COMPLETED"
overview: "Fix the state machine so a CODE_CHANGE task with \"commit but do not deploy\" ends COMPLETED when patch + tests + typecheck + commit + GitHub verification all succeed, instead of being downgraded to FAILED for missing deploy/feature-verification. Add 7 regression tests and re-prove live with the same chat prompt that ended FAILED."
createdAt: 2026-07-21T17:59:32.038Z
---
# IVX terminal-state completion rules — commit-only CODE_CHANGE must end COMPLETED

Fix the state machine so a CODE_CHANGE task with "commit but do not deploy" ends COMPLETED when patch + tests + typecheck + commit + GitHub verification all succeed, instead of being downgraded to FAILED for missing deploy/feature-verification. Add 7 regression tests and re-prove live with the same chat prompt that ended FAILED.

## Root cause (proven from code)

`backend/services/ivx-task-state-machine.ts` `assertCanTransition()` treats VERIFIED as the only success terminal for development tasks and requires, for any dev task with `filesChangedCount > 0`:
- `deployId` (line 167-170) — rejects commit-only scope
- `productionHealthOk` (line 171-174)
- `featureVerificationOk === true` (line 177-185) — rejects when not performed

In `backend/services/ivx-senior-developer-worker.ts` (line 1240-1263), when the guard refuses VERIFIED, the code calls `terminalStateForNoWork()` which returns FAILED for any non-auth error string. So a successful commit-only CODE_CHANGE ends FAILED with the message "State machine refused VERIFIED: Feature verification failed — a task cannot become VERIFIED from /health alone." — exactly what the live job `ivx-worker-8918ca45` produced.

There is no "deploy not requested" signal threaded from the autonomous coder to the worker, and no success terminal below VERIFIED for dev tasks that legitimately stop at commit.

## Scope (strict)

- Fix ONLY terminal-state completion rules. Do NOT touch the autonomous coding engine, the LLM patch loop, command execution, or test running.
- Add a `deployRequested: boolean` field to the worker result + autonomous-coder result so the guard knows when deploy was explicitly not requested.
- Thread `deployRequested` from `ivx-autonomous-coder.ts` (already knows whether `deployFn` was invoked / whether the prompt said "do not deploy") into the worker result.

## Required status rules (what the fix enforces)

- CODE_CHANGE + NO_DEPLOY: PATCH + TESTS + TYPECHECK + COMMIT + GITHUB_VERIFY = COMPLETED
- CODE_CHANGE + DEPLOY: PATCH + TESTS + TYPECHECK + COMMIT + DEPLOY + PRODUCTION_VERIFY = COMPLETED
- READ_ONLY: INSPECTION + FINDINGS = COMPLETED
- QA_ONLY: TARGETED TESTS + RESULTS = COMPLETED
- DEPLOY_ONLY: VERIFIED COMMIT + DEPLOY + HEALTH = COMPLETED
- A task must NOT be marked FAILED because a non-requested stage was not executed.

## Files changed (planned)

1. `backend/services/ivx-task-state-machine.ts`
   - Add a new terminal state `COMPLETED` to `IVXTaskState` and `ALL_TASK_STATES` (so commit-only success has an honest terminal that is not VERIFIED). Update `TERMINAL_TASK_STATES` to include it.
   - Add legal transitions to `COMPLETED` from `CODE_CHANGED`, `TESTING`, `READY_TO_DEPLOY` (commit-only path), `QA_IN_PROGRESS` (QA_ONLY), and `ANALYZING` (READ_ONLY).
   - Update `assertCanTransition()` to accept `deployRequested`, `typecheckPassed`, `commitVerified`, and `taskType` on the guard input. Add a new branch for `to === 'COMPLETED'`:
     - Dev task (CODE_FIX/FEATURE/UI_FIX/DATA_FIX): requires `filesChangedCount > 0`, `testsRun`, `testsPassed`, `typecheckPassed`, `commitSha` (via `commitVerified`); deploy/feature-verification NOT required when `!deployRequested`.
     - READ_ONLY: requires findings present, no patch/commit/deploy.
     - QA_ONLY: requires `testsRun`, no patch/commit/deploy.
     - DEPLOY_ONLY: requires `commitVerified`, `deployId`, `productionHealthOk`.
   - Keep the existing `to === 'VERIFIED'` branch intact for the full end-to-end deploy path (unchanged semantics).
2. `backend/services/ivx-senior-developer-worker.ts`
   - Add `deployRequested: boolean` to `IVXWorkerJobResult` (line ~239) and set it from the autonomous-coder result.
   - Change `terminalTarget` (line 1225-1231): when `result.finalStatus === 'COMPLETE'` AND `!result.deployRequested`, target `COMPLETED` instead of `VERIFIED`.
   - Update the guard call (line 1240-1251) to pass `deployRequested`, `typecheckPassed` (from result), `commitVerified` (from `Boolean(result.commitSha)`), and `taskType`.
   - Update the downgrade branch (line 1255-1263): when the guard refuses, only downgrade to FAILED/BLOCKED if the refused reason is a requested-but-failed gate. If the reason is a non-requested stage (deploy/feature-verification when `!deployRequested`), do NOT downgrade — keep COMPLETED.
   - Update `result.finalStatus` mapping so `COMPLETED` stays `'COMPLETE'` (job status `completed`, not `failed`) at lines 1469, 1520, 1620, 1681, 1745.
3. `backend/services/ivx-autonomous-coder.ts`
   - Add `deployRequested: boolean` to `IVXAutonomousCoderResult` (line ~139) and set it from the prompt intent (true if `deployFn` was invoked, false if the prompt said "do not deploy" or deploy was skipped). No engine-loop changes.

## Tests added (7 regression tests in `backend/services/ivx-task-state-machine.test.ts`)

1. Commit requested, deploy not requested → COMPLETED after commit verification (filesChanged>0, testsRun, testsPassed, typecheckPassed, commitVerified, deployRequested=false).
2. Deploy requested → not COMPLETED/VERIFIED until deploy + production verify pass (same input but deployRequested=true, no deployId → rejected).
3. Read-only task → COMPLETED with no patch/commit/deploy.
4. QA-only task → COMPLETED after targeted tests, no patch.
5. Commit succeeds but tests fail → FAILED (guard rejects COMPLETED when testsPassed=false).
6. Commit succeeds and GitHub verification passes → COMPLETED.
7. Non-requested production verification missing → no failure (deployRequested=false, productionHealthOk=false → still COMPLETED).

Plus update the existing `has exactly 17 states` test to the new state count (18).

## Test results (planned)

- `bun test backend/services/ivx-task-state-machine.test.ts` → all pass
- `bun test backend/ivx-autonomous-coder.test.ts` → 25 pass (unchanged engine)
- `bun test backend/` → 1711+ pass / 0 fail

## Commit + deploy

- Commit the 3 changed files via `github_commit_file` (CONFIRM_IVX_GITHUB_WRITE) — single commit.
- Deploy via `render_trigger_deploy` (CONFIRM_IVX_RENDER_DEPLOY).
- Wait for health to show new commit, healthy.

## Live retry proof

- Re-mint owner token via `POST /api/ivx/owner-passwordless-login` `{"email":"iperez4242@gmail.com"}`.
- Cancel all prior orphaned jobs.
- Submit ONE fresh chat prompt: "Add a one-line comment // IVX convergence proof 2026-07-21 final above the line export const PILOT_LABEL in backend/services/ivx-autonomous-coder-pilot.ts. Run targeted tests. Commit to GitHub. Do not deploy."
- Poll the job to terminal in the background (no mid-job deploy/restart).
- Acceptance: job `status` = `completed`, `finalStatus` = `COMPLETED` (not FAILED), `changedFiles` non-empty, `commitSha` present, `testsPassed: true`, `deployId: null` (not requested), no "State machine refused" error.

## Final acceptance (what the owner sees)

The same live autonomous task ends as:

STATUS: COMPLETED

not FAILED — with the real commit SHA, deploy ID (null), live retry task ID, and final task status reported back.