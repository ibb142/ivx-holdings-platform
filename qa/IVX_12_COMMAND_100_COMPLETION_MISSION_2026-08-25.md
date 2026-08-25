# IVX 12+100 Completion Mission — Owner Mandate

Status: ACTIVE MISSION PROPOSAL
Start target: 2026-08-25
Deadline target: this week

## Fleet allocation

- Agents 001-012: Autonomous Command Tier.
- Agents 013-112: IVX Completion Execution Fleet (exactly 100 workers).
- All 112 remain dedicated to IVX Holdings. No agent is allocated to the future external App Factory company.

## Autonomous Command Tier (001-012)

The existing enterprise registry already enforces that agents 001-012 are 12 distinct specialist roles. Their mission for this campaign is command/control rather than routine queue work:

1. Prioritize the IVX completion backlog by P0/P1/P2.
2. Decompose work into safe, testable tasks for agents 013-112.
3. Route code-changing work to the IVX Senior Developer Worker / Autonomous Coder.
4. Enforce owner gates for destructive migrations, auth/permissions, secrets, payments, infrastructure, security-critical changes, critical rollback, and other high-risk actions.
5. Require tests, typecheck, CI, PR/merge proof, exact-SHA deploy proof, and live verification before VERIFIED/COMPLETED.
6. Refuse false completion when evidence is missing.
7. Rebalance the 100-worker fleet toward current P0/P1 blockers.
8. Aggregate evidence and publish an executive completion state.

## 100-worker IVX Completion Execution Fleet (013-112)

Agents 013-112 stay focused on finishing IVX, not on building external Factory apps. Workstreams are dynamically balanced across:

- Landing page and paid-traffic readiness
- Mobile app stability and UX
- Owner sign-in / authentication / recovery
- Backend/API correctness
- Supabase/database/RLS
- Investor/member registration and CRM
- Deals/media/reels/chat
- Security/privacy/legal gates
- Performance/accessibility
- Android APK/release readiness
- AWS S3/CloudFront/DNS deployment
- Render live exact-SHA parity
- Observability/watchdogs
- E2E regression tests
- 112-agent runtime/certification
- Final enterprise 10/10 evidence

## Definition of done

IVX is not 100% complete merely because tasks were dispatched. Final completion requires, on the current main SHA:

- P0 = 0
- P1 = 0 or proven non-blocking
- mandatory CI/E2E/QA gates green
- exact production SHA parity
- live health/version proof
- mobile critical paths verified
- landing GO for advertising
- security/secret gates green
- 112-agent final live certificate green
- global 10/10 certificate artifact present

## Guardrails

- No direct writes to protected main.
- Branch -> tests -> PR -> CI -> merge -> deploy -> live verify.
- High-risk changes remain owner-gated.
- No simulated success may count toward completion.
- All 112 agents remain IVX-only until the owner explicitly changes this allocation.
