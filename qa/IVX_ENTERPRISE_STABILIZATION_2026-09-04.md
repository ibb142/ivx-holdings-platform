# IVX Enterprise Stabilization — 2026-09-04

Goal: stabilize current main without rolling back recent product work.

Repair order:
1. Strict WORKING truth: real heartbeat only; never task updatedAt.
2. Single-deploy authority / no duplicate Render deploy for same SHA.
3. Productivity ledger: PASS-only evidence, exact 24h clipping, no double count.
4. Regression tests for false WORKING and false productivity.
5. One merge, one deployment, exact-SHA verification, then 112/112 certification.

Enterprise invariants:
- fail closed;
- one source of truth;
- one deployment authority;
- exact SHA from commit through production;
- observer systems do not mutate production state;
- no certification from synthetic or stale evidence.

Completed in this branch:
- Truth controller now reads Autonomous Task Engine as a third evidence source only when a real lastHeartbeatAt exists.
- task.updatedAt is explicitly forbidden as WORKING evidence.
- Task-engine WORKING proof additionally requires taskId + leaseHolder + fresh heartbeat <= 60s.
- Regression tests lock these rules.
