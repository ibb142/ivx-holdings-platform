# Verified recovery on main e52bfee8

`scripts/ops/force-live-deployment.sh` retains the requested filename. It performs
a read-only database/capacity preflight and optionally recovers explicitly selected
FAILED tasks. It does not deploy, terminate sessions, refund reservations or claim
zero runtime errors. These operations are not equivalent to zero-traffic recovery.

```bash
# Dependencies: repository Node/pg installation and a configured database URL.
chmod +x scripts/ops/force-live-deployment.sh
./scripts/ops/force-live-deployment.sh

# Apply only after selecting task IDs from the preview, at most ten per invocation:
./scripts/ops/force-live-deployment.sh --apply \
  --task-ids=TASK_ID_FROM_PREVIEW \
  --reason='Owner-authorized recovery of verified expired leases'
```

The URL precedence is `IVX_PATROL_RECOVERY_DATABASE_URL`,
`IVX_BUDGET_RECONCILIATION_DATABASE_URL`, `SUPABASE_DB_URL`, then `DATABASE_URL`.
URLs must identify project `kvclcdjmjghndxsngfzb`; certificate verification remains
enabled. Credentials are never printed or passed as shell command arguments.

The preflight checks capacity and monetary exposure independently. Missing or
invalid budget data, disabled admission, full capacity or an exhausted daily
budget blocks task writes. Worker admission still reserves capacity at execution;
the preflight is an observation, not a guarantee that slots remain available.

Task writes use the existing `recover-failed-patrols.mjs` recovery operation: row
locking with SKIP LOCKED, expected-version comparison, expired leases, stale
heartbeats, retry attempt/time limits, synchronized payload/columns, bigint version
increment and an audit event in the same transaction. A lost commit acknowledgement
is reported as uncertain and is never retried automatically.

Exit 0 means preview or acknowledged recovery completed; exit 1 means failure or
blocked preflight; exit 2 means an apply request recovered no tasks. Read JSON
`tasks.applied`, `tasks.skipped` and `tasks.errors` for per-task results.

## Findings and live execution, 2026-09-13 UTC

- At 22:16, the proposed idle-session filter matched 17 managed connections,
  including PostgREST, Realtime, Supavisor, Auth and infrastructure connections.
  None were terminated. An idle state does not establish that a session is leaked.
- The actual reservation primary key is `reservation_id`; there is no `id` or
  `updated_at` column. Allowed statuses are `reserved`, `settled`, `uncertain` and
  `cancelled`; `EXPIRED_RELEASED` violates the existing constraint.
- PostgreSQL termination signals also do not certify zero runtime errors or freed
  RAM. A count of a boolean expression would count false values as well. See the
  [PostgreSQL administration reference](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL).
- At 22:20 and again immediately before recovery at 22:23:45, the native budget
  status reported 1 active reservation out of 12, 37 uncertain charges,
  USD 131.173144554 settled upper bounds and USD 28.940432 retained liabilities
  against the authorized USD 1000 daily limit. The claimed 12/12 block was not
  present at these observations; no financial rows were changed by this operation.
- Ten recent FAILED tasks were inspected: five had exhausted retry attempts/time,
  one eligible task referenced an older source revision, and four eligible tasks
  referenced current main `e52bfee8`. Only those four were selected.

Recovery run: `c44d9964-9c50-4f13-bfbb-807cf88b9769`.

| Agent | Task | Version | Audit event |
| --- | --- | --- | --- |
| IA-09 | `task_mu0d0zqr_n3tjp54i` | 8 → 9 | `2554656` |
| IA-36 | `task_mu0d0fcr_al33pz2q` | 8 → 9 | `2554684` |
| IA-85 | `task_mu0cz6qf_oo4kwa1d` | 8 → 9 | `2554699` |
| IA-61 | `task_mu0cz4kn_n71g2gp5` | 8 → 9 | `2554707` |

All four transactions were acknowledged between 22:24:16 and 22:24:47. Independent
readback at **22:25:44 UTC** confirmed all four durable audit events, version 9,
retry count 1, cleared leases and `QUEUED` in both the column and payload. Workers
had not yet claimed these four tasks at that observation. This proves requeueing,
not completed execution, 112 active agents or continuous production health.

The shell entry point was executed in this workspace and correctly returned
`DATABASE_URL_REQUIRED` because no direct database URL was configured locally.
The live recovery used the connected Supabase SQL channel with the exact existing
guarded recovery statement, explicit IDs/versions and per-task transactions.

Seven new local preflight/CLI tests passed. The reused recovery statement already
has a PostgreSQL 17 proof suite, including two-connection lock contention. The CI
workflow now runs both the new seven tests and that SQL proof suite.
