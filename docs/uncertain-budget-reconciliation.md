# Verified reconciliation of uncertain reservations

The four-argument batch proposal cannot run against the current ledger: daily
balances are keyed by `day` and store `settled_upper_nano`. It also assigns one
provider ID to unrelated orphan reservations. This implementation requires an
explicit receipt attestation for each reservation and preserves the shared
budget contract.

The operational command reads the selected reservations and fetches their
receipts through authenticated `GET /v1/generation` requests to the fixed AI
Gateway origin. It verifies the existing generation ID, model, original request
window, non-BYOK billing and consistent provider cost fields. Decimal charges
are rounded up to integer nanodollars. It retains only identity, cost, timestamps
and the SHA-256 of the response bytes. No inference requests are made.

The private SQL RPC accepts these backend attestations; a caller-provided string
is not itself proof of a provider payment. Do not expose this RPC through a
public endpoint, grant it to user roles or build attestations from guessed
amounts. Service credentials and the provider key must belong to the reviewed
project/account. SQL cannot authenticate arbitrary receipt JSON.

Apply `supabase/migrations/20260913161000_ivx_verified_budget_reconciliation.sql`
through the normal migration process. The requested
`database/functions/execute_budget_reconciliation_batch.sql` is an exact source
copy, checked by the PostgreSQL proof; install only one copy. The migration
creates a unique index on existing gateway generation IDs. Existing duplicate
IDs stop installation for investigation and are never deleted automatically.

The RPC signature is `(p_batch_size integer, p_receipts jsonb)`, with 1–112
explicit receipt entries. It locks the policy before reservations, consistently
with admission and ordinary settlement. Busy policy or reservation rows are
skipped. The receipt, reservation transition and daily counter commit together;
an error rolls back the batch. Identical retries do not charge again. Read back
the receipt rows: a zero count can also mean contention.

Charges are recorded on the reconciliation UTC day, preserving carryover of
old uncertain liabilities. The provider request's `completed_at` is preserved;
the receipt table records `reconciled_at` separately. An amount above the
reservation is booked in full and disables new admission. Reconciliation never
raises the budget, re-enables a disabled policy, certifies agents or suppresses
audit findings.

From a trusted operator environment, supply the project's PostgreSQL connection
in `IVX_BUDGET_RECONCILIATION_DATABASE_URL` and its AI Gateway key in
`AI_GATEWAY_API_KEY`. The command accepts the exact project's direct host or
Supabase pooler username. Do not put secrets in arguments or output files.

```sh
node scripts/ops/reconcile-uncertain-budget.mjs --reservation-ids=<uuid1>,<uuid2>
node scripts/ops/reconcile-uncertain-budget.mjs --reservation-ids=<uuid1>,<uuid2> --apply
```

Supply 1–112 distinct full reservation UUIDs. Abbreviations, task IDs, duplicate
IDs, duplicate flags and unknown arguments are rejected before a database client
is created. `--apply` is the only live switch: `--commit=true` is rejected, and
the `DRY_RUN` environment variable does not select the mode. The project binding
and provider key are required before connection; validation errors do not print
credentials.

The first command is a dry run. A preview with blocked receipts exits nonzero
and retains the structured report for review. The second re-fetches receipts,
starts a transaction, sets `statement_timeout = '4s'` before invoking the RPC, and verifies
durable results after commit. Provider reads have a 120-second batch deadline
and 5-second per-read limit outside database locks. A missing acknowledgement
is `WRITE_UNCONFIRMED`, never a claim that no rows changed. Inspect durable
receipt rows before retrying; the emitted exact receipt evidence can be used
for an idempotent RPC retry. A selected reservation already settled before the
command is reported for review rather than silently recharged.

Orphans with no existing provider generation ID remain uncertain. Their
reservation-to-provider linkage must first be recovered from external evidence
and reviewed individually. This operation does not assign IDs to them, and
neither a request hash nor a Git commit proves a provider charge.

Validation covers receipt rejection, dry runs, lost acknowledgements, CLI mode
and cohort validation, credential redaction, and client cleanup in Node tests:

```sh
node --test scripts/ops/reconcile-uncertain-budget-cli.test.mjs backend/services/ivx-uncertain-budget-reconciliation.test.mjs
```

The PostgreSQL proof checks monetary atomicity, idempotency, UTC
accounting, original timestamps, privilege boundaries, amount breaches, and
two-session lock contention. Run it only against the disposable local
`ivx_ha_test` database after the existing global-budget proof. The fleet workflow
runs this gate and retains its JSON evidence. A local embedded PostgreSQL run
does not certify multi-session concurrency or production receipt reconciliation.

References: [AI Gateway generation receipt contract](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api#look-up-a-generation)
and [PostgreSQL statement timeouts](https://www.postgresql.org/docs/17/runtime-config-client.html).
