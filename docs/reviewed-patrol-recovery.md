# Reviewed recovery of failed Landing patrols

The proposed recovery script used a nonexistent audit table, reopened arbitrary
failed work and printed success before COMMIT. This operator command accepts
1–10 explicit task IDs and a full source SHA. A default invocation only reads.

It applies only to canonical Landing QA patrols with a transient error, unused
retry attempts, an unexpired retry episode, no live or ambiguous lease, and no
recorded code/database mutation or deployment. Other failures remain for review.
This is an explicit manual recovery operation; it does not relax the task
engine's general terminal-state guard or add an automatic retry loop.

Use Node with the existing repository dependencies. Supply the verified IVX
PostgreSQL connection through IVX_BUDGET_RECONCILIATION_DATABASE_URL,
SUPABASE_DB_URL or DATABASE_URL. Credentials never belong in arguments or logs.
The CLI checks the project/database and verifies the Supabase TLS certificate.

    node scripts/ops/recover-failed-patrols.mjs --source-sha=FULL_REVIEWED_SHA --task-ids=REVIEWED_TASK_ID

After reviewing those exact tasks and confirming the runtime SHA, add:

    --apply --reason='Owner-requested recovery of reviewed transient QA failure'

The current owner emergency-stop row must exist and be inactive. A short shared
lock keeps it consistent during each transaction. The selected task is locked
with NOWAIT and its bigint version is compared with the initial read. Recovery
uses the existing ivx_fleet_retry_payload and
ivx_autonomous_task_compare_and_set RPCs. The result is RETRYING, with the
canonical jitter/backoff and maxRetries policy; the normal scheduler later
claims due work. Both copies of lease fields and completion timestamps are
cleared by the canonical retry payload, and the full prior evidence remains.

The normal state-transition event and a detailed owner_patrol_recovery event
commit together in ivx_autonomous_task_events. PostgreSQL allocates event IDs.
The detailed event retains the reason, operation UUID, SHA, exact versions,
previous error, completion time and retry counts. The CLI reports
RETRY_SCHEDULE_COMMITTED only after COMMIT and a separate durable audit read.
That status does not mean that a patrol ran or that any QA check passed.

A timeout or lost commit acknowledgement stops the batch with WRITE_UNCONFIRMED.
Inspect the returned operationId/auditId and durable task before issuing any
further command. An acknowledged commit with failed readback is separately
reported as COMMITTED_VERIFICATION_UNAVAILABLE. There is no automatic replay,
backend termination, budget refund, schema migration, model call or deployment.

The supplied gateway replacement must not be installed: owner-ai and
live-work/agents already route through the authenticated production handlers.
The chat uses durable request identity, real execution and SSE/JSON responses.
provider_cost_nano is not a reservation column, taskId is not a reservation UUID,
and a successful SELECT cannot justify SETTLED_EXECUTION. The live dashboard
requires fresh authoritative observations and its established payload contract;
a historical RUNNING status alone cannot certify a live agent.
handleAgentLedgerGet already belongs to the agent-work-ledger API and must not
be replaced by app.fetch.

Validation:

    node --check scripts/ops/recover-failed-patrols.mjs
    node --test scripts/ops/recover-failed-patrols.test.mjs

The independent failed-patrol-recovery CI job runs seven PostgreSQL scenarios:
dry run, retry/evidence preservation, two-connection contention, version races,
audit rollback, emergency stop and a real commit with a lost acknowledgement.
Its fixture is restricted to localhost database ivx_patrol_recovery_test and
never receives production credentials.

Observed on 2026-09-13 at 23:26 UTC: the production schema lacked
ivx_task_audit_events and provider_cost_nano. The targeted query found zero
FAILED patrols for main e52bfee89187eff24f19e618bcd619d63b33a7c7.
At 23:34 UTC the same SHA cohort contained 112 QUEUED patrols and no other
states. Recovering FAILED tasks cannot unblock that queued cohort. Queue
admission and worker execution still require diagnosis; this observation does
not certify live agents. No production recovery or deployment was executed
during this review.
