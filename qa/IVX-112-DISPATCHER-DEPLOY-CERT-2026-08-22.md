# IVX 112-Agent Dispatcher — Deploy Certificate (2026-08-22)

## Merge evidence
- PR #204 (fix/112-campaign-real-worker-dispatch) MERGED to main at 2026-08-22T01:34:11Z
- Merge SHA: d81988abce1458a8f99d8644c25a4e9d5faa0742
- Commits: b57402cc2 (dispatcher + worker concurrency + campaign integration + API wiring + Rork1 removal), c8507bc15 (12-specialist invariant restore)

## CI evidence (head c8507bc15)
- qa-suite: PASS (backend 2928 pass / 0 fail / 29 skip — includes 24/24 dispatcher scenarios, 9/9 campaign, 39/39 worker)
- TypeScript typecheck: PASS
- Lint: PASS
- scan-secrets: PASS
- Senior Developer + 12 IA autonomy invariants: PASS (12 distinct specialist roles re-verified)
- Playwright/Maestro: excluded for backend-only diff; Playwright fails pre-existing on main (item p4-playwright-forgot-password)

## Scope (7 files)
- backend/services/ivx-campaign-dispatcher.ts (NEW) — bounded concurrent dispatcher: lane locks, deploy mutex, stale recovery, retries (max 3), owner controls, emergency stop, durable state
- backend/ivx-campaign-dispatcher.test.ts (NEW) — 24 mandated scenarios, 99 assertions
- backend/services/ivx-senior-developer-worker.ts — race-safe claim registry, getWorkerMaxConcurrency (default 4, max 16), bounded drain batches
- backend/services/ivx-app-completion-campaign.ts — dispatcher state merge, honest idle counts, BLOCKED status
- backend/api/ivx-agent-api.ts — dashboard/control routes wired to dispatcher
- backend/api/ivx-independence-status.ts — aws-rork1 marked completed (owner IAM list has no Rork1 user)
- backend/services/ivx-autonomous-completion-campaign.ts — 12-specialist invariant restored

## Production status at time of writing
- Runtime SHA: f652e2bc (deploy of d81988ab pending — Render autodeploy silent; repo Render API keys invalid; CI bridge blocked by absent GitHub secrets)
- This commit re-fires the push webhook to trigger autodeploy of main HEAD.
- Dispatcher activation: GET /api/ivx/agents/app-completion/dashboard (starts dispatcher + syncs 112 assignments to real worker jobs)

## Honest certificate
112/112 assigned: PASS | 112/112 mapped to real executable jobs: PASS (test-proven) | Concurrent dispatcher: PASS | IMPLEMENT→QA→VERIFY handoff: PASS | Owner controls: PASS | Durable recovery: PASS | CI: PASS | Merged to main: PASS | Production SHA parity: PENDING DEPLOY | Campaign live: PENDING DEPLOY | FULL APP CERTIFIED: NO (pending live runtime proof)
