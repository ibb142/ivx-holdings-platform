# Runtime rectification after 5134f530

## Login

Malformed JSON, invalid types, oversized credentials and non-public special-use
email TLDs now fail before member-store or authentication I/O. Password whitespace
is preserved. Existing rate limits and the valid-login timeout/retry budget stay
in force. A valid-looking email with a wrong password still requires real Auth;
an unavailable provider remains HTTP 503, never a fabricated credential denial.

Local handler verification: 32 concurrent malformed/negative requests completed
in 1.724 ms combined, with zero authentication calls. This is an isolated handler
measurement, not a measurement of production network latency.

## Queue readiness

Queue health uses the existing PostgreSQL telemetry pool when direct credentials
are configured, with the existing transaction-local deadlines and service role.
REST remains the configured alternative when direct credentials are absent; a
failed direct read is not replayed over REST. Concurrent probes share one pending
read, and the next read observes current Owner authorization. The observer has
a five-second caller deadline and keeps timed-out producers until pg settles.

Readiness exposes transport, total time, pool acquisition and client query round
trip separately. Raw server SQL time remains unavailable. A fast timer does not
prove SQL execution below 50 ms. Owner pauses, current worker SHA/heartbeat,
queue saturation, stale queued work and circuit health still determine readiness.
The relevant code is in the queue observer, not autonomous control policy.

## IA-10 production recovery

Source: https://github.com/ibb142/ivx-holdings-platform/actions/runs/34761777846
was completed/failure. The live certificate did not verify IA-10 tool output.
The records were in `ivx_agent_executions` and `ivx_agent_states`, rather than the
historical jobs table. Initial recovery attempts timed out and rolled back.
Another operation closed the unstarted retry; our guard detected that change.
The adjusted, targeted transaction then failed the remaining orphan primary.

Readback at **2026-09-13T14:47:42.072169Z** confirmed:

| Record | State | Finished |
| --- | --- | --- |
| live112-34761777846-010-primary | failed | 2026-09-13T14:47:14.955151Z |
| live112-34761777846-010-retry | failed | 2026-09-13T14:13:10.814585Z |

IA-10 availability was `available`. Its actual heartbeat remained
2026-09-13T14:13:10.814585Z. Both executions retained `real_tool_used=false` and
`verified_output=false`. Recovery time is not productive work or certification.
The one-time SQL refuses changed state and is expected to refuse after recovery.

## Provider receipts

The collector targets the original 33 uncertain reservations before
2026-09-13T14:16:00Z; their sorted identity hash must match the recorded cohort.
It only reads Gateway generation receipts and uploads validated numeric/identity
evidence into the existing private durable document store. It creates no model
requests and changes no ledger amounts or budget limits. Missing credentials,
missing receipts, changed cohorts, wrong identities, BYOK, invalid timing/usage,
unfinished generations and costs exceeding reserved liability remain failures.

The receipt workflow runs on the dedicated repair branch and can be invoked
manually. It reports counts/error codes only. Private reservation IDs and receipts
are not printed to workflow logs. Verified receipts still need an atomic, audited
settlement that updates both the reservation and the daily ledger under the
existing budget-policy lock. Receipt collection alone does not settle a bill or
certify the fleet.

## Verification

- 59 targeted backend tests passed, including the actual HTTP handler, shared
  probe concurrency, failure handling, Owner authorization and PostgreSQL cleanup.
- 24 billing/receipt tests passed, including identity, cost, missing-receipt and
  upload boundaries.
- Backend TypeScript check passed before publication; production validation is
  required after an authorized merge/deploy.
