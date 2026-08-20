# IVX-112-SENIOR-DEVELOPER-NOT-CERTIFIED

**Verdict: NOT CERTIFIED**  
Evaluated: `2026-08-20T02:52:32.345334Z`  
Production SHA: `6ca1cd71f2b9602d079c141805f918279888e7da`

## What changed since the last evaluation

A REAL execution run was triggered on live production by the agent this turn (runId=rec-1787194134937). It completed 112/112 with 0 failures. The previous blocking reason 'no agent has ever executed a run' is now FACTUALLY OBSOLETE and has been withdrawn.

## What IS genuinely certified now

The **IVX 112 Real Execution Certificate** passed live and was independently re-verified:

- Certificate: `IVX-112-REAL-EXEC-859548d214a09da6`
- Run: `rec-1787194134937` — 112 agents, **112/112 real execution verified**, 112/112 evidence verified
- Simulated runs: **0** · Policy checks: 12/12 passed · E2E: 4/4 passed
- Commit `6ca1cd71f2b9602d079c141805f918279888e7da` matches runtime: `True`

Fleet observed on live production:

- 112/112 executed a real tool · 112/112 distinct evidence SHAs
- 112/112 fresh heartbeats · 112/112 healthy · 0/112 errors
- Tools used: `wikipedia_search`×49, `crm_read`×28, `worldbank_indicator`×24, `sec_edgar_fulltext`×9, `frankfurter_fx`×1, `sec_edgar_submissions`×1

> Scope: Proves the fleet performs REAL tool-backed research with durable per-agent evidence. Does NOT prove senior-grade engineering.

## Conditions

- PASS — `localQaGateGreen`
- PASS — `totalAgentsIs112`
- PASS — `realExecutionCertifiedOnRuntimeSha`
- PASS — `allAgentsExecutedRealTool`
- PASS — `allAgentsHaveDistinctEvidenceSha`
- PASS — `allAgentsHeartbeatFresh`
- **FAIL** — `agentsWithSourceReference112`
- **FAIL** — `acceptedBySeniorGate112`
- **FAIL** — `allSixWorkflowsPassedOnExactSha`
- PASS — `productionHealthy`
- PASS — `productionVersionMatchesSha`

**8/11 conditions pass.**

## Why 10/10 senior certification is NOT issued

1. agentsWithSourceReference=84/112: the 28 agents whose task ran on the internal `crm_read` tool emit no external http sourceReference. Agent numbers: [10, 14, 18, 20, 21, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82, 86, 90, 94, 98, 102, 106, 110].

2. acceptedBySeniorGate=0 of required 112. The run just executed is RESEARCH work (wikipedia_search, sec_edgar_*, worldbank_indicator, frankfurter_fx, crm_read). The senior gate requires per-agent changedFiles, tests, typecheck, lint, securityReview, errorHandlingReview, performanceReview, accessibilityReview, commitSha and deploymentEvidence. None of those fields are populated by a research task. Calling a real tool is NOT senior-grade software engineering.

3. The six required workflows have NOT been observed green on this exact SHA. Deploy of the two workflow fixes is still BLOCKED_NO_WORKFLOW_SCOPE (no PAT with `workflow` scope exists in .env or in any of the 5 Render services; the only live GitHub token carries `repo` scope only).

## Known defect: `registry-counter-desync` (high)

GET /api/ivx/agents reports totalRuns=0, evidenceCount=0, lastHeartbeat=null, health='unknown' for all 112 agents, while GET /api/ivx/agents/real-status — queried seconds later on the same production host — reports 112/112 healthy with fresh heartbeats and 112 distinct evidence SHAs. The list route reads per-process in-memory getExecutionState(); the durable run path does not update it. Any dashboard or gate reading /api/ivx/agents will under-report real work as zero.

**Impact:** This desync is why earlier evaluations concluded 'no agent has ever executed a run'.

## Note

Real tool execution is now genuinely proven and independently re-verified against live production. The SENIOR DEVELOPER 10/10 claim remains unproven and is NOT issued: research tool calls are a different and much lower bar than senior-grade software engineering, and the six-workflow requirement is still blocked on a missing workflow-scoped GitHub token. No fabricated PASS is recorded here.
