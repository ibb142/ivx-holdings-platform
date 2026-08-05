# IVX Holdings — Independent Mobile Release Pipeline

> **Owner-controlled mobile build and release pipeline. No Rork required.**

## Overview

IVX uses two mobile build paths, both fully owner-controlled:

1. **EAS Build** (Expo Application Services) — cloud builds via owner's Expo account
2. **Native Gradle Build** — local/CI Android builds using committed `expo/android/` project

Expo Go remains supported for development. Standalone builds are used for production releases.

## Prerequisites

### EAS Build (Cloud)
```bash
# Login to owner's Expo account
eas login

# Verify project linkage
cd expo
eas init
# Should show: Project ID configured in app.config.ts → extra.eas.projectId
```

Required env vars:
- `EXPO_PUBLIC_EAS_PROJECT_ID` — Expo project UUID
- `EXPO_TOKEN` — EAS authentication token (for CI)

### Native Android Build (Local/CI)
```bash
# Java 17 required
java -version

# Android SDK
echo $ANDROID_HOME
# Should point to SDK installation
```

Required env vars for release signing:
- `IVX_RELEASE_KEYSTORE_PATH` — path to .keystore file
- `IVX_RELEASE_KEYSTORE_PASSWORD` — keystore password
- `IVX_RELEASE_KEY_ALIAS` — key alias
- `IVX_RELEASE_KEY_PASSWORD` — key password

## Build Profiles

Defined in `expo/eas.json`:

| Profile | Platform | Output | Distribution | Use Case |
|---|---|---|---|---|
| `development` | Android | APK | Internal | Dev testing with dev client |
| `preview` | Android | APK | Internal | QA testing |
| `production` | Android | AAB | Store | Google Play release |
| `ios-simulator-qa` | iOS | .app | Internal | iOS simulator QA |
| `ios-device-qa` | iOS | .ipa | Internal | Physical device QA |
| `production` | iOS | .ipa | Store | App Store release |

## Build Commands

### Android APK (Testing)
```bash
cd expo
eas build --platform android --profile preview --non-interactive
# Output: Download link from EAS, or local APK via Gradle:
cd android && ./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

### Android AAB (Google Play)
```bash
cd expo
eas build --platform android --profile production --non-interactive
# Output: AAB ready for Google Play upload
```

### iOS Simulator Build
```bash
cd expo
eas build --platform ios --profile ios-simulator-qa --non-interactive
```

### iOS App Store Build
```bash
cd expo
eas build --platform ios --profile production --non-interactive
# Requires Apple Developer account credentials in EAS
```

## CI/CD Integration

### GitHub Actions — Android APK Build
Already configured in `.github/workflows/ivx-ci.yml`:
- Triggered on push to main (backend changes) or manual dispatch
- Builds release APK using `./gradlew assembleRelease`
- Uploads APK as artifact
- Records SHA-256 for verification

### GitHub Actions — Android Production Signing
Already configured in `.github/workflows/android-production-signing.yml`:
- Manual dispatch only
- Signs APK with production keystore
- Uploads signed APK as artifact

### GitHub Actions — iOS Simulator QA
Already configured in `.github/workflows/ios-simulator-qa.yml`:
- Uses macOS runner
- Runs `npx expo run:ios` with simulator
- Executes Maestro QA flows

## API Configuration

Standalone builds must point to IVX-owned endpoints:

| Environment | `EXPO_PUBLIC_IVX_API_BASE_URL` |
|---|---|
| Production | `https://api.ivxholding.com` |
| Staging | `https://staging-api.ivxholding.com` |
| Local dev | `http://localhost:3000` |

These are set in:
- `expo/.env` — local development
- EAS build profile `env` section — cloud builds
- Render env vars — for backend reference

## App Store Connect Preparation

1. **App ID:** `com.ivxholdings.app` (configured in `app.config.ts`)
2. **App Name:** IVX Holdings
3. **Version:** 1.9.5 (from `app.config.ts`)
4. **Build Number:** 5 (iOS) / Version Code 92 (Android)

### To submit to App Store:
```bash
cd expo
eas build --platform ios --profile production --non-interactive
eas submit --platform ios --profile production --non-interactive
```

### To submit to Google Play:
```bash
cd expo
eas build --platform android --profile production --non-interactive
eas submit --platform android --profile production --non-interactive
```

## Verification Checklist

After any build:

- [ ] App launches without crash
- [ ] API configuration points to `api.ivxholding.com`
- [ ] Authentication flow works (login/signup)
- [ ] IVX IA Chat works (identity brain, math brain, real AI)
- [ ] Autonomous status interfaces render
- [ ] No requests to `rork.com` or `rork.app`
- [ ] No `@rork-ai` imports in bundle
- [ ] Push notification configuration (if applicable)

## Rollback

If a build is rejected or broken:
1. Revert to previous Git commit: `git revert HEAD`
2. Push to main: `git push origin main`
3. Rebuild: `eas build --platform <platform> --profile <profile>`
4. Resubmit to store

No Rork dependency exists in any build or submission step.
