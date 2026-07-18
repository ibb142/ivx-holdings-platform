# IVX Autonomous Senior Developer — Executable Implementation Plan

**Owner:** Ivan Perez (iperez4242@gmail.com)  
**Approved:** 2026-07-18T21:45:00Z  
**Status:** IN IMPLEMENTATION — not yet verified  
**Honest label:** IVX OWNER AI — ENGINEERING COMMAND INTERFACE until chat-only certification test passes.

## Final acceptance rule

Do NOT label the system `IVX IA SENIOR DEVELOPER — VERIFIED` until all of these are true:
- Task initiated from IVX chat
- Durable task created
- Autonomous worker executes
- Worker reads and modifies code
- Tests run
- Owner approval is enforced
- Commit reaches owner GitHub
- Render deploys
- Runtime SHA matches GitHub
- Live feature passes
- Evidence returns to IVX chat
- Task survives restart
- Rork browser is not required

Until then, use: `IVX OWNER AI — ENGINEERING COMMAND INTERFACE`.

---

## 1. Architecture gap

The current IVX Owner AI is a chat interface with a durable task queue and an API-caller backend pipeline. It is **not** an autonomous senior developer.

| Capability | Current | Required |
|---|---|---|
| Read code autonomously | No | Yes |
| Edit code autonomously | No | Yes |
| Run tests/typecheck | No | Yes |
| Create branches/commits | Partial (pre-computed patches only) | Yes |
| Deploy autonomously | Only after owner approval | Yes, with approval gate |
| Survive Rork browser closed | No | Yes |
| 12 engineering teams | Database labels | Real workflow roles or relabeled |

## 2. Implementation architecture

```
IVX Owner Chat (expo/app/ivx/chat.tsx)
  → POST /api/ivx/owner-ai
  → DurableTaskService
  → ivx_owner_ai_tasks (Supabase)

IVX-SENIOR-DEV-01 Worker (long-running process on Render)
  → poll ivx_owner_ai_tasks WHERE task_type = 'senior_dev'
  → claim via heartbeat + checkpoint
  → clone owner GitHub repo to ephemeral workspace
  → LLM reasoning loop with tool calls
  → edit files, add tests
  → run tsc, lint, bun test
  → create branch, commit, push
  → request owner approval (WAITING_APPROVAL)
  → on approval: merge, trigger Render deploy, verify parity
  → on failure: rollback to previous tag
  → write proof ledger
  → post result back to IVX chat via task status API
```

## 3. Files to create

- `backend/services/ivx-senior-dev-worker.ts`
- `backend/services/ivx-senior-dev-agent.ts`
- `backend/services/ivx-senior-dev-tools.ts` (enhanced)
- `backend/services/ivx-senior-dev-git.ts`
- `backend/services/ivx-senior-dev-render.ts`
- `backend/services/ivx-senior-dev-proof.ts`
- `backend/services/ivx-senior-dev-sandbox.ts`
- `backend/workers/ivx-senior-dev-worker-entry.ts`
- `expo/src/modules/ivx-developer/seniorDevTaskPoller.ts`
- `deploy/supabase/ivx-senior-dev-worker-migrations.sql`
- `docs/ivx-autonomous-senior-developer-plan.md` (this file)

## 4. Files to modify

- `expo/app/ivx/chat.tsx`
- `expo/lib/ivxDurableTaskService.ts`
- `backend/api/ivx-owner-ai.ts`
- `backend/services/ivx-owner-ai-task-queue.ts`
- `backend/hono.ts`
- `render.yaml`
- `package.json`

## 5. Database migrations

- `ivx_senior_dev_worker_runs` — per-run evidence
- `ivx_senior_dev_checkpoints` — per-step checkpoint history
- `ivx_senior_dev_approvals` — approval records bound to owner/task/action
- Extend `ivx_owner_ai_tasks` with `worker_type`, `assigned_worker_id`, `approval_url`

## 6. Infrastructure services

- Render worker service (separate from web service)
- Supabase task queue + proof ledger
- GitHub Data API + git clone over HTTPS
- Vercel AI Gateway for reasoning
- Render API for deploy trigger
- S3 for artifact storage
- No Rork browser dependency

## 7. First milestone

**Fix chat-to-worker transport and durable task state machine.**

Every engineering request returns:
```json
{
  "taskId": "...",
  "status": "QUEUED",
  "taskType": "senior_dev",
  "assignedWorker": "IVX-SENIOR-DEV-01",
  "approvalRequired": true,
  "createdAt": "2026-07-18T21:45:00Z"
}
```

## 8. First chat-only test

Close Rork. Open IVX. Send:

> "Audit and fix the active 503 issue."

Expected end-to-end flow:
1. IVX returns `taskId` and `QUEUED`.
2. Worker diagnoses the 503 issue.
3. Worker edits code.
4. Worker adds regression test.
5. Worker runs typecheck and tests.
6. Worker requests approval in IVX chat.
7. Owner approves.
8. Worker commits to GitHub.
9. Worker deploys to Render.
10. Worker verifies SHA parity and health.
11. Worker returns complete proof to IVX chat.

## 9. Exact owner approvals required

- `CONFIRM_IVX_SENIOR_DEV_WORKER_ENABLE` — enable the worker service
- `CONFIRM_IVX_GITHUB_WRITE` — allow GitHub writes
- `CONFIRM_IVX_RENDER_DEPLOY` — allow Render deploy
- `CONFIRM_IVX_DATABASE_MIGRATION` — allow DB migrations
- `CONFIRM_IVX_SENSITIVE_OPERATION` — sensitive/financial ops
- `CONFIRM_IVX_PRODUCTION_APPROVAL` — full production release

## 10. Implementation timeline

| Phase | Work | Target |
|---|---|---|
| 1 | Fix chat transport + durable task state machine | 2026-07-19 |
| 2 | Build worker skeleton + repo clone + file read/edit | 2026-07-20 |
| 3 | Add test execution + GitHub commit/push | 2026-07-21 |
| 4 | Add Render deploy + verification + rollback | 2026-07-22 |
| 5 | Add proof ledger + chat reporter + restart recovery | 2026-07-23 |
| 6 | Chat-only certification test | 2026-07-24 |

## 11. State machine

Non-terminal:
- RECEIVED
- PERSISTED
- QUEUED
- CLAIMED
- PLANNING
- INSPECTING
- IMPLEMENTING
- TESTING
- WAITING_APPROVAL
- COMMITTING
- DEPLOYING
- LIVE_VERIFYING
- ROLLING_BACK
- RETRYING

Terminal:
- VERIFIED
- FAILED
- BLOCKED
- CANCELED

Rules: one terminal state per task; no `VERIFIED + BLOCKED`; persist before external calls; heartbeat; idempotency; retry transients; dead-letter exhausted failures.

## 12. Security controls

- Worker runs in owner-controlled Render service
- Secrets loaded from runtime environment, never logged
- GitHub writes require owner approval phrase
- Render deploys require owner approval phrase
- DB migrations require owner approval phrase
- All destructive ops require explicit confirmation
- No credentials displayed in chat
- Proof ledger is append-only and owner-readable
