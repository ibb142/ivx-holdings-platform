# IVX IA — Full End-to-End System Map (Owner Edition)

Last verified live: 2026-07-18 ~17:20Z · Runtime commit 33ff0a77 · /health 200 healthy · Engineering OS 12/12 teams ACTIVE

This is the complete map of the IVX AI brain: every layer, how signals flow, how you control it, and the honest deployment status of every component.

---

## LAYER 1 — INPUTS (how the brain is triggered)

| Input | Who can use it | Route |
| --- | --- | --- |
| IVX Owner AI Chat (app + dashboard) | Owner only (iperez4242@gmail.com) | POST /api/ivx/owner-ai |
| Public landing support chat | Anyone (rate-limited, no data leak) | public chat AI on ivxholding.com |
| 2-hour Executive Report ticker | Self-triggered on schedule | posts report into IVX AI Chat |
| Engineering OS pipeline | Owner-created tasks | /api/ivx/engineering-os/tasks/* |
| Lead capture | Public visitors (consent required) | POST /api/ivx/leads/capture → CRM |

## LAYER 2 — THE BRAIN CORE (thinking)

1. **AI Gateway** — Vercel AI Gateway → openai/gpt-4o (adapter 3.0.85).
   - Provider state machine (no more permanent AI_UNAVAILABLE latch)
   - Half-open circuit breaker with 60s cooldown
   - Bounded retry + backoff on transient failures
   - Idempotency dedup: same requestId = one shared call, identical answer
2. **Durable Task Queue** (`ivx_owner_ai_tasks`) — the 503-proof spine.
   - Every owner message is persisted FIRST (202 + taskId), then executed by a background worker
   - Auto-retry on 429/502/503/504/timeout; dead-letter + replay; survives Render restarts
3. **Senior Developer SD-0001** — the coding brain.
   - Plans, writes code, creates branches, opens PRs, runs tests, fixes failures
   - Proven live: real commits, PR #1 lifecycle, test-fix cycles

## LAYER 3 — THE HANDS (what the brain can act on) — every write is phrase-gated

| Action | Confirmation phrase | Restriction |
| --- | --- | --- |
| GitHub commit / rollback tag | CONFIRM_IVX_GITHUB_WRITE | only repo ibb142/rork-global-real-estate-invest (enforced in code) |
| GitHub merge PR | separate merge phrase | owner only |
| Render production deploy | CONFIRM_IVX_RENDER_DEPLOY | TEAM-12 Release Manager ONLY |
| Supabase data writes | CONFIRM_OWNER_SUPABASE_WRITE | owner backend only, service-role never exposed |
| Supabase migrations | CONFIRM_IVX_SUPABASE_MIGRATION | owner only |
| APK upload to your domain | CONFIRM_IVX_APK_UPLOAD | whitelist apk/*.apk|.aab, 15-min presign |
| Landing file upload | CONFIRM_IVX_LANDING_UPLOAD | whitelisted files only |
| Pipeline production approval | CONFIRM_IVX_PRODUCTION_APPROVAL | owner only, per task |
| Engineering OS activation | CONFIRM_IVX_ENGINEERING_OS_ACTIVATION | owner only |

## LAYER 4 — THE FACTORY (Engineering OS)

- 12 teams (TEAM-01 Architecture → TEAM-12 Release Manager), all ACTIVE, approved by you
- 14-stage pipeline, one stage at a time (skipping = rejected live):
  COLLECT_BUGS → ANALYZE → GENERATE_TASKS → ASSIGN → DEVELOP → CODE_REVIEW → AUTOMATED_TESTS → SECURITY_REVIEW → PERFORMANCE_REVIEW → OWNER_APPROVAL → PRODUCTION_DEPLOY → HEALTH_VERIFICATION → PROOF_LEDGER → MONITOR
- Rule 5 in code: a task cannot be VERIFIED without commit SHA + deploy + tests + health evidence
- Only TEAM-12 can merge/tag/deploy (proven live: TEAM-03 deploy rejected)
- 10 complete VERIFIED task cycles executed to date

## LAYER 5 — SAFETY & GOVERNANCE (your kill-switches)

1. **Emergency stop** — `ivx_agent_controls` (RLS-protected). When ON, agents refuse work (EMERGENCY_STOP_ACTIVE) — proven live twice.
2. **Owner allowlist** — only your email can authenticate as owner; others get 403; brute force gets 429.
3. **Rollback tags** — every risky change is preceded by a tag (latest: rollback-pre-200root-cert-20260718).
4. **Proof Ledger** — `developer_proof_ledger`: every real action recorded with commit, deploy, tests, live URL, final status.
5. **Health monitors** — /health, /health/live, /ready, /ai, /database, /queue, /provider (ready flips 503 if the AI path is down).
6. **RLS everywhere** — 195 tables inventoried; anonymous probes leak zero rows.

## LAYER 6 — MEMORY (data)

Supabase (kvclcdjmjghndxsngfzb): members, investors (875), buyers, jv_deals, jv_deal_reels, properties, notifications, wallets, transactions, kyc_verifications, waitlist, public_chat_messages, ivx_owner_ai_tasks, ivx_engineering_teams/tasks/reports, ivx_ia_factory_agents, ivx_agent_controls, developer_proof_ledger + audit logs.

## END-TO-END FLOW (one message, full circuit)

You type in IVX AI Chat
→ owner JWT verified → task persisted (ivx_owner_ai_tasks) → 202 + taskId
→ background worker picks it up → AI Gateway (gpt-4o) thinks
→ if work is needed: SD-0001 writes code → tests → phrase-gated GitHub commit
→ TEAM-12 deploy → Render boots new SHA → /health verified → Proof Ledger row
→ answer persisted to chat → your app shows it (with retry/cancel if anything blips)

## DEPLOYMENT STATUS — honest, component by component

### DEPLOYED & VERIFIED 100% (live in production)
- Owner AI Chat + durable 503-proof task queue
- AI Gateway hardening (circuit breaker, retries, dedup, repo binding)
- Senior Developer SD-0001 (full dev cycle proven)
- Engineering OS: 12/12 teams ACTIVE, 14-stage pipeline enforced
- 2-hour Executive Report ticker
- Emergency stop (enforced at runtime + deploy gate)
- Proof Ledger
- Deploy control (GitHub/Render/rollback, all phrase-gated)
- Health system (7 endpoints, all 200)
- Public landing chat + lead capture → CRM
- Android release pipeline (APK v1.4.8(40) live on ivxholding.com/apk/)
- Landing site + reels UI
- 200-root certification: VERIFIED (196 PASS / 0 FAIL / 4 owner-blocked)

### REGISTERED BUT NOT ACTIVE (plans — waiting on YOU)
- App Factory FA-01..50: registered honestly as UNTESTED / PENDING_OWNER_APPROVAL. Only SD-0001 is verified. Activation needs your approval + isolated infrastructure (separate repo/cloud/DB).
- Pilot application: waiting on your selection.

### BLOCKED ON OWNER CREDENTIALS (cannot be done by AI alone)
- iOS / TestFlight: needs your Apple credentials
- Play Store AAB upload: needs your Play credentials
- On-device acceptance tests: need your phone

## OWNER MANAGEMENT PLAYBOOK

1. **Give work**: type it in IVX AI Chat — it becomes a durable task automatically.
2. **Approve production**: reply with CONFIRM_IVX_PRODUCTION_APPROVAL when a task reaches OWNER_APPROVAL.
3. **Stop everything**: engage the emergency stop (ivx_agent_controls) — all agents refuse work instantly.
4. **Check health**: open https://api.ivxholding.com/health (commit shown = what's live).
5. **Verify any claim**: every VERIFIED task has a Proof Ledger row — no proof, no pass.
6. **Roll back**: order a rollback to any rollback-* tag; TEAM-12 redeploys the tagged SHA.
