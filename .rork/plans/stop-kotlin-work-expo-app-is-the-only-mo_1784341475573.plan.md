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
