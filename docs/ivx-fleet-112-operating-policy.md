# 112-agent operating policy

The existing Render worker `ivx-senior-dev-01` runs the production PostgreSQL
dispatcher. `GLOBAL_WORKER_CONCURRENCY_LIMIT=112` now sets the common admission
ceiling for that dispatcher and the senior worker. An explicit lower path limit,
including zero, remains authoritative. This value is a ceiling, not an active
agent count or a Render instance count. PostgreSQL owns logical-agent claims
across replicas; configured process concurrency does not prove global activity.

The worker renews its queue leases every 30 seconds. The default lease is
90 seconds; `IVX_AUTONOMOUS_LEASE_SECONDS=90` makes the deployed value explicit.
The existing claim, start, heartbeat and recovery RPCs retain physical process
identity, atomic task locking and bounded batches. Restart recovery uses durable
task state; it never extends every expired lease or fabricates a busy agent.

`MIN_AUTONOMY_HOURS=20` and `MAX_AUTONOMY_HOURS=24` describe a recoverable service
operating objective. They do not make a task run for 20 hours, defer owner stop,
extend per-task deadlines, or certify elapsed work. The continuity evaluator
reports `minimumWindowPassed` only after 20 hours of complete passing patrol
observations. Its existing 24-hour threshold remains separate, and neither
certifies model execution, repair completion or all production flows.

The global model budget is a separate database policy. Raising its
`max_concurrent` requires the owner's operational instruction and preserves the
existing monetary ceiling, settlement accounting and unknown-charge liabilities.
Changing an environment variable cannot bypass monetary admission.

The additive `MultiAgentFleet` executor is separate from the production
dispatcher. New installations seed 112 durable capacity slots. An explicit
`unlockFullFleetCapacity(store)` expands an existing installation from eight
slots without resetting tokens, task ownership or fencing counters. It refuses
capacity reductions. It does not install a schema, create work, start a worker,
or supply a production pipeline adapter. Simulation remains simulation.

The native PostgreSQL gate tests 112 simultaneous owned leases across two
executors with four shared connections, refuses a 113th task, renews all leases,
and verifies expansion preserves an existing live lease. A separate four-client
budget proof admits 112 model reservations and rejects overflow without issuing
provider calls. These isolated tests are prerequisites, not production load or
20-hour observations.

Apply the runtime variables to the existing worker, retaining its database
secret configuration and shared pool limits. Do not create a duplicate worker or
replace credentials with a placeholder URL. The root Blueprint has an existing
database-plan validation issue; resolve its database declarations before a full
Blueprint synchronization. A service-specific deployment does not require that
unrelated infrastructure mutation.
