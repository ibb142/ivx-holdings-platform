import React, { memo, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSegments, type Href } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { isOpenAccessModeEnabled } from '@/lib/open-access';

/**
 * Routes accessible without an authenticated session.
 *
 * Anything not listed here is treated as protected and requires a session.
 * Public marketing/auth pages live at the top of `expo/app/`.
 */
const PUBLIC_TOP_LEVEL_SEGMENTS = new Set<string>([
  'landing',
  'login',
  'signup',
  'owner-login',
  'owner-signup',
  'owner-access',
  'reset-password',
  'authenticator',
  '+not-found',
  '+native-intent',
  'modal',
  'waitlist',
]);

const AUTH_HOME_ROUTE: Href = '/(tabs)/home' as Href;
const PUBLIC_LANDING_ROUTE: Href = '/landing' as Href;

function isPublicSegment(rootSegment: string | undefined): boolean {
  if (!rootSegment) {
    // Empty segments array → expo-router is at index. Treat as public; the
    // root index route handles its own redirect based on auth state.
    return true;
  }
  return PUBLIC_TOP_LEVEL_SEGMENTS.has(rootSegment);
}

/**
 * Global owner-authentication gate.
 *
 * - Unauthenticated users on a protected route are redirected to /landing.
 * - Authenticated users sitting on /landing or /login are redirected into /(tabs).
 * - Open-access builds bypass all gating (matches `useAdminGuard`).
 * - Per-route guards (e.g. `useAdminGuard` for /admin) remain in force on top of this.
 */
function AuthGateInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, isLoading } = useAuth();
  const lastRedirectRef = useRef<string | null>(null);

  const rootSegment = segments[0] as string | undefined;
  const isPublic = useMemo(() => isPublicSegment(rootSegment), [rootSegment]);
  const openAccess = isOpenAccessModeEnabled();

  useEffect(() => {
    if (openAccess) {
      return;
    }
    if (isLoading) {
      return;
    }

    const here = segments.join('/') || '<root>';

    if (!isAuthenticated && !isPublic) {
      if (lastRedirectRef.current === `guard:${here}`) {
        return;
      }
      lastRedirectRef.current = `guard:${here}`;
      console.log('[AuthGate] Unauthenticated on protected route — redirecting to /landing | from:', here);
      router.replace(PUBLIC_LANDING_ROUTE);
      return;
    }

    if (isAuthenticated && (rootSegment === 'landing' || rootSegment === 'login')) {
      if (lastRedirectRef.current === `auth:${here}`) {
        return;
      }
      lastRedirectRef.current = `auth:${here}`;
      console.log('[AuthGate] Authenticated user on public auth route — redirecting to /(tabs) | from:', here);
      router.replace(AUTH_HOME_ROUTE);
      return;
    }

    lastRedirectRef.current = null;
  }, [openAccess, isLoading, isAuthenticated, isPublic, rootSegment, segments, router]);

  return <>{children}</>;
}

export const AuthGate = memo(AuthGateInner);
export default AuthGate;
