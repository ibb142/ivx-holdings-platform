# Verified finance reconciliation

The migration schedules `fn_autonomous_finance_depuration()` every five minutes
with pg_cron. It consumes private provider receipt documents for reservations
that are `uncertain` and older than fifteen minutes. Age is only an eligibility
condition. It never substitutes for billing evidence.

The consumer accepts only reviewed collector revisions in
`ivx_ai_receipt_sources`. Initial approval covers the collector implementation
at `ef429b20225fc01c84f6adc9e5f165291a95d389`, which authenticates its GET calls to
Gateway and verifies generation identity, model, BYOK exclusion, finality and
cost aliases before writing evidence. Source approval is writable only by the
database administrator; the backend service role can read it. A digest provides
integrity, not independent provider authentication.

The database revalidates the receipt's identity, amount, timestamps, token
counts, allowed source and digest against the live reservation. It accepts no
more than ten agreeing receipts per reservation and processes up to twenty-five
reservations per transaction. Evidence errors remain pending with private
rejection reasons. Rows without receipts are not candidates. Rejected older
receipts require investigation and can fill a batch until corrected.

Settlement uses the admission policy's existing lock order. Reservation state,
daily cost and immutable settlement audit are written atomically. Repeated
execution does not charge again. Historical liabilities are charged to the
current UTC admission day, matching the existing `ivx_ai_budget_finish` RPC.
Budget policy, Owner controls, agent state and certifications are not modified.

The SQL job does **not** call the provider. The Pending Provider Receipt
Collection Actions workflow obtains new receipts every five minutes and on
relevant main pushes. It makes authenticated GET requests only, writes verified
private evidence, then invokes the atomic consumer for up to two batches.
GitHub scheduled executions can be delayed; the database cron independently
consumes evidence that has already arrived.

The new collector's source revision is a 160-bit prefix of SHA-256 over the exact
collector, validator and collection-workflow bytes. It is a content revision,
not a Git commit. Approval therefore survives unrelated deployments but changes
when any trusted collection code changes. The actual Git commit and Actions
invocation are recorded separately in private collection reports. Review and
approve a new content revision before enabling modified collection code.

Selection rotates through bounded batches of old, terminal uncertain records
that have generation IDs. Ambiguous generation bindings are rejected. Existing
documents are left for the SQL validator instead of repeatedly appending more
copies. Credentials and private report payloads are not written to Actions logs.
Missing generation IDs, unavailable receipts and rejected evidence remain
pending. A successful cron execution alone never certifies full reconciliation.

Operational evidence is in `ivx_ai_finance_reconciliation_runs`; scheduling and
execution status are in `cron.job` and `cron.job_run_details`. The named job is
`ivx-verified-finance-reconciliation`. Pause this consumer, if needed, with:

```sql
select cron.alter_job(job_id := jobid, active := false)
from cron.job where jobname = 'ivx-verified-finance-reconciliation';
```

Receipt prefixes use bytewise pattern operators and a `text_pattern_ops` index.
Ordinary range comparisons against a trailing tilde are invalid under the
production `en_US.UTF-8` collation. The collector uses a LIKE prefix instead.

The CI contract suite runs against PostgreSQL 17 initialized with `en_US.utf8`
and reproduces the locale failure before asserting the corrected comparison.
An optional isolated PGlite runtime supports fast local accounting checks but
does not reproduce operating-system locale ordering. Tests do not connect to
production. Cron itself must be checked on the hosted PostgreSQL instance.
