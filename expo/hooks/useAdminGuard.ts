import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { isAdminRole } from '@/lib/auth-helpers';
import { useAuth } from '@/lib/auth-context';
import { getAdminAccessLockMessage, isOwnerAdminEmail, shouldBlockRoleForAdminAccess } from '@/lib/admin-access-lock';
import { isOpenAccessModeEnabled } from '@/lib/open-access';

let __adminGuardRenderCount = 0;
const ADMIN_AUTH_HYDRATION_GRACE_MS = 3000;

export interface AdminGuardState {
  isAdmin: boolean;
  isVerifying: boolean;
  userId: string | null;
  role: string | null;
  error: string | null;
}

export function useAdminGuard(options?: { redirectOnFail?: boolean; silent?: boolean }): AdminGuardState {
  const router = useRouter();
  const auth = useAuth();
  const deniedOnce = useRef(false);
  const [hydrationGraceActive, setHydrationGraceActive] = useState(true);

  const redirectOnFail = options?.redirectOnFail !== false;
  const silent = !!options?.silent;

  __adminGuardRenderCount += 1;
  if (__adminGuardRenderCount % 25 === 0) {
    console.log('[AdminGuard][render-trace] hook render count:', __adminGuardRenderCount);
  }

  const authUserId = auth.user?.id ?? null;
  const authUserEmail = auth.user?.email ?? null;
  const authUserRoleField = auth.user?.role ?? null;
  const { isOwnerIPAccess, isAdmin: authIsAdmin, isLoading, isAuthenticated, userRole, userId } = auth;

  // A deep link can mount /admin before the persisted Supabase session has
  // finished hydrating back into AuthProvider. During that short window some
  // builds report isLoading=false + isAuthenticated=false for one or more
  // renders. Treat that state as VERIFYING briefly instead of rendering Access
  // denied / scheduling router.back(). This does not grant access: once the
  // grace expires, an unauthenticated user is denied exactly as before.
  useEffect(() => {
    if (isAuthenticated || authUserId || isOwnerIPAccess || authIsAdmin || isOwnerAdminEmail(authUserEmail)) {
      setHydrationGraceActive(false);
      return;
    }
    const timer = setTimeout(() => setHydrationGraceActive(false), ADMIN_AUTH_HYDRATION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [isAuthenticated, authUserId, isOwnerIPAccess, authIsAdmin, authUserEmail]);

  const state = useMemo<AdminGuardState>(() => {
    if (isOpenAccessModeEnabled()) {
      const uid = authUserId ?? userId ?? 'open-access-admin';
      const role = userRole ?? authUserRoleField ?? 'owner';
      return { isAdmin: true, isVerifying: false, userId: uid, role, error: null };
    }

    if (isOwnerIPAccess) {
      const uid = authUserId ?? userId ?? 'owner-ip-access';
      return { isAdmin: true, isVerifying: false, userId: uid, role: 'owner', error: null };
    }

    if (isOwnerAdminEmail(authUserEmail)) {
      const uid = authUserId ?? userId ?? 'owner-email-access';
      const role = userRole || authUserRoleField || 'owner';
      return { isAdmin: true, isVerifying: false, userId: uid, role, error: null };
    }

    const adminLockBlocked = shouldBlockRoleForAdminAccess(userRole, authUserEmail);
    if (adminLockBlocked) {
      return { isAdmin: false, isVerifying: false, userId: authUserId ?? userId ?? null, role: userRole ?? null, error: getAdminAccessLockMessage() };
    }

    if (authIsAdmin || isAdminRole(userRole)) {
      const uid = authUserId ?? userId ?? 'admin-access';
      const role = userRole || authUserRoleField || 'owner';
      return { isAdmin: true, isVerifying: false, userId: uid, role, error: null };
    }

    if (isAuthenticated && authUserId) {
      const resolvedRole = userRole || authUserRoleField || null;
      const ownerIpFallback = authUserId.startsWith('owner-ip-');
      if (ownerIpFallback || isAdminRole(resolvedRole)) {
        const role = ownerIpFallback
          ? (resolvedRole && isAdminRole(resolvedRole) ? resolvedRole : 'owner')
          : (resolvedRole ?? 'owner');
        return { isAdmin: true, isVerifying: false, userId: authUserId, role, error: null };
      }
      return { isAdmin: false, isVerifying: false, userId: authUserId, role: userRole, error: `Access denied. Role "${userRole || authUserRoleField}" is not an admin role.` };
    }

    if (isLoading || hydrationGraceActive) {
      return { isAdmin: false, isVerifying: true, userId: null, role: null, error: null };
    }

    return { isAdmin: false, isVerifying: false, userId: null, role: null, error: 'Not authenticated. Please log in.' };
  }, [isOwnerIPAccess, authIsAdmin, isLoading, isAuthenticated, authUserId, authUserEmail, authUserRoleField, userRole, userId, hydrationGraceActive]);

  useEffect(() => {
    if (state.isAdmin) deniedOnce.current = false;
  }, [state.isAdmin]);

  useEffect(() => {
    if (state.isVerifying || state.isAdmin || deniedOnce.current) return;
    deniedOnce.current = true;

    if (redirectOnFail) {
      const timer = setTimeout(() => {
        if (!silent) {
          Alert.alert(
            'Access Denied',
            state.error ?? 'You do not have admin privileges to view this page.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        } else {
          router.back();
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [state.isVerifying, state.isAdmin, state.error, redirectOnFail, silent, router]);

  return state;
}
