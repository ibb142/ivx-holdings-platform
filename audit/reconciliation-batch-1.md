# Reconciliation Batch 1 — assessment

## Outcome

Batch 1 did **not** mutate the owner-controlled baseline. The working tree is not based on owner SHA `d1d232a`, so applying a source change here would not create the requested owner-baseline reconciliation. No commit, push, or deployment was performed.

A byte-level comparison against `/tmp/ivx-owner-audit` at `d1d232a` found one functional candidate in the permitted scope.

## Selected candidate

### `expo/app/ivx/chat.tsx`

- **GitHub behavior:** local-first chat awaited `sendQueue.mutateAsync` before triggering an assistant reply. A blocked persistence retry could leave an otherwise valid request at `USER_ROW_INSERTED`.
- **Workspace behavior:** only `send_and_ai` and `ai_only` in local-first mode start the assistant before persistence resolves. Durable persistence continues through the existing queue and logs any retryable failure. Attachment, send-only, and remote-first operations remain persistence-first.
- **Merged behavior:** retain owner routing, diagnostic, trust-confirmation, worker, watchdog, and rendering branches. Add only the local-first dispatch policy and its narrow queue branch. The workspace file already represents that surgical result; it does not add a Rork runtime dependency.
- **Decision:** `MERGE_MANUALLY` candidate is semantically resolved in the workspace, but has not been applied to a clean owner-baseline branch.

## Deferred candidates

The other Batch-1-topic candidates were intentionally not merged because comparison found no executable functional difference:

| Path | Difference | Decision |
|---|---|---|
| `backend/api/ivx-autonomy.ts` | Comment-only environment-variable rename | Defer; no runtime change |
| `backend/api/ivx-autonomous-runs.ts` | Final newline only | Defer |
| `backend/api/ivx-autonomous-task-engine-api.ts` | Final newline only | Defer |
| `backend/api/ivx-scoped-memory.ts` | Final newline only | Defer |
| `backend/services/ivx-scoped-memory-store.ts` | Final newline only | Defer |

## Required-prompt coverage status

The focused suite verifies existing engineering routing, tool selection, local-first sending, and scoped-memory isolation. It does **not** contain the requested exact English/Spanish pairs as a single acceptance test. The following evidence exists:

- app/module creation and deploy routes: planner/router suite;
- owner-login safety: pre-execution gate suite (not run in this focused batch);
- property context and engineering-query protection: conversation-state implementation and scoped-memory isolation suite.

A clean owner-baseline worktree is required before adding the requested exact-prompt regression suite; that suite should be added there and executed before any commit.

## Validation

- `bun test expo/__tests__/ivx-send-trigger-policy.test.ts backend/services/ivx-owner-ai-intent-router.test.ts backend/services/ivx-owner-conversation-state.test.ts backend/__tests__/ivx-scoped-memory-store.test.ts` — **PASS**, 105 tests, 0 failures.
- `bun x tsc --noEmit` — **PASS**.
- Expo TypeScript command attempted as `bun --cwd expo x tsc --noEmit` — **not run**; the Expo package script does not provide `x`. This is a command invocation issue, not a source regression.

## Stop condition

No Batch 1 commit exists and no remote SHA changed. Do not deploy or start Batch 2.
