# Guarded finalization entry point

`scripts/ops/finalize-100-percent.sh` preserves the owner-requested command name
and delegates to the reviewed task recovery pipeline. Its name is not a claim
that deployment, media acceptance, an APK build or the 112-agent fleet is complete.

```bash
chmod +x scripts/ops/finalize-100-percent.sh
./scripts/ops/finalize-100-percent.sh
```

This default invocation previews the database budget and up to ten FAILED tasks.
It requires a configured project database URL; it does not obtain credentials
from another environment. Connection and argument errors return a nonzero exit.

To apply recovery, first select actual eligible IDs from the preview and set
`IVX_RECOVERY_TASK_IDS` to those IDs, separated by commas:

```bash
./scripts/ops/finalize-100-percent.sh --apply \
  --task-ids="$IVX_RECOVERY_TASK_IDS" \
  --reason='Owner-authorized recovery of verified expired task leases'
```

The underlying operation preserves retry limits, compares versions, clears all
lease fields, synchronizes the payload, and writes an audit event atomically.
An apply request that recovers no tasks returns exit 2. A preview or acknowledged
recovery returning exit 0 does not certify release completion.

`IVX_EXPECTED_SOURCE_SHA` optionally binds execution to a specific local commit.
It must resolve to the current checkout. Invalid, unknown, ambiguous and different
commits stop the launcher before it opens a database connection. This check proves
local identity only; it does not prove that a commit is published or deployed.

Publishing code remains a separate PR operation with successful required checks.
This entry point performs no force push, branch overwrite, approval override,
deployment, or APK workflow dispatch. It does not mark an unavailable Reels feed
as successful playback.

Financial reconciliation is separate from task recovery. An old reservation or
missing generation ID does not establish that a provider request never started.
Cancellation requires evidence of no consumption. Completed requests whose
settlement is unconfirmed can be reviewed through the native budget operation,
retaining the full liability as uncertain and recording their existing provider
IDs and runtime evidence. The launcher never cancels financial rows by age.

See [the recovery contract](force-live-deployment.md) for connection precedence,
project binding, transaction safeguards and the distinction between requeueing
and completed execution.
