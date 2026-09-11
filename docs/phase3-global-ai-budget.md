# Phase 3 item 11.4: shared monetary admission

Process-local token counters cannot enforce one daily budget across API and
worker replicas. This change reserves a conservative USD liability in PostgreSQL
before each instrumented provider HTTP attempt, including SDK retries and
fallbacks. One policy-row lock serializes reservation and settlement; it does
not serialize the model calls themselves. Independent calls may run concurrently
within the configured shared capacity and monetary envelope.

## Delivery is not activation or certification

The migration creates a disabled policy with **no daily amount**. The transport
is opt-in through `IVX_AI_GLOBAL_BUDGET_ENABLED=true`. Deploying this code leaves
the existing behavior unchanged until activation. No owner-approved numeric
USD/day ceiling is recorded by this patch. Existing process defaults, available
provider credit and permission to deploy are not substituted for that amount.

Item 11.4 remains partial until the owner supplies the amount, the policy and all
replicas are activated, and production evidence proves the shared admission.
Item 11.5 also needs a bounded production provider-limit and recovery test. A
local fixture or a passing PostgreSQL test does not establish the upstream
provider's sustainable capacity, invoice limit, or 24/7 continuity.

## Scope and accounting

- The first import in the API and both worker entry points wraps global `fetch`.
  Known provider hosts and requests using the configured AI credential aliases
  are intercepted. This covers the installed SDK and legacy direct HTTP calls
  in these processes. Other executables, WebSocket connections and external
  uses of the provider account are outside this control.
- Supported operations are Gateway v3/v4 language-model, OpenAI-compatible chat
  completions and Anthropic messages. Unknown operations, paid tools, multiple
  completions, output modalities and custom provider routing options fail with
  HTTP 402 while enforcement is enabled. Image generation, transcription and
  speech requests therefore need their own pricing support before activation
  can preserve their availability. They cannot spend using a text estimate.
- Every quote uses the public Gateway model catalog, valid for five minutes,
  and reserves a full published context plus maximum output at the highest
  published input/cache-write/cache-read and output prices across pricing tiers.
  Nanodollar integers round upwards. Missing model bounds or prices block the
  request. These are conservative upper bounds, **not actual invoice costs**.
- Complete valid usage settles a conservative token-cost upper bound. Anthropic
  cached tokens are included. Streaming usage must have a terminal marker;
  incomplete usage, failed HTTP, cancellation after sending, lost replies and
  failed settlement retain the original liability. Only a request cancelled
  before upstream transmission may be refunded as zero work.
- Unknown charges release concurrency after confirmed local termination but
  continue consuming the monetary budget. A crashed process leaves its active
  reservation in place. There is no automatic expiry or refund: recovery needs
  evidence of the request's termination and bill. Do not delete reservations to
  make the counters green. Requests have a 120-second transport deadline.
- UTC completion-day costs plus all unresolved liabilities from every prior day
  consume the daily ceiling. A restart or midnight cannot erase pending charges.
  Duplicate reservation IDs never grant another call. Duplicate identical
  settlements are idempotent; conflicting or wrong-worker settlements fail.
- Usage exceeding the quoted amount is recorded and disables further admission.
  Catalog price changes, uninstrumented clients and provider billing semantics
  still require reconciliation with provider receipts and account controls.

The existing authenticated Owner AI jobs runtime response includes `globalBudget`
with marker `ivx-global-ai-budget-v1`, enforcement state, policy revision, timestamp,
shared active requests, unresolved liabilities and settled upper bounds. A missing
policy or failed read is shown as unknown/blocked when enforcement is requested.

## Rollout and verification

1. Pass all applicable PR checks. The fleet gate runs transport unit tests, the
   installed SDK against an isolated transport, and four real PostgreSQL
   connections against an isolated `ivx_ha_test` database. Its artifact retains
   `global-ai-budget.json` and `global-ai-budget-sdk.json` with the tested SHA.
2. Apply `20260911203746_ivx_global_ai_budget.sql` through the migration workflow.
   Tables use RLS; only the backend service role can execute the budget RPCs.
   The existing bounded database pools are reused.
3. Record the owner's explicit positive global USD/day amount and an auditable
   authorization reference. Convert the decimal string to nanodollars without
   floating-point arithmetic. Set the policy amount and measured concurrency
   limit in a reviewed transaction, increment its revision, then enable it.
   No illustrative or default production budget is supplied here.
4. Enable `IVX_AI_GLOBAL_BUDGET_ENABLED=true` on every API/worker replica and
   deploy the verified SHA. Check each process, not just a load-balanced response.
   Inventory other paid call transports before describing this as account-wide.
5. Within that approved envelope, prove two processes share the same monetary
   and concurrency admission, denial reaches no upstream HTTP, retries each
   reserve, cancellations retain uncertain charges, and recovery preserves the
   ledger. Capture timestamps, SHA, policy revision and provider receipts.
6. Reconcile unknown charges with provider evidence before a reviewed manual
   correction. Disabling the database policy while the transport flag remains
   enabled stops new instrumented spending. Do not use the opt-out flag as a
   way to bypass an exhausted or uncertain budget.

Local commands (no paid provider calls):

```sh
bun test backend/services/ivx-global-ai-budget.test.ts
bun scripts/ivx-global-ai-budget-sdk-proof.ts
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json
# The fleet gate provisions PostgreSQL 17 and its prerequisite test roles:
node scripts/ivx-global-ai-budget-postgres-proof.mjs
```

Official references: [Gateway model catalog](https://vercel.com/docs/ai-gateway/models-and-providers),
[Gateway budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets),
[generation usage and cost](https://vercel.com/docs/ai-gateway/observability-and-spend/usage).
Gateway account soft caps alone do not reserve concurrent in-flight liabilities.
