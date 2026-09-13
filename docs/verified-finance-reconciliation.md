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

The SQL job does **not** call the provider or obtain new vouchers. The existing
collector is scoped to its original recovery cohort; it does not continuously
collect future receipts. New cohorts need authenticated collection and review
of their collector revision before this consumer can settle them. Therefore a
successful cron execution alone does not mean full financial reconciliation.

Operational evidence is in `ivx_ai_finance_reconciliation_runs`; scheduling and
execution status are in `cron.job` and `cron.job_run_details`. The named job is
`ivx-verified-finance-reconciliation`. Pause this consumer, if needed, with:

```sql
select cron.alter_job(job_id := jobid, active := false)
from cron.job where jobname = 'ivx-verified-finance-reconciliation';
```

Local tests use a separate PGlite PostgreSQL runtime and do not connect to
production. See the dedicated GitHub workflow for the reproducible command.
Cron itself must be checked on the hosted PostgreSQL instance.
