# IVX Autonomous — Audit, QA, and Executable Vision Upgrade

**Audit time:** 2026-09-06T23:58:00Z  
**Production source SHA observed:** `9ea20cd38727fa721890c6676f432622b6070da6`  
**Local remediation branch:** `fix/autonomous-control-order-20260906`  
**Production verdict:** **RED — 112/112 simultaneous execution is not certified**  
**Local remediation verdict:** **PASS — typecheck and focused executable checks pass**

## Executive finding

The 112-agent registry exists, but live evidence does not prove 112 agents working simultaneously. The current hot path repeatedly reprocesses dispatcher and senior-worker state through shared durable JSON documents. This creates database reads, full-document writes, and event rows that look like activity without proving distinct productive work.

The fleet must remain capped at the currently deployed capacity until the hot queue uses normalized PostgreSQL rows with atomic claims, leases, heartbeats, and worker identity. The new executable vision fails closed while the queue backend is `durable_json`.

## Live production evidence

### Supabase cumulative counters

`pg_stat_statements` was reset at `2026-08-30T03:44:10.23604Z`. These are cumulative SQL statement counts since that reset, not files, agents, or completed tasks.

| Observation (UTC) | Durable reads | Durable document writes | Durable event inserts |
|---|---:|---:|---:|
| 2026-09-06 23:35:57 | 9,372,312 | 4,414,310 | 4,371,823 |
| 2026-09-06 23:43:41 | 9,373,478 | 4,414,537 | 4,372,427 |
| 2026-09-06 23:47:57 | 9,374,106 | 4,414,738 | 4,372,857 |

Measured over the final 255-second window, the system added approximately 148 reads/minute, 47 full-document writes/minute, and 101 event inserts/minute.

The `ivx_durable_events` relation was approximately 2.219 GB with about 4.4 million rows. Historical rows were not deleted during this audit.

### Runtime truth

| Signal | Observed | Required for 112 certification |
|---|---:|---:|
| Registered logical agents | 112 | 112 |
| Normalized agent-job rows | ~7,260 | informational only |
| Queued agent-job rows | 131 | informational only |
| Rows labelled running/validating | 283 | not proof without fresh leases |
| Fresh lock holders | 0 | active leases required |
| Distinct fresh lock holders | 0 | known claimant identity required |
| Owner-AI tasks | ~40 | informational only |
| Fresh Owner-AI heartbeats | 0 | fresh heartbeat required |
| Deployed concurrency | 12 | at least 112 |
| Hot fleet queue | shared durable JSON document | atomic PostgreSQL rows |

Therefore the production claim is not 112/112. Rows labelled `running` are stale or unproven when no fresh lock/heartbeat identifies a live claimant.

## Root cause

The latest 10,000 durable events were dominated by the app-completion dispatcher and senior-worker queue:

| Event | Count |
|---|---:|
| `job_started` | 3,260 |
| `job_attached` | 2,782 |
| `job_enqueued` | 711 |
| `duplicate_evidence_rejected` | 580 |
| dispatcher `control` | 571 |
| `job_expired` | 506 |
| `record_superseded` | 415 |
| `job_cancelled` | 290 |
| `stale_recovered` | 247 |

A shorter live increment showed 76 `job_started` events alongside 39 attachments and 38 enqueues. Code review found the matching defects:

1. A worker job that remained `queued` was synchronized back to a `QUEUED` campaign record while retaining its `workerJobId`.
2. The next dispatcher tick did not check that `workerJobId`, submitted the same campaign record again, attached to the still-queued worker job, and forced the campaign record back to `RUNNING`. This created a repeating `QUEUED → attach → RUNNING → QUEUED` cycle.
3. The dispatcher emitted `job_started` after both a new enqueue and an attachment to existing work.
4. The senior worker emitted `duplicate_evidence_rejected` but then fell through and enqueued the duplicate anyway.
5. Repeated submissions with the same campaign `taskId` emitted a new attachment event on every cycle.
6. The shared JSON queue performs load-modify-save operations and cannot provide safe multi-process atomic claims.

## Remediation implemented locally

- Encoded the canonical fleet as 12 command agents plus 100 execution agents.
- Added an executable 112 activation gate requiring distinct agents, leases, fresh heartbeats, claimant identity, concurrency, one authority, an atomic PostgreSQL queue, and zero stale/blocked/emergency conditions.
- Made the truth endpoint's top-level `ok` mean full certification, not merely “112 registry rows exist.”
- Established one default fleet mutation authority; deployment repair, doctor repair, and GitHub supervisor mutation loops fail closed unless explicitly enabled.
- Restored owner priority: pause, stop, disable, and emergency stop cannot be overridden by the 24/7 mandate or doctor repair.
- Prevented read-only observation/learning from manufacturing repair tasks.
- Disabled the 30-second campaign feed unless explicitly enabled.
- Made exact `taskId` retries reuse the existing worker job without a new event.
- Made completed duplicate evidence reuse the prior completed job when present instead of enqueuing again.
- Made campaign records with a `workerJobId` poll that worker until terminal state; they are no longer eligible for redispatch while the worker is queued.
- Preserved the real worker status instead of forcing every enqueue/attachment to `RUNNING` with a fabricated fresh heartbeat.
- Separated `attached` from `started` in dispatcher tick results and stopped emitting false `job_started` events for attachments.
- Converted 23 competing GitHub fleet workflows to manual dispatch only and kept secondary production mutation loops disabled in `render.yaml`.

## QA evidence

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| Render + 23 changed workflow YAML files parse | PASS (24 files) |
| Safe default authority count | PASS (`1`) |
| Secondary controller detection | PASS (`2`, therefore certification blocks) |
| Repair capacity with 112 campaign / 12 continuity slots | PASS (bounded to `12`) |
| Current backend certification | PASS fail-closed (`durable_json`, 12 slots, no worker identity) |
| Exact active `taskId` retry | PASS (one job; second request attaches) |
| Exact completed `taskId` retry | PASS (prior completed job reused; queue remains one job) |
| Attached dispatcher job accounting | PASS (`started=[]`, `attached=[task]`) |
| Queued worker across two dispatcher ticks | PASS (one enqueue; zero re-enqueues/attachments on tick two) |

The repository's Bun test runner is not installed in this execution environment, so focused checks were executed directly through the installed TypeScript runtime in addition to the full TypeScript compile.

## Required gates before 112 activation

1. Publish and deploy this containment patch; verify database event/write rates fall in production.
2. Migrate the fleet's hot queue from shared JSON documents to normalized PostgreSQL rows with atomic conditional claims.
3. Persist lease owner, worker identity, lease expiry, heartbeat, attempt budget, and idempotency key for every task.
4. Prove graceful drain, lease recovery, zero duplicate execution, and owner stop controls under multi-worker load.
5. Increase capacity in measured stages. Stop automatically on lock, connection, error, cost, memory, or evidence-integrity thresholds.
6. Certify 112 only from one observation window containing 112 distinct active tasks, 112 distinct valid leases, 112 fresh heartbeats, sufficient deployed capacity, and no blockers.

Historical event retention and archive should be addressed separately and in batches. Deleting millions of rows is not a remediation for the execution loop and was not authorized or performed.
