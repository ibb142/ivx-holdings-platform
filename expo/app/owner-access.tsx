import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ShieldCheck,
  KeyRound,
  Wifi,
  ChevronRight,
  CheckCircle2,
  XCircle,
  ScanLine,
  LayoutGrid,
  MessageSquareText,
  LockKeyhole,
  Fingerprint,
  RefreshCw,
  Zap,
  Globe,
  Smartphone,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import IVXBrandIcon from '@/components/IVXBrandIcon';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { validateEmail } from '@/lib/auth-helpers';
import { getPasswordResetRedirectUrl } from '@/lib/auth-password-recovery';
import {
  buildRepairIssueItems,
  fetchOwnerRepairReadiness,
  getOwnerRepairReadiness,
  type OwnerRepairReadiness,
  type RepairIssueItem,
} from '@/lib/owner-repair-readiness';
import {
  getAdminAccessLockFixUpdate,
  getAdminAccessLockHonestStatus,
  getAdminAccessLockMessage,
  getAdminAccessLockNextStep,
  isAdminAccessLocked,
} from '@/lib/admin-access-lock';
import { getOpenAccessModeMessage, isOpenAccessModeEnabled } from '@/lib/open-access';
import {
  fetchOwnerRecoverySmsStatus,
  requestOwnerRecoverySms,
  verifyOwnerRecoverySms,
  type OwnerRecoveryStatus,
} from '@/lib/owner-recovery-sms';

interface AccessRouteCard {
  id: string;
  title: string;
  description: string;
  detail: string;
  cta: string;
  accent: string;
  mode: 'signin' | 'restore' | 'controls';
}

interface QuickActionCard {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  icon: React.ComponentType<{ size: number; color: string }> | React.ComponentType<any>;
  onPress: () => void;
  testID: string;
}

interface NextStepItem {
  id: string;
  title: string;
  detail: string;
}

interface HonestStatusItem {
  id: string;
  label: string;
  value: string;
  tone: string;
}

function buildOwnerLoginRoute(email?: string) {
  const normalizedEmail = email?.trim().toLowerCase() ?? '';
  return {
    pathname: '/login',
    params: {
      ownerMode: '1',
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
    },
  } as const;
}

interface DirectAnswerItem {
  id: string;
  title: string;
  detail: string;
}

const ACCESS_ROUTES: AccessRouteCard[] = [
  {
    id: 'owner-session',
    title: '1. Owner session',
    description: 'Use your verified owner email and password for full app access.',
    detail: 'Best for daily use, write actions, admin approvals, and deploy-authorized operations. No public signup is required for existing owner recovery.',
    cta: 'Open full app',
    accent: '#FFD700',
    mode: 'signin',
  },
  {
    id: 'trusted-restore',
    title: '2. Trusted device restore',
    description: 'Restore owner access instantly on the previously verified network/device.',
    detail: 'Works with carrier subnet matching — your mobile IP can change within the same network range.',
    cta: 'Restore trusted access',
    accent: '#00C48C',
    mode: 'restore',
  },
  {
    id: 'owner-controls',
    title: '3. Owner controls',
    description: 'Open Admin > Owner Controls to verify, rotate, or refresh your trusted device.',
    detail: 'Use this to keep owner recovery under your control and re-verify your current network.',
    cta: 'Open owner controls',
    accent: '#4A90D9',
    mode: 'controls',
  },
];

function formatAuthoritySource(source: string | null | undefined): string {
  switch (source) {
    case 'profiles':
      return 'Profiles table';
    case 'rpc_get_user_role':
      return 'get_user_role RPC';
    case 'rpc_verify_admin_access':
      return 'verify_admin_access RPC';
    case 'trusted_device':
      return 'Trusted-device fallback';
    case 'owner_ip_access':
      return 'Trusted owner session';
    case 'local_session':
      return 'Local session state';
    case 'not_authenticated':
      return 'No active session';
    case 'fallback':
      return 'Fallback';
    default:
      return 'Unknown source';
  }
}

function formatIdentityVerdict(status: string | null | undefined): string {
  switch (status) {
    case 'verified_owner_authority':
      return 'Verified owner authority';
    case 'trusted_device_owner_authority':
      return 'Trusted-device owner authority';
    case 'normal_user_account':
      return 'Normal user account only';
    case 'email_mismatch':
      return 'Email mismatch';
    default:
      return 'Unverified';
  }
}

