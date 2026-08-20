# IVX PHASE 4 FINAL EXECUTION — ITEM-BY-ITEM — 2026-08-20

Canonical: ibb142/ivx-holdings-platform · PR #192 · branch fix/senior-certification-hard-gates
FEATURE_SHA ce78bfcf01761ec21e49bd4840825dbea78650c2 (live-fetched) · MAIN_SHA 6ca1cd71f2b9602d079c141805f918279888e7da
No secret values printed. No funds moved. No merge. No deploy.

## ITEM 1 — Canonical state — PASS
PR #192 open / draft=true / merged=false / mergeable_state=unstable / head=ce78bfcf = branch head.
HEAD advanced 39a62c9a → ce78bfcf (2 commits: phase3 CI workflow + durable-store migration).

## ITEM 2 — Certified phases preserved — PASS
Protected files (runtime, real-tools, persistence, least-privilege, wire-transfer, server.ts, agent-api) UNCHANGED.
CI at ce78bfcf: Phase 1 PASS · Phase 2 PASS · Phase 3 PASS (x2). Nothing rebuilt.

## ITEM 3 — Durable autonomous database — PASS (live readback)
Project kvclcdjmjghndxsngfzb (management API, HTTP 200):
- Tables ivx_agent_states / _executions / _alerts / _certificates EXIST, rowsecurity=true.
- Grants: service_role ONLY (anon/authenticated: no privileges at all).
- Run 32414581276: 15 rows — 8 `completed` (real_tool_used=8, tool_result_id=8, source_reference=8,
  evidence_sha256=8, simulated=0) + 7 `blocked` negatives (simulated=0, evidence persisted).
- Window 20:32:05.438Z → 20:32:18.496Z. Agent states persisted (ivx_holdings_2/13/22/31/41…).
- WARNING: ivx_agent_certificates table is EMPTY (no cert row for the run); certificate lives only
  in CI artifact 9423412587.

## ITEM 4 — SMS / carrier audit — PASS (discovery)
ACTIVE_SMS_PROVIDER=MULTI_CARRIER — SignalWire (primary SMS + voice escalation, LaML API) →
Amazon SNS (secondary fallback, owner recovery). Fixed transport order in ivx-autonomous-sms-notifier.ts
(marker `ivx-autonomous-owner-comms-2026-08-16-signalwire-primary`). TWILIO_REQUIRED=false.
Twilio reference classification: ivx-signalwire-voice.ts getTwilioConfig = LEGACY_COMPAT (alternative
env-var naming only, feeds SignalWire config booleans; no Twilio API call); ivx-member-verification.ts
= DOC_ONLY; expo owner-access.tsx / module-registry = DOC_ONLY text/comments. No Twilio service file.
Nothing removed (compat shim is reachable and harmless).
WARNING: ivx-signalwire-service.ts embeds a fallback carrier token/project-id/from-number as source
defaults (token fingerprint `PT…`, not printed). Repo is PUBLIC-readable → live carrier credential
exposed to anyone. Owner action: rotate token + move to env-only.

## ITEM 5 — Twilio removed from autonomous gates — PASS (no code gate existed)
No certification logic in .github/workflows/, scripts/, qa/, backend/ requires Twilio (only historical
evidence docs). This report's matrix drops Twilio: status NOT_REQUIRED. No source change needed.

## ITEM 6 — Credential matrix (active dependencies only)
- GitHub: PRESENT_BUT_UNAUTHORIZED (401 Bad credentials, read+identity; public repo read 200)
- Render: BOUND_AND_VALID (recovered key, service metadata 200)
- Supabase management: BOUND_AND_VALID · Supabase production runtime: BOUND_AND_VALID
- AI provider: UNVERIFIED (workspace probe 404; production /health ai.ok=false — warning)
- SignalWire carrier: UNVERIFIED (workspace env absent; source-embedded defaults; no live send performed)
- AWS (S3/CloudFront/SNS): MISSING_BINDING (stored key is the AWS docs example key)

## ITEM 7 — GitHub write auth — PRESENT_BUT_UNAUTHORIZED
Authed repo read 401 · /user 401 ("Bad credentials"). Unauthenticated repo read 200 (public).
Feature-branch write and PR update not possible with stored binding. Does not affect GitHub Actions
GITHUB_TOKEN or the canonical repo.

## ITEM 8 — Render source of truth — VERIFIED, PRODUCTION_STALE
srv-d7t9ivreo5us73ftose0 · ivx-holdings-platform · repo canonical · branch main · autoDeploy yes.
/version → commit 6ca1cd71f2b9602d079c141805f918279888e7da (boot 14:25:20.719Z) ≠ ce78bfcf.
PRODUCTION_SHA ≠ APPROVED_SHA. HTTP 200 not treated as deploy proof.

## ITEM 9 — Production financial negative tests (stale prod @6ca1cd71) — PASS
| Test | Result |
|---|---|
| anon GET wire-instructions | 200 preview only — no routing/account digits |
| fake-bearer GET wire-instructions | 200 preview only — no digits |
| anon POST wire-submission (invented ref) | 404 denied, not persisted |
| fake-bearer POST (invented ref) | 404 denied, not persisted |
| USER_A + valid own reference + body userId=VICTIM | 404 denied — no impersonation, nothing stored |
| foreign reference (wire_mt1rz1ql…) | 404 denied |
| wallet debit anon/fake | 404 denied |
| wallet credit anon/fake | 404 denied |
| settlement anon/fake | 404 denied |
| cross-user financial read | 200, own rows only, no foreign leak |

