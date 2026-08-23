# IVX Autonomous Intelligence Upgrade Mission

Status: OWNER-APPROVED PROGRAM OF WORK
Synced: 2026-08-23
Execution policy: safe work may execute autonomously; dangerous actions remain Owner-gated.
CI retrigger marker: owner-sync-2026-08-23T10:46-04:00

## Mission
Transform IVX Autonomous from a task-execution worker into a high-reasoning, self-auditing, self-correcting autonomous software engineering system.

Target lifecycle:
UNDERSTAND -> ANALYZE -> FORM HYPOTHESES -> INSPECT REAL EVIDENCE -> PLAN -> SIMULATE CONSEQUENCES -> MODIFY CODE -> TEST -> CRITIQUE -> REVISE -> CI -> MERGE -> DEPLOY -> VERIFY USER BEHAVIOR -> MONITOR -> SELF-RECOVER -> LEARN FROM EVIDENCE.

Do not optimize for narrative. Optimize for correct decisions and measurable results.

## Program blocks

### Job 1 — Reasoning, evidence, critic
1. Structured reasoning state before code changes: objective, symptoms, files, runtime evidence, logs/errors, architecture, constraints, safety, hypotheses, confidence, side effects, acceptance criteria.
2. For non-trivial failures generate at least three plausible hypotheses and gather evidence before selecting a patch.
3. Distinguish FACT / INFERENCE / HYPOTHESIS / UNKNOWN. Unsupported diagnoses must remain NEEDS_MORE_EVIDENCE.
4. Multi-pass review before write: architecture, root cause, security, regression risk, test strategy.
5. Independent IMPLEMENTER + CRITIC pass; patch advances only on APPROVED or explicit owner override.

### Job 2 — Integrity, blast radius, self-correction
6. CI rejects fake fixes: TODO-as-implementation, empty/stub bodies, hardcoded PASS, production mocks, disabled failing tests, catch-and-ignore, deleting behavior to silence failures, expectation changes that normalize broken behavior, fabricated evidence/deployment/certificates.
7. Before merge calculate blast radius across changed files, dependents, API consumers, auth/security, DB, mobile, web and deployment; HIGH risk requires Owner Gate.
8. On test/CI/live failure preserve hypotheses and evidence, classify failure, revise, run targeted gates, then full required gates. Retries are bounded and cannot loop forever.

### Job 3 — Engineering memory, code graph, runtime brain
9. Durable engineering memory stores bug signature, root cause, failed/successful approaches, affected files, required tests, CI failures, production symptoms and regression history; retrieve relevant lessons before similar repairs.
10. Maintain a codebase dependency model: files, imports, exports, routes, DB tables, services, mobile screens, auth boundaries, deployment components and test coverage.
11. Runtime incident model correlates GitHub, Render, Supabase, AWS, mobile logs, API health, CI, DB state and dashboard jobs before changing code.

### Job 4 — Behavior proof, confidence, specialists, multi-agent review
12. Every fix defines behavior acceptance criteria. Source-code parity alone is not VERIFIED when live behavior can be tested.
13. Confidence is evidence-derived: root-cause confidence, patch confidence, regression risk and production verification. No arbitrary confidence values.
14. Decision-quality metrics: root-cause accuracy, test quality, regression rate, CI first-pass rate, rollback rate, production incident rate, time-to-repair, false-completion rate, owner-intervention rate.
15. Route work to role specialists: Architecture, Backend, React Native, Expo, Auth, Supabase, Postgres, AWS, Render, Security, CI/CD, QA, Playwright, Maestro, Performance, Database, Observability, Incident Response, Code Review and Release Engineering.
16. HIGH-complexity work uses independent diagnosis, alternative diagnosis and security/regression critic, with Autonomous Manager selecting and recording the final option.

### Job 5 — Owner control, self-healing, benchmark, certification
17. Safe low-risk work can execute autonomously. Owner approval is mandatory for destructive migrations, auth/permission changes, secrets, payments, security policy, infrastructure deletion, production rollback, irreversible data operations and high-risk deployment changes.
18. Owner controls must retain PAUSE AUTONOMOUS, STOP ALL JOBS, DISABLE DEPLOY, DISABLE CODE WRITES and ROLL BACK LAST CHANGE.
19. Self-healing watches API health, CI, deployment mismatch, worker/queue health, DB connectivity and mobile crash signals; it may diagnose and prepare safe repairs but never bypass Owner Gates.
20. Build an IVX Autonomous benchmark with >=100 realistic engineering scenarios and compare measurable repair success, regression rate, false-completion rate, evidence quality and owner intervention against scripted automation, a basic coding-agent baseline, current Autonomous baseline and human-reviewed reference solutions.

## Completion standard
Autonomous 10/10 requires evidence-first reasoning, hypothesis generation, architecture awareness, critic review, no-stub enforcement, regression-risk analysis, self-correction, durable engineering memory, code graph, runtime correlation, real behavior verification, evidence-derived confidence, specialist routing, multi-agent review, owner safety controls, restart recovery, self-healing, benchmark suite, measurable improvement and zero fabricated completion.

Never certify from heartbeat, HTTP 200 alone, assignment, narrative, or agent count. Certification requires correct reasoning + real code + real tests + safe decisions + live verification + self-correction + proven results.

## Scheduling / execution contract
This mission MUST be decomposed into the five jobs above. Execute sequentially so each block has its own inspect -> patch -> targeted tests -> typecheck -> PR -> required CI -> merge -> live verification/evidence cycle before the next block is considered complete. If a required hard gate is red, the block is BLOCKED/FAILED, never COMPLETED. Dangerous actions pause at the Owner Gate. Persist task/job IDs, commits, PRs, CI run IDs, deploy IDs and behavior-verification evidence so work survives restart.

Final certificate must report PASS/FAIL for each of the five jobs and the overall Autonomous Intelligence Upgrade. 100% completion may be declared only when all required hard gates and live evidence are present.