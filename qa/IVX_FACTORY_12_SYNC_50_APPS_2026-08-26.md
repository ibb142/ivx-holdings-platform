# IVX Factory 12-Agent Sync — 50 Apps

Status: SYNCED / STAGED
Date: 2026-08-26

## Owner directive
Prepare the 12-agent Factory Command Division now for a future 50-app production pipeline while preserving the current IVX 112-agent completion mission.

## Safety / allocation rule
- Agents 001-012 remain the active IVX Autonomous Command Tier until IVX reaches the release gates defined in `qa/IVX_12_COMMAND_100_COMPLETION_MISSION_2026-08-25.md`.
- This document synchronizes the Factory mission and responsibilities now; it does NOT silently remove those 12 agents from IVX production QA.
- Factory app execution activates after IVX demonstrates stable 112/112 certification and the owner authorizes Factory execution.
- All destructive migrations, auth/permissions, secrets, payments, infrastructure, security-critical changes and critical rollback remain Owner-Gated.

## 12 Factory Command roles
1. Product Commander — intake, app objective, users, acceptance criteria.
2. Architecture Commander — stack, boundaries, APIs, data model.
3. UX/UI Commander — navigation, responsive/mobile UX, accessibility.
4. Frontend Commander — app/web implementation quality and state management.
5. Backend Commander — APIs, jobs, integrations, idempotency.
6. Data Commander — Supabase/schema/RLS/data lifecycle.
7. Security Commander — auth, secrets, abuse controls, privacy and threat checks.
8. QA Commander — unit/integration/E2E/regression and evidence.
9. Release Commander — build artifacts, signing, versions, exact-SHA proof.
10. SRE Commander — deploy, health, observability, rollback readiness.
11. Radar Commander — internal/external runtime scanning and safe self-heal routing.
12. Factory Executive Commander — portfolio prioritization, capacity, final GO/NO-GO.

## 50-app pipeline
Each app must pass:
IDEA -> SPEC -> ARCHITECTURE -> SCAFFOLD -> IMPLEMENT -> SECURITY -> QA -> BUILD -> DEPLOY -> LIVE VERIFY -> CERTIFICATE.

No app counts as completed because code was generated. Completion requires evidence for tests, build, deploy and live verification on the exact release SHA.

## Parallelization target
- 50 app slots tracked independently.
- Command tier assigns implementation to Factory workers/runners rather than requiring one commander to write every file.
- Shared components and proven remedies should be reused across apps through the IVX Factory Engine/tool registry.
- A failure in one app must not produce false completion in another.

## Activation gates
Factory production may start when:
1. IVX current main has stable repeated 112/112 green cycles.
2. P0 = 0 and blocking P1 = 0.
3. Autonomous closed-loop repair has demonstrated detect -> diagnose -> safe repair -> test -> deploy -> rerun -> green evidence.
4. Owner explicitly authorizes Factory production.

## First Factory production objective
On activation, create a 50-app portfolio manifest with app-001 through app-050. Each entry must include owner goal, category, priority, assigned command roles, implementation workers, repository/path, current phase, blockers, test evidence, release SHA, deploy proof and certificate state.
