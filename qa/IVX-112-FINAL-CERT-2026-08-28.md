# IVX 112 IA — FINAL CERTIFICATE (2026-08-28)

**STATUS: RED — NOT CERTIFIED (fail-closed policy)**
**Marker:** `ivx-112-final-cert-2026-08-28`
**Main SHA (only evidence SHA):** `426fcf86bc5fead23c16bccb0adbc1c759274d91`
**Machine-readable:** `qa/IVX-112-FINAL-CERT-2026-08-28.json`

## Production runtime verification

| Deploy | Commit | PR | Fix |
|--------|--------|----|-----|
| `dep-da8elrfqj5pc73e9b22g` | `a4344db4d` | #415 | Worker queue lost-update → memory-mirror fallback in `getSeniorDeveloperJob` |
| `dep-da8enubtqb8s73a0g370` | `426fcf86b` | #416 | Idempotent `create_file` patches (coder + runtime) |

`/health` → 200 healthy on `426fcf86b`. All evidence below from live `/api/ivx/agents/app-completion/dashboard` on this exact SHA.

## 112 fleet state (live evidence snapshot)

- **Expected / discovered / assigned:** 112 / 112 / 112 ✓
- **COMPLETED:** 38 → **FAILED:** 5 → **BLOCKED:** 0 → **in flight:** 69 (queued/running/testing/verifying)
- **Simulated agents:** 0 — all executions through the real worker bridge on production
- Fleet actively converging (retry waves + fixed pipeline; COMPLETED rose 25→38 during this session)

## Root causes FIXED (with regression protection)

1. **RC-1 (PR #415):** 66+ honest agents failed "STALE HEARTBEAT / job no longer found" — queue lost-update race reported live jobs as missing. Fix: never return null for a job present in the in-process mirror.
2. **RC-2 (PR #416):** Agent 57 BLOCKED 6/6 iterations — `create_file` on an existing file (created by prior runs). Fix: same-content create = idempotent no-op; differing content = actionable "re-emit as update" error.
3. **RC-3 (mitigated):** Render deploy restarts killed in-memory worker jobs → boot recovery + retry waves; full durable job handoff recommended as follow-up.

## Acceptance gate — honest verdict

| Mandatory check | Result |
|---|---|
| 112 unique agents loaded | ✓ PASS |
| 112/112 PASS | ✗ FAIL — 38 completed, 5 failed, 69 in flight at snapshot |
| 0 failed agents | ✗ FAIL |
| realToolUsed / verifiedOutput | ✓ enforced by worker bridge (no simulated paths) |
| Evidence on single current main SHA | ✓ PASS |
| Utilization ≥ 74.4% (≥ 2,000 verified productive agent-hours / rolling 24h) | ✗ FAIL — **3.06%** (82.12h / 2,688h). This is a wall-clock rolling-24h metric; it cannot be honestly accelerated. |

## OWNER GATE (section 6) — blocked task

- **Agent 57 (`p3-agent-cycle-401`)**: runtime commits fail `GitHub default branch ref lookup: 401` — **no GitHub token exists in the production environment** (verified against Render env-vars: zero GitHub credentials). Adding a production secret requires **Owner authorization**.

## What is required for GREEN

1. Fleet reaches 112/112 COMPLETED WITH EVIDENCE on current main (in progress — pipeline now healthy after RC-1/RC-2 fixes).
2. ≥ 2,000 verified productive agent-hours accumulate over a rolling 24h with the continuous safe backlog — requires sustained 24/7 operation.
3. Owner injects a production GitHub token (OWNER GATE) to unblock agent 57.

## Honesty statement

No simulated agents. No fabricated hours. No narrative inflation. Per fail-closed policy, **one failing mandatory check = CERTIFICATE RED**.
