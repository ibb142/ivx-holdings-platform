# IVX 112 Atomic Fleet Verification — 2026-09-07

Generated at: `2026-09-07T15:42:23Z`

## Verdict

**Implementation and database capacity: VERIFIED. Production activation: NOT YET VERIFIED. Landing 10/10: NOT YET CERTIFIED.**

The repository fix is committed locally at `118afdacd5ad03bc951dadfeef007f00c32f9f26`. The two additive Supabase migrations are live. The Render API is still running main commit `fe73e97e21eeacd279038a5a00f26da613b2a6c5`, so the live service has not started the repaired 112-lane runtime.

No report may claim 112/112 production work until one observation window proves all of these at the same time: 112 registered agents, 112 distinct logical lease holders, 112 distinct active task IDs, 112 task heartbeats no older than 60 seconds, at least one physical worker identity, configured capacity 112, one mutation authority, zero stale or blocked agents, and emergency stop inactive.

## Root gaps found

| Gap | Evidence | Repair |
|---|---|---|
| Fleet tasks lived in one JSONB document | Concurrent processes could read the same snapshot and overwrite or duplicate leases | Added normalized `ivx_autonomous_tasks` rows and PostgreSQL RPC mutations |
| Lease mutex was process-local | It could not coordinate overlapping Render processes | Claims now use `FOR UPDATE SKIP LOCKED` |
| Two processes could assign different tasks to one logical IA | No database invariant existed for one active lease per holder | Added advisory transaction locks and partial unique index `ivx_autonomous_tasks_active_holder_idx` |
| 112 cold starts caused repeated Supabase reads and writes | Each lane independently seeded, read, leased, started and heartbeated | Added in-flight read coalescing and fleet batch create/claim/start/heartbeat operations |
| Restarted work could remain stranded | Old RUNNING work waited on process memory or stale JSON state | Expired active leases recover from shared PostgreSQL state with bounded retries |
| Registry/global heartbeat could appear as work | Registration did not prove task execution | Production truth now requires a valid task lease, physical process identity and task-specific heartbeat |
| Paused or invalid agent rows could inflate 112/112 | Assignment metadata and generic heartbeats were accepted too broadly | Canonical proof now binds `agent:<registered-id>` to the matching registered number and excludes paused, disabled, offline or failed agents |
| Render Blueprint combined disk and autoscaling | Render disks only support one service instance | API Blueprint now declares one disk-backed instance and 112 logical async lanes |

## Applied database changes

| Migration version | Name | Status |
|---|---|---|
| `20260907151751` | `ivx_autonomous_atomic_task_queue` | Applied successfully |
| `20260907153209` | `ivx_autonomous_unique_worker_lease` | Applied successfully |

Security checks on the fleet queue:

- RLS enabled: `true`
- claim function `SECURITY DEFINER`: `false`
- `public`, `anon`, and `authenticated` execute access: `false`
- `service_role` execute access: `true`
- active-holder unique index present: `true`
- duplicate active lease holders after migration: `0`

## 112-lane database verification

A rollback-only transaction executed the real production RPCs against 112 temporary task rows. Every write was rolled back after the assertions.

| Assertion | Result |
|---|---:|
| Temporary rows created | 112 |
| Rows claimed | 112 |
| Distinct claimed task IDs | 112 |
| Distinct logical lease holders | 112 |
| Rows moved to RUNNING | 112 |
| Heartbeats refreshed | 112 |
| Fresh task heartbeats | 112 |
| Duplicate active holders | 0 |
| Physical process identities | 1 |
| Verification writes retained | 0 (`ROLLBACK`) |

This proves that the database and RPC architecture can represent and atomically operate 112 logical lanes. It does not prove that the old production application process is currently running them.

## Local verification

- Backend TypeScript: PASS (`tsc --noEmit`)
- Focused fleet/task/landing tests: 93 passed, 0 failed
- Related autonomous control/project-manager tests: 60 passed, 0 failed
- Total non-overlapping selected tests: 153 passed, 0 failed
- `git diff --check`: PASS
- `render.yaml` YAML and semantic checks: PASS
- 112 simultaneous PostgreSQL queue reads coalesced to one REST request in regression coverage
- 112 fallback-ledger tasks create, lease and start with three document writes in regression coverage
- 112 lease heartbeats persist with one batch write in regression coverage

The attempted all-service test directory invoked tests that require outbound network access and was stopped by the environment's network approval gate. The selected test suites cover every changed execution, persistence, landing, truth and control module.

## Current production observation

Observed after the database migrations and before application deployment:

| Metric | Live value |
|---|---:|
| Render API deployed commit | `fe73e97e21eeacd279038a5a00f26da613b2a6c5` |
| Render API instances | 1 starter instance |
| Queue rows | 437 |
| QUEUED | 201 |
| LEASED | 2 |
| RUNNING | 2 |
| VERIFIED | 231 |
| BLOCKED | 1 |
| Fresh active task heartbeats (60 seconds) | 0 |
| Physical worker identities on active rows | 0 |
| Duplicate active holders | 0 |
| Production 112/112 certified | **NO** |

## Landing release state

Landing PR `#1432` remains open at commit `ba15fc886bcc34f4f2ec1be42ced36b543e3b747`. Seven reported checks are successful or correctly skipped. `Playwright E2E (web surface) — HARD GATE` remains failed because production Supabase `/auth/v1/recover` did not return within 30 seconds across three attempts. The landing page therefore remains unmerged and cannot honestly be called 10/10.

## Remaining release sequence

1. Publish branch `fix/autonomous-fleet-capacity-20260907` to `ibb142/ivx-holdings-platform`.
2. Run GitHub CI and repair any red required check.
3. Merge only after required checks pass.
4. Let the main-branch Render auto-deploy finish, then merge-update the live environment to `postgres_atomic` and concurrency `112` if Blueprint values are not synced automatically.
5. Verify the production endpoint and database in one observation window for 112 distinct leases, 112 logical holders, 112 fresh task heartbeats, physical process identity, one authority and zero duplicate execution.
6. Continue Landing P0 until all 119 audit/certificate units are evidence-backed and the live web hard gate is green.

## File integrity

| File | SHA-256 |
|---|---|
| `backend/services/ivx-postgres-autonomous-task-store.ts` | `af5da1e59ad559e801ce85a44e928ae4440372767558cad3db3a84bc0f794551` |
| `backend/services/ivx-autonomous-runtime-enforcer.ts` | `2eb58ce71ee2c695fee58f6b289d50957dc125b41d3f5546ec78312607b40265` |
| `backend/services/ivx-autonomous-truth-control.ts` | `c1e54aab64aef8b2081592b7aed92f716077819a8debd03db6449604794cdce4` |
| `supabase/migrations/20260907151751_ivx_autonomous_atomic_task_queue.sql` | `5daf705797ac0757ec767e1d11893cb56aa69495f77a28c643a5bea52a1150b8` |
| `supabase/migrations/20260907153209_ivx_autonomous_unique_worker_lease.sql` | `aa4d485a2ccf5b9a1d068b1c0386b711fa8039758af61309ad813fb1f5aa2702` |
| `render.yaml` | `b87c737336dd51ff8d48cce16d50b20ec56a401600f303f0917bb0ea7fc7225b` |

## Separate pre-existing database findings

The post-DDL Supabase advisor still reports pre-existing `RLS disabled in public` errors on `analytics_funnel`, `analytics_identity_links`, `analytics_retention_daily`, and `analytics_attribution`. They were not changed in this fleet release because enabling RLS without verified client policies can break existing analytics access. The new fleet tables are backend-only, have RLS enabled, revoke client grants, and permit only `service_role` operations.
