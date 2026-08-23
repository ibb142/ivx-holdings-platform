/// <reference types="node" />
import type { ExpoConfig } from 'expo/config';
import { execSync } from 'child_process';
import withFmtXcode26Fix from './plugins/withFmtXcode26Fix';

let _sourceCommitSha = 'unknown';
try {
  _sourceCommitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
} catch {
  _sourceCommitSha = process.env.EXPO_PUBLIC_SOURCE_COMMIT_SHA || 'unknown';
}

const config: ExpoConfig = {
  name: 'IVX Holdings',
  slug: 'ivx-holdings',
  owner: 'ivx-holdings',
  version: "1.10.30",
  runtimeVersion: { policy: 'appVersion' },
  extra: {
    buildMarker: 'IVX_BUNDLE_2026_08_23_V11030_AUTH_ROUTE_BLACKSCREEN_FIX',
    buildTimestamp: "2026-08-23T18:26:00.000Z",
    sourceCommitSha: _sourceCommitSha,
    watchdogPatchVersion: 'android-auth-route-visible-gate-v13',
    frontendDeployMarker: 'ivx-frontend-2026-08-23-v1.10.30',
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '00000000-0000-0000-0000-000000000000' },
  },
  sdkVersion: '54.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'ivx-app',
  userInterfaceStyle: 'dark',
  backgroundColor: '#000000',
  newArchEnabled: true,
  updates: { enabled: false, checkAutomatically: 'NEVER', fallbackToCacheTimeout: 0 },
  splash: { image: './assets/images/splash-icon.png', resizeMode: 'contain', backgroundColor: '#000000' },
  ios: { supportsTablet: false, bundleIdentifier: 'com.ivxholdings.app', buildNumber: '5' },
  android: {
    adaptiveIcon: { foregroundImage: './assets/images/adaptive-icon.png', backgroundColor: '#000000' },
    package: 'com.ivxholdings.app',
    versionCode: 128,
    softwareKeyboardLayoutMode: 'resize',
  },
  web: { favicon: './assets/images/favicon.png', bundler: 'metro', output: 'single' },
  platforms: ['ios', 'android', 'web'],
  plugins: [
    'expo-router',
    'expo-font',
    'expo-web-browser',
    'expo-secure-store',
    ['expo-audio', { microphonePermission: 'Allow IVX Holdings to capture voice prompts for transcription.' }],
    withFmtXcode26Fix as unknown as [string, any],
  ],
  experiments: { typedRoutes: true, baseUrl: '/app' },
};

export default config;
