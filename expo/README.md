# IVX Holdings — Owner-Controlled Mobile App

This is the IVX Holdings native cross-platform mobile app. It is owned, built,
deployed, and operated by IVX Holdings (owner: iperez4242@gmail.com).

The canonical production repository is
[github.com/ibb142/rork-global-real-estate-invest](https://github.com/ibb142/rork-global-real-estate-invest).

## Repo history note

This project was originally scaffolded by Rork. On 2026-07-19 the Rork SDK
(`@rork-ai/toolkit-sdk`), the Rork Metro wrapper (`withRorkMetro`), the Rork
git-router Render deploy hooks, and all Rork-owned bundle IDs were removed.
IVX Holdings now builds, deploys, and operates this app independently of Rork.
The Rork branding/headers that remained in the iOS Swift templates and this
README were also removed on 2026-07-19.

## Develop locally

```bash
bun install
bunx expo start
```

## Build

Android (APK / AAB) and iOS (TestFlight) builds are produced from this Expo app
via the owner-controlled Gradle / Xcode pipelines in `expo/android` and the iOS
targets. See `expo/deploy/` for the build scripts.

## Deploy

Backend deploys go to the owner-controlled Render service
(`srv-d7t9ivreo5us73ftose0`) which pulls directly from the canonical GitHub
repo above. APK/AAB artifacts are uploaded to the owner-controlled S3 bucket
served by `https://ivxholding.com/apk/`.

## Production

- Live backend: `https://api.ivxholding.com`
- Landing: `https://ivxholding.com`
- APK: `https://ivxholding.com/apk/ivx-holdings-v1.4.17.apk`

## Project structure

- `app/` — Expo Router screens
- `components/` — shared UI components
- `lib/` — services, hooks, utilities
- `src/modules/` — feature modules (owner-ai, chat, developer, etc.)
- `shared/ivx/types.ts` — shared types between backend and client
- `android/` — Expo-managed Android native project
- `deploy/` — build/deploy scripts
