# IVX Factory Allocation — Landing + 50 Apps

Status: ACTIVE ALLOCATION
Updated: 2026-08-27

## Owner directive
Run the IVX fleet in two simultaneous divisions now:

- Agents 013-112: 100-agent Landing Page completion mission.
- Agents 001-012: 12-agent Factory Command Division working on the 50-app factory pipeline.

The 12 Factory agents no longer wait for Landing completion. Factory work may progress now without consuming the 100 Landing agents.

## Division A — Landing Page
Agents: 013-112 (100 agents)
Priority: P0 until Landing is complete and certified.
Mission: audit, repair, QA, performance, media, registration, navigation, accessibility, security, E2E, deploy verification, exact-SHA live proof and Landing certificate.

## Division B — Factory
Agents: 001-012 (12 agents)
Priority: P1 while Landing is P0.
Mission: build and maintain the 50-app portfolio, specifications, reusable architecture, shared components, QA templates, release templates and app-by-app implementation queues.

## 12 Factory Command roles
1. Product Commander — intake, objectives, users, acceptance criteria.
2. Architecture Commander — stack, APIs and data model.
3. UX/UI Commander — navigation, mobile UX and accessibility.
4. Frontend Commander — implementation and state management.
5. Backend Commander — APIs, jobs and integrations.
6. Data Commander — Supabase, schema, RLS and lifecycle.
7. Security Commander — auth, secrets, abuse controls and privacy.
8. QA Commander — unit, integration, E2E and regression evidence.
9. Release Commander — builds, signing, versions and exact-SHA proof.
10. SRE Commander — deployment, health, observability and rollback readiness.
11. Radar Commander — scanning and safe self-heal routing.
12. Factory Executive Commander — portfolio priority, capacity and GO/NO-GO.

## 50-app pipeline
IDEA -> SPEC -> ARCHITECTURE -> SCAFFOLD -> IMPLEMENT -> SECURITY -> QA -> BUILD -> DEPLOY -> LIVE VERIFY -> CERTIFICATE.

No app counts as complete from generated code alone. Completion requires test, build, deploy and live exact-SHA evidence.

## Phase 3 — New 100-agent Factory Worker Fleet
Trigger: Landing Page reaches completion/certification and the 100 Landing agents are released from P0 Landing duty.

Action:
- Provision a NEW 100-agent Factory implementation fleet for the 50-app portfolio.
- Keep the 12 Factory Command agents as commanders/orchestrators.
- Do not replace or renumber the existing IVX 112 production registry.
- New Factory workers require unique IDs, contracts, queues, memory namespaces, evidence records and resource limits.
- Before production use, require registry integrity, isolation tests, permission verification and fail-closed execution evidence.

Phase 3 target:
- 12 Factory Command agents.
- 100 new Factory implementation agents.
- 112 Factory agents total dedicated to the 50-app portfolio.
- Original IVX production fleet remains separately auditable.

## Priority
P0: Landing completion/certification by Agents 013-112.
P1: Factory 50-app work by Agents 001-012.
P2: Non-blocking cleanup/research.
Factory work must never delay a Landing P0 repair.

## Owner Gate
Autonomous may automatically execute routine code repair, QA, tests, safe config, retries, builds and evidence generation.
Owner approval remains required for destructive production data migrations, secret rotation/exposure, broad IAM/security-policy changes, payment/bank controls, DNS/domain takeover, irreversible infrastructure deletion and critical production rollback.

## Evidence
Every Factory app must track owner goal, category, priority, assigned command roles, implementation workers, repository/path, phase, blockers, test evidence, release SHA, deploy proof and certificate state.
