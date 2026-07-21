import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LoginFailureReason, OwnerDirectAccessAuditResult } from '@/lib/auth-context';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Animated,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Href } from 'expo-router';
import { Mail, Lock, Eye, EyeOff, ArrowLeft, Shield, ChevronRight, MailCheck, Check } from 'lucide-react-native';
import * as SecureStore from 'expo-secure-store';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { checkAuthRateLimit, recordAuthAttempt, getRateLimitMessage, clearAuthAttempts } from '@/lib/auth-rate-limiter';
import { validateEmail, sanitizeEmail } from '@/lib/auth-helpers';
import { getPasswordResetRedirectUrl, inspectPasswordResetRedirect } from '@/lib/auth-password-recovery';
import {
  buildRepairIssueItems,
  fetchOwnerRepairReadiness,
  getOwnerRepairReadiness,
  type OwnerRepairReadiness,
} from '@/lib/owner-repair-readiness';

import { IVX_LOGO_SOURCE } from '@/constants/brand';
import {
  getAdminAccessLockFixUpdate,
  getAdminAccessLockHonestStatus,
  getAdminAccessLockMessage,
  getAdminAccessLockNextStep,
  isAdminAccessLocked,
} from '@/lib/admin-access-lock';
import { getOpenAccessModeMessage, isOpenAccessModeEnabled } from '@/lib/open-access';
import { supabase, isSupabaseConfigured, getSupabaseConfigAudit, forceProductionSupabaseClient, SUPABASE_USING_PRODUCTION_FALLBACK, SUPABASE_NOT_CONFIGURED_MESSAGE, SUPABASE_HOST_HINT } from '@/lib/supabase';
import { resolveSupabaseUrl, resolveSupabaseAnonKey } from '@/lib/supabase-env';
import { logStartup } from '@/lib/startup-trace';

/** Pre-sign-in guard: verifies the resolved Supabase config is safe before
 * sending credentials. Blocks sign-in and shows a clear error if the bundle
 * has an invalid anon key or wrong project, instead of letting Supabase
 * return the confusing "Invalid API key" HTTP 401. */
function preflightSupabaseConfig(): {
  ok: boolean;
  reason: string;
  urlRef: string;
  keyValidJwt: boolean;
  keyPresent: boolean;
  hostMatch: boolean;
} {
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseAnonKey();
  let urlRef = 'unknown';
  try { urlRef = new URL(url).hostname.replace(/\.supabase\.co$/, ''); } catch {}
  const keyPresent = key.length > 0;
  const keyValidJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
  const hostMatch = urlRef === 'kvclcdjmjghndxsngfzb';
  if (!hostMatch) {
    return { ok: false, reason: `Supabase URL project ref is ${urlRef}, not kvclcdjmjghndxsngfzb. Mobile bundle has invalid Supabase config. Rebuild required.`, urlRef, keyValidJwt, keyPresent, hostMatch };
  }
  if (!keyPresent || !keyValidJwt) {
    return { ok: false, reason: 'Mobile bundle has invalid Supabase anon key (not a JWT). Rebuild required.', urlRef, keyValidJwt, keyPresent, hostMatch };
  }
  return { ok: true, reason: 'ok', urlRef, keyValidJwt, keyPresent, hostMatch };
}
import { SupabaseAuthDiagnostic } from '@/components/SupabaseAuthDiagnostic';
import { OwnerAuthActions } from '@/components/OwnerAuthActions';


/** True when the Supabase client failed to initialize (URL/key missing).
 * This is the root cause of the "Supabase URL is required" AuthError. */
const SUPABASE_CONFIG_OK = isSupabaseConfigured();

/** Source of the Supabase config for diagnostics. */
const SUPABASE_CONFIG_SOURCE: 'env' | 'fallback' = SUPABASE_USING_PRODUCTION_FALLBACK ? 'fallback' : 'env';
const OWNER_REPAIR_ENDPOINT_PATH = '/api/ivx/owner-access-repair';
const OWNER_REPAIR_API_BASE_URL = 'https://api.ivxholding.com';
const OWNER_REPAIR_EXPECTED_BACKEND_VERSION = 'V7';
const OWNER_REPAIR_OLD_BACKEND_MESSAGE = 'Render backend is old — redeploy required.';

function validateOwnerRepairPassword(password: string): string | null {
  if (password.length < 8) return 'Enter a new owner password with at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Owner password must include at least 1 uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Owner password must include at least 1 number.';
  return null;
}

function shouldAuditOwnerRecoveryForFailure(failureReason: LoginFailureReason | undefined, message: string): boolean {
  if (
    failureReason === 'invalid_credentials'
    || failureReason === 'email_not_confirmed'
    || failureReason === 'rate_limited'
    || failureReason === 'service_unavailable'
    || failureReason === 'unknown'
  ) {
    return true;
  }

  const lowerMessage = message.toLowerCase();
  return lowerMessage.includes('invalid login credentials')
    || lowerMessage.includes('invalid email or password')
    || lowerMessage.includes('email not confirmed')
    || lowerMessage.includes('temporarily unavailable')
    || lowerMessage.includes('failed to fetch')
    || lowerMessage.includes('timeout');
}

function buildLoginFailureAlertMessage(
  baseMessage: string,
  failureReason: LoginFailureReason | undefined,
  remainingAttempts: number,
  lockedUntilMs: number,
): string {
  if (failureReason === 'service_unavailable') {
    return `${baseMessage}\n\nControlled owner recovery can still restore access on a previously verified owner device.`;
  }

  if (failureReason !== 'invalid_credentials') {
    return baseMessage;
  }

  const rejectionEvidence = 'Server check: email is normalized (trim + lowercase); password is trimmed for leading/trailing spaces only. Supabase rejected this email/password pair.';

  if (lockedUntilMs > Date.now()) {
    return `${baseMessage}\n\n${rejectionEvidence}\n\n${getRateLimitMessage(lockedUntilMs)}`;
  }

  if (remainingAttempts > 0) {
    return `${baseMessage}\n\n${rejectionEvidence}\n\nDevice cooldown guard: ${remainingAttempts} invalid password attempt${remainingAttempts === 1 ? '' : 's'} left before a 15-minute pause on this device.`;
  }

  return `${baseMessage}\n\n${rejectionEvidence}`;
}

type LoginAttemptTone = 'neutral' | 'success' | 'warning';

interface LoginAttemptState {
  status: 'idle' | 'submitting' | 'success' | 'failed';
  title: string;
  detail: string;
  email: string;
  tone: LoginAttemptTone;
  cooldownCleared?: boolean;
  kind?: 'reset-sent';
  supabaseErrorMessage?: string;
  supabaseErrorCode?: string;
  supabaseErrorStatus?: number;
  supabaseErrorName?: string;
}

const INITIAL_LOGIN_ATTEMPT_STATE: LoginAttemptState = {
  status: 'idle',
  title: 'Direct sign-in path',
  detail: 'Email + password always go through live Supabase sign-in. Trusted owner restore stays separate below.',
  email: '',
  tone: 'neutral',
};

type LoginIssueSeverity = 'critical' | 'warning' | 'success';

interface LoginIssueItem {
  id: string;
  title: string;
  detail: string;
  severity: LoginIssueSeverity;
}

interface RecoveryTruthItem {
  id: string;
  title: string;
  detail: string;
}

function classifyOwnerAuditSeverity(reason: string): LoginIssueSeverity {
  const lowerReason = reason.toLowerCase();
  if (
    lowerReason.includes('window is no longer active')
    || lowerReason.includes('could not be detected')
    || lowerReason.includes('carrier subnet')
    || lowerReason.includes('temporarily unavailable')
    || lowerReason.includes('rate limit')
  ) {
    return 'warning';
  }

  return 'critical';
}

function dedupeLoginIssues(items: LoginIssueItem[]): LoginIssueItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.severity}:${item.title}:${item.detail}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildLoginIssueItems(params: {
  failureReason: LoginFailureReason | null;
  failedLoginMessage: string | null;
  attemptedEmail: string;
  remainingAttempts: number;
  lockedUntilMs: number;
  audit: OwnerDirectAccessAuditResult | null;
  ownerRepairReadiness: OwnerRepairReadiness;
}): LoginIssueItem[] {
  const {
    failureReason,
    failedLoginMessage,
    attemptedEmail,
    remainingAttempts,
    lockedUntilMs,
    audit,
    ownerRepairReadiness,
  } = params;

  const items: LoginIssueItem[] = [];

  if (failureReason === 'invalid_credentials' && failedLoginMessage) {
    items.push({
      id: 'live-password-rejected',
      title: 'Supabase rejected the live password',
      detail: attemptedEmail
        ? `The exact password entered for ${attemptedEmail} was sent to Supabase and rejected there.`
        : 'The exact password entered on this screen was sent to Supabase and rejected there.',
      severity: 'critical',
    });
  }

  if (failureReason === 'email_not_confirmed') {
    items.push({
      id: 'email-not-confirmed',
      title: 'Email confirmation is incomplete',
      detail: 'Supabase still requires email confirmation for this account before password sign-in can complete.',
      severity: 'critical',
    });
  }

  if (failureReason === 'service_unavailable') {
    items.push({
      id: 'service-unavailable',
      title: 'Live sign-in is temporarily unavailable',
      detail: 'The direct Supabase login path could not be reached cleanly. Trusted owner recovery or password reset is the safe fallback.',
      severity: 'warning',
    });
  }

  if (failureReason === 'admin_access_locked') {
    items.push({
      id: 'admin-access-locked',
      title: 'Admin access is temporarily locked',
      detail: getAdminAccessLockMessage(),
      severity: 'critical',
    });
  }

  if (failureReason === 'rate_limited') {
    items.push({
      id: 'server-rate-limit',
      title: 'Rate limit is active',
      detail: 'Supabase is throttling repeated sign-in attempts right now. Wait briefly before trying again.',
      severity: 'warning',
    });
  }

  const shouldSurfaceServerRepairBlocker = (
    failureReason === 'service_unavailable'
    || failureReason === 'unknown'
  ) && !ownerRepairReadiness.hasRealServiceRole;

  if (failureReason === 'invalid_credentials' && !ownerRepairReadiness.hasRealServiceRole) {
    items.push({
      id: 'admin-repair-separate-from-signin',
      title: 'Server repair key is separate from normal sign-in',
      detail: 'This password rejection already came from the live Supabase email/password sign-in path. A missing or bad service-role key did not cause the rejection. That key is only needed for backend admin repair of an existing owner auth account if support must inspect or rewrite it.',
      severity: 'warning',
    });
  }

  if (shouldSurfaceServerRepairBlocker) {
    buildRepairIssueItems(ownerRepairReadiness)
      .filter((item) => item.tone !== 'success')
      .forEach((item) => {
        items.push({
          id: `owner-repair-${item.id}`,
          title: item.title,
          detail: item.detail,
          severity: item.tone === 'critical' ? 'critical' : 'warning',
        });
      });
  }

  if (lockedUntilMs > Date.now()) {
    items.push({
      id: 'device-cooldown-active',
      title: 'Device cooldown is active',
      detail: getRateLimitMessage(lockedUntilMs),
      severity: 'warning',
    });
  } else if (failureReason === 'invalid_credentials' && remainingAttempts > 0) {
    items.push({
      id: 'device-cooldown-guard',
      title: 'Local cooldown guard is armed',
      detail: `${remainingAttempts} invalid password attempt${remainingAttempts === 1 ? '' : 's'} remain before this device pauses sign-in for 15 minutes.`,
      severity: 'warning',
    });
  }

  if (audit?.eligible) {
    items.push({
      id: 'trusted-restore-available',
      title: 'Trusted owner restore is available',
      detail: audit.currentIP
        ? `This verified device can restore owner access now from ${audit.currentIP}.`
        : 'This verified device can restore owner access now without another password entry.',
      severity: 'success',
    });
  }

  if (audit?.emailMismatch && audit.verifiedEmail) {
    items.push({
      id: 'verified-email-mismatch',
      title: 'The entered owner email is not the verified owner email',
      detail: `This device is anchored to ${audit.verifiedEmail}, not ${(audit.requestedEmail ?? attemptedEmail) || 'the current email'}.`,
      severity: 'critical',
    });
  }

  if (audit && !audit.eligible) {
    const auditReasons = audit.blockingReasons.length > 0 ? audit.blockingReasons : [audit.message];
    auditReasons.forEach((reason, index) => {
      items.push({
        id: `audit-reason-${index}`,
        title: classifyOwnerAuditSeverity(reason) === 'critical' ? 'Owner restore blocker' : 'Owner restore warning',
        detail: reason,
        severity: classifyOwnerAuditSeverity(reason),
      });
    });
  }

  if (audit?.subnetMatch && audit.currentIP && audit.storedIP && audit.currentIP !== audit.storedIP) {
    items.push({
      id: 'carrier-subnet-match',
      title: 'Carrier subnet fallback is available',
      detail: `Current network ${audit.currentIP} is different from ${audit.storedIP}, but both still match the same trusted carrier subnet.`,
      severity: 'warning',
    });
  }

  return dedupeLoginIssues(items);
}

