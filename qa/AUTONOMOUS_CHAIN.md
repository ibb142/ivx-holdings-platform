# Phase 4 owner order acceptance

`qa/e2e/complete-autonomous-chain.spec.ts` exercises the deployed owner chat.
It sends a real repair/deployment instruction. Run it once for a specific
owner-authorized order through **Phase 4 complete owner order chain** in Actions
on `main`, providing the instruction and a stable audit token. The existing
owner password, Supabase database URL, anonymous key and Render key must be
available as repository secrets; GitHub access is read-only.

For the autoplay order already authorized by the owner, the workflow inputs are:

```text
order: Deploy hotfix for autoplay controls
order_token: audit-task-20260912-autoplay-01
```

Review whether that token has already been used before dispatching. The test
checks persisted chat history, the active queue and archived jobs before sending.
It rejects automatic retries, repeated tests and GitHub reruns. If execution is
interrupted, inspect `proof.json` and the recorded request/job IDs; do not create
a new token merely to retry an order with an unknown outcome. Existing runtime
approval gates still apply. A requested approval or blocked job fails acceptance.

Apply `20260912224306_owner_message_preflight_index.sql` before live preflight.
The partial trigram index covers Owner message bodies; the query escapes LIKE
metacharacters so tokens still match literally. Queue and archive checks remain
complete. The disposable PostgreSQL gate verifies a 33,000-message history uses
the index and tests wildcard, role and conversation isolation. Neither a failed
connection nor a timed-out query establishes that an order is absent.

The test uses the actual `ivx-owner-chat-input`, `ivx-owner-chat-send` and execution
console controls. It double-clicks once and requires one observed owner-AI
submission. The server's message identity is preserved unchanged. Read-only,
parameterized database queries require one persisted owner message and one
worker identity across the queue and archive, plus the matching chat receipt.
The test follows `/api/ivx/senior-developer/worker/jobs/{jobId}` with bounded polling.

Success requires IA identity and matching execution workspace provenance, real
test/typecheck receipts, matching IA/task/job commit trailers, independent GitHub
checks for the recorded required contexts, a new commit, a merged PR, all three configured
Render services live on the merge SHA, and fresh health/version probes matching
that SHA. Authored and merge SHAs may differ, but the PR must link them. A 200
response marked degraded is rejected. Missing evidence fails, never skips.

The current owner-chat handoff does not explicitly populate `agentId` or
`agentNumber`. If the worker still has no attributed IA, acceptance fails with
`AUTONOMOUS_IA_ASSIGNMENT_MISSING`; the test does not manufacture an assignment.
The normalized `ivx_autonomous_tasks` table is a separate queue. It has no
`tracking_token`, `commit_sha`, `pull_request_id` or `SUCCESS` contract used by
the original sample, and is not queried through the browser's Supabase client.

Local verification without sending an order:

```sh
node --test qa/autonomous-chain-evidence.test.mjs
node node_modules/playwright/cli.js test --config qa/playwright.autonomous-chain.config.ts --list
```

The live test is excluded from the normal Expo E2E directory. Credentials remain
in memory, traces/screenshots/videos are disabled, and only a projected evidence
receipt is uploaded. SQL transactions are read-only with a four-second statement
deadline. A passing chain receipt covers this one order; it always leaves
`phase4Certified` and `continuous24HoursCertified` false. Fleet and 24-hour
acceptance require their own evidence.

PR CI also executes both production read queries against a disposable PostgreSQL
15 service, covering duplicate jobs, archived copies, message counts and owner
isolation. This validates the query contracts; it is not production acceptance.
