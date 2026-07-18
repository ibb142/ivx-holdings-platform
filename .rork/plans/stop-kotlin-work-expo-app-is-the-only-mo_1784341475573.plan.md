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
- The folder stays untouched on disk (nothing deleted unless you say so).
- The 9 MB test file it produced is discarded — it is not your app and will never be presented as your APK.

**Expo app becomes the single source for all mobile builds**
- Android APK and AAB: produced from the Expo app (v1.4.6) through its existing build pipeline — the same one that produced your verified v1.4.5-build37 APK.
- New builds from the latest verified code still need your build-service credentials (the same owner action already tracked); I will re-verify what is available and give you the exact one-step instruction if anything is missing.
- iOS/TestFlight: same — from the Expo app, pending your Apple credentials.

**Phase 2 continues unchanged, on the Expo app**
- Senior Developer activation, the 50-agent App Factory registration, the live agent dashboard, and the pilot app all proceed as mandated.
- Two-hour executive reports continue with verified evidence only.

## Order of work
- Record Kotlin retirement + correct the task ledger so Android tasks point at the Expo app.
- Re-check build credentials and either start the real Expo Android build or report the exact blocker.
- Proceed with Senior Developer activation and the first 12 App Factory agents.
