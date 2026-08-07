# IVX Production Hardening + Release QA — 14-phase owner directive

> Current directive: 14-phase hardening + 28-rule delivery enforcement (Rork → GitHub → CI → Merge → Deploy → Production). This supersedes the prior 16-phase certification plan.

## Current verified baseline

- GitHub main: `ff4fe5da85049f1e5d9e1750c88fe470d5920027`
- Render deployed: `ff4fe5da85049f1e5d9e1750c88fe470d5920027`
- `/health` SHA: `ff4fe5da85049f1e5d9e1750c88fe470d5920027`
- `/version` SHA: `ff4fe5da85049f1e5d9e1750c88fe470d5920027`
- Rollback reference: `rollback-healthy-production` → `1f5b683e288cce20155abffc092a1709a1ee1857`

## Phase checklist

- [x] Phase 1 — Preserve current verified baseline
- [x] Phase 2 — Investigate HTTP 544 event (fix: transient 544 retry on DDL bootstrap; commit `ff4fe5da`; deployed; parity verified). Landing page fix `5da8a10f` resolves Android release consistency.
- [ ] Phase 3 — Background worker / queue hardening (blocked by CI TypeScript failures)
- [ ] Phase 4 — Production soak test (2–4 hours)
- [ ] Phase 5 — Controlled failure recovery
- [ ] Phase 6 — IVX IA Chat deep live QA
- [ ] Phase 7 — IVX Brain quality QA
- [ ] Phase 8 — Autonomous senior-developer real task
- [ ] Phase 9 — Security regression
- [ ] Phase 10 — Android real-device QA
- [ ] Phase 11 — iOS / TestFlight QA
- [ ] Phase 12 — Store release readiness
- [ ] Phase 13 — Rork independence check
- [ ] Phase 14 — Final full regression + release verdict

## Active blocker

- CI TypeScript typecheck failures in `ff4fe5da` / `5da8a10f` runs:
  - `backend/api/ivx-owner-auth.ts`: `roleSource` indexed access on union; `expires_at` not on Supabase `User`
  - `backend/services/ivx-brain/ivx-brain-qa-dataset.ts`: stray `source` field in prompt object
- Resolution: fix type errors, commit, push, verify CI green before Phase 3.
- Local status: fixes applied; root and backend `tsc --noEmit` pass.

## Rules

- No fabricated logs, commits, SHAs, deploy IDs, or test results.
- Every result classified as PASS / FAIL / BLOCKED / NOT EXECUTED.
- SHA parity must be maintained; repair parity before normal QA if it breaks.
- CI must be green before phase certification.
- Do not mark release ready while any critical defect remains.
