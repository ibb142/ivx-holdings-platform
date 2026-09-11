# Phase 3: budget settlement recovery

On 2026-09-11, two production provider transports finished but their database
settlements failed. Reservations made at 23:03:16 and 23:04:35 UTC remained
active and occupied both global slots. Their original API deployment was later
deactivated; the uncertain monetary liability was USD 1.645056.

The transport attempted settlement once and then discarded the receipt metadata.
This change attempts the same idempotent database operation up to four times,
with background retry delays of 1, 5 and 15 seconds. Retries never call the
provider, create another reservation, change its status/cost, or refund uncertain
work. The response waits only for the first database attempt. Acknowledged
settlements stop retries, including a pricing breach that disables admission.
Repeated finish calls share the first completion promise.

At the first retry and after permanent failure, logs retain the reservation ID,
process identity, settlement status, cost upper bound and provider generation ID,
without prompts, responses or credentials. If all attempts fail, the reservation
stays in PostgreSQL. This permits later reviewed recovery.
Process crashes still require proof of transport termination and reconciliation;
there is no automatic expiry of monetary liability or fictional zero-cost refund.

Six deterministic tests cover transient failure, a committed write with a lost
acknowledgement, bounded permanent failure, unknown costs, a pricing breach and
non-overlapping retries. The PostgreSQL gate also reproduces a committed
settlement followed by a lost acknowledgement using the real retry helper and
two independent connections. It requires one charge, zero active reservations
and preservation of the provider receipt. All calls are isolated; no provider
requests or production rows are used by that gate.

This patch does not change the owner's USD 200/day limit or claim provider
saturation, invoice reconciliation, full fleet productivity or Phase 3 closure.

## Production recovery observed at 2026-09-11 23:49 UTC

The two reviewed reservations were changed from `reserved` to `uncertain` using the existing finish RPC at 23:48:28 UTC, with exact reservation, worker, creation-time, amount and policy-revision guards. A separate read at 23:49:07 UTC confirmed both results. Their full combined USD 1.645056 liability remains counted; no provider cost was invented or refunded.

The released capacity admitted subsequent production work. The status sample still showed two active requests, now with two uncertain charges. Another settlement-unconfirmed log at 23:49:06 UTC demonstrates that the deployed single-attempt implementation still needs this patch. This recovery is not evidence of permanent saturation recovery or invoice reconciliation.
