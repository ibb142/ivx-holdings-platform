# Connection audit

Run from the repository root with Node 22+ and the existing `pg` dependency installed:

```sh
node scripts/ops/audit-connection-leakage.mjs
```

Supply an existing secret connection URL through one of these variables, in priority order:

1. `IVX_CONNECTION_AUDIT_DATABASE_URL`
2. `IVX_BUDGET_RECONCILIATION_DATABASE_URL`
3. `DATABASE_URL`

The auditor opens one connection, runs a read-only transaction and closes the connection even when an operation fails. It does not update application data, change global settings, requeue tasks or terminate other sessions. Connection acquisition is limited to 5 seconds, statements to 3 seconds and lock waits to 500 milliseconds. URL options cannot remove those limits. Supabase connections use the backend's bundled public CA with certificate verification enabled.

Output is JSON. Exit code **0** means the snapshot was collected with visible activity statistics, **2** means activity visibility was incomplete, and **1** means the audit failed. Exit code 0 does not certify database or fleet health. Threshold findings are included in the report. Query text, query parameters, connection URLs and raw error messages are not printed; application names, client addresses and process/query identifiers are included, so keep production output private.

The single snapshot distinguishes client connections from internal PostgreSQL processes, reads the actual server and reserved-slot settings, and groups clients by database, role, application and address. Capacity includes the auditor itself. Transaction ages use total elapsed seconds, including days and hours. Detailed long-transaction/lock-wait observations are limited to the current database and exclude the auditor; lists are capped at 50 with explicit truncation indicators. `pg_blocking_pids` reflects locks observed during the query and can change immediately afterward.

Idle connections and large groups do not prove a connection leak. Names and addresses can represent many processes behind a pooler. Long transactions do not alone prove locks, swap pressure or the cause of an HTTP 503. To investigate a leak, compare snapshots under comparable load, configured pool sizes and process counts, plus application pool total/idle/waiting counts and pooler client/server queue metrics. Nominal general slot headroom does not measure role-specific limits, Supavisor/PgBouncer admission or connection acquisition delays.

Run the regression tests without production credentials:

```sh
node --test scripts/ops/audit-connection-leakage.test.mjs
```

References: [PostgreSQL activity statistics](https://www.postgresql.org/docs/17/monitoring-stats.html), [node-postgres Client configuration](https://node-postgres.com/apis/client), and [Supabase connection management](https://supabase.com/docs/guides/database/connection-management).