interface LoginScreenContentProps {
  ownerMode?: boolean;
}

export function LoginScreenContent({ ownerMode = false }: LoginScreenContentProps = {}) {
  logStartup('INITIAL_ROUTE_RENDERED', 'login');
  logStartup('APP_INTERACTIVE');
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; justRegistered?: string; ownerMode?: string; mode?: string }>();
  const routeOwnerMode = params.ownerMode === '1' || params.ownerMode === 'true' || params.mode === 'owner';
  const effectiveOwnerMode = ownerMode || routeOwnerMode;
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  if (renderCountRef.current === 1 || renderCountRef.current % 25 === 0) {
  }
  const openAccessMode = isOpenAccessModeEnabled();
  const openAccessMessage = getOpenAccessModeMessage();
  const adminAccessLocked = isAdminAccessLocked();
  const adminAccessLockMessage = getAdminAccessLockMessage();
  const adminAccessLockHonestStatus = getAdminAccessLockHonestStatus();
  const adminAccessLockFixUpdate = getAdminAccessLockFixUpdate();
  const adminAccessLockNextStep = getAdminAccessLockNextStep();
  const {
    login,
    verify2FA,
    cancelTwoFactor,
    requiresTwoFactor,
    loginLoading,
    verify2FALoading,
    pendingTwoFactorEmail,
    pendingTwoFactorFactorLabel,
    isOwnerIPAccess,
    detectedIP,
    isAuthenticated,
    isAdmin,
    userRole,
    auditOwnerDirectAccess,
    ownerDirectAccess,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [twoFACode, setTwoFACode] = useState<string[]>(['', '', '', '', '', '']);
  const [failedLoginMessage, setFailedLoginMessage] = useState<string | null>(null);
  const [ownerRecoveryAudit, setOwnerRecoveryAudit] = useState<OwnerDirectAccessAuditResult | null>(null);
  const [ownerRecoveryLoading, setOwnerRecoveryLoading] = useState<boolean>(false);
  const [liveOwnerAuditLoading, setLiveOwnerAuditLoading] = useState<boolean>(false);
  const [passwordResetLoading, setPasswordResetLoading] = useState<boolean>(false);
  const [serverPasswordRepairLoading, setServerPasswordRepairLoading] = useState<boolean>(false);
  // "Remember Me" is OFF by default — the owner must manually sign in every launch.
  const [rememberMe, setRememberMe] = useState<boolean>(false);
  // Amazon/Instagram-level UX: all diagnostic/recovery machinery is collapsed
  // behind a single "Troubleshoot access" disclosure by default. The owner sees
  // email + password + Sign In + Forgot? — nothing else — until they tap it.
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [repairDebug, setRepairDebug] = useState<{
    endpoint: string;
    status: number | null;
    ok: boolean;
    timestamp: string;
    requestJson: string;
    response: string;
    autoSignIn?: {
      attempted: boolean;
      success: boolean;
      message?: string;
      failureReason?: string | null;
      supabaseErrorMessage?: string | null;
      supabaseErrorCode?: string | null;
      supabaseErrorStatus?: number | null;
      supabaseErrorName?: string | null;
    };
  } | null>(null);
  const [lastFailureReason, setLastFailureReason] = useState<LoginFailureReason | null>(null);
  const [attemptState, setAttemptState] = useState<LoginAttemptState>(() => effectiveOwnerMode
    ? {
      status: 'idle',
      title: 'Owner sign-in path',
      detail: 'Enter your approved owner email and password. This route is separate from worker and regular user signup.',
      email: '',
      tone: 'neutral',
    }
    : INITIAL_LOGIN_ATTEMPT_STATE);
  const twoFARefs = useRef<(TextInput | null)[]>([]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const registrationAlertShown = useRef(false);
  const openAccessRedirectedRef = useRef(false);
  const postLoginNavigationDoneRef = useRef(false);
  const postLoginNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginSubmitInFlightRef = useRef(false);
  const ownerTrustedRestoreNavigationDoneRef = useRef(false);
  const [telemetrySteps, setTelemetrySteps] = useState<{ step: string; ts: string; detail?: string }[]>([]);
  const pushTelemetry = useCallback((step: string, detail?: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setTelemetrySteps((prev) => {
      const next = [...prev, { step, ts, detail }];
      return next.length > 30 ? next.slice(-30) : next;
    });
  }, []);
  const userRoleHydratedRef = useRef(false);
  const navTelemetryWiredRef = useRef(false);
  const normalizedEmail = useMemo(() => sanitizeEmail(email), [email]);
  const effectiveRecoveryEmail = useMemo(() => {
    if (ownerRecoveryAudit?.emailMismatch && ownerRecoveryAudit.verifiedEmail) {
      return ownerRecoveryAudit.verifiedEmail;
    }

    return normalizedEmail;
  }, [normalizedEmail, ownerRecoveryAudit?.emailMismatch, ownerRecoveryAudit?.verifiedEmail]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();

    return () => {
      if (postLoginNavigationTimerRef.current) {
        clearTimeout(postLoginNavigationTimerRef.current);
        postLoginNavigationTimerRef.current = null;
      }
    };
  }, [fadeAnim, slideAnim, logoScale]);

  useEffect(() => {
    const nextEmail = typeof params.email === 'string' ? params.email.trim() : '';
    if (nextEmail) {
      setEmail(nextEmail);
    }
  }, [params.email]);

  // Load "Remember Me" preference — OFF by default per owner requirement.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync('ivx_remember_me');
        if (!cancelled && stored === 'true') {
          setRememberMe(true);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleRememberMe = useCallback(async () => {
    const next = !rememberMe;
    setRememberMe(next);
    try {
      await SecureStore.setItemAsync('ivx_remember_me', next ? 'true' : 'false');
    } catch {}
  }, [rememberMe]);

  useEffect(() => {
    const justRegistered = params.justRegistered === '1' || (Array.isArray(params.justRegistered) && params.justRegistered.includes('1'));
    if (!justRegistered || registrationAlertShown.current) {
      return;
    }

    registrationAlertShown.current = true;
    Alert.alert('Registration Saved', 'Your account is registered. Next time, only Sign In is required.');
  }, [params.justRegistered]);

  useEffect(() => {
    if (!openAccessMode || openAccessRedirectedRef.current) {
      return;
    }
    if (effectiveOwnerMode) {
      return;
    }

    openAccessRedirectedRef.current = true;
    router.replace('/(tabs)/(home)/home' as any);
  }, [openAccessMode, router, effectiveOwnerMode]);

  // Auto-redirect authenticated owners/admins away from the login screen.
  // After a successful repair + sign-in (or on app restart with a persisted Supabase
  // session) the user must land directly on Owner Controls instead of staring at
  // the login form. This is the single source of truth for "already signed in".
  useEffect(() => {
    if (postLoginNavigationDoneRef.current) {
      return;
    }
    if (!isAuthenticated) {
      return;
    }
    if (requiresTwoFactor) {
      return;
    }
    // Owner/admin login lands on the real app Home (/(tabs)) so the operator sees
    // their actual IVX HOLDINGS app first. Owner Controls remains reachable from
    // Profile → Owner Controls / Admin entry, never as a forced redirect.
    const target = '/(tabs)/(home)/home';
    postLoginNavigationDoneRef.current = true;
    pushTelemetry('9. admin guard result', `isAuthenticated=${isAuthenticated} isAdmin=${isAdmin} userRole=${userRole ?? 'null'} → ${target}`);
    postLoginNavigationTimerRef.current = setTimeout(() => {
      postLoginNavigationTimerRef.current = null;
      pushTelemetry('8. router.replace(/(tabs)) called', `from=auth-effect target=${target}`);
      try {
        router.replace(target as any);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? '');
        pushTelemetry('8b. router.replace threw', msg);
      }
    }, 0);
  }, [isAuthenticated, isAdmin, userRole, requiresTwoFactor, effectiveOwnerMode, router, pushTelemetry]);

  // Telemetry: userRole + isAdmin hydration after sign-in.
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    if (userRole && !userRoleHydratedRef.current) {
      userRoleHydratedRef.current = true;
      pushTelemetry('5. userRole loaded', `role=${userRole}`);
      pushTelemetry('6. isAdmin resolved', `isAdmin=${isAdmin}`);
    }
  }, [isAuthenticated, userRole, isAdmin, pushTelemetry]);

  useEffect(() => {
    if (effectiveOwnerMode || openAccessMode || !normalizedEmail || !validateEmail(normalizedEmail)) {
      setLiveOwnerAuditLoading((current) => current ? false : current);
      if (!failedLoginMessage) {
        setOwnerRecoveryAudit((current) => current === null ? current : null);
      }
      return;
    }

    let cancelled = false;
    setLiveOwnerAuditLoading((current) => current ? current : true);
    const timer = setTimeout(() => {
      void auditOwnerDirectAccess(normalizedEmail)
        .then((audit) => {
          if (cancelled) {
            return;
          }
          setOwnerRecoveryAudit(audit);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLiveOwnerAuditLoading((current) => current ? false : current);
          }
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [auditOwnerDirectAccess, failedLoginMessage, normalizedEmail, openAccessMode, effectiveOwnerMode]);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const openOwnerAccess = useCallback((source: 'login' | 'login-failure' | 'owner-recovery' = 'login') => {
    const normalizedEmail = sanitizeEmail(email);
    router.push({
      pathname: '/owner-access',
      params: {
        source,
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
      },
    } as Href);
  }, [email, router]);

  const navigateAfterSuccessfulLogin = useCallback((source: 'password' | 'two-factor') => {
    pushTelemetry('7. navigateAfterSuccessfulLogin called', `source=${source} alreadyRan=${postLoginNavigationDoneRef.current}`);
    if (postLoginNavigationDoneRef.current) {
      return;
    }

    postLoginNavigationDoneRef.current = true;
    // Always land owner + non-owner users on Home. Owner Controls is opt-in from Profile/Admin entry.
    const target = '/(tabs)/(home)/home';
    postLoginNavigationTimerRef.current = setTimeout(() => {
      postLoginNavigationTimerRef.current = null;
      pushTelemetry('8. router.replace(/(tabs)) called', `target=${target}`);
      try {
        router.replace(target as any);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? '');
        pushTelemetry('8b. router.replace threw', msg);
      }
    }, 0);
  }, [effectiveOwnerMode, router, pushTelemetry]);

  const handleBackPress = useCallback(() => {
    if (effectiveOwnerMode) {
      router.replace('/landing' as any);
      return;
    }

    router.back();
  }, [effectiveOwnerMode, router]);

  const handleOwnerTrustedRestore = useCallback(async () => {
    setOwnerRecoveryLoading(true);
    try {
      const result = await ownerDirectAccess(normalizedEmail);
      if (result.success) {
        setFailedLoginMessage(null);
        setLastFailureReason(null);
        setAttemptState({
          status: 'success',
          title: 'Trusted owner access restored',
          detail: result.message,
          email: normalizedEmail,
          tone: 'success',
        });
        Alert.alert('Owner Access Restored', result.message, [
          {
            text: 'Continue',
            onPress: () => {
              if (ownerTrustedRestoreNavigationDoneRef.current) {
                return;
              }
              ownerTrustedRestoreNavigationDoneRef.current = true;
              router.replace('/(tabs)/(home)/home' as any);
            },
          },
        ]);
        return;
      }

      setAttemptState({
        status: 'failed',
        title: 'Trusted owner access blocked',
        detail: result.message,
        email: normalizedEmail,
        tone: 'warning',
      });
      Alert.alert('Trusted Access Blocked', result.message);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to restore trusted owner access';
      setAttemptState({
        status: 'failed',
        title: 'Trusted owner access blocked',
        detail: message,
        email: normalizedEmail,
        tone: 'warning',
      });
      Alert.alert('Trusted Access Blocked', message);
    } finally {
      setOwnerRecoveryLoading(false);
    }
  }, [effectiveOwnerMode, normalizedEmail, ownerDirectAccess, router]);

  const handlePasswordReset = useCallback(async (targetEmail?: string) => {
    const resetTarget = sanitizeEmail(targetEmail ?? effectiveRecoveryEmail);
    if (!resetTarget) {
      Alert.alert('Enter Email', 'Please enter your owner email first, then tap Forgot.');
      return;
    }
    if (!validateEmail(resetTarget)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    setPasswordResetLoading(true);
    try {
      // ── RUNTIME PROOF: redirect URL diagnostics (live reset flow) ──
      const rawEnvAuthUrl: string = (process.env.EXPO_PUBLIC_IVX_AUTH_URL ?? '') as string;
      const audit = inspectPasswordResetRedirect();
      const redirectTo: string = audit.resolvedUrl;
      const protocolMatches = redirectTo.match(/https?:\/\//g) ?? [];
      const duplicatedProtocol = protocolMatches.length > 1;
      const duplicatedResetPath = (redirectTo.match(/\/reset-password/g) ?? []).length > 1;
      const hasWhitespace = /\s/.test(redirectTo);
      const hasControlChars = /[\u0000-\u001F\u007F]/.test(redirectTo);
      const charCodes = Array.from(redirectTo).slice(0, 8).map((c) => c.charCodeAt(0));
      let parseOk = false;
      let parseError: string | null = null;
      try { new URL(redirectTo); parseOk = true; } catch (e) { parseError = e instanceof Error ? e.message : String(e); }








      const { error } = await supabase.auth.resetPasswordForEmail(resetTarget, {
        redirectTo,
      });
      if (error) {
        throw error;
      }

      const cooldownWasCleared = clearAuthAttempts(resetTarget) || (normalizedEmail ? clearAuthAttempts(normalizedEmail) : false);
      setLastFailureReason(null);
      setFailedLoginMessage(null);
      const baseDetail = ownerRecoveryAudit?.emailMismatch && ownerRecoveryAudit.verifiedEmail === resetTarget
        ? `A reset link was sent to the verified owner email ${resetTarget} saved on this device.`
        : `A reset link was sent to ${resetTarget}.`;
      const detail = `${baseDetail} Open the link, pick a new password (something simple you'll remember), then come back here and sign in.`;
      setAttemptState({
        status: 'success',
        title: 'Verify your email',
        detail,
        email: resetTarget,
        tone: 'success',
        cooldownCleared: cooldownWasCleared,
        kind: 'reset-sent',
      });
      const alertSuffix = cooldownWasCleared
        ? '\n\nDevice cooldown cleared — you can sign in as soon as you set the new password.'
        : '';
      Alert.alert(effectiveOwnerMode ? 'Owner Reset Email Sent' : 'Check Your Email', `${detail} Please check your inbox and spam folder.${alertSuffix}`);
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error ?? '');
      const looksLikeParseError = /^\d+:\d+:/.test(rawMessage) || /SyntaxError|Unexpected token|expected/i.test(rawMessage);
      const looksLikeRateLimit = /rate.?limit|too many|429/i.test(rawMessage);
      const looksLikeBundleLoadError = /split bundle|Snapshot not found|Failed to load.*bundle|ChunkLoadError|Loading chunk/i.test(rawMessage);
      const looksLikeNetworkError = /Network request failed|fetch failed|Failed to fetch|TypeError: Network/i.test(rawMessage);

      // Owner login cannot mark email reset as success unless server repair + sign-in both succeed.
      if (looksLikeParseError) {
        if (effectiveOwnerMode) {
          const detail = 'Email reset fallback could not confirm delivery because the Supabase SDK returned a parse error. This does not block owner login. Use the primary server reset button with the typed phone password.';
          setAttemptState({
            status: 'failed',
            title: 'Secondary email reset not confirmed',
            detail,
            email: resetTarget,
            tone: 'warning',
          });
          Alert.alert('Email Reset Fallback Not Confirmed', detail);
          return;
        }

        const cooldownWasCleared = clearAuthAttempts(resetTarget) || (normalizedEmail ? clearAuthAttempts(normalizedEmail) : false);
        setLastFailureReason(null);
        setFailedLoginMessage(null);
        const detail = `A password reset link is on the way to ${resetTarget}. Open the link, pick a new password (something simple you'll remember), then come back here and sign in.`;
        setAttemptState({
          status: 'success',
          title: 'Verify your email',
          detail,
          email: resetTarget,
          tone: 'success',
          cooldownCleared: cooldownWasCleared,
          kind: 'reset-sent',
        });
        const alertSuffix = cooldownWasCleared
          ? '\n\nDevice cooldown cleared \u2014 you can sign in as soon as you set the new password.'
          : '';
        Alert.alert(
          effectiveOwnerMode ? 'Owner Reset Email Sent' : 'Check Your Email',
          `${detail} Please check your inbox and spam folder.${alertSuffix}`
        );
        return;
      }

      // Metro split-bundle / network glitches do NOT mean the email failed —
      // they mean the SDK call could not even reach Supabase from this device.
      // Surface a calm message and offer the server-side path instead of a
      // scary stack trace.
      if (looksLikeBundleLoadError || looksLikeNetworkError) {
        const friendly = 'Your network briefly blocked the reset email. Tap \u201CForgot owner password?\u201D again in a few seconds, or use the server-side owner password repair below to bypass email delivery entirely.';
        setAttemptState({
          status: 'failed',
          title: 'Reset link not sent yet',
          detail: friendly,
          email: resetTarget,
          tone: 'warning',
        });
        return;
      }

      // Defensive: wrapped tokenizer/parse errors are never owner-login success.
      if (/[0-9]+:[0-9]+/.test(rawMessage) && /expected|token|syntax/i.test(rawMessage)) {
        if (effectiveOwnerMode) {
          const detail = 'Email reset fallback could not confirm delivery because the Supabase SDK returned a parse/tokenizer error. This does not block owner login. Use the primary server reset button with the typed phone password.';
          setAttemptState({
            status: 'failed',
            title: 'Secondary email reset not confirmed',
            detail,
            email: resetTarget,
            tone: 'warning',
          });
          Alert.alert('Email Reset Fallback Not Confirmed', detail);
          return;
        }

        const cooldownWasCleared = clearAuthAttempts(resetTarget) || (normalizedEmail ? clearAuthAttempts(normalizedEmail) : false);
        setLastFailureReason(null);
        setFailedLoginMessage(null);
        const detail = `A password reset link is on the way to ${resetTarget}. Open the link, pick a new password, then come back here and sign in.`;
        setAttemptState({
          status: 'success',
          title: 'Verify your email',
          detail,
          email: resetTarget,
          tone: 'success',
          cooldownCleared: cooldownWasCleared,
          kind: 'reset-sent',
        });
        Alert.alert(effectiveOwnerMode ? 'Owner Reset Email Sent' : 'Check Your Email', `${detail} Please check your inbox and spam folder.`);
        return;
      }
      const message = !rawMessage
        ? 'Could not send the reset email right now. Try the server-side owner password repair below, or try again in a few minutes.'
        : looksLikeRateLimit
          ? 'Supabase is rate-limiting reset emails for this address. Wait about a minute, or use the server-side owner password repair below to bypass email delivery entirely.'
          : rawMessage;
      setAttemptState({
        status: 'failed',
        title: 'Password reset email could not be sent',
        detail: message,
        email: resetTarget,
        tone: 'warning',
      });
    } finally {
      setPasswordResetLoading(false);
    }
  }, [effectiveRecoveryEmail, effectiveOwnerMode, ownerRecoveryAudit?.emailMismatch, ownerRecoveryAudit?.verifiedEmail, normalizedEmail]);

  const handleServerOwnerPasswordRepair = useCallback(async () => {
    const target = sanitizeEmail(effectiveRecoveryEmail || normalizedEmail);
    const enteredPassword = password.trim();
    if (!target || !validateEmail(target)) {
      Alert.alert('Enter Owner Email', 'Please enter your owner email first, then tap the server reset button.');
      return;
    }
    const passwordValidationError = validateOwnerRepairPassword(enteredPassword);
    if (passwordValidationError) {
      setAttemptState({
        status: 'failed',
        title: 'New owner password required',
        detail: `${passwordValidationError} This value will be sent once over HTTPS to the backend, set directly in Supabase, then immediately used by this phone for sign-in.`,
        email: target,
        tone: 'warning',
      });
      Alert.alert('Set Owner Password Now', passwordValidationError);
      shake();
      return;
    }

    setServerPasswordRepairLoading(true);
    const apiBase = OWNER_REPAIR_API_BASE_URL;
    const endpoint = `${apiBase}${OWNER_REPAIR_ENDPOINT_PATH}`;
    const startedAt = new Date().toISOString();
    const repairPayload = {
      email: target,
      newPassword: enteredPassword,
      sendPasswordReset: false,
      clientFlow: 'phone_exact_password_repair_v7_render_direct_backend',
    };
    const safeRequestPayload = {
      email: target,
      newPassword: `[redacted:${enteredPassword.length} chars]`,
      passwordSubmitted: true,
      sendPasswordReset: false,
      apiBaseSource: 'render_direct_backend_origin',
      clientFlow: 'phone_exact_password_repair_v7_render_direct_backend',
    };
    const requestJson = JSON.stringify(safeRequestPayload, null, 2);
    setRepairDebug({ endpoint, status: null, ok: false, timestamp: startedAt, requestJson, response: 'Warming Render backend (cold-start can take 30–60s)…' });
    pushTelemetry('1. repair POST started', `endpoint=${endpoint}`);
    // Cold-start tolerant POST: retry once after a short delay if the first call aborts/network-fails.
    const postRepairOnce = async (timeoutMs: number): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(repairPayload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      try {
        const warmController = new AbortController();
        const warmTimer = setTimeout(() => warmController.abort(), 60000);
        await fetch(`${apiBase}${OWNER_REPAIR_ENDPOINT_PATH}/status`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: warmController.signal,
        }).finally(() => clearTimeout(warmTimer));
      } catch (warmErr: unknown) {
        const warmMsg = warmErr instanceof Error ? warmErr.message : String(warmErr ?? '');
      }
      setRepairDebug((prev) => prev ? { ...prev, response: 'Backend warm. Sending password repair request…' } : prev);
      let response: Response;
      try {
        response = await postRepairOnce(90000);
      } catch (firstErr: unknown) {
        const firstName = firstErr instanceof Error ? firstErr.name : '';
        const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr ?? '');
        const isRetryable = firstName === 'AbortError' || /abort|network|fetch failed|Failed to fetch/i.test(firstMsg);
        if (!isRetryable) throw firstErr;
        setRepairDebug((prev) => prev ? { ...prev, response: 'Cold-start retry in progress (Render free tier woke up — retrying once)…' } : prev);
        await new Promise((r) => setTimeout(r, 3000));
        response = await postRepairOnce(90000);
      }
      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch (parseError: unknown) {
        const parseMessage = parseError instanceof Error ? parseError.message : String(parseError ?? 'unknown JSON parse error');
        parsed = { success: false, message: `Endpoint returned non-JSON response: ${parseMessage}`, rawResponse: text };
      }
      const passwordUpdatedFromClientRequest = parsed.passwordUpdatedFromClientRequest === true;
      const passwordUpdated = parsed.passwordUpdated === true || passwordUpdatedFromClientRequest || parsed.passwordUpdatedFromRuntimeSecret === true;
      const passwordLoginEnabled = parsed.passwordLoginEnabled === true;
      const emailConfirmed = parsed.emailConfirmed === true;
      const passwordUpdateSource = typeof parsed.passwordUpdateSource === 'string' ? parsed.passwordUpdateSource : 'unknown';
      const backendVersion = typeof parsed.backendVersion === 'string' ? parsed.backendVersion : 'unknown';
      pushTelemetry('2. repair POST completed', `http=${response.status} backendVersion=${backendVersion} passwordLoginEnabled=${passwordLoginEnabled}`);
      const finishedAt = new Date().toISOString();
      setRepairDebug({
        endpoint,
        status: response.status,
        ok: response.ok,
        timestamp: finishedAt,
        requestJson,
        response: JSON.stringify(parsed, null, 2),
      });

      if (backendVersion !== OWNER_REPAIR_EXPECTED_BACKEND_VERSION) {
        const rawResponse = typeof parsed.rawResponse === 'string' ? parsed.rawResponse : '';
        const hostHint = rawResponse.includes('<!DOCTYPE') || rawResponse.toLowerCase().includes('service temporarily unavailable')
          ? ` The owner repair request is now pinned to the direct Render backend ${OWNER_REPAIR_API_BASE_URL}; this response was not the V7 JSON API and must be fixed on the API deployment.`
          : '';
        const blocker = `${OWNER_REPAIR_OLD_BACKEND_MESSAGE} Expected backendVersion=${OWNER_REPAIR_EXPECTED_BACKEND_VERSION}, received backendVersion=${backendVersion}.${hostHint}`;
        setRepairDebug((prev) => prev ? {
          ...prev,
          autoSignIn: { attempted: false, success: false, message: blocker },
        } : prev);
        setAttemptState({
          status: 'failed',
          title: OWNER_REPAIR_OLD_BACKEND_MESSAGE,
          detail: blocker,
          email: target,
          tone: 'warning',
        });
        Alert.alert(OWNER_REPAIR_OLD_BACKEND_MESSAGE, blocker);
        return;
      }

      if (!response.ok || !passwordLoginEnabled) {
        const failMessage = typeof parsed.message === 'string' && parsed.message
          ? parsed.message
          : `Server-side owner repair returned HTTP ${response.status}.`;
        setRepairDebug((prev) => prev ? { ...prev, response: `${prev.response}\n\nFail: ${failMessage}` } : prev);
        setAttemptState({
          status: 'failed',
          title: 'Server-side owner repair blocked',
          detail: failMessage,
          email: target,
          tone: 'warning',
        });
        Alert.alert('Server Repair Blocked', failMessage);
        return;
      }

      if (!passwordUpdatedFromClientRequest) {
        const blocker = `${OWNER_REPAIR_OLD_BACKEND_MESSAGE} The phone sent a new password, but the backend did not acknowledge passwordUpdateSource=client_request. Current source: ${passwordUpdateSource}. Redeploy/restart the ivx-holdings-platform Render API so the V7 backend is live, then tap this button again.`;
        setRepairDebug((prev) => prev ? {
          ...prev,
          autoSignIn: { attempted: false, success: false, message: blocker },
        } : prev);
        setAttemptState({
          status: 'failed',
          title: 'Render API is not on the exact-password repair build',
          detail: blocker,
          email: target,
          tone: 'warning',
        });
        Alert.alert('Render API Update Required', blocker);
        return;
      }

      const cooldownCleared = clearAuthAttempts(target) || (normalizedEmail ? clearAuthAttempts(normalizedEmail) : false);
      try {
        pushTelemetry('3. Supabase sign-in started', `email=${target}`);
        const signInResult = await login(target, enteredPassword);
        pushTelemetry('4. Supabase sign-in completed', `success=${signInResult.success} reason=${signInResult.failureReason ?? 'none'}`);
        setRepairDebug((prev) => prev ? {
          ...prev,
          autoSignIn: {
            attempted: true,
            success: !!signInResult.success,
            message: signInResult.success
              ? `Supabase accepted the same password value that this phone sent to ${OWNER_REPAIR_ENDPOINT_PATH}. Cooldown cleared: ${cooldownCleared ? 'yes' : 'already clear'}.`
              : signInResult.message,
            failureReason: signInResult.failureReason ?? null,
            supabaseErrorMessage: signInResult.supabaseErrorMessage ?? (signInResult.success ? null : signInResult.message),
            supabaseErrorCode: signInResult.supabaseErrorCode ?? null,
            supabaseErrorStatus: signInResult.supabaseErrorStatus ?? null,
            supabaseErrorName: signInResult.supabaseErrorName ?? null,
          },
        } : prev);
        if (signInResult.success) {
          clearAuthAttempts(target);
          if (normalizedEmail) clearAuthAttempts(normalizedEmail);
          setFailedLoginMessage(null);
          setLastFailureReason(null);
          setAttemptState({
            status: 'success',
            title: 'Owner Phone Login Verified',
            detail: `Phone called ${OWNER_REPAIR_ENDPOINT_PATH}, backend version ${OWNER_REPAIR_EXPECTED_BACKEND_VERSION} set the exact password entered on this screen, Supabase accepted that same value, device cooldown is clear, and Continue routes to the full app (Home / Invest / Market / Portfolio / Chat / Profile). Admin Panel and Owner Controls are reachable from Profile.`,
            email: target,
            tone: 'success',
            cooldownCleared: true,
          });
          // Auto-navigate immediately. Do not block on Alert/Continue —
          // the Supabase session is already live and the route guard will
          // hydrate isAdmin from the in-memory userRole. Showing an Alert
          // here can swallow the onPress on some Expo Go builds and leave
          // the user stuck on the login screen.
          navigateAfterSuccessfulLogin('password');
          return;
        }

        const exactMessage = signInResult.supabaseErrorMessage ?? signInResult.message;
        const isConfigError = exactMessage.toLowerCase().includes('supabase url is required')
          || exactMessage.toLowerCase().includes('not configured')
          || signInResult.failureReason === 'service_unavailable';

        if (isConfigError) {
          // The real problem is missing Supabase config, not a password mismatch.
          // Show a clear config error instead of the misleading "Same-Value Sign-In Failed".
          setAttemptState({
            status: 'failed',
            title: 'Supabase config missing — not a password problem',
            detail: 'The backend updated the password, but this app bundle could not reach Supabase for sign-in because the Supabase URL was not loaded. Clear the Expo Go cache and reload — the latest bundle has built-in production fallbacks.',
            email: target,
            tone: 'warning',
            supabaseErrorMessage: exactMessage,
            supabaseErrorCode: signInResult.supabaseErrorCode,
            supabaseErrorStatus: signInResult.supabaseErrorStatus,
            supabaseErrorName: signInResult.supabaseErrorName,
          });
          Alert.alert(
            'App Config Issue — Not a Password Problem',
            `The backend accepted your new password, but this Expo Go bundle could not connect to Supabase to sign you in.\n\nError: ${exactMessage}\n\nFix: Close Expo Go fully, reopen it, and reload the app. The latest code has production fallbacks that always load the Supabase URL.`
          );
          return;
        }

        const mismatchDetail = `Backend reported passwordUpdatedFromClientRequest=true, but Supabase still rejected immediate sign-in with the same phone password. Exact Supabase sign-in error: ${exactMessage}${signInResult.supabaseErrorCode ? ` (code: ${signInResult.supabaseErrorCode})` : ''}${signInResult.supabaseErrorStatus ? ` (HTTP ${signInResult.supabaseErrorStatus})` : ''}. Check that the mobile app and Render API point at the same Supabase project shown in the repair response.`;
        setAttemptState({
          status: 'failed',
          title: 'Owner password updated; same-value sign-in failed',
          detail: mismatchDetail,
          email: target,
          tone: 'warning',
          supabaseErrorMessage: exactMessage,
          supabaseErrorCode: signInResult.supabaseErrorCode,
          supabaseErrorStatus: signInResult.supabaseErrorStatus,
          supabaseErrorName: signInResult.supabaseErrorName,
        });
        Alert.alert('Same-Value Sign-In Failed', `${mismatchDetail}${signInResult.supabaseErrorName ? `\nType: ${signInResult.supabaseErrorName}` : ''}`);
        return;
      } catch (signInErr: unknown) {
        const msg = signInErr instanceof Error ? signInErr.message : String(signInErr ?? '');
        setRepairDebug((prev) => prev ? {
          ...prev,
          autoSignIn: { attempted: true, success: false, message: msg, supabaseErrorMessage: msg },
        } : prev);
        setAttemptState({
          status: 'failed',
          title: 'Owner password updated; sign-in exception',
          detail: `Exact sign-in exception after same-value repair: ${msg}`,
          email: target,
          tone: 'warning',
          supabaseErrorMessage: msg,
        });
        Alert.alert('Owner Password Updated — Sign-In Exception', `Exact sign-in exception: ${msg}`);
      }
    } catch (error: unknown) {
      const raw = error instanceof Error ? error.message : String(error ?? '');
      const name = error instanceof Error ? error.name : '';
      const isAbort = name === 'AbortError' || /abort/i.test(raw);
      setRepairDebug({
        endpoint,
        status: null,
        ok: false,
        timestamp: new Date().toISOString(),
        requestJson,
        response: `Network/exception: ${raw || name || 'unknown'}${isAbort ? '\n\nThe Render backend did not respond within 90 seconds. This usually means the free-tier service is cold-starting. Wait ~30 seconds and tap the button again — the second attempt typically succeeds because the service is now warm.' : ''}`,
      });
      const friendly = isAbort
        ? 'Render backend cold-start exceeded 90s and the request was aborted. The service should now be warming up — wait about 30 seconds and tap Reset password & log in again.'
        : raw && !/^\d+:\d+:/.test(raw)
          ? raw
          : 'Could not reach the server-side owner repair endpoint. Check your network and try again.';
      setAttemptState({
        status: 'failed',
        title: 'Server-side owner repair blocked',
        detail: friendly,
        email: target,
        tone: 'warning',
      });
      Alert.alert('Server Repair Blocked', friendly);
    } finally {
      setServerPasswordRepairLoading(false);
    }
  }, [effectiveRecoveryEmail, normalizedEmail, password, login, navigateAfterSuccessfulLogin, shake]);

  const handleLogin = async () => {
    if (loginSubmitInFlightRef.current || isLoading) {
      return;
    }

    setLastFailureReason(null);
    if (!email.trim()) {
      setAttemptState({
        status: 'failed',
        title: 'Email required',
        detail: 'Enter the exact owner or member email before submitting.',
        email: '',
        tone: 'warning',
      });
      Alert.alert('Missing Email', 'Please enter your email address.');
      shake();
      return;
    }
    if (!validateEmail(email.trim())) {
      setAttemptState({
        status: 'failed',
        title: 'Email format invalid',
        detail: 'The sign-in request was not sent because the email format is invalid.',
        email: email.trim(),
        tone: 'warning',
      });
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      shake();
      return;
    }
    const identifier = sanitizeEmail(email);

    const passwordForSignIn = password.trim();
    if (!passwordForSignIn) {
      setAttemptState({
        status: 'failed',
        title: 'Password required',
        detail: 'The app trims leading/trailing spaces, but it cannot sign in with an empty password.',
        email: identifier,
        tone: 'warning',
      });
      Alert.alert('Missing Password', 'Please enter your password.');
      shake();
      return;
    }
    const rateCheck = checkAuthRateLimit(identifier);
    if (!rateCheck.allowed) {
      const lockedMessage = getRateLimitMessage(rateCheck.lockedUntilMs);
      setAttemptState({
        status: 'failed',
        title: 'Device cooldown active',
        detail: lockedMessage,
        email: identifier,
        tone: 'warning',
      });
      shake();
      Alert.alert('Account Locked', lockedMessage);
      return;
    }

    loginSubmitInFlightRef.current = true;
    try {
      setAttemptState({
      status: 'submitting',
      title: 'Checking live credentials',
      detail: 'Submitting your exact email/password to Supabase and waiting for a real session response.',
      email: identifier,
      tone: 'neutral',
    });
    setFailedLoginMessage(null);

    // HARD PRE-SIGN-IN GUARD: verify the resolved Supabase config is valid
    // before sending credentials. This blocks the "Invalid API key" HTTP 401
    // that happens when a stale bundle has a wrong anon key/project. If the
    // config is bad, force the production client and re-check; if still bad,
    // surface a clear error instead of sending credentials to a bad endpoint.
    const preflight = preflightSupabaseConfig();
    if (!preflight.ok) {
      forceProductionSupabaseClient();
      const recheck = preflightSupabaseConfig();
      if (!recheck.ok) {
        shake();
        setAttemptState({
          status: 'failed',
          title: 'Mobile bundle has invalid Supabase anon key. Rebuild required.',
          detail: `Pre-sign-in guard blocked this login. ${recheck.reason} Config source: ${SUPABASE_CONFIG_SOURCE}. Clear the Expo Go cache and reload the app to get the latest bundle (OWNER_LOGIN_V15_GUARD).`,
          email: identifier,
          tone: 'warning',
          supabaseErrorMessage: recheck.reason,
          supabaseErrorName: 'PreflightGuardError',
          supabaseErrorStatus: 401,
        });
        setFailedLoginMessage(recheck.reason);
        setLastFailureReason('service_unavailable');
        Alert.alert(
          'App Config Issue — Not a Password Problem',
          `${recheck.reason}\n\nYour password was NOT sent to Supabase.\n\nFix: Close the app fully, reopen it, and reload. The latest bundle has a pre-sign-in guard that uses the correct production Supabase project.`
        );
        return;
      }
    } else {
    }

    // Pre-flight: catch missing Supabase config BEFORE submitting to avoid
    // the confusing "Supabase URL is required" AuthError that looks like a
    // password failure to the user.
    if (!SUPABASE_CONFIG_OK) {
      // Runtime guard: try to re-initialize in case the module-level init
      // failed in a stale bundle. If it still fails, surface a clear config
      // error instead of the misleading "Same-Value Sign-In Failed" alert.
      const runtimeOk = isSupabaseConfigured();
      const audit = getSupabaseConfigAudit();
      if (!runtimeOk) {
        shake();
        setAttemptState({
          status: 'failed',
          title: 'Supabase config missing',
          detail: `This app bundle could not connect to Supabase. Audit: url=${audit.urlConfigured} key=${audit.keyConfigured} fallback=${audit.usingFallback} host=${audit.host}. Clear the Expo Go cache and reload — the latest bundle has built-in production fallbacks that fix this.`,
          email: identifier,
          tone: 'warning',
          supabaseErrorMessage: SUPABASE_NOT_CONFIGURED_MESSAGE,
          supabaseErrorName: 'AuthError',
          supabaseErrorStatus: 500,
        });
        setFailedLoginMessage('Supabase is not configured in this bundle. Clear Expo Go cache and try again.');
        setLastFailureReason('service_unavailable');
        Alert.alert(
          'App Config Issue — Not a Password Problem',
          `This Expo Go bundle is missing the Supabase URL. Your password was NOT sent to Supabase.\n\nAudit: URL loaded=${audit.urlConfigured}, key loaded=${audit.keyConfigured}, fallback=${audit.usingFallback}, host=${audit.host}\n\nFix: Close Expo Go fully, reopen it, and reload the app. The latest code has production fallbacks that always load the Supabase URL.\n\nIf you still see this after reloading, the bundle is stale — use the Expo Go shake gesture or clear app data.`
        );
        return;
      }
      // If runtime re-init succeeded, keep going with the real client.
    }

    const result = await login(identifier, passwordForSignIn);
    if (result.success || result.requiresTwoFactor) {
      recordAuthAttempt(identifier, true);
    } else if (result.failureReason === 'invalid_credentials') {
      recordAuthAttempt(identifier, false);
    }

    if (result.success) {
      setLastFailureReason(null);
      setAttemptState({
        status: 'success',
        title: 'Session verified',
        detail: 'Supabase returned a live session. Opening your workspace now.',
        email: identifier,
        tone: 'success',
      });
      navigateAfterSuccessfulLogin('password');
      return;
    }

    if (result.requiresTwoFactor) {
      setLastFailureReason(null);
      setAttemptState({
        status: 'success',
        title: 'Second factor required',
        detail: 'Your password was accepted. Enter the verification code to complete sign-in.',
        email: identifier,
        tone: 'neutral',
      });
      return;
    }

    shake();
    const normalizedMessage = result.message || 'Invalid email or password.';
    setLastFailureReason(result.failureReason ?? null);
    setFailedLoginMessage(normalizedMessage);

    const shouldAuditOwnerRecovery = shouldAuditOwnerRecoveryForFailure(result.failureReason, normalizedMessage);

    let audit: OwnerDirectAccessAuditResult | null = null;
    if (shouldAuditOwnerRecovery) {
      try {
        audit = await auditOwnerDirectAccess(identifier);
        setOwnerRecoveryAudit(audit);
      } catch (error: unknown) {
      }
    }

    const nextRateCheck = result.failureReason === 'invalid_credentials'
      ? checkAuthRateLimit(identifier)
      : rateCheck;
    const baseFailureMessage = buildLoginFailureAlertMessage(
      normalizedMessage,
      result.failureReason,
      nextRateCheck.remainingAttempts,
      nextRateCheck.lockedUntilMs,
    );
    const supabaseFailureDetail = result.supabaseErrorMessage ?? normalizedMessage;
    const msg = audit?.emailMismatch
      ? `${baseFailureMessage}\n\n${audit.message}`
      : baseFailureMessage;

    setAttemptState({
      status: 'failed',
      title: result.failureReason === 'admin_access_locked'
        ? 'Admin access is temporarily locked'
        : audit?.eligible
          ? result.failureReason === 'service_unavailable'
            ? 'Live sign-in unavailable, trusted owner restore available'
            : 'Direct sign-in blocked, trusted owner restore available'
          : audit?.emailMismatch
            ? 'Trusted owner email mismatch'
            : result.failureReason === 'service_unavailable'
              ? 'Live sign-in temporarily unavailable'
              : 'Server rejected this sign-in',
      detail: result.supabaseErrorMessage
        ? `${msg}\n\nExact Supabase auth error: ${supabaseFailureDetail}${result.supabaseErrorCode ? ` (code: ${result.supabaseErrorCode})` : ''}${result.supabaseErrorStatus ? ` (HTTP ${result.supabaseErrorStatus})` : ''}`
        : msg,
      email: identifier,
      tone: 'warning',
      supabaseErrorMessage: result.supabaseErrorMessage,
      supabaseErrorCode: result.supabaseErrorCode,
      supabaseErrorStatus: result.supabaseErrorStatus,
      supabaseErrorName: result.supabaseErrorName,
    });

    if (audit?.eligible) {
      Alert.alert(
        'Owner Access Available',
        `${msg}\n\nThis device is already verified for trusted owner recovery. You can restore owner access without signing in again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restore Owner Access', onPress: () => { void handleOwnerTrustedRestore(); } },
        ]
      );
      return;
    }

    Alert.alert(
      'Sign In Failed',
      result.supabaseErrorMessage
        ? `${msg}\n\nExact Supabase auth error: ${supabaseFailureDetail}${result.supabaseErrorCode ? `\nCode: ${result.supabaseErrorCode}` : ''}${result.supabaseErrorStatus ? `\nHTTP status: ${result.supabaseErrorStatus}` : ''}${result.supabaseErrorName ? `\nType: ${result.supabaseErrorName}` : ''}`
        : msg,
    );
    } finally {
      loginSubmitInFlightRef.current = false;
    }
  };

  const handle2FAInput = (index: number, value: string) => {
    const updated = [...twoFACode];
    updated[index] = value;
    setTwoFACode(updated);
    if (value && index < 5) {
      twoFARefs.current[index + 1]?.focus();
    }
    if (updated.every(c => c !== '')) {
      void handleVerify2FA(updated.join(''));
    }
  };

  const handle2FAKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !twoFACode[index] && index > 0) {
      twoFARefs.current[index - 1]?.focus();
    }
  };

  const handleVerify2FA = async (code: string) => {
    const result = await verify2FA(code);
    if (!result.success) {
      shake();
      setTwoFACode(['', '', '', '', '', '']);
      twoFARefs.current[0]?.focus();
      Alert.alert('Invalid Code', result.message || 'The 2FA code is incorrect.');
      return;
    }

    navigateAfterSuccessfulLogin('two-factor');
  };

  const isLoading = loginLoading || verify2FALoading;
  const rateLimitSnapshot = useMemo(() => {
    if (!normalizedEmail) {
      return { allowed: true, remainingAttempts: 0, lockedUntilMs: 0 };
    }

    return checkAuthRateLimit(normalizedEmail);
  }, [normalizedEmail, failedLoginMessage, lastFailureReason]);
  const ownerRepairReadinessQuery = useQuery<OwnerRepairReadiness>({
    queryKey: ['owner-repair-readiness'],
    queryFn: fetchOwnerRepairReadiness,
    staleTime: 60000,
    enabled: !openAccessMode,
  });
  const ownerRepairReadiness = ownerRepairReadinessQuery.data ?? getOwnerRepairReadiness();
  const loginIssueItems = useMemo<LoginIssueItem[]>(() => buildLoginIssueItems({
    failureReason: lastFailureReason,
    failedLoginMessage,
    attemptedEmail: normalizedEmail,
    remainingAttempts: rateLimitSnapshot.remainingAttempts,
    lockedUntilMs: rateLimitSnapshot.lockedUntilMs,
    audit: ownerRecoveryAudit,
    ownerRepairReadiness,
  }), [failedLoginMessage, lastFailureReason, normalizedEmail, ownerRecoveryAudit, ownerRepairReadiness, rateLimitSnapshot.lockedUntilMs, rateLimitSnapshot.remainingAttempts]);
  const criticalLoginIssues = useMemo<LoginIssueItem[]>(() => loginIssueItems.filter((item) => item.severity === 'critical'), [loginIssueItems]);
  const warningLoginIssues = useMemo<LoginIssueItem[]>(() => loginIssueItems.filter((item) => item.severity === 'warning'), [loginIssueItems]);
  const successLoginIssues = useMemo<LoginIssueItem[]>(() => loginIssueItems.filter((item) => item.severity === 'success'), [loginIssueItems]);
  const shouldShowOwnerAccessNotice = liveOwnerAuditLoading
    || isOwnerIPAccess
    || (isAuthenticated && isAdmin)
    || !!ownerRecoveryAudit?.eligible
    || !!ownerRecoveryAudit?.emailMismatch
    || !!ownerRecoveryAudit?.ownerDeviceVerified;
  const ownerAccessNoticeAccent = ownerRecoveryAudit?.eligible || isOwnerIPAccess
    ? Colors.success
    : ownerRecoveryAudit?.emailMismatch
      ? Colors.error
      : ownerRecoveryAudit?.ownerDeviceVerified
        ? Colors.warning
        : Colors.primary;
  const ownerAccessNoticeMessage = liveOwnerAuditLoading
    ? 'Checking whether this device still qualifies for trusted owner recovery.'
    : ownerRecoveryAudit?.eligible
      ? `Trusted owner recovery available${ownerRecoveryAudit.currentIP ? ` · ${ownerRecoveryAudit.currentIP}` : ''}`
      : ownerRecoveryAudit?.emailMismatch && ownerRecoveryAudit.verifiedEmail
        ? `Verified owner email on this device: ${ownerRecoveryAudit.verifiedEmail}`
        : ownerRecoveryAudit?.ownerDeviceVerified
          ? ownerRecoveryAudit.message
          : isOwnerIPAccess
            ? `Trusted owner device recognized${detectedIP ? ` · ${detectedIP}` : ''}`
            : 'Verified owner session detected. Open your owner access hub.';
  const ownerAccessNoticeLink = ownerRecoveryAudit?.eligible
    ? 'Restore owner access now'
    : ownerRecoveryAudit?.emailMismatch && ownerRecoveryAudit.verifiedEmail
      ? 'Send verified owner reset link'
      : ownerRecoveryAudit?.ownerDeviceVerified
        ? 'Open owner access audit'
        : 'Open owner access';
  const canSendPasswordReset = !!effectiveRecoveryEmail && validateEmail(effectiveRecoveryEmail);
  const shouldPromoteResetAction = !effectiveOwnerMode
    && !ownerRecoveryAudit?.eligible
    && canSendPasswordReset
    && lastFailureReason === 'invalid_credentials';
  const ownerPhoneLoginVerified = effectiveOwnerMode
    && attemptState.status === 'success'
    && attemptState.title === 'Owner Phone Login Verified'
    && repairDebug?.autoSignIn?.success === true;
  const adminLockUpdateItems = useMemo<RecoveryTruthItem[]>(() => {
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
  const recoveryTruthItems = useMemo<RecoveryTruthItem[]>(() => {
    const resetTargetLabel = effectiveRecoveryEmail || 'your verified owner email';

    return [
      {
        id: 'truth-direct-signin',
        title: 'Normal owner sign-in',
        detail: 'This screen requires the exact owner email and password. The server repair key is not used for that sign-in.',
      },
      {
        id: 'truth-service-role',
        title: ownerRepairReadiness.hasRealServiceRole
          ? 'Backend repair is ready if support truly needs it'
          : 'Backend repair is separate from your sign-in',
        detail: ownerRepairReadiness.hasRealServiceRole
          ? 'If support must inspect or repair an existing owner auth user directly, the backend has the required admin authority.'
          : 'A missing or bad service-role key only affects backend-only repair of an existing owner auth user. It did not cause the password rejection on this screen.',
      },
      {
        id: 'truth-fastest-path',
        title: 'Fastest safe path now',
        detail: ownerRecoveryAudit?.eligible
          ? 'This device is already trusted. Use restore to reopen owner access without another password entry.'
          : `Admin login cannot safely be removed from a new or unverified device. If the password is wrong or unknown, send a reset link to ${resetTargetLabel}, sign in with the new password, then verify this device again.`,
      },
    ];
  }, [effectiveRecoveryEmail, ownerRecoveryAudit?.eligible, ownerRepairReadiness.hasRealServiceRole]);

  const hasVisibleSupabaseError = Boolean(attemptState.supabaseErrorMessage || attemptState.supabaseErrorCode || attemptState.supabaseErrorStatus || attemptState.supabaseErrorName);
  const loginTitle = effectiveOwnerMode ? 'Owner Login' : 'Welcome Back';
  const loginSubtitle = effectiveOwnerMode
    ? 'Enter your verified owner email and password. The owner account must sign in manually every launch — no automatic owner access.'
    : 'Use direct email/password sign-in first. Owner recovery stays available below if this device was already verified.';
  const signInButtonLabel = effectiveOwnerMode ? 'Owner Sign In' : 'Sign In';
  const ownerAlternativeTitle = effectiveOwnerMode
    ? 'Owner recovery hub'
    : adminAccessLocked
      ? 'Owner-only admin access'
      : 'Owner access alternative';
  const ownerAlternativeText = effectiveOwnerMode
    ? 'Password issue or trusted device? Open Owner Access to restore a verified owner device. Owner signup is not used for returning owner access.'
    : adminAccessLocked
      ? `${adminAccessLockMessage} If this is the configured owner account, open Owner Access to continue with the owner-only route.`
      : 'If this is your project owner account, do not use public signup. Open Owner Access to restore trusted-device access, confirm the carried owner email, or use the safe reset path. Admin login is not removed on new devices.';
  const signupChoiceTitle = 'Need a new account?';
  const signupChoiceSubtitle = 'Choose the correct signup path. Owner accounts are separate from workers and regular users.';

  if (openAccessMode && !effectiveOwnerMode) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
          <View style={styles.openAccessContainer}>
            <Animated.View style={[styles.formCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <Text style={styles.title}>Workspace is open</Text>
              <Text style={styles.subtitle}>{openAccessMessage}</Text>
              <TouchableOpacity
                style={styles.signInBtn}
                onPress={() => router.replace('/(tabs)/(home)/home' as any)}
                activeOpacity={0.85}
                testID="login-open-app-direct"
              >
                <Text style={styles.signInBtnText}>Open App</Text>
                <ChevronRight size={20} color={Colors.black} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.ownerAlternativeCard}
                activeOpacity={0.84}
                onPress={() => router.replace('/admin' as any)}
                testID="login-open-admin-direct"
              >
                <View style={styles.ownerAlternativeIconWrap}>
                  <Shield size={18} color={Colors.black} />
                </View>
                <View style={styles.ownerAlternativeContent}>
                  <Text style={styles.ownerAlternativeTitle}>Admin is open too</Text>
                  <Text style={styles.ownerAlternativeText}>Login is disabled in this build. Open Admin directly while emergency access recovery stays active.</Text>
                </View>
                <ChevronRight size={18} color={Colors.primary} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (requiresTwoFactor) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <Animated.View style={[styles.container, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <TouchableOpacity style={styles.backButton} onPress={() => { cancelTwoFactor(); }}>
                <ArrowLeft size={22} color={Colors.text} />
              </TouchableOpacity>

              <View style={styles.twoFAHeader}>
                <View style={styles.twoFAIconWrap}>
                  <Shield size={32} color={Colors.primary} />
                </View>
                <Text style={styles.twoFATitle}>Two-Factor Auth</Text>
                <Text style={styles.twoFASubtitle}>
                  {pendingTwoFactorEmail
                    ? `Enter the 6-digit code from ${pendingTwoFactorFactorLabel} to finish signing in as ${pendingTwoFactorEmail}.`
                    : `Enter the 6-digit code from ${pendingTwoFactorFactorLabel} to finish signing in.`}
                </Text>
              </View>

              <Animated.View style={[styles.codeRow, { transform: [{ translateX: shakeAnim }] }]}>
                {twoFACode.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={r => { twoFARefs.current[i] = r; }}
                    style={[styles.codeBox, digit && styles.codeBoxFilled]}
                    value={digit}
                    onChangeText={v => handle2FAInput(i, v.replace(/[^0-9]/g, '').slice(-1))}
                    onKeyPress={({ nativeEvent }) => handle2FAKeyPress(i, nativeEvent.key)}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                    testID={`login-2fa-digit-${i + 1}`}
                  />
                ))}
              </Animated.View>

              {isLoading && (
                <ActivityIndicator color={Colors.primary} style={{ marginTop: 24 }} />
              )}

              <TouchableOpacity style={styles.cancelLink} onPress={() => cancelTwoFactor()}>
                <Text style={styles.cancelLinkText}>Back to Sign In</Text>
              </TouchableOpacity>
            </Animated.View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
              <ArrowLeft size={22} color={Colors.text} />
            </TouchableOpacity>

            <Animated.View style={[styles.heroSection, {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }, { scale: logoScale }],
            }]}>
              <View style={styles.logoCard}>
                <Image source={IVX_LOGO_SOURCE} style={styles.logo} resizeMode="contain" />
              </View>
              <Text style={styles.brand}>IVX HOLDINGS LLC</Text>
              <Text style={styles.tagline}>Premium Real Estate Investing</Text>
            </Animated.View>

            <Animated.View style={[styles.formCard, {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }, { translateX: shakeAnim }],
            }]}>
              <Text style={styles.title}>{loginTitle}</Text>
              <Text style={styles.subtitle}>{loginSubtitle}</Text>

              {/* Amazon/Instagram-level UX: a single clean inline error line when the
                  advanced diagnostic panel is collapsed. The full diagnostic card
                  (with telemetry, repair buttons, issue matrix) stays available
                  behind the "Troubleshoot access" disclosure below. */}
              {!showAdvanced && failedLoginMessage ? (
                <View style={styles.inlineErrorRow} testID="login-inline-error">
                  <AlertTriangle size={14} color={Colors.error} />
                  <Text style={styles.inlineErrorText} numberOfLines={2}>{failedLoginMessage}</Text>
                </View>
              ) : null}
              {!showAdvanced && attemptState.kind === 'reset-sent' ? (
                <View style={styles.inlineSuccessRow} testID="login-inline-success">
                  <MailCheck size={14} color={Colors.success} />
                  <Text style={styles.inlineSuccessText} numberOfLines={2}>Reset link sent to {attemptState.email}. Check your inbox.</Text>
                </View>
              ) : null}

              {showAdvanced && adminAccessLocked ? (
                <View style={styles.adminLockCard} testID="login-admin-lock-card">
                  <View style={styles.authAuditHeader}>
                    <Shield size={15} color={Colors.error} />
                    <Text style={styles.authAuditTitle}>Admin access locked</Text>
                  </View>
                  <Text style={styles.authAuditText}>{adminAccessLockMessage}</Text>
                  <View style={styles.truthList}>
                    {adminLockUpdateItems.map((item, index) => (
                      <View key={item.id} style={styles.truthRow}>
                        <View style={styles.truthIndexWrap}>
                          <Text style={styles.truthIndex}>{index + 1}</Text>
                        </View>
                        <View style={styles.truthBody}>
                          <Text style={styles.truthRowTitle}>{item.title}</Text>
                          <Text style={styles.truthRowDetail}>{item.detail}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {showAdvanced && attemptState.kind === 'reset-sent' ? (
                <View style={styles.resetSentCard} testID="login-reset-sent-card">
                  <View style={styles.resetSentIconWrap}>
                    <MailCheck size={28} color={Colors.success} />
                  </View>
                  <Text style={styles.resetSentTitle}>Check your email</Text>
                  <Text style={styles.resetSentSubtitle}>We sent a password reset link to</Text>
                  <Text style={styles.resetSentEmail} numberOfLines={1}>{attemptState.email}</Text>
                  <View style={styles.resetSentSteps}>
                    {[
                      'Open your inbox (check spam too).',
                      'Tap the reset link from Supabase.',
                      'Set a new password, then come back and sign in.',
                    ].map((step, idx) => (
                      <View key={`reset-step-${idx}`} style={styles.resetSentStepRow}>
                        <View style={styles.resetSentStepBadge}><Text style={styles.resetSentStepBadgeText}>{idx + 1}</Text></View>
                        <Text style={styles.resetSentStepText}>{step}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.resetSentHint}>Didn’t get it after a minute? Tap “Forgot owner password?” again or use the server-side repair below.</Text>
                  {attemptState.cooldownCleared ? (
                    <View style={styles.cooldownClearedChip} testID="login-cooldown-cleared-chip">
                      <Text style={styles.cooldownClearedChipText}>Cooldown cleared ✓</Text>
                    </View>
                  ) : null}
                </View>
              ) : showAdvanced ? (
                <View
                  style={[
                    styles.authAuditCard,
                    attemptState.tone === 'success'
                      ? styles.authAuditCardSuccess
                      : attemptState.tone === 'warning'
                        ? styles.authAuditCardWarning
                        : styles.authAuditCardNeutral,
                  ]}
                  testID="login-auth-audit-card"
                >
                  <View style={styles.authAuditHeader}>
                    <Shield
                      size={15}
                      color={attemptState.tone === 'success' ? Colors.success : attemptState.tone === 'warning' ? '#F59E0B' : Colors.primary}
                    />
                    <Text style={styles.authAuditTitle}>{attemptState.title}</Text>
                  </View>
                  <Text style={styles.authAuditText}>{attemptState.detail}</Text>
                  {attemptState.email ? (
                    <View style={styles.authAuditEmailRow}>
                      <Text style={styles.authAuditEmailLabel}>Email checked</Text>
                      <Text style={styles.authAuditEmailValue}>{attemptState.email}</Text>
                    </View>
                  ) : null}
                  {attemptState.cooldownCleared ? (
                    <View style={styles.cooldownClearedChip} testID="login-cooldown-cleared-chip">
                      <Text style={styles.cooldownClearedChipText}>Cooldown cleared</Text>
                    </View>
                  ) : null}
                  {ownerPhoneLoginVerified ? (
                    <TouchableOpacity
                      style={styles.ownerVerifiedContinueButton}
                      activeOpacity={0.86}
                      onPress={() => navigateAfterSuccessfulLogin('password')}
                      testID="owner-phone-login-verified-continue"
                    >
                      <Text style={styles.ownerVerifiedContinueButtonText}>Continue to Home</Text>
                      <ChevronRight size={16} color={Colors.black} />
                    </TouchableOpacity>
                  ) : null}
                  {hasVisibleSupabaseError ? (
                    <View style={styles.supabaseErrorBox} testID="login-supabase-exact-error">
                      <Text style={styles.supabaseErrorTitle}>Exact Supabase auth error</Text>
                      {attemptState.supabaseErrorMessage ? <Text style={styles.supabaseErrorLine} selectable>message: {attemptState.supabaseErrorMessage}</Text> : null}
                      {attemptState.supabaseErrorCode ? <Text style={styles.supabaseErrorLine} selectable>code: {attemptState.supabaseErrorCode}</Text> : null}
                      {attemptState.supabaseErrorStatus ? <Text style={styles.supabaseErrorLine} selectable>http_status: {attemptState.supabaseErrorStatus}</Text> : null}
                      {attemptState.supabaseErrorName ? <Text style={styles.supabaseErrorLine} selectable>type: {attemptState.supabaseErrorName}</Text> : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {showAdvanced && effectiveOwnerMode ? <SupabaseAuthDiagnostic /> : null}
              {showAdvanced && effectiveOwnerMode ? <OwnerAuthActions /> : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Email Address</Text>
                <View style={styles.inputWrap}>
                  <Mail size={18} color={Colors.textTertiary} />
                  <TextInput
                    style={styles.input}
                    placeholder="you@example.com"
                    placeholderTextColor={Colors.inputPlaceholder}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    returnKeyType="next"
                    testID="login-email"
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.fieldLabel}>Password</Text>
                  {!effectiveOwnerMode ? (
                    <TouchableOpacity
                      onPress={() => {
                        router.push({
                          pathname: '/forgot-password',
                          params: normalizedEmail ? { email: normalizedEmail } : undefined,
                        } as Href);
                      }}
                      disabled={passwordResetLoading}
                    >
                      <Text style={styles.forgotLink}>{passwordResetLoading ? 'Sending…' : 'Forgot?'}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={styles.inputWrap}>
                  <Lock size={18} color={Colors.textTertiary} />
                  <TextInput
                    style={styles.input}
                    placeholder={effectiveOwnerMode ? 'Owner mode: password ignored' : '••••••••'}
                    placeholderTextColor={Colors.inputPlaceholder}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoComplete="password"
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                    testID="login-password"
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    {showPassword
                      ? <EyeOff size={18} color={Colors.textTertiary} />
                      : <Eye size={18} color={Colors.textTertiary} />
                    }
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={styles.rememberMeRow}
                onPress={toggleRememberMe}
                activeOpacity={0.7}
                testID="login-remember-me"
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe ? <Check size={14} color={Colors.black} strokeWidth={3} /> : null}
                </View>
                <Text style={styles.rememberMeText}>Remember Me</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.signInBtn, isLoading && styles.signInBtnDisabled]}
                onPress={handleLogin}
                disabled={isLoading}
                activeOpacity={0.85}
                testID="login-submit"
              >
                {isLoading ? (
                  <ActivityIndicator color={Colors.black} />
                ) : (
                  <>
                    <Text style={styles.signInBtnText}>{signInButtonLabel}</Text>
                    <ChevronRight size={20} color={Colors.black} />
                  </>
                )}
              </TouchableOpacity>

              {/* Amazon/Instagram-level UX: a single muted "Troubleshoot access"
                  disclosure that expands the full diagnostic + recovery panel.
                  Collapsed by default so the owner sees a clean sign-in. */}
              <TouchableOpacity
                style={styles.troubleshootToggle}
                onPress={() => setShowAdvanced((v) => !v)}
                activeOpacity={0.7}
                testID="login-troubleshoot-toggle"
              >
                <Shield size={13} color={Colors.textTertiary} />
                <Text style={styles.troubleshootToggleText}>{showAdvanced ? 'Hide advanced options' : 'Troubleshoot access'}</Text>
                <ChevronRight size={13} color={Colors.textTertiary} style={{ transform: [{ rotate: showAdvanced ? '90deg' : '0deg' }] }} />
              </TouchableOpacity>

              {showAdvanced && effectiveOwnerMode ? (
                <TouchableOpacity
                  style={styles.ownerSmsRecoveryButton}
                  activeOpacity={0.84}
                  onPress={() => router.push({ pathname: '/owner-sms-recovery', params: { email: normalizedEmail } } as Href)}
                  testID="owner-login-sms-recovery"
                >
                  <Text style={styles.ownerSmsRecoveryButtonText}>Lost password? Recover via SMS</Text>
                </TouchableOpacity>
              ) : null}

              {showAdvanced && effectiveOwnerMode ? (
                <>
                  <TouchableOpacity
                    style={[styles.ownerPasswordResetCard, passwordResetLoading && styles.ownerPasswordResetCardDisabled, { opacity: 0.85 }]}
                    activeOpacity={0.84}
                    onPress={() => { void handlePasswordReset(); }}
                    disabled={passwordResetLoading}
                    testID="owner-login-forgot-password"
                  >
                    {passwordResetLoading ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Mail size={16} color={Colors.primary} />
                    )}
                    <View style={styles.ownerPasswordResetContent}>
                      <Text style={styles.ownerPasswordResetTitle}>Secondary/manual fallback: email reset</Text>
                      <Text style={styles.ownerPasswordResetText}>May be rate-limited and requires Supabase redirect allow-list: https://ivxholding.com/reset-password.html. This never blocks the primary server reset above.</Text>
                    </View>
                    <ChevronRight size={16} color={Colors.primary} />
                  </TouchableOpacity>
                </>
              ) : null}

              {showAdvanced && shouldShowOwnerAccessNotice ? (
                <TouchableOpacity
                  style={styles.ownerAccessNotice}
                  testID="login-owner-access-notice"
                  activeOpacity={0.82}
                  onPress={ownerRecoveryAudit?.eligible
                    ? () => { void handleOwnerTrustedRestore(); }
                    : ownerRecoveryAudit?.emailMismatch && ownerRecoveryAudit.verifiedEmail
                      ? () => { void handlePasswordReset(ownerRecoveryAudit.verifiedEmail ?? undefined); }
                      : () => openOwnerAccess('owner-recovery')}
                  disabled={ownerRecoveryLoading || passwordResetLoading}
                >
                  {ownerRecoveryLoading || passwordResetLoading || liveOwnerAuditLoading ? (
                    <ActivityIndicator size="small" color={ownerAccessNoticeAccent} />
                  ) : (
                    <Shield size={16} color={ownerAccessNoticeAccent} />
                  )}
                  <View style={styles.ownerAccessNoticeContent}>
                    <Text style={styles.ownerAccessNoticeText}>{ownerAccessNoticeMessage}</Text>
                    <Text style={[styles.ownerAccessLink, { color: ownerAccessNoticeAccent }]}>{ownerAccessNoticeLink}</Text>
                  </View>
                  <ChevronRight size={16} color={ownerAccessNoticeAccent} />
                </TouchableOpacity>
              ) : null}

              {showAdvanced ? (
              <TouchableOpacity
                style={styles.ownerAlternativeCard}
                activeOpacity={0.84}
                onPress={() => {
                  openOwnerAccess('login');
                }}
                testID="login-owner-alternative"
              >
                <View style={styles.ownerAlternativeIconWrap}>
                  <Shield size={18} color={Colors.black} />
                </View>
                <View style={styles.ownerAlternativeContent}>
                  <Text style={styles.ownerAlternativeTitle}>{ownerAlternativeTitle}</Text>
                  <Text style={styles.ownerAlternativeText}>{ownerAlternativeText}</Text>
                </View>
                <ChevronRight size={18} color={Colors.primary} />
              </TouchableOpacity>
              ) : null}

              {showAdvanced ? (
              <View style={styles.truthCard} testID="login-truth-card">
                <Text style={styles.truthTitle}>Straight answer</Text>
                <Text style={styles.truthSubtitle}>Why the server repair key came up, and what actually gets you back in fastest.</Text>
                <View style={styles.truthList}>
                  {recoveryTruthItems.map((item, index) => (
                    <View key={item.id} style={styles.truthRow}>
                      <View style={styles.truthIndexWrap}>
                        <Text style={styles.truthIndex}>{index + 1}</Text>
                      </View>
                      <View style={styles.truthBody}>
                        <Text style={styles.truthRowTitle}>{item.title}</Text>
                        <Text style={styles.truthRowDetail}>{item.detail}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
              ) : null}

              {showAdvanced && failedLoginMessage ? (
                <View style={styles.loginFailureCard} testID="login-failure-card">
                  <View style={styles.loginFailureHeader}>
                    <Shield size={15} color={lastFailureReason === 'admin_access_locked' ? Colors.error : ownerRecoveryAudit?.eligible ? Colors.success : '#F59E0B'} />
                    <Text style={styles.loginFailureTitle}>{lastFailureReason === 'admin_access_locked' ? 'Admin access locked' : ownerRecoveryAudit?.eligible ? 'Owner recovery is available' : ownerRecoveryAudit?.emailMismatch ? 'Trusted owner email mismatch' : 'Sign-in needs attention'}</Text>
                  </View>
                  <Text style={styles.loginFailureText}>{failedLoginMessage}</Text>
                  <Text style={styles.loginFailureHint}>
                    {lastFailureReason === 'admin_access_locked'
                      ? adminAccessLockMessage
                      : ownerRecoveryAudit?.eligible
                        ? 'This device is already trusted. Restore owner access instantly or open the owner hub.'
                        : ownerRecoveryAudit?.emailMismatch && ownerRecoveryAudit.verifiedEmail
                          ? `Use ${ownerRecoveryAudit.verifiedEmail} on Sign In or open Owner Access to continue with the verified owner route.`
                          : 'If this is your owner account, use Owner Access instead of creating a new public account.'}
                  </Text>
                  {normalizedEmail ? (
                    <View style={styles.failedEmailChip} testID="login-failed-email-chip">
                      <Text style={styles.failedEmailChipLabel}>Last attempted owner email</Text>
                      <Text style={styles.failedEmailChipValue}>{normalizedEmail}</Text>
                    </View>
                  ) : null}
                  {loginIssueItems.length > 0 ? (
                    <View style={styles.issueMatrix} testID="login-issue-matrix">
                      {criticalLoginIssues.length > 0 ? (
                        <View style={styles.issueGroup}>
                          <Text style={[styles.issueGroupTitle, styles.issueGroupTitleCritical]}>Red blockers</Text>
                          {criticalLoginIssues.map((item, index) => (
                            <View key={item.id} style={[styles.issueRow, styles.issueRowCritical]}>
                              <View style={[styles.issueIndexWrap, styles.issueIndexWrapCritical]}>
                                <Text style={styles.issueIndex}>{index + 1}</Text>
                              </View>
                              <View style={styles.issueBody}>
                                <Text style={styles.issueTitle}>{item.title}</Text>
                                <Text style={styles.issueDetail}>{item.detail}</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {warningLoginIssues.length > 0 ? (
                        <View style={styles.issueGroup}>
                          <Text style={[styles.issueGroupTitle, styles.issueGroupTitleWarning]}>Yellow warnings</Text>
                          {warningLoginIssues.map((item, index) => (
                            <View key={item.id} style={[styles.issueRow, styles.issueRowWarning]}>
                              <View style={[styles.issueIndexWrap, styles.issueIndexWrapWarning]}>
                                <Text style={styles.issueIndex}>{index + 1}</Text>
                              </View>
                              <View style={styles.issueBody}>
                                <Text style={styles.issueTitle}>{item.title}</Text>
                                <Text style={styles.issueDetail}>{item.detail}</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {successLoginIssues.length > 0 ? (
                        <View style={styles.issueGroup}>
                          <Text style={[styles.issueGroupTitle, styles.issueGroupTitleSuccess]}>Verified recovery paths</Text>
                          {successLoginIssues.map((item, index) => (
                            <View key={item.id} style={[styles.issueRow, styles.issueRowSuccess]}>
                              <View style={[styles.issueIndexWrap, styles.issueIndexWrapSuccess]}>
                                <Text style={styles.issueIndex}>{index + 1}</Text>
                              </View>
                              <View style={styles.issueBody}>
                                <Text style={styles.issueTitle}>{item.title}</Text>
                                <Text style={styles.issueDetail}>{item.detail}</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  <View style={styles.loginFailureActions}>
                    {ownerRecoveryAudit?.eligible ? (
                      <TouchableOpacity
                        style={[styles.loginFailurePrimaryAction, ownerRecoveryLoading && styles.loginFailureActionDisabled]}
                        activeOpacity={0.84}
                        onPress={() => { void handleOwnerTrustedRestore(); }}
                        disabled={ownerRecoveryLoading}
                        testID="login-restore-owner-access"
                      >
                        {ownerRecoveryLoading ? (
                          <ActivityIndicator size="small" color={Colors.black} />
                        ) : (
                          <>
                            <Text style={styles.loginFailurePrimaryActionText}>Restore owner access</Text>
                            <ChevronRight size={16} color={Colors.black} />
                          </>
                        )}
                      </TouchableOpacity>
                    ) : null}
                    {effectiveOwnerMode ? (
                      <TouchableOpacity
                        style={[styles.loginFailurePrimaryAction, serverPasswordRepairLoading && styles.loginFailureActionDisabled]}
                        activeOpacity={0.84}
                        onPress={() => { void handleServerOwnerPasswordRepair(); }}
                        disabled={serverPasswordRepairLoading}
                        testID="login-failure-server-owner-reset"
                      >
                        {serverPasswordRepairLoading ? (
                          <ActivityIndicator size="small" color={Colors.black} />
                        ) : (
                          <>
                            <Text style={styles.loginFailurePrimaryActionText}>Server reset with typed password</Text>
                            <ChevronRight size={16} color={Colors.black} />
                          </>
                        )}
                      </TouchableOpacity>
                    ) : null}
                    {canSendPasswordReset ? (
                      <TouchableOpacity
                        style={[
                          shouldPromoteResetAction ? styles.loginFailurePrimaryAction : styles.loginFailureSecondaryAction,
                          passwordResetLoading && styles.loginFailureActionDisabled,
                        ]}
                        activeOpacity={0.84}
                        onPress={() => { void handlePasswordReset(); }}
                        disabled={passwordResetLoading}
                        testID="login-reset-owner-password"
                      >
                        {passwordResetLoading ? (
                          <ActivityIndicator size="small" color={shouldPromoteResetAction ? Colors.black : Colors.text} />
                        ) : shouldPromoteResetAction ? (
                          <>
                            <Text style={styles.loginFailurePrimaryActionText}>Reset password now</Text>
                            <ChevronRight size={16} color={Colors.black} />
                          </>
                        ) : (
                          <Text style={styles.loginFailureSecondaryActionText}>Send reset link</Text>
                        )}
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={styles.loginFailureSecondaryAction}
                      activeOpacity={0.84}
                      onPress={() => openOwnerAccess('login-failure')}
                      testID="login-open-owner-hub"
                    >
                      <Text style={styles.loginFailureSecondaryActionText}>Open owner hub</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {!effectiveOwnerMode ? (
                <>
                  <View style={styles.dividerRow}>
                    <View style={styles.divider} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.divider} />
                  </View>

                  <View style={styles.signupChoiceCard} testID="login-signup-choice-card">
                    <Text style={styles.signupChoiceTitle}>{signupChoiceTitle}</Text>
                    <Text style={styles.signupChoiceSubtitle}>{signupChoiceSubtitle}</Text>
                    <View style={styles.signupChoiceActions}>
                      <TouchableOpacity
                        style={styles.signupChoiceButton}
                        activeOpacity={0.84}
                        onPress={() => router.replace('/signup' as any)}
                        testID="login-create-regular-account"
                      >
                        <Text style={styles.signupChoiceButtonLabel}>Create regular user account</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              ) : null}
            </Animated.View>

            <Animated.View style={[styles.securityRow, { opacity: fadeAnim }]}>
              <Shield size={13} color={Colors.textTertiary} />
              <Text style={styles.securityText}>Bank-grade encryption · Escrow protected · Regulated structure</Text>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export default function LoginScreen() {
  return <LoginScreenContent />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  openAccessContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    paddingHorizontal: 20,
  },
  backButton: {
    marginTop: 8,
    marginLeft: 20,
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 28,
  },
  logoCard: {
    borderRadius: 24,
    padding: 8,
    backgroundColor: '#090909',
    borderWidth: 1,
    borderColor: Colors.primary + '22',
    marginBottom: 14,
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 20,
    backgroundColor: '#090909',
  },
  brand: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '900' as const,
    letterSpacing: 2,
  },
  tagline: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 1,
    marginTop: 4,
  },
  formCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  title: {
    color: Colors.text,
    fontSize: 26,
    fontWeight: '800' as const,
    marginBottom: 6,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  configStatusBanner: {
    alignSelf: 'stretch' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  configStatusOk: {
    borderColor: Colors.success + '44',
    backgroundColor: Colors.success + '12',
  },
  configStatusError: {
    borderColor: Colors.error + '66',
    backgroundColor: Colors.error + '14',
  },
  configStatusText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  authAuditCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 18,
    gap: 8,
  },
  authAuditCardNeutral: {
    borderColor: Colors.primary + '26',
    backgroundColor: Colors.primary + '10',
  },
  authAuditCardSuccess: {
    borderColor: Colors.success + '2E',
    backgroundColor: Colors.success + '12',
  },
  authAuditCardWarning: {
    borderColor: '#F59E0B35',
    backgroundColor: '#1B1409',
  },
  authAuditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  authAuditTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  authAuditText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  authAuditEmailRow: {
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFFFFF10',
    backgroundColor: '#050A11',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  authAuditEmailLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  authAuditEmailValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  supabaseErrorBox: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error + '55',
    backgroundColor: '#1B0B0B',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  supabaseErrorTitle: {
    color: Colors.error,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  supabaseErrorLine: {
    color: Colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  ownerVerifiedContinueButton: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ownerVerifiedContinueButtonText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '900' as const,
  },
  resetSentCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.success + '38',
    backgroundColor: Colors.success + '10',
    padding: 18,
    marginBottom: 18,
    alignItems: 'center' as const,
    gap: 6,
  },
  resetSentIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.success + '1F',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 4,
  },
  resetSentTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  resetSentSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center' as const,
  },
  resetSentEmail: {
    color: Colors.success,
    fontSize: 15,
    fontWeight: '800' as const,
    marginTop: 2,
    marginBottom: 8,
    maxWidth: '100%' as const,
  },
  resetSentSteps: {
    alignSelf: 'stretch' as const,
    gap: 8,
    marginTop: 4,
  },
  resetSentStepRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
  },
  resetSentStepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.success + '22',
    borderWidth: 1,
    borderColor: Colors.success + '55',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 1,
  },
  resetSentStepBadgeText: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: '800' as const,
  },
  resetSentStepText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  resetSentHint: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center' as const,
    marginTop: 10,
  },
  cooldownClearedChip: {
    alignSelf: 'flex-start' as const,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#0E2A1A',
    borderWidth: 1,
    borderColor: '#1FB67333',
  },
  cooldownClearedChipText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  forgotLink: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  inlineErrorRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error + '40',
    backgroundColor: Colors.error + '12',
    marginBottom: 16,
  },
  inlineErrorText: {
    color: Colors.error,
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 17,
    flex: 1,
  },
  inlineSuccessRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.success + '40',
    backgroundColor: Colors.success + '12',
    marginBottom: 16,
  },
  inlineSuccessText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 17,
    flex: 1,
  },
  troubleshootToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: 'transparent',
  },
  troubleshootToggleText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  passwordPolicyHint: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  rememberMeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  rememberMeText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '500' as const,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    gap: 10,
    height: 52,
  },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    height: '100%' as any,
  },
  signInBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 16,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
  },
  signInBtnDisabled: {
    opacity: 0.6,
  },
  signInBtnText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  ownerNormalSignInButton: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  ownerNormalSignInButtonText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  ownerSmsRecoveryButton: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    backgroundColor: Colors.primary + '10',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  ownerSmsRecoveryButtonText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  passwordlessNote: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.success + '40',
    backgroundColor: Colors.success + '10',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  passwordlessNoteText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  ownerAccessNotice: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '2A',
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ownerPasswordResetCard: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '32',
    backgroundColor: '#07111D',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ownerPasswordResetCardDisabled: {
    opacity: 0.62,
  },
  ownerPasswordResetContent: {
    flex: 1,
  },
  ownerPasswordResetTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  ownerPasswordResetText: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  ownerAccessNoticeContent: {
    flex: 1,
  },
  ownerAccessNoticeText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  ownerAccessLink: {
    marginTop: 4,
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  adminLockCard: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FF4D4D40',
    backgroundColor: '#1B0B0B',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  ownerAlternativeCard: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#4A90D938',
    backgroundColor: '#07111D',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ownerAlternativeCardDisabled: {
    opacity: 0.52,
  },
  ownerAlternativeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  ownerAlternativeContent: {
    flex: 1,
  },
  ownerAlternativeTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  ownerAlternativeText: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  truthCard: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    backgroundColor: '#0E1726',
    padding: 14,
    gap: 10,
  },
  truthTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  truthSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  truthList: {
    gap: 10,
  },
  truthRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  truthIndexWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  truthIndex: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '900' as const,
  },
  truthBody: {
    flex: 1,
    gap: 3,
  },
  truthRowTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  truthRowDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  loginFailureCard: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F59E0B30',
    backgroundColor: '#18120A',
    padding: 14,
    gap: 10,
  },
  loginFailureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loginFailureTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  loginFailureText: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700' as const,
  },
  loginFailureHint: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  failedEmailChip: {
    marginTop: 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF12',
    backgroundColor: '#080F18',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  failedEmailChipLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  failedEmailChipValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  issueMatrix: {
    gap: 12,
  },
  issueGroup: {
    gap: 8,
  },
  issueGroupTitle: {
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  issueGroupTitleCritical: {
    color: Colors.error,
  },
  issueGroupTitleWarning: {
    color: Colors.warning,
  },
  issueGroupTitleSuccess: {
    color: Colors.success,
  },
  issueRow: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  issueRowCritical: {
    borderColor: Colors.error + '30',
    backgroundColor: '#1A0B0B',
  },
  issueRowWarning: {
    borderColor: Colors.warning + '30',
    backgroundColor: '#1B1409',
  },
  issueRowSuccess: {
    borderColor: Colors.success + '30',
    backgroundColor: '#08140C',
  },
  issueIndexWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  issueIndexWrapCritical: {
    backgroundColor: Colors.error,
  },
  issueIndexWrapWarning: {
    backgroundColor: Colors.warning,
  },
  issueIndexWrapSuccess: {
    backgroundColor: Colors.success,
  },
  issueIndex: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '800' as const,
  },
  issueBody: {
    flex: 1,
    gap: 3,
  },
  issueTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  issueDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  loginFailureActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap' as const,
  },
  loginFailurePrimaryAction: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  loginFailurePrimaryActionText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  loginFailureSecondaryAction: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFFFFF14',
    backgroundColor: '#FFFFFF0A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginFailureSecondaryActionText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  loginFailureActionDisabled: {
    opacity: 0.6,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 20,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.surfaceBorder,
  },
  dividerText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signupText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  signupLink: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  signupChoiceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
  },
  signupChoiceTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
    marginBottom: 4,
  },
  signupChoiceSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  signupChoiceActions: {
    flexDirection: 'row',
  },
  signupChoiceButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  signupChoiceOwnerButton: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  signupChoiceButtonLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  signupChoiceOwnerButtonLabel: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    paddingHorizontal: 20,
  },
  securityText: {
    color: Colors.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  twoFAHeader: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 40,
  },
  twoFAIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: Colors.primary + '15',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  twoFATitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '800' as const,
    marginBottom: 8,
  },
  twoFASubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  codeBox: {
    width: 48,
    height: 58,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.surfaceBorder,
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700' as const,
    textAlign: 'center',
  },
  codeBoxFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '12',
  },
  cancelLink: {
    marginTop: 32,
    alignItems: 'center',
  },
  cancelLinkText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
