import { isAdminRole, normalizeRole, sanitizeEmail } from '@/lib/auth-helpers';
import { getOpenAccessModeAdminMessage, isOpenAccessModeEnabled } from '@/lib/open-access';

/** Production owner email fallback for admin access lock. */
const PRODUCTION_OWNER_EMAIL = 'iperez4242@gmail.com';

/**
 * Resolve the configured owner email on every call.
 *
 * This is deliberately NOT captured in a module-level constant. Doing so froze
 * the value at first import, so whichever module happened to load this file
 * first decided the owner email for the entire process — a real order
 * dependence that made owner access resolve differently depending on import
 * order, and that only showed up once several screens imported it.
 */
function ownerAdminEmail(): string {
  return sanitizeEmail(
    process.env.EXPO_PUBLIC_OWNER_EMAIL
      || process.env.NEXT_PUBLIC_OWNER_EMAIL
      || PRODUCTION_OWNER_EMAIL
  );
}

export const ADMIN_ACCESS_LOCK_TITLE = isOpenAccessModeEnabled()
  ? 'Open access active'
  : ownerAdminEmail()
    ? 'Owner-only admin access'
    : 'Admin access restored';

export function getConfiguredOwnerAdminEmail(): string | null {
  return ownerAdminEmail() || null;
}

export function isAdminAccessLocked(): boolean {
  return !isOpenAccessModeEnabled() && ownerAdminEmail().length > 0;
}

export function isOwnerAdminEmail(email: string | null | undefined): boolean {
  const configured = ownerAdminEmail();
  if (!configured) {
    return false;
  }

  return sanitizeEmail(email ?? '') === configured;
}

export function shouldBlockRoleForAdminAccess(role: string | null | undefined, email?: string | null): boolean {
  if (isOpenAccessModeEnabled()) {
    return false;
  }

  return isAdminAccessLocked() && isAdminRole(normalizeRole(role)) && !isOwnerAdminEmail(email);
}

export function getAdminAccessLockMessage(): string {
  if (isOpenAccessModeEnabled()) {
    return getOpenAccessModeAdminMessage();
  }

  if (!ownerAdminEmail()) {
    return 'The temporary app-side admin lock is off. Owner/admin sign-in, trusted-device restore, and admin routes are enabled again in this build.';
  }

  return `Admin access is temporarily limited to the configured owner email (${ownerAdminEmail()}) while testing. Other admin accounts are blocked from admin sign-in, trusted-device restore, and admin routes.`;
}

export function getAdminAccessLockHonestStatus(): string {
  if (isOpenAccessModeEnabled()) {
    return 'Yes — login is disabled in this build now. The app opens directly and admin routes are no longer blocked by the app-side owner lock.';
  }

  if (!ownerAdminEmail()) {
    return 'Yes — the temporary app-side admin lock is OFF in this build now. Owner/admin sessions, trusted-device restore, and admin routes are no longer blocked on the app side.';
  }

  return `Yes — the temporary owner-only admin lock is ON in this build now. Only ${ownerAdminEmail()} can keep admin access while testing.`;
}

export function getAdminAccessLockFixUpdate(): string {
  if (isOpenAccessModeEnabled()) {
    return 'The app now bypasses Owner Access and Sign In entirely in this build so the workspace opens directly while the underlying auth recovery work stays in place.';
  }

  if (!ownerAdminEmail()) {
    return 'The auth audit, password-reset route, trusted-device diagnostics, and role-resolution fixes remain in place, and the temporary app-side admin lock has now been removed.';
  }

  return 'The app now reads EXPO_PUBLIC_OWNER_EMAIL or NEXT_PUBLIC_OWNER_EMAIL and applies the temporary admin lock in the shared auth flow, trusted-device recovery, and admin route guard.';
}

export function getAdminAccessLockNextStep(): string {
  if (isOpenAccessModeEnabled()) {
    return 'Open the app directly. Admin routes and the main workspace now bypass the login gate in this build.';
  }

  if (!ownerAdminEmail()) {
    return 'If owner access still fails now, the remaining blocker is outside this temporary app-side lock — most likely the live Supabase credentials for that owner account or the backend repair key configuration.';
  }

  return `Use the exact owner email ${ownerAdminEmail()} for owner/admin access while testing. Non-owner admin accounts will be signed out or denied when they hit protected admin flows until this temporary lock is removed.`;
}