Valid reference used: own referenceCode from authenticated instructions (IVX-EYJHBGCI-4323).
Routing sanity: POST /api/ivx/wire-submissions/purge-qa → 200 (POST routing alive; denials are handler
semantics, not missing routes). Purge after tests: removed 0 new; QAF4 refs absent; dead-4beef absent.
NOTE: earlier-session probes (20:24Z) persisted on this same boot; current probes are all denied —
behavior differs from this morning's FAIL round; recorded honestly, not retroactively merged.
Remaining row `wire_mt1rz1ql_8e5cf73547` is the prior synthetic QA probe (qa:false, marked
"safe to purge", no funds) — purge-qa does not remove qa:false rows; flagged for owner cleanup.
SOURCE_CODE_SECURE=true (byte-identical wire code) · PRODUCTION_STALE=true (SHA).

## ITEM 10 — Security definer / RLS audit — PASS
ivx_query_auth_user_by_email, ivx_exec_sql, atomic_wallet_operation: SECURITY DEFINER, search_path
pinned, EXECUTE granted to service_role ONLY (anon/authenticated/public denied).
RLS enabled on investor_profiles, member_financial_summary, classification_audit, ivx_durable_documents,
ivx_durable_events, ivx_agent_states/_executions/_alerts/_certificates (all rowsecurity=true).
Full definer-function inventory reviewed. WARNING: legacy ivx_agent_jobs/ivx_agent_job_logs carry
authenticated-ALL policies (superseded by new locked tables).

## ITEM 11 — Mobile release secret scan — PASS
APK built from canonical clone @ ce78bfcf (android/ identical to 39a62c9a — gradle cache-valid).
app-release.apk · sha256 12a3aac9332256e6fd13b65ab47a0a3c5172c31f0df34678a9818d83eb711eb9 ·
15,537,625 bytes · 458 entries / 53,229,839 bytes scanned · patterns: gh[pousr]_, github_pat_, rnd_,
service_role, sbp_, carrier PT-token, sk-, AKIA, PEM, postgres:// + exact-value scan of every held
secret. **forbidden_secret_matches = 0**.

## ITEM 12 — CI matrix at ce78bfcf (15 check runs)
PASS: Phase 1 Autonomous Governance · Phase 2 Least Privilege · Phase 3 Execution QA (x2) · Senior
quality gate · scan-secrets · qa-suite · Playwright E2E · Landing live · Lint · TypeScript.
QUEUED: Maestro E2E. FAIL: Redirect rules / Header rules / Pages changed — ivxholding (Netlify).

## ITEM 13 — Maestro — BLOCKED_INFRA
check_run 96573129078 · run 32414581191 · job 96573129078 · github-actions · queued since
2026-08-20T20:33:24Z. QUEUED ≠ PASS. All other work continued.

## ITEM 14 — Production approval boundary — PASS (source-level)
Protected files unchanged; PROHIBITED_TOOL_IDS=[money_movement, trade_execution, legal_execution];
production_deploy/external_outreach approval-gated; AUTONOMOUS_TASK_BLOCKED covers the full
never-autonomous class (move/credit/debit/settle/trade, approve_kyc/aml, disable_rls,
weaken_secret_scanner, fabricate_certificate); wallet debit auth-guarded. Boundary intact at ce78bfcf.

## ITEM 15 — Merge / deploy — MERGE_OWNER_APPROVAL_REQUIRED=true
PR #192 open/draft/unmerged (re-fetched). No silent merge. Render tracks main; exact feature SHA not
deployed. Exact-SHA branch deployment not authorized from here.

## ITEM 16 — Post-deploy security smoke — NOT RUN
Requires exact-SHA deploy (Item 15 authorization). Not fabricatd.

## ITEM 17 — Autonomous final rubric — 7/10
1. Governance — PASS · 2. Least privilege — PASS · 3. Real execution — PASS ·
4. Durable evidence/persistence — PASS · 5. Fail-closed handling — PASS ·
6. Credential isolation — FAIL (live carrier token embedded in public source) ·
7. Financial safety boundary — PASS · 8. Database privacy / RLS — PASS ·
9. CI + E2E reproducibility — FAIL (Maestro BLOCKED_INFRA, 3 Netlify FAIL) ·
10. Exact-SHA production verification — FAIL (PRODUCTION_STALE)

## ITEM 18 — Certificate
**AUTONOMOUS_SCORE: 7/10 — FINAL CERTIFICATE NOT ISSUED.**
Blockers: (a) exact-SHA production deploy + post-deploy smoke (owner merge/deploy approval);
(b) Maestro queue + 3 Netlify checks; (c) SignalWire token rotation/removal from public source;
(d) GitHub write binding 401 (blocks branch updates from workspace).
TWILIO: NOT_REQUIRED. SMS_PROVIDER: MULTI_CARRIER (SignalWire primary, AWS SNS fallback).
