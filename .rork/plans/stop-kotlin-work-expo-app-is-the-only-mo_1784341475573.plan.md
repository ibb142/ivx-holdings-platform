---
name: "Stop Kotlin work — Expo app is the only mobile product"
overview: "Permanently retire the separate Kotlin Android project and continue all Phase 2 work (Android/iOS builds, QA, Senior Developer activation, App Factory) from your existing Expo app only."
createdAt: 2026-07-18T02:24:35.573Z
---
# Stop Kotlin work — Expo app is the only mobile product

Permanently retire the separate Kotlin Android project and continue all Phase 2 work (Android/iOS builds, QA, Senior Developer activation, App Factory) from your existing Expo app only.

## What changes

**Stop Kotlin permanently**
- No more builds, edits, or version bumps in the separate Kotlin Android project.
- Mark it retired in the project records so no agent or report ever picks it up again.
- ~~The folder stays untouched on disk (nothing deleted unless you say so).~~ UPDATE 2026-07-18: owner APPROVED removal — standalone Kotlin app `android-ivx-holdings/` (62 files) deleted; `expo/android/` (Expo/EAS-required) preserved; rollback tag `rollback-pre-kotlin-removal-20260718` @ f82e5a5d + local tar backup created BEFORE deletion.
- The 9 MB test file it produced is discarded — it is not your app and will never be presented as your APK.

**Expo app becomes the single source for all mobile builds**
- Android APK and AAB: produced from the Expo app (v1.4.6) through its existing build pipeline — the same one that produced your verified v1.4.5-build37 APK.
- New builds from the latest verified code still need your build-service credentials (the same owner action already tracked); I will re-verify what is available and give you the exact one-step instruction if anything is missing.
- iOS/TestFlight: same — from the Expo app, pending your Apple credentials.

**Phase 2 continues unchanged, on the Expo app**
- Senior Developer activation, the 50-agent App Factory registration, the live agent dashboard, and the pilot app all proceed as mandated.
- Two-hour executive reports continue with verified evidence only.

## Order of work
- [x] Record Kotlin retirement + correct the task ledger so Android tasks point at the Expo app. (Kotlin FROZEN per owner order — not deleted; ledger JOB-0032; backup tag backup-pre-expo-only-20260718 @ f82e5a5d)
- [x] Re-check build credentials and either start the real Expo Android build or report the exact blocker. (Exact blocker: eas-cli "Not logged in", EXPO_TOKEN absent — owner EAS credentials required. Expo typecheck PASS: 0 errors.)
- [x] Proceed with Senior Developer activation and the first 12 App Factory agents. (SD-0001 ACTIVE with real work evidence; AF-001..AF-012 registered PENDING_OWNER_APPROVAL; live dashboard view ivx_factory_dashboard verified; AF-VERIFY-001..012 + AF-PILOT-001 queued; ledger JOB-0033)
- [x] Owner-approved cleanup: remove standalone Kotlin app, run full Expo Android build, verify all production flows, return evidence. (62 files removed; expo/android preserved; APK 84.65 MB sha256 36ff2c63 + AAB 42.88 MB sha256 89840a62 BUILD SUCCESSFUL from expo/android v1.4.6(38); all 8 production flows verified live; ledger JOB-0034)
- [x] Owner priority order 2026-07-18: P1 Render verify (deploy dep-d9dec4v41pts73cv5vog LIVE @ f82e5a5d, 3-way SHA parity) + P2 full production QA all-pass incl. landing registration E2E with cleanup + P3 RM-only deploy policy written/verified, no hook exposed in code (regeneration = owner dashboard action) + P4 APK link delivered hash-verified. (ledger JOB-0035)
- [x] FINAL MANDATE Phase 0 (T0 2026-07-18T04:01:33Z): baseline recorded, emergency-stop control created + live-toggle tested, all 50 factory agent roles registered honestly as UNTESTED/NOT_STARTED in ivx_ia_factory_agents with restricted permissions, SD-0001 heartbeat, ledger JOB-0036, report posted to IVX AI Chat.
- [ ] FINAL MANDATE Phase 1 (T0+24h): prove remaining SD-0001 capabilities (branch+PR flow, automated test-fix cycle, screenshot evidence); wire emergency-stop check into backend task runtime. (PROGRESS 2026-07-18 ~11:30Z: CODE SHIPPED — ivx-emergency-stop-gate.ts enforced in senior-developer worker at enqueue + pre-execution; owner-only endpoint /api/ivx/senior-developer/branch-pr-proof executes real branch→commit→PR→close cycle; typecheck clean on new files; AWAITING next push-to-main autodeploy, then live enforcement test + branch+PR execution. Full E2E QA battery all-pass 11:16–11:25Z; honest factory audit: FA-01..50 all NOT VERIFIED; ledger JOB-0040 e458d13d.)
- [x] EMERGENCY AI GATEWAY REPAIR 2026-07-18 ~11:45Z: root cause = provider state machine latched AI_UNAVAILABLE permanently (no recovery path) while the stored vck_ key was actually valid (dead-key history verified 401 live; loaded key verified 200 live). Service RESTORED via owner-authorized redeploy dep-d9dm98mrnols73coeh00 (boot 11:36:31Z); SD-0001 real commit f848308a pushed + autodeployed (boot 11:42:41Z, SHA parity GitHub=runtime). Exact database-security-remediation command completes from IVX Owner AI chat with no timeout (assistant msgs 2d2870ac, 304d2893). Hardening patch (half-open circuit breaker w/ 60s cooldown, createGateway SDK removed → direct client, bounded retry+backoff, idempotency dedup) written locally, typecheck clean, 42/42 tests — DEPLOY PENDING next repo sync. Secondary finding: pre-execution gate 409 GITHUB_REPO_INVALID on deploy-word messages (gate reads GITHUB_REPO, runtime has GITHUB_REPO_URL) — env fix or patch pending. Ledger 9a7db23e (emergency_ai_gateway_repair); report posted to IVX AI Chat.
- [ ] FINAL MANDATE Phases 3-7: factory isolation infrastructure (separate repo/cloud/DB — owner provisioning needed), build+verify FA-01..50 per pipeline, owner-selected pilot application, business workflow activation. Blocked on owner approvals: APR-003 EAS/Play key, Apple credentials, pilot selection, FA build approval, deploy-hook regeneration.
