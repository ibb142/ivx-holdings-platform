# Infrastructure diagnostics and dashboard acceptance

`scripts/ops/infra-control-tower.sh` runs read-only diagnostics through one bounded PostgreSQL client. It reports the proposed purge targets, the canonical budget policy, up to 112 old reservations without provider IDs, up to 10 recent failed tasks, and emergency-stop authority. Samples are marked when truncated. It does not read full task history or output prompts, raw query text or connection credentials.

```bash
./scripts/ops/infra-control-tower.sh
```

Configure an existing database binding securely: `IVX_BUDGET_RECONCILIATION_DATABASE_URL`, `SUPABASE_DB_URL`, then `DATABASE_URL` are checked in that order. Blank aliases are ignored. The launcher uses the existing `pg` dependency and does not require `psql`. Exit 0 means the diagnostic queries completed; 1 means configuration, connection or cleanup failed; 2 means at least one query failed. Every result explicitly says recovery is unverified and readiness was not checked.

The proposed destructive launcher does not match the audited schema: reservations use `reservation_id`, have no `updated_at`, and only allow `reserved`, `settled`, `uncertain` and `cancelled`. Age and a missing provider ID do not establish that an inference was never executed. Reconcile stopped execution and provider evidence before changing liabilities. The canonical reconciliation module is `backend/services/ivx-uncertain-budget-reconciliation.mjs`.

The purge name exclusions also select managed Supavisor, PostgREST and Realtime sessions. PostgreSQL defines idle as waiting for the next client command, which does not establish a leak: https://www.postgresql.org/docs/current/monitoring-stats.html#PG-STAT-ACTIVITY-VIEW . Failed tasks need canonical state, lease, retry policy and execution evidence reconciliation; a raw `FAILED` to `QUEUED` update does not provide that evidence or update the JSON state.

The existing API `/api/ivx/live-work/agents?enterpriseDashboard=1&view=live` requires owner authorization and returns 503 for unavailable observations. The Expo screen is `/ivx/landing-workers-live`. Readiness remains a check of AI, database, auth and the Owner AI queue; emergency-stop alone cannot prove availability.

## Acceptance checks

```bash
node ./node_modules/@playwright/test/cli.js test --config=tests/e2e/dashboard.playwright.config.ts
```

The API tests reject anonymous access and require all six simultaneous owner reads to return complete, fresh observations on the deployed SHA. `IVX_OWNER_TOKEN` is required for that test. `IVX_DASHBOARD_API_BASE` defaults to `https://api.ivxholding.com`.

The UI tests require `IVX_DASHBOARD_WEB_BASE` pointing to the actual Expo web app and `IVX_OWNER_STORAGE_STATE` pointing to an existing authenticated owner browser state. The first UI test captures the app's own API request and verifies 112 distinct rendered cards. The separate outage test injects 503 and requires a visible error with no agent cards. Missing credentials or unavailable telemetry fail the relevant acceptance test; there is no degradation bypass. Trace, screenshots and video are disabled for this suite to avoid publishing owner session or private dashboard contents.

This bounded six-request check is not a stress benchmark or certification of 112 concurrent workers, productive output, or continuous operation. A complete production run still requires the deployed application, owner session and current source SHA.
