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

Verify public chat, owner chat and the direct owner worker endpoint against shared storage with two API replicas.
Capture the conversation, user and assistant messages, source message identity,
task/job identity, assigned agent, streamed provider response and owner controls.
Retry before admission, during execution, after completion and after a process
restart. Verify there is one accepted command and one resulting change.

The worker identity regression covers admission with substituted persistence.
It does not certify cross-replica provider deduplication, replay after terminal
history retention, or durable chat persistence during a production DB outage.
Those remain separate live acceptance checks.

`scripts/ivx-owner-chat-live-proof.mjs` supplies an additional post-deploy check.
It uses the existing owner CI credentials for a real password grant and verifies
the issued identity and protected owner gate. It races two identical requests,
requires one original response, checks exact receipt replay from two distinct
API processes, rejects changed content under the same ID, and accepts a new ID
for equal text. It rereads both assistant rows under the real owner session and
requires exactly two owner rows for those two commands despite concurrent retries.
It also verifies canonical SSE replay and a real direct stream
with durable terminal replay. Each response must report the exact tested commit;
an opaque process identity distinguishes the serving replica without exposing
its hostname. Missing second-replica coverage is a failed check, not a pass.

This workflow runs after main deployment and archives a scoped proof. It does
not certify app history, a process restart, public chat, worker execution, a
restored backup or the complete phase. Those checks remain independently required.

The knowledge and manual text paths honor both persistence flags before claiming
a completed turn. A requested owner write must finish before model execution;
the assistant ID is returned only after its write succeeds. Provider or history
failures return an error status and do not become successful assistant notices.
This correction still requires the live row checks and app reload proof.
Authenticated health probes reach the existing capability-probe handler before
conversation routing, so polling does not create ordinary model conversation
turns or replace capability evidence with a prose response.

The app threads its per-message client ID through primary transport retries and
durable intake. A new message with equal text must retain a distinct ID. Direct
worker submissions carry the conversation and source message; a 409 attachment
recovers the original job rather than reporting worker unavailability. A global
last-proof record is usable only when its job ID matches the submitted job.

Backend/auth/network notices are failure outcomes, not model answers. The UI
must validate the outcome before marking a reply successful or persisting it as
assistant content. A lost response does not prove that no server-side work ran.

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
# Owner request admission and reconciliation

JSON and SSE owner requests reserve `owner-chat-requests/<sha256(owner,room,message)>`
in the existing `ivx_durable_documents` table before invoking a planner, provider,
tool or worker. The table must retain its existing service-role-only privileges.
Admission uses an INSERT and a unique document key; it never replaces an existing
reservation. A content fingerprint detects reuse of an identity for different input.
Completion compares the invocation token and pending state before storing the exact
HTTP/JSON result and its message/task links. A lost write acknowledgement is checked
by reading that same key; it is not permission for a new provider call.

The chat's transient-error recovery passes `primaryRequestId` to the durable endpoint.
That endpoint only polls the original receipt and preserves its identifier across
app reopen. Absence of a readable receipt is an unknown outcome, not proof that the
primary request never ran. Standalone durable tasks remain a separate API.

A crashed in-flight invocation is not automatically taken over after a time limit:
the provider or a tool may already have executed. Such a receipt remains pending
until its outcome can be reconciled. Recovery of that ambiguous crash, pre-upgrade
in-flight requests, the public chat route, real owner auth and provider behavior
across deployed replicas still require live evidence before certifying 16.3.

Validation includes concurrent admissions, insert/completion acknowledgement loss,
failure before admission, unavailable persistence, changed content, owner isolation,
terminal replay, and preserved message links. The PostgreSQL proof uses two clients
only against the explicit local `ivx_ha_test` database and is an additional CI step.
An embedded PostgreSQL run does not prove separate production replicas or a restored
backup. The request ledger is now part of the required 17.5 restoration inventory.


### Submission races and direct streaming route

The owner composer now takes a synchronous guard shared by Send, Ask AI, attachment batches and retries before creating a new message identity. It releases the guard on success or error, ignores events for an already-cleared draft, and keeps the original ID for an explicit retry. Eleven tests execute the actual callbacks with pending state held at its pre-render value; they are not browser evidence.

The direct `/api/ivx/owner-ai/stream` route now uses the same owner/message admission store. A stable requestId is required. Deltas remain progressive, but `done` is delivered only after the response receipt is durable. Reconnection replays that result without a second provider call. `receiptPersisted` is separate from `assistantPersisted`: this direct route does not claim to insert conversation messages. Known authentication outage status is preserved as 503 rather than mislabeled 403. Ten endpoint tests cover admission, replay, real-time fixture deltas, persistence failure, disconnect, ownership and provider errors. They use a simulated provider and storage adapter; live owner/provider acceptance remains required.

A missing network response does not establish that nothing executed. Recovery notices preserve that uncertainty and direct the owner to the original request instead of asserting that a retry cannot duplicate work.

### Attribute an unavailable dependency before claiming provider failure

The real owner Android run for `e957148` reached Home, Dashboard and Autonomous,
then failed in Chat. Render traces at 2026-09-11 02:56:33/37 UTC identify
`loadIVXOwnerProfile` and `AUTH_SERVICE_UNAVAILABLE` before model execution.
The incident classifier previously labeled every otherwise-unidentified 502/503
as `provider_transient`. Explicit owner-auth and database failures now retain
their subsystem, while a bare HTTP status remains `unknown`.

The regression includes the observed auth payload, auth-provider timeout
wording, database pressure/read timeout, unknown 502/503 and explicit model,
gateway and deadline failures. This changes diagnosis only. It does not bypass
owner verification, change retries or timeouts, or repair the underlying profile
lookup availability. The production E2E and continuity requirements still apply.
