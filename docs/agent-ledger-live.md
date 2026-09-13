# Agent ledger live view

`GET /api/ivx/autonomous/agent-ledger?view=live` returns a JSON snapshot through
the existing native `Request` handler. It accepts the same registered owner,
system key or trusted GitHub Actions OIDC authentication. Responses remain
`Cache-Control: no-store`. This is a polling endpoint, not an SSE stream.

The default ledger, historical `from`/`to` reads and attribution ingest retain
their contracts. Combining `view=live` with either historical parameter returns
400. Pool setup, authentication infrastructure or query failures return the
existing generic 503 response without fabricated counts or internal error text.

## Meaning of the response

- `timestamp`: PostgreSQL statement time shared by the matrix and summary.
- `matrix112`: ordered slots 1–112. Missing registry entries have null registry
  fields, `registered: false` and `heartbeat_state: MISSING_AGENT`.
- `summary.registry_complete`: all 112 exact `ivx_holdings_<number>` identities
  exist with matching company and number. Array length alone is insufficient.
- `summary.fresh_heartbeat_count`: registry heartbeats between 60 seconds before
  and 5 seconds after database time. Missing, absent, stale and future heartbeats
  are distinguishable. The registry's `status: active` is not execution proof.
- `summary.active_concurrent_count`: canonical native queue lease holders in
  `RUNNING`, with a nonempty worker instance, unexpired lease and task heartbeat
  in the same freshness window. Ownership comes from
  `agent:ivx_holdings_<number>`, including work stolen from another assignment.
  The runtime updates registry `last_task_id` after finishing, so that pointer
  and registry heartbeat freshness do not gate current task observations.
- `metrics`: counts by reported registry status, including null for missing
  entries; each group separates presence and active task counts.
- `status`: `WORK_OBSERVED` or `NO_ACTIVE_WORK_OBSERVED` within this native queue
  scope. Neither certifies productive hours, completed outputs, all deployment
  phases or executions outside this queue. Existing ledger evidence serves those
  separate purposes.

## Database cost and validation

One fixed query projects narrow columns from the registry and task table; it
does not load task JSON payloads. It reuses `getObserverPool(..., 'telemetry')`
and its transaction-local deadlines. Overlapping requests share the read but
receive independent response objects. Settled results and errors are not cached.
The existing primary keys and unique partial
`ivx_autonomous_tasks_active_holder_idx` bound each of the 112 lookups. No schema
or pool budget change is required.

The recovery contract workflow runs the backend typecheck, API and coalescing
regressions, and the exact SQL against isolated PGlite fixtures. SQL tests cover
missing/foreign identities, work stealing, presence without work, stale/future
heartbeats, expired leases, absent workers, read-only execution and complete
idle registries. PGlite does not establish native pool performance or production
HTTP availability; deployment must be verified separately.

The exported query also ran through the Supabase connector in a read-only
production transaction with a 2500 ms statement limit. At
2026-09-13 20:41:24 UTC it observed 112 canonical registry entries, 5 fresh
registry heartbeats, 11 native RUNNING holders with valid leases and task
heartbeats, and no future registry heartbeats. These are timestamped
observations, not a production HTTP test or a claim that this commit is deployed.

## Connection cleanup

The proposed idle-session filter excluding names containing `supabase` or
`pooler`, even with `ILIKE`, also selects `Supavisor`, PostgREST and Realtime
sessions. Its read-only production preview on 2026-09-13 selected 30 managed
connections. No sessions were terminated and no role settings were altered.
Do not use that exclusion list to classify connections as unmanaged.

PostgreSQL defines `idle` as waiting for another client command; it is not a
leak diagnosis. See [connection activity states](https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW)
and [statement timestamps](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).
