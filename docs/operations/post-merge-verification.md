# Autonomous post-merge verification

A merged `code_change` job is code-complete. Production completion requires a
separate observation of its merge SHA and its functional acceptance result.

## Deployment order

1. Apply `20260913060000_senior_post_merge_commit.sql`. This additive, service-role
   RPC combines the existing queue compare-and-swap with the canonical proof
   ledger write in one transaction. It changes no media rows, budgets, task
   execution states or owner permissions.
2. Merge only after the required checks pass on the reviewed PR head. Confirm
   both the API and background worker deploy the resulting merge SHA.
3. The dedicated worker starts an independent adaptive poll (60–300 seconds).
   It inspects at most two due jobs per tick. A durable 90-second observation
   lease prevents concurrent replicas from probing the same job. Failed reads
   or writes retry after the lease expires; they do not execute another code job.
4. Inspect `result.postMergeVerification` in the senior queue/proof ledger.
   A missing receipt, migration or configuration is an open verification gap.

## Configuration and evidence

The existing owner-variable bridge resolves `RENDER_API_KEY`.
`IVX_POST_MERGE_API_SERVICE_ID` defaults to `srv-d7t9ivreo5us73ftose0`;
`IVX_POST_MERGE_WORKER_SERVICE_ID` defaults to the existing
IVX background worker, `srv-d9i15fg4n6ts73bn00j0`. `PRODUCTION_BASE_URL` defaults
to `https://api.ivxholding.com`. Both Render services must independently match
this repository, `main`, and their expected service types.
The built-in `RENDER_SERVICE_ID` identifies the current process; it is not used
as a substitute for the public API service binding.

Only GET requests are issued. Render credentials are sent only to
`api.render.com`, with redirects disabled. Reads have an 8-second timeout,
a 25-second HTTP observation deadline and bounded response bodies. No database
transaction is held across these requests.

`commitSha` remains the original PR-head commit. `prMergeCommitSha` is the
expected deployment SHA. Receipts include both service/deployment identities,
health, version and readiness observations. An old/deactivated deployment can
be linked as historical evidence but cannot certify current production.

Functional acceptance currently supports the existing
`landing-remediation:<source-sha>:<unit-id>` contract. It requires fresh,
hash-validated, persisted patrol evidence for the same agent, unit and deployed
merge SHA, observed after both deployments finished. A PASS for another unit,
empty readiness, generic HTTP 200, missing checks or stale evidence cannot seal
the job. Video presence/MIME patrols also remain open until an authentic media
acceptance adapter verifies actual footage; pointer-only PASS cannot close them.
General owner requests without this acceptance contract remain
`awaiting_acceptance`; each needs a real task-specific acceptance adapter.

## Operational limits

The poll inspects the retained durable senior queue (the existing limit is 200
terminal jobs). Older archived jobs are not automatically backfilled. Render
history reads are bounded to the latest 100 deployments per service. Historical
proof gaps outside these windows need an explicit backfill with real evidence.

This is a per-job verification receipt, not a fleet or uptime certificate.
It does not prove 112 independent productive agents, authentic property video
content, an owner-chat-to-visible-result trace, or 24 uninterrupted hours. Those
acceptance gates remain separate and must be measured.
