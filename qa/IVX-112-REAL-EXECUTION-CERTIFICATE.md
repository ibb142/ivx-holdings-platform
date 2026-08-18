# IVX 112 Real Execution Certificate — CERTIFIED 112/112

**Final Certificate ID:** `IVX-112-REAL-EXEC-669af32dd16cdb3d`
**Certified (UTC):** 2026-08-18T22:31:10Z · **Run:** `rec-1787092227000` · **Runtime:** `3.0.0-real-execution`
**Production commit (exact):** `6174b9e4bd6b` — certificate SHA == runtime SHA == `/health` SHA, `commitMatchesRuntime: true` verified live
**Live endpoint:** `GET https://api.ivxholding.com/api/ivx/agents/certificate`

Certification history (all 112/112 runs, real tools, zero simulation):
- `rec-1787091851826` → `IVX-112-REAL-EXEC-e2af84c11b569a1b` (first full PASS, SHA `5684d3eee580`)
- `rec-1787091955530` → `IVX-112-REAL-EXEC-c1d70d97d79e6a35` (PASS **through a live mid-run restart**)
- `rec-1787092227000` → `IVX-112-REAL-EXEC-669af32dd16cdb3d` (final recertification on the exact current production SHA)

## Final result — all hard gates PASS

| Gate | Required | Result |
|---|---|---|
| Total agents | 112 | **112** |
| Healthy (active + fresh heartbeat) | 112 | **112** |
| Real execution verified (realToolUsed + sourceReference + verifiedOutput) | 112 | **112** |
| Evidence verified (evidence + sha256) | 112 | **112** |
| Unique agentNumber / agentId values | 112 / 112 | **112 / 112** |
| Persistence verified (Supabase, not RAM) | true | **true** |
| Simulated runs in certified run | 0 | **0** |
| Exact production SHA verified | yes | **yes** |
| Policy checks | 12/12 | **12/12** |
| End-to-end tests | 4/4 | **4/4** |
| Failed agents (one failure fails all) | 0 | **0** |

## What changed (the runtime is now real)

- `executeAgentRun()` can NEVER complete from `produceAgentOutput(...)` alone — that text is an advisory annotation only. Completion requires at least one real permitted tool success.
- Required execution fields on every run: `realToolUsed`, `sourceReference`, `toolResultId`, `verifiedOutput`. Any execution without a verifiable source FAILS. No synthetic fallback, no fake success.
- Real permitted tools: SEC EDGAR full-text + submissions, Wikipedia API, World Bank API, ECB FX rates, and the real IVX CRM (Supabase). Each tool result carries a source reference, HTTP status, and content sha256.
- Execution state persists in Supabase (never RAM-only): executions (taskId, toolsUsed, evidence, sourceReference, output, costUsage, finalStatus), agent states (lastHeartbeat, lastSuccessfulRun, lastFailedRun), CRM prospects, alerts, certificates. Durable store: `ivx_agent_jobs` typed-document mode (deterministic UUID PKs = dedup); auto-upgrades to dedicated tables when a `SUPABASE_ACCESS_TOKEN` becomes available.
- Registry integrity enforced: exactly 112 agents, 112 unique numbers, 112 unique ids, all active — offline/disabled/paused/unknown/unhealthy agents fail the certificate. All "100 agents" references removed.

## Acquisition agents connected to real sources

- **IA-17 Investor Acquisition** — SEC EDGAR Form D (permitted public lead source) → CRM investor prospect with verifiable filing URL, objective score, dedup key; regulated solicitation escalated, outreach `blocked_pending_approval`.
- **IA-19 Buyer Acquisition** — SEC EDGAR 8-K real-estate purchase filings → CRM buyer prospect with source + score; buyers separated from investors.
- **IA-20 Buyer Qualification** — reads the real CRM and scores buyers from real filing data (recency/completeness/jurisdiction/authority breakdown stored).
- **IA-21 Buyer Follow-Up** — real CRM next-action queue; **zero external outreach sent** — all outreach behind approval/compliance gates.
- **IA-27 Partnership Development** — real company research with source URLs → CRM partner pipeline.
- **IA-28 JV Deal Origination** — SEC EDGAR joint-venture filings → verifiable JV opportunities in CRM.
- **IA-31 Tokenized Assets** — real research; every tokenization opportunity carries jurisdiction + source; `legalReviewStatus=requires_independent_review` — securities/legal approval is never claimed.
- **IA-32 Tokenized Deal Research** — real tokenized-market filings with jurisdiction + source, same independent-review rule.

E2E proof from the certified run: investor "810 SEVENTH AVENUE MEMBER LLC" (SEC source, outreach gated), tokenized "Fairmint Inc" (jurisdiction DE, independent legal review), buyer + CRM persistence verified.

## Policy verifications (12/12, all real tests)

persistence_supabase_not_ram · retries_do_not_duplicate_tasks · prospect_deduplication · per_agent_timeout_policy · per_agent_retry_policy · per_agent_cost_limits · per_agent_tool_permissions · prohibited_tools_blocked (money_movement, trade_execution, legal_execution) · production_deploy_approval_gated · cross_agent_memory_isolation · cross_company_isolation · pending_tasks_survive_restart

## Live restart/redeploy persistence test — PASS

Run `rec-1787091955530` was **killed at 30/112 by a live Render restart**. After boot, the new process automatically resumed the pending tasks and completed the run: **112 rows, 112 unique task ids, 112 unique agents, 0 duplicates, 112/112 real+verified** — and the post-restart certificate PASSED.

## War Room policy

The "Landing 112-Agent Autonomous QA War Room" workflow is **advisory/QA only** and is never used as proof of real work (`usedAsProofOfRealWork: false`). Certification comes exclusively from this workflow via `/api/ivx/agents/certificate`.

## Prohibitions (verified blocked + alerting)

Money movement: PROHIBITED · Trade execution: PROHIBITED · Legal execution: PROHIBITED · Production deploy: owner approval required · External outreach: compliance-gated.

## Evidence

- 112 individual artifacts: `qa/evidence/real-execution-112/agent-001.json` … `agent-112.json`
- Final summary: `qa/evidence/real-execution-112/SUMMARY-112-OF-112.json`
- Durable rows: Supabase `ivx_agent_jobs` (types `ivx_rec_execution`, `ivx_rec_state`, `ivx_rec_prospect`, `ivx_rec_alert`, `ivx_rec_certificate`)
- Live dashboard: `GET /api/ivx/agents/real-status` + Expo screen `ivx/real-execution-112` (per-agent status, last real tool, last source, last evidence, heartbeat, duration, errors, retries, cost, alerts)

## Honest notes

- An earlier run (`rec-1787091464235`) scored 111/112 healthy due to a heartbeat write race that overwrote one agent's durable health. The race was fixed (global heartbeat doc + seed-only state rows) and the certificate only passed after the fix — no numbers were faked.
- Dedicated Postgres tables could not be created because no valid `SUPABASE_ACCESS_TOKEN` exists in the runtime or owner-variables store; persistence runs on the proven `ivx_agent_jobs` durable store and auto-upgrades when the owner saves a valid management token.
- Agent costUsd is accounting cost for public-API tool calls ($0.001/call) — no paid AI inference was used in certified runs, which is also why simulatedRuns=0 is provable: every output hash-links to a fetched public source or CRM record.
