/// <reference types="node" />
import type { ExpoConfig } from 'expo/config';
import { execSync } from 'child_process';

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
  version: "1.4.32",
  runtimeVersion: {
    policy: 'appVersion',
  },
  extra: {
    buildMarker: 'IVX_BUNDLE_2026_07_21_BUILD_63_CHAT_COMPOSER_LOADING_REMOVED',
    buildTimestamp: "2026-07-21T01:15:00.000000+00:00",
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
  newArchEnabled: false,
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
    buildNumber: '2',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png', // Official IVX adaptive icon (brand standardization 2026-07-21)
      backgroundColor: '#000000',
    },
    package: 'com.ivxholdings.app',
    versionCode: 64,
    softwareKeyboardLayoutMode: 'resize',
  },
  web: {
    favicon: './assets/images/favicon.png', // Official IVX favicon (brand standardization 2026-07-21)
    bundler: 'metro',
  },
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
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