export default function OwnerAccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; source?: string }>();
  const auth = useAuth();
  const openAccessMode = isOpenAccessModeEnabled();
  const openAccessRedirectedRef = React.useRef(false);
  const ownerAutoRedirectRef = React.useRef(false);
  const openAccessMessage = getOpenAccessModeMessage();
  const adminAccessLocked = isAdminAccessLocked();
  const adminAccessLockMessage = getAdminAccessLockMessage();
  const adminAccessLockHonestStatus = getAdminAccessLockHonestStatus();
  const adminAccessLockFixUpdate = getAdminAccessLockFixUpdate();
  const adminAccessLockNextStep = getAdminAccessLockNextStep();

  const carriedEmail = useMemo(() => {
    const rawEmail = typeof params.email === 'string' ? params.email.trim().toLowerCase() : '';
    return rawEmail;
  }, [params.email]);

  React.useEffect(() => {
    if (!openAccessMode || openAccessRedirectedRef.current) {
      return;
    }

    openAccessRedirectedRef.current = true;
    console.log('[OwnerAccessHub] Open access mode active — bypassing owner access screen');
    router.replace('/(tabs)/(home)/home' as any);
  }, [openAccessMode, router]);

  // Owner must never get stuck on this hub. If we already have an authenticated
  // owner/admin session (or trusted owner-IP access), send them straight to the
  // full app Home with all 6 bottom tabs. Owner Controls / Admin Panel remain
  // reachable from Profile → Admin Panel — they are no longer the landing page.
  React.useEffect(() => {
    if (ownerAutoRedirectRef.current) {
      return;
    }
    if (params.source === 'login-failure' || params.source === 'owner-recovery') {
      return;
    }
    const hasOwnerSession =
      (auth.isAuthenticated && auth.isAdmin) || auth.isOwnerIPAccess === true;
    if (!hasOwnerSession) {
      return;
    }
    ownerAutoRedirectRef.current = true;
    console.log('[OwnerAccessHub] Authenticated owner detected — redirecting to full app /(tabs)', {
      isAuthenticated: auth.isAuthenticated,
      isAdmin: auth.isAdmin,
      isOwnerIPAccess: auth.isOwnerIPAccess,
      userRole: auth.userRole,
      email: auth.user?.email ?? null,
    });
    router.replace('/(tabs)/(home)/home' as any);
  }, [
    auth.isAuthenticated,
    auth.isAdmin,
    auth.isOwnerIPAccess,
    auth.userRole,
    auth.user?.email,
    params.source,
    router,
  ]);
  const recoverySource = typeof params.source === 'string' ? params.source : 'direct';
  const requestedOwnerEmail = useMemo(() => carriedEmail || auth.user?.email || '', [auth.user?.email, carriedEmail]);

  const ownerAuditQuery = useQuery({
    queryKey: ['owner-access-audit-hub', requestedOwnerEmail],
    queryFn: () => auth.auditOwnerDirectAccess(requestedOwnerEmail || undefined),
    staleTime: 10000,
    refetchOnWindowFocus: true,
    enabled: !openAccessMode,
  });
  const ownerIdentityAuditQuery = useQuery({
    queryKey: ['owner-identity-audit-hub', requestedOwnerEmail, auth.user?.id ?? 'anon', auth.userRole, auth.isOwnerIPAccess],
    queryFn: () => auth.auditOwnerIdentity(requestedOwnerEmail || undefined),
    staleTime: 10000,
    refetchOnWindowFocus: true,
    enabled: !openAccessMode,
  });
  const effectiveOwnerEmail = useMemo(() => {
    if (ownerAuditQuery.data?.emailMismatch && ownerAuditQuery.data.verifiedEmail) {
      return ownerAuditQuery.data.verifiedEmail;
    }
    return requestedOwnerEmail;
  }, [ownerAuditQuery.data?.emailMismatch, ownerAuditQuery.data?.verifiedEmail, requestedOwnerEmail]);

  const ownerRestoreMutation = useMutation({
    mutationFn: () => auth.ownerDirectAccess(effectiveOwnerEmail || undefined),
    onSuccess: (result) => {
      console.log('[OwnerAccessHub] Trusted owner restore result:', result.success, result.message);
      if (result.success) {
        void ownerAuditQuery.refetch();
        void ownerIdentityAuditQuery.refetch();
        router.replace('/(tabs)/(home)/home' as any);
        return;
      }
      Alert.alert('Trusted Access Blocked', result.message);
    },
    onError: (error: Error) => {
      console.log('[OwnerAccessHub] Trusted owner restore error:', error.message);
      Alert.alert('Trusted Access Blocked', error.message);
    },
  });

  const forceVerifyMutation = useMutation({
    mutationFn: () => auth.activateOwnerAccess(effectiveOwnerEmail || undefined),
    onSuccess: (result) => {
      console.log('[OwnerAccessHub] Force verify result:', result.success, result.message);
      if (result.success) {
        void ownerAuditQuery.refetch();
        void ownerIdentityAuditQuery.refetch();
        Alert.alert('Device Verified', result.message + '\n\nYour current network is now the trusted owner network. Trusted restore will work from here.');
      } else {
        Alert.alert('Verification Failed', result.message);
      }
    },
    onError: (error: Error) => {
      Alert.alert('Verification Failed', error.message);
    },
  });

  const claimOwnerMutation = useMutation({
    mutationFn: async () => {
      const ownerEmail = effectiveOwnerEmail || auth.user?.email || '';
      console.log('[OwnerAccessHub] Claiming owner device for:', ownerEmail);
      const result = await auth.claimOwnerDevice(ownerEmail);
      if (!result.success) {
        throw new Error(result.message);
      }
      return result;
    },
    onSuccess: (result) => {
      console.log('[OwnerAccessHub] Owner device claimed:', result.message);
      void ownerAuditQuery.refetch();
      void ownerIdentityAuditQuery.refetch();
      Alert.alert(
        'Trusted Device Verified',
        result.message + '\n\nThis device is now registered for trusted owner recovery.',
        [{ text: 'Open Full App', onPress: () => router.replace('/(tabs)/(home)/home' as any) }]
      );
    },
    onError: (error: Error) => {
      Alert.alert('Claim Failed', error.message);
    },
  });

  // ── Owner login recovery via AWS SNS SMS (secondary access path) ──
  const [recoverySmsStatus, setRecoverySmsStatus] = React.useState<OwnerRecoveryStatus | null>(null);
  const [recoverySmsCode, setRecoverySmsCode] = React.useState('');
  const [recoverySmsNewPassword, setRecoverySmsNewPassword] = React.useState('');
  const [recoverySmsRequested, setRecoverySmsRequested] = React.useState(false);

  const recoverySmsStatusQuery = useQuery({
    queryKey: ['owner-recovery-sms-status'],
    queryFn: () => fetchOwnerRecoverySmsStatus(),
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  React.useEffect(() => {
    if (recoverySmsStatusQuery.data) {
      setRecoverySmsStatus(recoverySmsStatusQuery.data);
    }
  }, [recoverySmsStatusQuery.data]);

  const recoverySmsRequestMutation = useMutation({
    mutationFn: () => requestOwnerRecoverySms(effectiveOwnerEmail || auth.user?.email || ''),
    onSuccess: (result) => {
      if (result.ok) {
        setRecoverySmsRequested(true);
        Alert.alert(
          'Recovery Code Sent',
          `A 6-digit code was texted to ${result.phoneMasked ?? 'your owner phone'}. It expires in ${result.codeTtlSeconds ?? 300} seconds. Enter it below to restore access.`,
        );
      } else {
        setRecoverySmsRequested(false);
        Alert.alert('Recovery SMS Failed', result.message);
      }
    },
    onError: (error: Error) => {
      setRecoverySmsRequested(false);
      Alert.alert('Recovery SMS Failed', error.message);
    },
  });

  const recoverySmsVerifyMutation = useMutation({
    mutationFn: () => verifyOwnerRecoverySms(
      effectiveOwnerEmail || auth.user?.email || '',
      recoverySmsCode.trim(),
      recoverySmsNewPassword.trim() || undefined,
    ),
    onSuccess: (result) => {
      if (result.ok) {
        setRecoverySmsCode('');
        setRecoverySmsNewPassword('');
        setRecoverySmsRequested(false);
        if (result.passwordRepaired) {
          Alert.alert(
            'Owner Access Restored',
            'Your owner password was reset to the value you entered. Sign in now with your owner email and the new password.',
            [{ text: 'Sign In Now', onPress: () => router.push(buildOwnerLoginRoute(effectiveOwnerEmail) as any) }],
          );
        } else {
          Alert.alert(
            'Recovery Code Verified',
            'Your owner identity was verified via SMS. Use the recovery token to complete profile/wallet repair if needed.',
            [{ text: 'Open Sign In', onPress: () => router.push(buildOwnerLoginRoute(effectiveOwnerEmail) as any) }],
          );
        }
      } else {
        Alert.alert('Verification Failed', result.message);
      }
    },
    onError: (error: Error) => {
      Alert.alert('Verification Failed', error.message);
    },
  });

  const recoverySmsReady = recoverySmsStatus?.ready === true;
  const recoverySmsEnabled = Boolean(effectiveOwnerEmail || auth.user?.email) && recoverySmsReady;

  const ownerPasswordResetMutation = useMutation({
    mutationFn: async () => {
      const targetEmail = effectiveOwnerEmail || auth.user?.email || '';
      const normalizedEmail = targetEmail.trim().toLowerCase();
      if (!validateEmail(normalizedEmail)) {
        throw new Error('A valid owner email is required before sending a password reset link.');
      }
      const redirectTo = getPasswordResetRedirectUrl();
      console.log('[OwnerAccessHub] Sending owner password reset to:', normalizedEmail, 'redirect:', redirectTo);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo,
        });
        if (error) {
          throw new Error(error.message || 'Failed to send password reset email.');
        }
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : String(err ?? '');
        // Supabase still delivers the reset email even when the SDK throws a
        // redirect-URL parse error like "1:4: ';' expected". Treat that as soft
        // success so the owner is not blocked by a scary dialog on device.
        const looksLikeParseError = /^\d+:\d+:/.test(raw) || /SyntaxError|Unexpected token|expected/i.test(raw);
        if (!looksLikeParseError) {
          throw err instanceof Error ? err : new Error(raw || 'Failed to send password reset email.');
        }
        console.log('[OwnerAccessHub] Soft-success: ignoring parse error after reset email sent:', raw);
      }
      return normalizedEmail;
    },
    onSuccess: (normalizedEmail) => {
      Alert.alert('Reset Link Sent', `A password reset link was sent to ${normalizedEmail}. After resetting your password once, come back here and trusted restore can be re-enabled from Owner Controls.`);
    },
    onError: (error: Error) => {
      const raw = error.message || '';
      const looksLikeParseError = /^\d+:\d+:/.test(raw) || /SyntaxError|Unexpected token|expected/i.test(raw);
      if (looksLikeParseError) {
        Alert.alert('Reset Link Sent', 'The reset email is on the way. Open the link in your inbox (or spam folder), pick a new password, then come back and sign in.');
        return;
      }
      Alert.alert('Reset Failed', raw || 'Could not send the reset email right now. Please try again in a minute.');
    },
  });

  const hasLiveOwnerControl = auth.isAuthenticated && auth.isAdmin;
  const audit = ownerAuditQuery.data;
  const identityAudit = ownerIdentityAuditQuery.data;
  const trustedReady = audit?.eligible ?? false;
  const trustedIdentity = audit?.currentIP ?? auth.detectedIP ?? 'Detecting…';
  const verifiedIdentity = audit?.storedIP ?? 'Not stored';
  const subnetMatch = useMemo(() => {
    if (!audit?.currentIP || !audit?.storedIP) return false;
    if (audit.currentIP === audit.storedIP) return true;
    const currentParts = audit.currentIP.split('.');
    const storedParts = audit.storedIP.split('.');
    return currentParts.length === 4 && storedParts.length === 4 &&
      currentParts[0] === storedParts[0] && currentParts[1] === storedParts[1];
  }, [audit?.currentIP, audit?.storedIP]);

  const ownerSessionState = hasLiveOwnerControl
    ? `Live · ${auth.userRole}`
    : auth.isAuthenticated
      ? `Signed in · ${auth.userRole}`
      : 'Not active';
  const ownerSigninCta = auth.isAuthenticated ? 'Open full app' : effectiveOwnerEmail ? 'Sign in with owner email' : 'Open sign in';
  const ownerSigninDetail = auth.isAuthenticated
    ? 'Your owner session is already active. Open the full app now.'
    : audit?.emailMismatch && audit.verifiedEmail
      ? `Use ${audit.verifiedEmail} on the sign-in screen. The carried email did not match the verified owner authority saved on this device.`
      : effectiveOwnerEmail
        ? `Use ${effectiveOwnerEmail} on the sign-in screen. No new signup is needed.`
        : 'Use your verified owner email and password. No new signup is needed.';
  const ownerSigninDescription = auth.isAuthenticated
    ? 'Your verified owner session is already active for full app access.'
    : audit?.emailMismatch
      ? 'Use the verified owner email saved on this trusted device for full app access.'
      : 'Use your verified owner email and password for full app access.';
  const ownerSessionTone = hasLiveOwnerControl
    ? Colors.success
    : auth.isAuthenticated
      ? Colors.warning
      : '#FF4D4D';

  const trustedStatusText = trustedReady
    ? 'Ready now'
    : audit?.emailMismatch
      ? 'Email mismatch'
      : subnetMatch
        ? 'Subnet match'
        : audit?.ownerDeviceVerified
          ? 'IP changed'
          : 'Not verified';
  const trustedStatusColor = trustedReady
    ? Colors.success
    : audit?.emailMismatch
      ? '#FF4D4D'
      : subnetMatch
        ? '#F59E0B'
        : '#FF4D4D';
  const ownerRepairReadinessQuery = useQuery<OwnerRepairReadiness>({
    queryKey: ['owner-repair-readiness'],
    queryFn: fetchOwnerRepairReadiness,
    staleTime: 60000,
    enabled: !openAccessMode,
  });
  const ownerRepairReadiness = ownerRepairReadinessQuery.data ?? getOwnerRepairReadiness();
  const repairIssueItems = useMemo<RepairIssueItem[]>(() => buildRepairIssueItems(ownerRepairReadiness), [ownerRepairReadiness]);
  const criticalRepairIssues = useMemo<RepairIssueItem[]>(() => repairIssueItems.filter((item) => item.tone === 'critical'), [repairIssueItems]);
  const warningRepairIssues = useMemo<RepairIssueItem[]>(() => repairIssueItems.filter((item) => item.tone === 'warning'), [repairIssueItems]);
  const successRepairIssues = useMemo<RepairIssueItem[]>(() => repairIssueItems.filter((item) => item.tone === 'success'), [repairIssueItems]);

  const handleRoutePress = useCallback((mode: AccessRouteCard['mode']) => {
    console.log('[OwnerAccessHub] Route requested:', mode, 'auth:', auth.isAuthenticated, 'role:', auth.userRole);
    if (mode === 'signin') {
      if (auth.isAuthenticated) {
        router.replace('/(tabs)/(home)/home' as any);
        return;
      }
      router.push(buildOwnerLoginRoute(effectiveOwnerEmail) as any);
      return;
    }

    if (mode === 'restore') {
      ownerRestoreMutation.mutate();
      return;
    }

    if (hasLiveOwnerControl) {
      router.push('/admin/owner-controls' as any);
      return;
    }

    Alert.alert('Owner Controls Require Verified Owner Sign In', 'Sign in with your verified owner account, then open Admin > Owner Controls.');
    router.push(buildOwnerLoginRoute(carriedEmail) as any);
  }, [auth.isAuthenticated, auth.userRole, effectiveOwnerEmail, hasLiveOwnerControl, ownerRestoreMutation, router]);

  const handleForceVerify = useCallback(() => {
    if (!auth.isAuthenticated) {
      Alert.alert(
        'Sign In Required',
        'You must sign in with your owner account first to verify this device.\n\nAfter verifying, trusted restore will work without signing in.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign In',
            onPress: () => router.push(buildOwnerLoginRoute(effectiveOwnerEmail) as any),
          },
        ]
      );
      return;
    }

    if (!auth.isAdmin) {
      Alert.alert('Access Denied', 'Only admin/owner accounts can verify trusted devices.');
      return;
    }

    Alert.alert(
      'Verify This Device',
      `This will register your current network (${trustedIdentity}) as the trusted owner device.\n\nAfter this, trusted restore will work even when you're not signed in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Verify Now', onPress: () => forceVerifyMutation.mutate() },
      ]
    );
  }, [auth.isAuthenticated, auth.isAdmin, effectiveOwnerEmail, trustedIdentity, forceVerifyMutation, router]);

  const handleClaimOwnerPress = useCallback(() => {
    if (!auth.isAuthenticated) {
      router.push(buildOwnerLoginRoute(effectiveOwnerEmail) as any);
      return;
    }

    if (!auth.isAdmin) {
      Alert.alert('Owner Sign-In Required', 'Sign in with your verified owner account, then verify this device in Owner Controls.');
      return;
    }

    Alert.alert(
      'Verify This Device',
      `This will register your current network (${trustedIdentity}) as the trusted owner device after your verified owner sign-in.\n\nTrusted restore will work from this device next time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Verify Now', onPress: () => claimOwnerMutation.mutate() },
      ]
    );
  }, [auth.isAdmin, auth.isAuthenticated, effectiveOwnerEmail, claimOwnerMutation, router, trustedIdentity]);

  const quickActions = useMemo<QuickActionCard[]>(() => {
    if (!hasLiveOwnerControl && !auth.isOwnerIPAccess) {
      return [];
    }

    return [
      {
        id: 'full-app',
        title: 'Open full app',
        subtitle: 'Dashboard, deals, members, and live modules',
        accent: Colors.primary,
        icon: LayoutGrid,
        onPress: () => router.replace('/(tabs)/(home)/home' as any),
        testID: 'owner-access-open-full-app',
      },
      {
        id: 'admin-hq',
        title: 'Open Admin HQ',
        subtitle: 'Owner-grade admin access and project controls',
        accent: '#00C48C',
        icon: ShieldCheck,
        onPress: () => router.push('/admin' as any),
        testID: 'owner-access-open-admin-hq',
      },
      {
        id: 'ivx-owner-room',
        title: 'Open IVX Owner room',
        subtitle: 'Live shared owner AI chat and backend capability proof',
        accent: '#FF9F43',
        icon: MessageSquareText,
        onPress: () => router.push('/ivx/chat' as any),
        testID: 'owner-access-open-ivx-owner-room',
      },
      {
        id: 'deploy-proof',
        title: 'Open deploy proof',
        subtitle: 'GitHub, AWS, and landing pipeline diagnostics',
        accent: '#38BDF8',
        icon: ScanLine,
        onPress: () => router.push('/admin/sync-diagnostics' as any),
        testID: 'owner-access-open-deploy-proof',
      },
      {
        id: 'owner-controls',
        title: 'Open Owner Controls',
        subtitle: 'Verify or rotate trusted device access',
        accent: '#4A90D9',
        icon: IVXBrandIcon,
        onPress: () => router.push('/admin/owner-controls' as any),
        testID: 'owner-access-open-owner-controls',
      },
    ];
  }, [auth.isOwnerIPAccess, hasLiveOwnerControl, router]);

  const identityVerdictTone = identityAudit?.status === 'verified_owner_authority' || identityAudit?.status === 'trusted_device_owner_authority'
    ? Colors.success
    : identityAudit?.status === 'normal_user_account'
      ? '#F59E0B'
      : '#FF4D4D';
  const overallHealthy = hasLiveOwnerControl || auth.isOwnerIPAccess || trustedReady;
  const lockUpdateItems = useMemo<DirectAnswerItem[]>(() => {
    return [
      {
        id: 'fix-update',
        title: 'What is already in place',
        detail: adminAccessLockFixUpdate,
      },
      {
        id: 'honest-lock-status',
        title: 'What is still blocking you',
        detail: adminAccessLockHonestStatus,
      },
      {
        id: 'next-step',
        title: 'What must happen next',
        detail: adminAccessLockNextStep,
      },
    ];
  }, [adminAccessLockFixUpdate, adminAccessLockHonestStatus, adminAccessLockNextStep]);
  const directAnswerItems = useMemo<DirectAnswerItem[]>(() => {
    const resetTargetLabel = effectiveOwnerEmail || 'your verified owner email';

    return [
      {
        id: 'service-role-answer',
        title: 'Why the server repair key came up',
        detail: ownerRepairReadiness.hasRealServiceRole
          ? 'That key is only for backend-only inspection or repair of an existing owner auth user. Your normal owner email/password sign-in still stays separate.'
          : 'That key is only for backend-only inspection or repair of an existing owner auth user. It did not cause the password rejection on this screen.',
      },
      {
        id: 'remove-login-answer',
        title: 'Why admin login is not removed',
        detail: 'The app cannot safely drop owner verification on a new or untrusted device. Full admin access still requires either a verified owner sign-in or a previously trusted-device restore.',
      },
      {
        id: 'fastest-path-answer',
        title: 'Fastest safe path now',
        detail: trustedReady
          ? 'This device is already trusted. Use restore now and you can open the full app immediately.'
          : `If the current password is wrong or unknown, send a reset link to ${resetTargetLabel}, set a new password, sign in once, then verify this device again.`,
      },
    ];
  }, [effectiveOwnerEmail, ownerRepairReadiness.hasRealServiceRole, trustedReady]);

  const honestStatusItems = useMemo<HonestStatusItem[]>(() => {
    const ownerEmailValue = carriedEmail
      ? `Carried from ${recoverySource}: ${carriedEmail}`
      : auth.user?.email
        ? `Signed-in session: ${auth.user.email}`
        : 'No owner email was carried into this screen yet. Open Owner Login with your owner email first.';
    const signinValue = hasLiveOwnerControl
      ? 'Signed in and verified'
      : auth.isAuthenticated
        ? 'Signed in, but not owner-verified yet'
        : 'Not signed in';
    const trustedValue = trustedReady
      ? 'Trusted restore is available now'
      : audit?.emailMismatch && audit.verifiedEmail
        ? `The carried email does not match the verified owner email saved on this device (${audit.verifiedEmail}).`
        : audit?.ownerDeviceVerified
          ? 'This device was verified before, but current restore conditions are not passing'
          : 'This device has not been verified for trusted restore yet';
    const nextActionValue = trustedReady
      ? 'Tap Restore trusted access below'
      : audit?.emailMismatch && audit.verifiedEmail
        ? `Use ${audit.verifiedEmail} on Sign In, or sign in live and verify this device again.`
        : auth.isAuthenticated && auth.isAdmin
          ? 'Tap Verify this device now'
          : !ownerRepairReadiness.hasRealServiceRole
            ? 'Your normal owner sign-in does not use the server repair key. If the real password is unknown or keeps getting rejected, use password reset now because backend admin repair stays unavailable until the server service-role key is real and different from anon.'
            : 'Use your owner email and password once, then verify this device in Owner Controls';

    return [
      {
        id: 'owner-email',
        label: 'Email evidence',
        value: ownerEmailValue,
        tone: carriedEmail || auth.user?.email ? Colors.primary : '#F59E0B',
      },
      {
        id: 'signin-state',
        label: 'Sign-in state',
        value: signinValue,
        tone: hasLiveOwnerControl ? Colors.success : auth.isAuthenticated ? '#F59E0B' : '#FF4D4D',
      },
      {
        id: 'trusted-state',
        label: 'Trusted restore',
        value: trustedValue,
        tone: trustedReady ? Colors.success : audit?.ownerDeviceVerified ? '#F59E0B' : '#FF4D4D',
      },
      {
        id: 'next-action',
        label: 'Exact next action',
        value: nextActionValue,
        tone: Colors.text,
      },
    ];
  }, [audit?.emailMismatch, audit?.ownerDeviceVerified, audit?.verifiedEmail, auth.isAdmin, auth.isAuthenticated, auth.user?.email, carriedEmail, hasLiveOwnerControl, ownerRepairReadiness.hasRealServiceRole, recoverySource, trustedReady]);

  const identityEvidenceItems = useMemo<HonestStatusItem[]>(() => {
    if (!identityAudit) {
      return [];
    }

    const authenticatedAuthorityValue = identityAudit.authenticatedEmail
      ? `${identityAudit.authenticatedRole || 'unknown'} via ${formatAuthoritySource(identityAudit.authenticatedRoleSource)}`
      : 'No active authenticated session';
    const trustedAuthorityValue = identityAudit.trustedDeviceVerified
      ? `${identityAudit.trustedDeviceVerifiedRole || 'unknown'} · ${identityAudit.trustedDeviceWindowActive ? 'window active' : 'window expired'}`
      : 'No trusted-device owner verification saved';

    return [
      {
        id: 'identity-requested-email',
        label: 'Audited email',
        value: identityAudit.requestedEmail || 'Missing',
        tone: identityAudit.requestedEmail ? Colors.primary : '#F59E0B',
      },
      {
        id: 'identity-authenticated-email',
        label: 'Authenticated session email',
        value: identityAudit.authenticatedEmail || 'No active session',
        tone: identityAudit.matchesAuthenticatedEmail ? Colors.success : identityAudit.authenticatedEmail ? '#F59E0B' : '#FF4D4D',
      },
      {
        id: 'identity-authenticated-authority',
        label: 'Authenticated authority',
        value: authenticatedAuthorityValue,
        tone: identityAudit.authenticatedAuthorityIsAdmin ? Colors.success : identityAudit.authenticatedEmail ? '#F59E0B' : '#FF4D4D',
      },
      {
        id: 'identity-trusted-email',
        label: 'Trusted-device owner email',
        value: identityAudit.trustedDeviceVerifiedEmail || 'Missing',
        tone: identityAudit.matchesTrustedDeviceEmail ? Colors.success : identityAudit.trustedDeviceVerifiedEmail ? '#F59E0B' : '#FF4D4D',
      },
      {
        id: 'identity-trusted-authority',
        label: 'Trusted-device authority',
        value: trustedAuthorityValue,
        tone: identityAudit.trustedDeviceAuthorityIsAdmin ? Colors.success : identityAudit.trustedDeviceVerified ? '#F59E0B' : '#FF4D4D',
      },
      {
        id: 'identity-verdict',
        label: 'Identity verdict',
        value: formatIdentityVerdict(identityAudit.status),
        tone: identityVerdictTone,
      },
    ];
  }, [identityAudit, identityVerdictTone]);

  const auditEvidenceItems = useMemo<HonestStatusItem[]>(() => {
    if (!audit) {
      return [];
    }

    const verifiedAtValue = audit.verifiedAt
      ? new Date(audit.verifiedAt).toLocaleString()
      : 'Missing';

    return [
      {
        id: 'carried-email',
        label: 'Carried email',
        value: carriedEmail || 'None',
        tone: carriedEmail ? Colors.primary : '#F59E0B',
      },
      {
        id: 'session-email',
        label: 'Authenticated email',
        value: auth.user?.email || 'No active authenticated session email',
        tone: auth.user?.email ? Colors.primary : '#F59E0B',
      },
      {
        id: 'verified-email',
        label: 'Verified owner email',
        value: audit.verifiedEmail || 'Missing',
        tone: audit.verifiedEmail ? Colors.success : '#F59E0B',
      },
      {
        id: 'email-check',
        label: 'Email authority check',
        value: audit.emailCheckPassed ? 'Pass' : 'Mismatch',
        tone: audit.emailCheckPassed ? Colors.success : '#FF4D4D',
      },
      {
        id: 'trusted-mode',
        label: 'Trusted mode',
        value: audit.ipEnabled ? 'Enabled' : 'Disabled',
        tone: audit.ipEnabled ? Colors.success : '#FF4D4D',
      },
      {
        id: 'device-verified',
        label: 'Device verified',
        value: audit.ownerDeviceVerified ? 'Yes' : 'No',
        tone: audit.ownerDeviceVerified ? Colors.success : '#FF4D4D',
      },
      {
        id: 'verified-user-id',
        label: 'Verified owner id',
        value: audit.verifiedUserId || 'Missing',
        tone: audit.hasValidTrustedIdentity ? Colors.success : '#FF4D4D',
      },
      {
        id: 'verified-role',
        label: 'Verified role',
        value: audit.verifiedRole || 'Missing',
        tone: audit.verifiedRole ? Colors.primary : '#FF4D4D',
      },
      {
        id: 'verified-at',
        label: 'Verified at',
        value: verifiedAtValue,
        tone: audit.trustedDeviceWindowActive ? Colors.success : '#F59E0B',
      },
      {
        id: 'exact-match',
        label: 'Exact network match',
        value: audit.exactIPMatch ? 'Pass' : 'No',
        tone: audit.exactIPMatch ? Colors.success : '#FF4D4D',
      },
      {
        id: 'subnet-match',
        label: 'Carrier subnet match',
        value: audit.subnetMatch ? 'Pass' : 'No',
        tone: audit.subnetMatch ? Colors.success : '#F59E0B',
      },
      {
        id: 'access-path',
        label: 'Restore path',
        value: audit.accessPath,
        tone: audit.eligible ? Colors.success : Colors.textSecondary,
      },
    ];
  }, [audit, auth.user?.email, carriedEmail]);

  const auditBlockers = useMemo<string[]>(() => {
    if (!audit || audit.eligible) {
      return [];
    }

    return audit.blockingReasons.length > 0 ? audit.blockingReasons : [audit.message];
  }, [audit]);

  const nextSteps = useMemo<NextStepItem[]>(() => {
    if (adminAccessLocked) {
      return [
        {
          id: 'owner-only-lock',
          title: 'Owner-only admin lock is active',
          detail: adminAccessLockMessage,
        },
        {
          id: 'use-owner-email',
          title: effectiveOwnerEmail ? `Use ${effectiveOwnerEmail} on Sign In` : 'Use your configured owner email on Sign In',
          detail: 'This temporary lock only allows the configured owner email to keep admin access while testing.',
        },
      ];
    }

    if (hasLiveOwnerControl) {
      return [
        {
          id: 'open-app',
          title: 'Open Full App',
          detail: 'Your owner session is already live. Use the command center below.',
        },
        {
          id: 'verify-device',
          title: audit?.ownerDeviceVerified ? 'Trusted device already verified' : 'Verify this device once',
          detail: audit?.ownerDeviceVerified
            ? 'Trusted restore is tied to this verified device/network.'
            : 'Open Owner Controls and verify this phone/network so future owner recovery works without login.',
        },
      ];
    }

    if (trustedReady) {
      return [
        {
          id: 'restore-now',
          title: 'Tap Restore trusted access',
          detail: 'This device/network is already recognized for owner recovery.',
        },
        {
          id: 'open-modules',
          title: 'Then open Admin HQ or Full App',
          detail: 'Once restored, all owner modules will be available again.',
        },
      ];
    }

    if (audit?.emailMismatch && audit.verifiedEmail) {
      return [
        {
          id: 'use-verified-email',
          title: `Use ${audit.verifiedEmail} on Sign In`,
          detail: 'The carried email does not match the trusted owner authority saved on this device.',
        },
        {
          id: 'reverify-after-login',
          title: 'After sign-in, verify this device again if needed',
          detail: 'That keeps the trusted-device authority aligned to the real owner account you control.',
        },
      ];
    }

    return [
      {
        id: 'signin-owner',
        title: effectiveOwnerEmail ? `Use ${effectiveOwnerEmail} + your owner password` : 'Use your owner email + password',
        detail: 'Owner access starts with your existing sign-in. Do not create a new public account.',
      },
      {
        id: 'verify-after-login',
        title: 'After sign-in, verify this device in Owner Controls',
        detail: 'That saves this phone/network for trusted owner recovery next time.',
      },
    ];
  }, [adminAccessLockMessage, adminAccessLocked, audit?.emailMismatch, audit?.ownerDeviceVerified, audit?.verifiedEmail, effectiveOwnerEmail, hasLiveOwnerControl, trustedReady]);

  if (openAccessMode) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} testID="owner-access-screen">
          <View style={[styles.heroCard, styles.heroCardActive]}>
            <View style={[styles.heroIconWrap, { backgroundColor: '#00C48C' }]}>
              <ShieldCheck size={22} color="#000" />
            </View>
            <Text style={styles.eyebrow}>OPEN ACCESS ACTIVE</Text>
            <Text style={styles.title}>Owner gate is bypassed</Text>
            <Text style={styles.subtitle}>{openAccessMessage}</Text>
          </View>

          <View style={styles.directAnswerCard} testID="owner-access-open-access-card">
            <Text style={styles.directAnswerTitle}>Direct access</Text>
            <Text style={styles.directAnswerSubtitle}>This build no longer needs the owner recovery flow before opening the project.</Text>
            <View style={styles.directAnswerList}>
              <View style={styles.directAnswerRow}>
                <View style={styles.directAnswerIndexWrap}>
                  <Text style={styles.directAnswerIndex}>1</Text>
                </View>
                <View style={styles.directAnswerBody}>
                  <Text style={styles.directAnswerRowTitle}>Open the workspace now</Text>
                  <Text style={styles.directAnswerRowDetail}>The app bypasses login and owner-only gating while emergency access recovery stays enabled.</Text>
                </View>
              </View>
              <View style={styles.directAnswerRow}>
                <View style={styles.directAnswerIndexWrap}>
                  <Text style={styles.directAnswerIndex}>2</Text>
                </View>
                <View style={styles.directAnswerBody}>
                  <Text style={styles.directAnswerRowTitle}>Admin routes stay open</Text>
                  <Text style={styles.directAnswerRowDetail}>You can open Admin directly in this build without waiting on trusted-device or password recovery checks.</Text>
                </View>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primarySigninCard}
            activeOpacity={0.84}
            onPress={() => router.replace('/(tabs)/(home)/home' as any)}
            testID="owner-access-open-app-direct"
          >
            <View style={styles.primarySigninIconWrap}>
              <LayoutGrid size={18} color={Colors.black} />
            </View>
            <View style={styles.primarySigninBody}>
              <Text style={styles.primarySigninTitle}>Open full app</Text>
              <Text style={styles.primarySigninSubtitle}>Go straight into the workspace with no owner login step.</Text>
            </View>
            <ChevronRight size={18} color={Colors.black} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.verifyDeviceCard}
            activeOpacity={0.82}
            onPress={() => router.replace('/admin' as any)}
            testID="owner-access-open-admin-direct"
          >
            <View style={styles.verifyIconWrap}>
              <IVXBrandIcon size={20} />
            </View>
            <View style={styles.verifyBody}>
              <Text style={styles.verifyTitle}>Open Admin HQ</Text>
              <Text style={styles.verifySubtitle}>Admin modules are available directly while the emergency open-access build is active.</Text>
            </View>
            <ChevronRight size={18} color="#FFD700" />
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} testID="owner-access-screen">
        <View style={[styles.heroCard, overallHealthy && styles.heroCardActive]}>
          <View style={[styles.heroIconWrap, overallHealthy && { backgroundColor: '#00C48C' }]}>
            {overallHealthy ? <CheckCircle2 size={22} color="#000" /> : <ScanLine size={22} color={Colors.black} />}
          </View>
          <Text style={styles.eyebrow}>{overallHealthy ? 'OWNER ACTIVE' : 'OWNER ACCESS'}</Text>
          <Text style={styles.title}>
            {overallHealthy ? 'You have full project control' : 'Three safe ways to access your project'}
          </Text>
          <Text style={styles.subtitle}>
            {overallHealthy
              ? 'Your VIP owner session is live. All admin, deploy, and write paths are available.'
              : 'You do not need public signup for owner access. Use your verified owner sign-in, trusted-device restore, or Owner Controls to recover access safely.'}
          </Text>
        </View>

        {adminAccessLocked ? (
          <>
            <View style={styles.lockCard} testID="owner-access-owner-only-lock-card">
              <View style={styles.lockIconWrap}>
                <LockKeyhole size={18} color={Colors.error} />
              </View>
              <View style={styles.lockBody}>
                <Text style={styles.lockTitle}>Owner-only admin lock is active</Text>
                <Text style={styles.lockText}>{adminAccessLockMessage}</Text>
              </View>
            </View>

            <View style={styles.directAnswerCard} testID="owner-access-lock-update">
              <Text style={styles.directAnswerTitle}>Current update</Text>
              <Text style={styles.directAnswerSubtitle}>Plain status of the temporary owner-only admin lock in this build.</Text>
              <View style={styles.directAnswerList}>
                {lockUpdateItems.map((item, index) => (
                  <View key={item.id} style={styles.directAnswerRow}>
                    <View style={styles.directAnswerIndexWrap}>
                      <Text style={styles.directAnswerIndex}>{index + 1}</Text>
                    </View>
                    <View style={styles.directAnswerBody}>
                      <Text style={styles.directAnswerRowTitle}>{item.title}</Text>
                      <Text style={styles.directAnswerRowDetail}>{item.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}

        {!overallHealthy ? (
          <TouchableOpacity
            style={[styles.claimCard, claimOwnerMutation.isPending && styles.claimCardDisabled]}
            activeOpacity={0.82}
            onPress={() => {
              handleClaimOwnerPress();
            }}
            disabled={claimOwnerMutation.isPending}
            testID="owner-access-claim-device"
          >
            <View style={styles.claimIconWrap}>
              {claimOwnerMutation.isPending ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <IVXBrandIcon size={22} />
              )}
            </View>
            <View style={styles.claimBody}>
              <Text style={styles.claimTitle}>Sign in and verify this device</Text>
              <Text style={styles.claimSubtitle}>
                Admin login is not removed from a new device. For safety, owner recovery requires one verified owner sign-in before this device can be trusted again.
              </Text>
            </View>
            <ChevronRight size={20} color="#000" />
          </TouchableOpacity>
        ) : null}

        <View style={styles.directAnswerCard} testID="owner-access-direct-answer">
          <Text style={styles.directAnswerTitle}>Straight answer</Text>
          <Text style={styles.directAnswerSubtitle}>Why the repair key was mentioned, why admin login stays protected, and the fastest safe way back in.</Text>
          <View style={styles.directAnswerList}>
            {directAnswerItems.map((item, index) => (
              <View key={item.id} style={styles.directAnswerRow}>
                <View style={styles.directAnswerIndexWrap}>
                  <Text style={styles.directAnswerIndex}>{index + 1}</Text>
                </View>
                <View style={styles.directAnswerBody}>
                  <Text style={styles.directAnswerRowTitle}>{item.title}</Text>
                  <Text style={styles.directAnswerRowDetail}>{item.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.nextStepsCard} testID="owner-access-next-steps">
          <Text style={styles.nextStepsTitle}>What you need to do</Text>
          <View style={styles.nextStepsList}>
            {nextSteps.map((item, index) => (
              <View key={item.id} style={styles.nextStepRow}>
                <View style={styles.nextStepIndexWrap}>
                  <Text style={styles.nextStepIndex}>{index + 1}</Text>
                </View>
                <View style={styles.nextStepBody}>
                  <Text style={styles.nextStepTitle}>{item.title}</Text>
                  <Text style={styles.nextStepDetail}>{item.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.honestStatusCard} testID="owner-access-honest-status">
          <Text style={styles.honestStatusTitle}>Honest status</Text>
          <Text style={styles.honestStatusSubtitle}>This screen shows exactly what is blocking owner recovery on this device.</Text>
          <View style={styles.honestStatusList}>
            {honestStatusItems.map((item) => (
              <View key={item.id} style={styles.honestStatusRow}>
                <Text style={styles.honestStatusLabel}>{item.label}</Text>
                <Text style={[styles.honestStatusValue, item.id !== 'next-action' ? { color: item.tone } : null]}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View
          style={[
            styles.repairReadinessCard,
            ownerRepairReadiness.hasRealServiceRole
              ? styles.repairReadinessCardSuccess
              : styles.repairReadinessCardCritical,
          ]}
          testID="owner-access-repair-readiness"
        >
          <Text style={styles.repairReadinessEyebrow}>Backend repair only · not normal sign-in</Text>
          <Text style={styles.repairReadinessTitle}>{ownerRepairReadiness.title}</Text>
          <Text style={styles.repairReadinessSubtitle}>{ownerRepairReadiness.detail}</Text>

          {criticalRepairIssues.length > 0 ? (
            <View style={styles.repairIssueGroup}>
              <Text style={[styles.repairIssueGroupTitle, styles.repairIssueGroupTitleCritical]}>Red blockers</Text>
              {criticalRepairIssues.map((item, index) => (
                <View key={item.id} style={[styles.repairIssueRow, styles.repairIssueRowCritical]}>
                  <View style={[styles.repairIssueIndexWrap, styles.repairIssueIndexWrapCritical]}>
                    <Text style={styles.repairIssueIndex}>{index + 1}</Text>
                  </View>
                  <View style={styles.repairIssueBody}>
                    <Text style={styles.repairIssueTitle}>{item.title}</Text>
                    <Text style={styles.repairIssueDetail}>{item.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {warningRepairIssues.length > 0 ? (
            <View style={styles.repairIssueGroup}>
              <Text style={[styles.repairIssueGroupTitle, styles.repairIssueGroupTitleWarning]}>Yellow warnings</Text>
              {warningRepairIssues.map((item, index) => (
                <View key={item.id} style={[styles.repairIssueRow, styles.repairIssueRowWarning]}>
                  <View style={[styles.repairIssueIndexWrap, styles.repairIssueIndexWrapWarning]}>
                    <Text style={styles.repairIssueIndex}>{index + 1}</Text>
                  </View>
                  <View style={styles.repairIssueBody}>
                    <Text style={styles.repairIssueTitle}>{item.title}</Text>
                    <Text style={styles.repairIssueDetail}>{item.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {successRepairIssues.length > 0 ? (
            <View style={styles.repairIssueGroup}>
              <Text style={[styles.repairIssueGroupTitle, styles.repairIssueGroupTitleSuccess]}>Verified paths</Text>
              {successRepairIssues.map((item, index) => (
                <View key={item.id} style={[styles.repairIssueRow, styles.repairIssueRowSuccess]}>
                  <View style={[styles.repairIssueIndexWrap, styles.repairIssueIndexWrapSuccess]}>
                    <Text style={styles.repairIssueIndex}>{index + 1}</Text>
                  </View>
                  <View style={styles.repairIssueBody}>
                    <Text style={styles.repairIssueTitle}>{item.title}</Text>
                    <Text style={styles.repairIssueDetail}>{item.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {identityEvidenceItems.length > 0 ? (
          <View style={styles.identityCard} testID="owner-access-identity-card">
            <View style={styles.identityHeader}>
              <Text style={styles.identityTitle}>Owner identity authority</Text>
              <View style={[styles.identityBadge, { backgroundColor: identityVerdictTone + '20' }]}>
                <View style={[styles.identityBadgeDot, { backgroundColor: identityVerdictTone }]} />
                <Text style={[styles.identityBadgeText, { color: identityVerdictTone }]}>{formatIdentityVerdict(identityAudit?.status)}</Text>
              </View>
            </View>
            <Text style={styles.identitySubtitle}>{identityAudit?.message ?? 'Checking owner identity authority...'}</Text>
            <View style={styles.evidenceList}>
              {identityEvidenceItems.map((item) => (
                <View key={item.id} style={styles.identityRow}>
                  <Text style={styles.evidenceLabel}>{item.label}</Text>
                  <Text style={[styles.evidenceValue, { color: item.tone }]}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {identityAudit?.warnings && identityAudit.warnings.length > 0 ? (
          <View style={styles.identityWarningsCard} testID="owner-access-identity-warnings-card">
            <Text style={styles.identityWarningsTitle}>Identity audit warnings</Text>
            <Text style={styles.identityWarningsSubtitle}>This is the exact evidence showing whether the audited email is the real owner authority or only a normal user account.</Text>
            <View style={styles.identityWarningsList}>
              {identityAudit.warnings.map((warning, index) => (
                <View key={`${index}-${warning}`} style={styles.identityWarningRow}>
                  <View style={styles.identityWarningIndexWrap}>
                    <Text style={styles.identityWarningIndex}>{index + 1}</Text>
                  </View>
                  <Text style={styles.identityWarningText}>{warning}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {auditEvidenceItems.length > 0 ? (
          <View style={styles.evidenceCard} testID="owner-access-evidence-card">
            <Text style={styles.evidenceTitle}>Trusted-device evidence</Text>
            <Text style={styles.evidenceSubtitle}>These are the raw checks the trusted-restore path is using on this device right now.</Text>
            <View style={styles.evidenceList}>
              {auditEvidenceItems.map((item) => (
                <View key={item.id} style={styles.evidenceRow}>
                  <Text style={styles.evidenceLabel}>{item.label}</Text>
                  <Text style={[styles.evidenceValue, { color: item.tone }]}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {auditBlockers.length > 0 ? (
          <View style={styles.blockersCard} testID="owner-access-blockers-card">
            <Text style={styles.blockersTitle}>Exact blockers</Text>
            <Text style={styles.blockersSubtitle}>Trusted restore stays locked until every blocker below is cleared.</Text>
            <View style={styles.blockersList}>
              {auditBlockers.map((reason, index) => (
                <View key={`${index}-${reason}`} style={styles.blockerRow}>
                  <View style={styles.blockerIndexWrap}>
                    <Text style={styles.blockerIndex}>{index + 1}</Text>
                  </View>
                  <Text style={styles.blockerText}>{reason}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {!overallHealthy ? (
          <View style={styles.auditCallout} testID="owner-access-audit-callout">
            <Text style={styles.auditCalloutTitle}>What I audited</Text>
            <Text style={styles.auditCalloutText}>This screen now uses raw trusted-device evidence instead of broad owner-access claims. If a restore check fails, the blocker list above tells you exactly which proof is missing.</Text>
            <Text style={styles.auditCalloutText}>If the email is empty here, this screen was opened without a carried email and without an authenticated owner session. Standard owner sign-in still depends on the real Supabase email/password pair and does not require the server service-role key.</Text>
          </View>
        ) : null}

        {carriedEmail ? (
          <View style={styles.recoveryCard} testID="owner-access-recovery-card">
            <View style={styles.recoveryIconWrap}>
              <KeyRound size={18} color={Colors.black} />
            </View>
            <View style={styles.recoveryBody}>
              <Text style={styles.recoveryTitle}>Owner recovery info carried over</Text>
              <Text style={styles.recoverySubtitle}>
                {audit?.emailMismatch && audit.verifiedEmail
                  ? `We brought ${carriedEmail} from ${recoverySource}, but this device is anchored to ${audit.verifiedEmail}. Use the verified owner email on Sign In.`
                  : `We brought ${carriedEmail} from ${recoverySource}. If this is your verified owner email, use that exact email on Sign In.`}
              </Text>
              <View style={styles.emailChip} testID="owner-access-email-chip">
                <Text style={styles.emailChipLabel}>Owner email</Text>
                <Text style={styles.emailChipValue}>{carriedEmail}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.recoveryAction}
              activeOpacity={0.82}
              onPress={() => router.push(buildOwnerLoginRoute(effectiveOwnerEmail) as any)}
              testID="owner-access-return-login"
            >
              <Text style={styles.recoveryActionText}>Open Owner Login</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Secondary owner access: AWS SNS SMS recovery ── */}
        <View style={styles.smsRecoveryCard} testID="owner-access-sms-recovery-card">
          <View style={styles.smsRecoveryHeader}>
            <View style={styles.smsRecoveryIconWrap}>
              <Smartphone size={18} color={Colors.black} />
            </View>
            <View style={styles.smsRecoveryHeaderText}>
              <Text style={styles.smsRecoveryTitle}>Secondary owner access · SMS recovery</Text>
              <Text style={styles.smsRecoverySubtitle}>
                {recoverySmsReady
                  ? 'A 6-digit code will be texted to your registered owner phone via AWS SNS. Verify it here to restore owner login even if email/password is broken.'
                  : 'AWS SNS SMS recovery is not fully configured on the backend yet. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and IVX_OWNER_RECOVERY_PHONE. Twilio integration is pending; AWS SNS is active.'}
              </Text>
            </View>
          </View>

          {recoverySmsReady ? (
            <>
              <TouchableOpacity
                style={[styles.smsRecoveryPrimaryBtn, recoverySmsRequestMutation.isPending && styles.smsRecoveryBtnDisabled]}
                activeOpacity={0.84}
                onPress={() => recoverySmsRequestMutation.mutate()}
                disabled={recoverySmsRequestMutation.isPending || !recoverySmsEnabled}
                testID="owner-access-sms-request-code"
              >
                {recoverySmsRequestMutation.isPending ? (
                  <ActivityIndicator color={Colors.black} size="small" />
                ) : (
                  <Text style={styles.smsRecoveryPrimaryBtnText}>
                    {recoverySmsRequested ? 'Resend recovery code' : 'Text me a recovery code'}
                  </Text>
                )}
              </TouchableOpacity>

              {recoverySmsRequested ? (
                <View style={styles.smsRecoveryVerifyWrap} testID="owner-access-sms-verify-wrap">
                  <Text style={styles.smsRecoveryLabel}>6-digit code from SMS</Text>
                  <TextInput
                    style={styles.smsRecoveryInput}
                    value={recoverySmsCode}
                    onChangeText={(v) => setRecoverySmsCode(v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    placeholderTextColor={Colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={6}
                    testID="owner-access-sms-code-input"
                  />
                  <Text style={styles.smsRecoveryLabel}>New owner password (optional)</Text>
                  <TextInput
                    style={styles.smsRecoveryInput}
                    value={recoverySmsNewPassword}
                    onChangeText={setRecoverySmsNewPassword}
                    placeholder="New password (8+ chars, 1 uppercase, 1 number)"
                    placeholderTextColor={Colors.textSecondary}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="owner-access-sms-password-input"
                  />
                  <TouchableOpacity
                    style={[styles.smsRecoveryVerifyBtn, recoverySmsVerifyMutation.isPending && styles.smsRecoveryBtnDisabled]}
                    activeOpacity={0.84}
                    onPress={() => recoverySmsVerifyMutation.mutate()}
                    disabled={recoverySmsVerifyMutation.isPending || recoverySmsCode.length !== 6}
                    testID="owner-access-sms-verify-btn"
                  >
                    {recoverySmsVerifyMutation.isPending ? (
                      <ActivityIndicator color={Colors.black} size="small" />
                    ) : (
                      <Text style={styles.smsRecoveryPrimaryBtnText}>Verify code & restore access</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.smsRecoveryPendingRow} testID="owner-access-sms-pending">
              <Text style={styles.smsRecoveryPendingText}>
                Transport: AWS SNS (active · free SMS tier). Twilio: pending. Backend status:{' '}
                {recoverySmsStatus ? `${recoverySmsStatus.awsRegion} · sns=${recoverySmsStatus.snsConfigured ? 'on' : 'off'} · phone=${recoverySmsStatus.recoveryPhoneConfigured ? 'on' : 'off'}` : 'loading…'}
              </Text>
            </View>
          )}
        </View>

        {!trustedReady ? (
          <TouchableOpacity
            style={[styles.resetCard, ownerPasswordResetMutation.isPending && styles.resetCardDisabled]}
            activeOpacity={0.84}
            onPress={() => ownerPasswordResetMutation.mutate()}
            disabled={ownerPasswordResetMutation.isPending}
            testID="owner-access-reset-password"
          >
            <View style={styles.resetIconWrap}>
              {ownerPasswordResetMutation.isPending ? (
                <ActivityIndicator color={Colors.black} size="small" />
              ) : (
                <KeyRound size={18} color={Colors.black} />
              )}
            </View>
            <View style={styles.resetBody}>
              <Text style={styles.resetTitle}>Fastest safe recovery: reset owner password</Text>
              <Text style={styles.resetSubtitle}>
                {effectiveOwnerEmail
                  ? `Send a reset link to ${effectiveOwnerEmail}. Use this when the password is unknown or rejected and trusted restore is not ready yet.`
                  : 'Send a reset link to your verified owner email. Use this when the current password is unknown or keeps getting rejected.'}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.black} />
          </TouchableOpacity>
        ) : null}

        {!auth.isAuthenticated ? (
          <>
            <TouchableOpacity
              style={styles.primarySigninCard}
              activeOpacity={0.84}
              onPress={() => router.push(buildOwnerLoginRoute(effectiveOwnerEmail) as any)}
              testID="owner-access-primary-signin"
            >
              <View style={styles.primarySigninIconWrap}>
                <ShieldCheck size={18} color={Colors.black} />
              </View>
              <View style={styles.primarySigninBody}>
                <Text style={styles.primarySigninTitle}>Sign in with your owner account</Text>
                <Text style={styles.primarySigninSubtitle}>
                  {effectiveOwnerEmail
                    ? `Use ${effectiveOwnerEmail} and your owner password. Do not create another public member account.`
                    : 'Use your verified owner email and password. Do not create another public member account.'}
                </Text>
              </View>
              <ChevronRight size={18} color={Colors.black} />
            </TouchableOpacity>

          </>
        ) : null}

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusTitle}>Owner access status</Text>
            {ownerAuditQuery.isFetching ? <ActivityIndicator color={Colors.primary} size="small" /> : null}
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Owner sign-in</Text>
            <View style={[styles.statusBadge, { backgroundColor: ownerSessionTone + '20' }]}>
              <View style={[styles.statusDot, { backgroundColor: ownerSessionTone }]} />
              <Text style={[styles.statusBadgeText, { color: ownerSessionTone }]}>{ownerSessionState}</Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Trusted device access</Text>
            <View style={[styles.statusBadge, { backgroundColor: trustedStatusColor + '20' }]}>
              <View style={[styles.statusDot, { backgroundColor: trustedStatusColor }]} />
              <Text style={[styles.statusBadgeText, { color: trustedStatusColor }]}>{trustedStatusText}</Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Detected network</Text>
            <View style={styles.ipRow}>
              <Globe size={12} color={Colors.textSecondary} />
              <Text style={styles.statusValue}>{trustedIdentity}</Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Verified network</Text>
            <View style={styles.ipRow}>
              <Fingerprint size={12} color={Colors.textSecondary} />
              <Text style={styles.statusValue}>{verifiedIdentity}</Text>
            </View>
          </View>
          {subnetMatch && audit?.currentIP !== audit?.storedIP ? (
            <View style={styles.subnetInfoRow}>
              <Zap size={14} color="#F59E0B" />
              <Text style={styles.subnetInfoText}>
                Carrier subnet match detected — your mobile IP changed but stays within the same network range. Trusted restore is available.
              </Text>
            </View>
          ) : null}
          <View style={styles.statusMessageRow}>
            {trustedReady || hasLiveOwnerControl ? <CheckCircle2 size={16} color={Colors.success} /> : <XCircle size={16} color="#FF4D4D" />}
            <Text style={styles.statusMessage}>{audit?.message ?? 'Checking your owner access status…'}</Text>
          </View>
        </View>

        {hasLiveOwnerControl && !audit?.ownerDeviceVerified ? (
          <TouchableOpacity
            style={styles.verifyDeviceCard}
            activeOpacity={0.82}
            onPress={handleForceVerify}
            disabled={forceVerifyMutation.isPending}
            testID="owner-access-force-verify"
          >
            <View style={styles.verifyIconWrap}>
              {forceVerifyMutation.isPending ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Fingerprint size={20} color="#000" />
              )}
            </View>
            <View style={styles.verifyBody}>
              <Text style={styles.verifyTitle}>Verify this device now</Text>
              <Text style={styles.verifySubtitle}>
                You're signed in as owner. Tap to register this device + network so trusted restore works next time without login.
              </Text>
            </View>
            <ChevronRight size={18} color="#FFD700" />
          </TouchableOpacity>
        ) : null}

        {hasLiveOwnerControl && audit?.ownerDeviceVerified && audit?.currentIP !== audit?.storedIP ? (
          <TouchableOpacity
            style={[styles.verifyDeviceCard, { borderColor: '#F59E0B30' }]}
            activeOpacity={0.82}
            onPress={() => {
              Alert.alert(
                'Update Trusted Network',
                `Your IP changed from ${audit?.storedIP} to ${audit?.currentIP}.\n\nUpdate the verified network to your current IP?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Update', onPress: () => forceVerifyMutation.mutate() },
                ]
              );
            }}
            disabled={forceVerifyMutation.isPending}
            testID="owner-access-update-ip"
          >
            <View style={[styles.verifyIconWrap, { backgroundColor: '#F59E0B' }]}>
              {forceVerifyMutation.isPending ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <RefreshCw size={18} color="#000" />
              )}
            </View>
            <View style={styles.verifyBody}>
              <Text style={styles.verifyTitle}>Update trusted network</Text>
              <Text style={styles.verifySubtitle}>
                Your IP changed. Tap to update the verified network to {audit?.currentIP} so exact-match restore works.
              </Text>
            </View>
            <ChevronRight size={18} color="#F59E0B" />
          </TouchableOpacity>
        ) : null}

        {quickActions.length > 0 ? (
          <View style={styles.commandDeck}>
            <View style={styles.commandDeckHeader}>
              <LockKeyhole size={16} color={Colors.primary} />
              <Text style={styles.commandDeckTitle}>Owner proof & command center</Text>
            </View>
            <View style={styles.commandDeckGrid}>
              {quickActions.map((item) => {
                const Icon = item.icon;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.commandCard}
                    activeOpacity={0.86}
                    onPress={item.onPress}
                    testID={item.testID}
                  >
                    <View style={[styles.commandIconWrap, { backgroundColor: item.accent + '1F' }]}>
                      <Icon size={18} color={item.accent} />
                    </View>
                    <Text style={styles.commandTitle}>{item.title}</Text>
                    <Text style={styles.commandSubtitle}>{item.subtitle}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {ACCESS_ROUTES.map((item) => {
          const Icon = item.mode === 'signin' ? KeyRound : item.mode === 'restore' ? Wifi : IVXBrandIcon;
          const loading = item.mode === 'restore' && ownerRestoreMutation.isPending;
          const disabled = loading;
          const isRestoreReady = item.mode === 'restore' && trustedReady;
          const isSessionActive = item.mode === 'signin' && auth.isAuthenticated;
          const routeBorderColor = isRestoreReady ? '#00C48C30' : isSessionActive ? '#FFD70030' : '#232323';
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.routeCard, { borderColor: routeBorderColor }]}
              activeOpacity={0.86}
              onPress={() => handleRoutePress(item.mode)}
              disabled={disabled}
              testID={`owner-access-${item.id}`}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={[styles.routeIconWrap, { backgroundColor: item.accent + '22' }]}>
                  <Icon size={20} color={item.accent} />
                </View>
                {isRestoreReady ? (
                  <View style={styles.readyBadge}>
                    <View style={styles.readyDot} />
                    <Text style={styles.readyText}>READY</Text>
                  </View>
                ) : isSessionActive ? (
                  <View style={[styles.readyBadge, { backgroundColor: '#FFD70018' }]}>
                    <View style={[styles.readyDot, { backgroundColor: '#FFD700' }]} />
                    <Text style={[styles.readyText, { color: '#FFD700' }]}>ACTIVE</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.routeBody}>
                <Text style={styles.routeTitle}>{item.title}</Text>
                <Text style={styles.routeDescription}>{item.mode === 'signin' ? ownerSigninDescription : item.description}</Text>
                <Text style={styles.routeDetail}>{item.mode === 'signin' ? ownerSigninDetail : item.detail}</Text>
              </View>
              <View style={styles.routeAction}>
                {loading ? (
                  <ActivityIndicator color={item.accent} size="small" />
                ) : (
                  <>
                    <Text style={[styles.routeActionText, { color: item.accent }]}>{item.mode === 'signin' ? ownerSigninCta : item.cta}</Text>
                    <ChevronRight size={16} color={item.accent} />
                  </>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={styles.secondaryButton}
          activeOpacity={0.82}
          onPress={() => {
            void ownerAuditQuery.refetch();
            void ownerIdentityAuditQuery.refetch();
          }}
          testID="owner-access-refresh"
        >
          <ShieldCheck size={16} color={Colors.primary} />
          <Text style={styles.secondaryButtonText}>Refresh owner status</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  heroCard: {
    backgroundColor: '#101010',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#262626',
  },
  heroCardActive: {
    borderColor: '#00C48C30',
    backgroundColor: '#081208',
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    marginBottom: 14,
  },
  eyebrow: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '900' as const,
    lineHeight: 34,
  },
  subtitle: {
    marginTop: 10,
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  directAnswerCard: {
    backgroundColor: '#0E1726',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    gap: 12,
  },
  directAnswerTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  directAnswerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  directAnswerList: {
    gap: 10,
  },
  directAnswerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  directAnswerIndexWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  directAnswerIndex: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '900' as const,
  },
  directAnswerBody: {
    flex: 1,
    gap: 4,
  },
  directAnswerRowTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  directAnswerRowDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  nextStepsCard: {
    backgroundColor: '#111111',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#252525',
    gap: 12,
  },
  lockCard: {
    backgroundColor: '#1A1113',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#4B2027',
    gap: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  lockIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#2A1013',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBody: {
    flex: 1,
    gap: 4,
  },
  lockTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  lockText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  honestStatusCard: {
    backgroundColor: '#0E1621',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#203148',
    gap: 12,
  },
  honestStatusTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  honestStatusSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  honestStatusList: {
    gap: 2,
  },
  honestStatusRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#203148',
    gap: 6,
  },
  honestStatusLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  },
  honestStatusValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
    lineHeight: 20,
  },
  repairReadinessCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  repairReadinessCardCritical: {
    backgroundColor: '#181014',
    borderColor: '#4B2027',
  },
  repairReadinessCardSuccess: {
    backgroundColor: '#0A1614',
    borderColor: '#1E4F45',
  },
  repairReadinessEyebrow: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  repairReadinessTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '900' as const,
  },
  repairReadinessSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  repairIssueGroup: {
    gap: 10,
  },
  repairIssueGroupTitle: {
    fontSize: 12,
    fontWeight: '800' as const,
  },
  repairIssueGroupTitleCritical: {
    color: '#F87171',
  },
  repairIssueGroupTitleWarning: {
    color: '#F59E0B',
  },
  repairIssueGroupTitleSuccess: {
    color: '#34D399',
  },
  repairIssueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
  },
  repairIssueRowCritical: {
    backgroundColor: '#2A1216',
    borderColor: '#5B232C',
  },
  repairIssueRowWarning: {
    backgroundColor: '#2A210F',
    borderColor: '#5A4311',
  },
  repairIssueRowSuccess: {
    backgroundColor: '#10211A',
    borderColor: '#1E4F45',
  },
  repairIssueIndexWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  repairIssueIndexWrapCritical: {
    backgroundColor: '#FF4D4D',
  },
  repairIssueIndexWrapWarning: {
    backgroundColor: '#F59E0B',
  },
  repairIssueIndexWrapSuccess: {
    backgroundColor: '#00C48C',
  },
  repairIssueIndex: {
    color: '#08110B',
    fontSize: 11,
    fontWeight: '900' as const,
  },
  repairIssueBody: {
    flex: 1,
    gap: 4,
  },
  repairIssueTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
    lineHeight: 18,
  },
  repairIssueDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  identityCard: {
    backgroundColor: '#0A1614',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E4F45',
    gap: 12,
  },
  identityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  identityTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  identitySubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  identityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  identityBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  identityBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
  },
  identityRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E4F45',
    gap: 5,
  },
  identityWarningsCard: {
    backgroundColor: '#1F180C',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#5A4311',
    gap: 12,
  },
  identityWarningsTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  identityWarningsSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  identityWarningsList: {
    gap: 10,
  },
  identityWarningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  identityWarningIndexWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  identityWarningIndex: {
    color: '#161006',
    fontSize: 11,
    fontWeight: '900' as const,
  },
  identityWarningText: {
    flex: 1,
    color: Colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  evidenceCard: {
    backgroundColor: '#151120',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#34294D',
    gap: 12,
  },
  evidenceTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  evidenceSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  evidenceList: {
    gap: 2,
  },
  evidenceRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#34294D',
    gap: 5,
  },
  evidenceLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  },
  evidenceValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    lineHeight: 19,
  },
  blockersCard: {
    backgroundColor: '#1A1113',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#4B2027',
    gap: 12,
  },
  blockersTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  blockersSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  blockersList: {
    gap: 10,
  },
  blockerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  blockerIndexWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF4D4D',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  blockerIndex: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900' as const,
  },
  blockerText: {
    flex: 1,
    color: Colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  nextStepsTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  nextStepsList: {
    gap: 12,
  },
  nextStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  nextStepIndexWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  nextStepIndex: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '900' as const,
  },
  nextStepBody: {
    flex: 1,
    gap: 4,
  },
  nextStepTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  nextStepDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  auditCallout: {
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    gap: 8,
  },
  auditCalloutTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  auditCalloutText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  recoveryCard: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F3A5F',
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  recoveryIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoveryBody: {
    flex: 1,
    gap: 4,
  },
  recoveryTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  recoverySubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  recoveryAction: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FFFFFF10',
    borderWidth: 1,
    borderColor: '#FFFFFF14',
  },
  recoveryActionText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  resetCard: {
    backgroundColor: '#FFD700',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resetCardDisabled: {
    opacity: 0.7,
  },
  resetIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#00000012',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBody: {
    flex: 1,
    gap: 4,
  },
  resetTitle: {
    color: Colors.black,
    fontSize: 15,
    fontWeight: '900' as const,
  },
  resetSubtitle: {
    color: '#312600',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  claimCard: {
    backgroundColor: '#00C48C',
    borderRadius: 22,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  claimCardDisabled: {
    opacity: 0.7,
  },
  claimIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#00000018',
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimBody: {
    flex: 1,
    gap: 4,
  },
  claimTitle: {
    color: '#000',
    fontSize: 17,
    fontWeight: '900' as const,
  },
  claimSubtitle: {
    color: '#0A3D1A',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600' as const,
  },
  emailChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#0B1220',
    borderWidth: 1,
    borderColor: '#22324F',
    gap: 2,
  },
  emailChipLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  },
  emailChipValue: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  primarySigninCard: {
    backgroundColor: Colors.primary,
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ownerSignupCard: {
    backgroundColor: '#1A1207',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F59E0B44',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  primarySigninIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#00000012',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerSignupIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySigninBody: {
    flex: 1,
    gap: 4,
  },
  primarySigninTitle: {
    color: Colors.black,
    fontSize: 15,
    fontWeight: '900' as const,
  },
  primarySigninSubtitle: {
    color: '#312600',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  ownerSignupTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '900' as const,
  },
  ownerSignupSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  statusCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  statusValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    flexShrink: 1,
    textAlign: 'right' as const,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  subnetInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F59E0B10',
    borderRadius: 10,
    padding: 10,
  },
  subnetInfoText: {
    flex: 1,
    color: '#F59E0B',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  statusMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 6,
  },
  statusMessage: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  verifyDeviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A00',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FFD70030',
    gap: 12,
  },
  verifyIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFD700',
  },
  verifyBody: {
    flex: 1,
    gap: 4,
  },
  verifyTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  verifySubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  commandDeck: {
    backgroundColor: '#0B0B0B',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#232323',
    gap: 14,
  },
  commandDeckHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commandDeckTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  commandDeckGrid: {
    gap: 10,
  },
  commandCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#212121',
    gap: 8,
  },
  commandIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commandTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  commandSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  routeCard: {
    backgroundColor: '#0F0F0F',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#232323',
  },
  routeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#00C48C18',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  readyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00C48C',
  },
  readyText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: '#00C48C',
    letterSpacing: 0.5,
  },
  routeBody: {
    gap: 6,
  },
  routeTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
  },
  routeDescription: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  routeDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  routeAction: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routeActionText: {
    fontSize: 13,
    fontWeight: '800' as const,
  },
  secondaryButton: {
    marginTop: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    backgroundColor: Colors.primary + '10',
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  smsRecoveryCard: {
    backgroundColor: '#0B1220',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    gap: 14,
  },
  smsRecoveryHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  smsRecoveryIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smsRecoveryHeaderText: {
    flex: 1,
    gap: 4,
  },
  smsRecoveryTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  smsRecoverySubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  smsRecoveryPrimaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smsRecoveryBtnDisabled: {
    opacity: 0.6,
  },
  smsRecoveryPrimaryBtnText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '900' as const,
  },
  smsRecoveryVerifyWrap: {
    gap: 10,
  },
  smsRecoveryLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  smsRecoveryInput: {
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#1F3A5F',
  },
  smsRecoveryVerifyBtn: {
    backgroundColor: '#00C48C',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  smsRecoveryPendingRow: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1F3A5F',
  },
  smsRecoveryPendingText: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
});
