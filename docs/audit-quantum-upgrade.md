# Autonomous upgrade evidence audit

Run with an existing secure database binding:

```sh
node scripts/ops/audit-quantum-upgrade.mjs
node scripts/ops/audit-quantum-upgrade.mjs --scan-limit=1000
```

Bindings are checked in order: `IVX_BUDGET_RECONCILIATION_DATABASE_URL`,
`SUPABASE_DB_URL`, `DATABASE_URL`. Blank values are ignored. The script uses the
existing `pg` dependency, one client, a five-second connection timeout, and
independent read-only transactions with three-second statement deadlines. It
closes the client exactly once, including connection/query failures.

The task scan first selects at most 500 recent task identities by creation time
(configurable from 1 to 2000), then searches only those payloads and task IDs for
whole terms `quantum`, `AGI`, or `self_upgrade` and its space/hyphen variants.
It reports at most ten matches. It does not sort different tasks by version:
versions are per-task counters and are returned as strings without rounding.
`older_tasks_unscanned` explicitly identifies incomplete historical coverage;
zero matches applies only to the scanned sample. The time range is included.

Canonical evidence previews use `evidenceType`, `createdAt`, `commitSha`,
`deploymentId` and `contentHash`. They show at most 20 entries per task and label
legacy `step`/`status` entries separately. Non-array evidence is reported as an
invalid format instead of parsing arbitrary serialized content. Raw payloads,
evidence source/summary/output, and database error messages are not printed.
An absent completion timestamp is left null; it is not a running-state claim.

The separate daily-log query uses the exact existing key
`self-upgrade/daily-upgrade-log.json` in `public.ivx_durable_documents`. Its
success flag, score and 10/10 flag are explicitly reported claims. The report
also includes the document's update time and age. Each query has its own
observation timestamp; the two sections are not one atomic snapshot.

Exit codes: **0** means both queries completed; **1** means configuration,
connection or cleanup failed; **2** means a query was unavailable. A timeout
returns unavailable data rather than an empty successful result. Exit 0 does
not certify an upgrade: `upgradeVerified` always remains false because keyword
matches and stored claims do not verify CI, source changes or production
behavior. `versionProgress` remains unassessed with a single snapshot.

The owner-requested mission definition is stored in
`qa/autonomous/quantum-self-upgrade-mission.json`. It is the initial admission
payload, not a live status snapshot. Its stable task ID and idempotency key are
submitted through the existing `ivx_autonomous_tasks_create_batch` function.
The manager can subsequently attach the active objective and advance the
version. Re-submission does not reset an existing task or discard its leases,
evidence or version. All eight acceptance criteria start unmet; no budget or
10/10 success claim is injected. Publication, merge and deployment retain their
existing owner gates. Queued admission does not certify worker execution.

The audit does not start the scheduler, call an AI provider, create tasks,
change budget reservations, or deploy code. Follow the returned evidence
references and verify their CI/deployment outcomes before certifying a change.

Validation:

```sh
node --test scripts/ops/audit-quantum-upgrade.test.mjs
IVX_PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite \
  node --test qa/quantum-upgrade-postgres.test.mjs
IVX_PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite \
  node --test qa/quantum-upgrade-mission-postgres.test.mjs
```

The SQL test uses an isolated PostgreSQL engine with canonical and malformed
fixtures, large integer versions, misleading substrings, bounded history and
unchanged-row assertions. Production credentials are not required for tests.
