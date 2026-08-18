import { getIVXAccessControlConfig } from '@/shared/ivx';

export function isOpenAccessModeEnabled(): boolean {
  // Expo/Metro only inlines EXPO_PUBLIC_* variables when they are referenced
  // with static dot notation. access-control.ts also supports dynamic key
  // lookup, but that lookup cannot see a build-time variable in a standalone
  // APK. Keep this direct reference so the QA artifact can enter Home while
  // production remains locked (the production workflow does not set it).
  if (process.env.EXPO_PUBLIC_IVX_OPEN_ACCESS_MODE === 'true') {
    return true;
  }
  return getIVXAccessControlConfig().openAccessEnabled;
}

export function getOpenAccessModeMessage(): string {
  const config = getIVXAccessControlConfig();
  return config.openAccessEnabled
    ? 'Login is temporarily disabled in this build. The app opens directly.'
    : 'Open access is disabled in this build. Sign in is required.';
}

export function getOpenAccessModeAdminMessage(): string {
  const config = getIVXAccessControlConfig();
  return config.openAccessEnabled
    ? 'Open access is active. Owner Access and Sign In are bypassed so you can open the app and admin routes directly.'
    : 'Open access is disabled. Admin routes require a verified session.';
}
