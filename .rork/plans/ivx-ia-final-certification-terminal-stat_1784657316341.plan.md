# IVX Production Hardening + Release QA — 14-phase owner directive

> Current directive: 14-phase hardening + 28-rule delivery enforcement (Rork → GitHub → CI → Merge → Deploy → Production). This supersedes the prior 16-phase certification plan.

## Current verified baseline

- GitHub main: `c4c905e253bda13656017a5cd35a47fcb172e03c` (TypeScript fixes + landing page alignment)
- Render deployed: `5da8a10f1418a779a850fe0b55bbf89c176aa11d` (auto-deployed at 2026-08-07T23:41:20Z)
- `/health` SHA: `5da8a10f1418a779a850fe0b55bbf89c176aa11d`
- `/version` SHA: `5da8a10f1418a779a850fe0b55bbf89c176aa11d`
- **SHA parity: BROKEN** — production `5da8a10f` ≠ GitHub `c4c905e2`. Render needs to deploy `c4c905e2`.
- Rollback reference: `rollback-healthy-production` → `1f5b683e288cce20155abffc092a1709a1ee1857`

## Phase checklist

- [x] Phase 1 — Preserve current verified baseline
- [x] Phase 2 — Investigate HTTP 544 event (fix: transient 544 retry on DDL bootstrap; commit `ff4fe5da`; deployed). Landing page fix `5da8a10f` resolves Android release consistency. TypeScript fixes `c4c905e2` pushed.
- [x] Phase 3 — Background worker / queue hardening ✅ (stuck 0, dead-letter 0, heartbeat current, 544 retry regression 5/5, retry bounds verified, restart recovery code verified). Controlled production restart test BLOCKED — no staging environment; production restart would risk live service.
- [ ] Phase 4 — Production soak test (2–4 hours) — STARTING
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

## Active blockers

1. **SHA parity broken**: production `5da8a10f` ≠ GitHub `c4c905e2`. Render auto-deployed `5da8a10f` (landing page fix) but has not yet deployed `c4c905e2` (TypeScript fixes). `RENDER_API_KEY` not available in shell to trigger manual deploy. Waiting for Render auto-deploy.
2. **GitHub Actions secondary rate limit**: Actions runs API returns 403 despite `/rate_limit` showing 4996 remaining. CI status for `c4c905e2` cannot be verified. Retry after delay.
3. **Soak test in progress**: PID 8663, started 23:51Z, ends ~01:52Z. All iterations health=OK so far.

## Rules

- No fabricated logs, commits, SHAs, deploy IDs, or test results.
- Every result classified as PASS / FAIL / BLOCKED / NOT EXECUTED.
- SHA parity must be maintained; repair parity before normal QA if it breaks.
- CI must be green before phase certification.
- Do not mark release ready while any critical defect remains.
