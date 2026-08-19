/// <reference types="node" />
import type { ExpoConfig } from 'expo/config';
import { execSync } from 'child_process';
import withFmtXcode26Fix from './plugins/withFmtXcode26Fix';

// Dynamically read the current git HEAD SHA at build time.
// This breaks the circular dependency where hardcoding the SHA
// creates a new commit with a different SHA.
let _sourceCommitSha = 'unknown';
try {
  _sourceCommitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
} catch {
  // Fallback for environments without git
  _sourceCommitSha = process.env.EXPO_PUBLIC_SOURCE_COMMIT_SHA || 'unknown';
}

const config: ExpoConfig = {
  name: 'IVX Holdings',
  slug: 'ivx-holdings',
  owner: 'ivx-holdings',
  version: "1.10.28",
  runtimeVersion: {
    policy: 'appVersion',
  },
  extra: {
    buildMarker: 'IVX_BUNDLE_2026_08_11_V11013_CHAT_UI_CLEANUP',
    buildTimestamp: "2026-08-11T04:30:00.000000+00:00",
    sourceCommitSha: _sourceCommitSha,
    watchdogPatchVersion: 'ai-mutation-watchdog-fix-v12-enterprise-verify',
    frontendDeployMarker: 'ivx-frontend-2026-07-15-enterprise-verification',
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '00000000-0000-0000-0000-000000000000',
    },
  },
  sdkVersion: '54.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png', // Official IVX master logo (brand standardization 2026-07-21)
  scheme: 'ivx-app',
  userInterfaceStyle: 'dark',
  backgroundColor: '#000000',
  // react-native-maps 1.26.1+ targets Fabric with React Native >=0.81.1.
  // This project uses RN 0.81.5 / react-native-maps 1.29, so compiling the
  // generated RNMaps*.mm components under the legacy architecture is invalid.
  newArchEnabled: true,
  updates: {
    enabled: false,
    checkAutomatically: 'NEVER',
    fallbackToCacheTimeout: 0,
  },
  splash: {
    image: './assets/images/splash-icon.png', // Official IVX splash logo (brand standardization 2026-07-21)
    resizeMode: 'contain',
    backgroundColor: '#000000',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.ivxholdings.app',
    buildNumber: '5',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png', // Official IVX adaptive icon (brand standardization 2026-07-21)
      backgroundColor: '#000000',
    },
    package: 'com.ivxholdings.app',
    versionCode: 126,
    softwareKeyboardLayoutMode: 'resize',
  },
  web: {
    favicon: './assets/images/favicon.png', // Official IVX favicon (brand standardization 2026-07-21)
    bundler: 'metro',
    output: 'single',
  },
  platforms: ['ios', 'android', 'web'],
  plugins: [
    'expo-router',
    'expo-font',
    'expo-web-browser',
    'expo-secure-store',
    [
      'expo-audio',
      {
        microphonePermission: 'Allow IVX Holdings to capture voice prompts for transcription.',
      },
    ],
    // Fix fmt 11.0.2 consteval compilation error with Xcode 26 / Apple Clang 21+.
    // React Native bundles fmt 11.0.2 via RCT-Folly; Xcode 26 enforces stricter
    // consteval rules that fmt 11.0.2 doesn't handle. fmt 12.1.0 fixes this but
    // RN hasn't upgraded yet. This plugin patches the Podfile post_install to
    // force C++17 for the fmt target and patch base.h to disable consteval.
    withFmtXcode26Fix as unknown as [string, any],
  ],
  experiments: {
    typedRoutes: true,
    baseUrl: '/app',
  },
};

export default config;
