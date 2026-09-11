# Phase 4: chat delivery and measured continuity

This is an acceptance procedure, not a production certificate. Passing unit tests,
an HTTP 200 health check, 112 configured agents, or a historical PASS does not
establish the owner-to-production chain or continuous operation.

## Message identity and execution

Send one stable `messageId` / `requestId` for the logical owner command, including
on a double click, reconnect or transport retry. Create a new identity for a new
command, even when its text is identical. The worker derives its task identity
from the owner, conversation and source message. It must retain that identity
when reconciling an acknowledgement lost after persistence or recovering a
committed job. A device `clientId` is not a message identity.

Verify both chat entry points against shared storage with two API replicas.
Capture the conversation, user and assistant messages, source message identity,
task/job identity, assigned agent, streamed provider response and owner controls.
Retry before admission, during execution, after completion and after a process
restart. Verify there is one accepted command and one resulting change.

The worker identity regression covers admission with substituted persistence.
It does not certify cross-replica provider deduplication, replay after terminal
history retention, or durable chat persistence during a production DB outage.
Those remain separate live acceptance checks.

The missing-table bootstrap uses the Management API's documented
[`POST /v1/projects/{ref}/database/query`](https://supabase.com/docs/reference/api/v1-run-a-query).
Its regression substitutes the token lookup and checks real retry counts for a
544 followed by 201 and for exhausted retries; it rejects an invalid HTTP method.
This verifies the request contract without creating production tables.

## Cadence and error limits

| Scope | Policy / source | Acceptance evidence |
| --- | --- | --- |
| IA-001 through IA-112 patrol eligibility | `getLandingPatrolIntervalMs`: default 5 seconds after an observation, bounded 1 second–1 hour by `IVX_LANDING_PATROL_INTERVAL_MS` | Record the actual deployed configuration. Eligibility is not achieved throughput. |
| Each IA observation | Maximum 120 seconds since completion and persistence | Matching IA, task, production SHA, immutable evidence ID, valid content hash and explicit verdict. |
| Runtime lease | Task engine lease duration 120 seconds; heartbeat comment specifies 20 seconds | A RUNNING observation needs a valid holder and unexpired lease. A completed observation does not need an active lease. |
| Queue progress | No recent valid evidence within 120 seconds is a continuity failure for that lane | Record task state, last proof, retry count and the concrete error; queue state alone is not work. |
| Initial observation window | At least 24 hours, samples no more than 120 seconds apart, all 112 passing in every sample, one production SHA | Gaps, invalid inventory, stale evidence, failed lanes or deployment changes prevent acceptance. |
| Failed or blocked work | Zero unresolved FAILED/BLOCKED lanes for acceptance | Preserve the failure and original task identity. Do not reset counters or manufacture successful evidence. |
| Recovery | Use existing bounded retry/backoff, lease fencing and committed-job recovery | Record the configured budget and actual attempts; an exhausted budget requires diagnosis. Do not raise limits to pass acceptance. |

Apply this policy independently to each IA and retain its task/evidence IDs.
Provider requests, repairs, audits and observations have different evidence;
successful patrol observations alone do not prove 112 model-driven repairs.

## Continuity evaluator

`scripts/ivx-phase4-continuity.mjs` evaluates saved read-only samples. It does not
start a worker, change controls or generate activity. An input JSON contains
`sourceSha`, a timestamp (`sampledAt`, row `sampled_at`, or `capturedAt`) and
`data`: the 112 current-SHA patrol rows, including `task_id`,
`assigned_agent_number`, `idempotency_key`, `state`, lease fields and
`latest_evidence`. Preserve the original query timestamp and raw samples.

```sh
node scripts/ivx-phase4-continuity.mjs report.json sample-001.json sample-002.json
```

Exit status 1 means the initial window has not passed, including when only one
sample exists. The output retains one verdict per IA, freshness and identity
failures, changed evidence between samples, coverage gaps and duration. A new
snapshot of the same evidence is not progress. The evaluator always leaves
`phase4Certified` false: chat, deployment and recovery need independent proof.

An hourly external follow-up can detect incidents and review CI. It cannot
provide two-minute coverage. Use persisted runtime observations for the actual
window, and retain incident and recovery intervals across days and weeks.
Twenty-four hours of success does not establish 365 days of availability.

## Recovery and release acceptance

1. Exercise DB unavailability and provider interruption in an isolated acceptance
   environment. Verify clear errors, bounded retries, no duplicate commands and
   recovery with the same task/message identity. A process crash is not a DB outage.
2. Use the existing isolated PostgreSQL proofs for concurrent claims, graceful
   shutdown, process crash, fencing and recovery of committed jobs. Archive the
   tested merge SHA and CI run; do not label this a production failover test.
3. Restore a backup to an isolated target. Inventory tasks, chat/history links,
   controls/approvals and memory as well as business tables. Compare primary keys,
   row counts, content hashes, referential links and effective controls; exercise
   resumed work there. Record backup/restore timestamps and measured RPO/RTO.
   A successful financial-data snapshot does not prove these domains are covered.
4. After owner sign-in and reload work, submit one controlled repair through chat.
   Retain the actual message -> task -> assigned IA -> commit -> PR -> complete CI
   -> merge -> live deploy chain and verify the requested behavior in the browser.
   A manually created PR is not a chat-created repair certificate.
5. Merge only after all applicable gates pass on the exact candidate integrated
   with current main. Confirm API, worker and frontend deployed SHAs separately.
   Exercise rollback and restart consistency in the acceptance environment,
   retaining original task identities and rejecting obsolete worker writes.
6. Present the owner with the functional result, task, SHA, PR, deployment, logs
   and effective pause/resume/stop controls. Close each of the 112 IA separately,
   with a reason and evidence for any blocked lane, before closing the phase.

Default Data Vault coverage and documented RPO/RTO targets must be verified
against the actual backup inventory. They are not evidence of a tested restore.
