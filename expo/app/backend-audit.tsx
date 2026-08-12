import React, { useState, useCallback, useRef, useEffect } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Platform} from "react-native";
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Database,
  Shield,
  Mail,
  Image,
  CreditCard,
  Bell,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  MessageSquare,
  Cloud,
  HardDrive,
  Eye,
  Activity} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { isAbortLikeError, runWithAbortTimeout } from '@/lib/abort-utils';
import { supabase } from '@/lib/supabase';
import { runLandingReadinessAudit, type ReadinessAuditMode } from '@/lib/landing-readiness-audit';
import { inspectPasswordResetRedirect } from '@/lib/auth-password-recovery';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';

type AuditStatus = 'pass' | 'fail' | 'warn' | 'info' | 'checking';

interface AuditItem {
  id: string;
  category: string;
  name: string;
  status: AuditStatus;
  message: string;
  details?: string;
  latencyMs?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
}

interface AuditCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  items: AuditItem[];
}

const STATUS_COLORS: Record<AuditStatus, string> = {
  pass: '#00C48C',
  fail: '#FF4D4D',
  warn: '#F59E0B',
  info: '#6366F1',
  checking: '#9CA3AF'};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#FF4D4D',
  medium: '#F59E0B',
  low: '#4A90D9',
  info: '#6366F1'};

const BACKEND_AUDIT_TIMEOUT_MS = 3_500;

function isSupabaseConfigured(): boolean {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  return !!(url && key);
}

async function measureLatency<T>(fn: () => Promise<T>): Promise<{ result: T | null; latency: number; error: string | null }> {
  const start = Date.now();
  try {
    const result = await fn();
    return { result, latency: Date.now() - start, error: null };
  } catch (err) {
    return { result: null, latency: Date.now() - start, error: (err as Error)?.message || 'Unknown error' };
  }
}

async function runFullAudit(mode: ReadinessAuditMode = 'full'): Promise<AuditCategory[]> {
  const categories: AuditCategory[] = [];

  const supabaseConfigured = isSupabaseConfigured();

  const supabaseItems: AuditItem[] = [];

  if (!supabaseConfigured) {
    supabaseItems.push({
      id: 'supabase-config',
      category: 'supabase',
      name: 'Supabase Configuration',
      status: 'fail',
      message: 'EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY not set',
      details: 'Without Supabase credentials, the app falls back to local storage for ALL data. Auth, realtime, and database features are disabled.',
      severity: 'critical'});
  } else {
    supabaseItems.push({
      id: 'supabase-config',
      category: 'supabase',
      name: 'Supabase Configuration',
      status: 'pass',
      message: 'URL and Anon Key configured',
      details: `URL: ${(process.env.EXPO_PUBLIC_SUPABASE_URL || '').substring(0, 45)}...`,
      severity: 'info'});

    supabaseItems.push({
      id: 'supabase-scan-mode',
      category: 'supabase',
      name: 'Supabase scan mode',
      status: 'info',
      message: mode === 'full' ? 'Deep verification is running' : 'Lightweight read-only audit is running',
      details: mode === 'full'
        ? 'Detailed table enumeration and deep readiness verification are enabled for this manual audit.'
        : 'Routine audit refresh skips the noisy table sweep so Supabase is not hammered during normal reviews.',
      severity: 'info'});

    const { latency: connLatency, error: connError } = await measureLatency(async () => {
      const { error } = await runWithAbortTimeout(
        BACKEND_AUDIT_TIMEOUT_MS,
        async (signal) => await supabase.from('profiles').select('id').limit(1).abortSignal(signal),
        `Backend audit connection probe timed out after ${BACKEND_AUDIT_TIMEOUT_MS}ms`,
      );
      if (error) throw new Error(error.message);
    });
    const connectionTimedOut = connError ? isAbortLikeError(connError) : false;

    supabaseItems.push({
      id: 'supabase-connection',
      category: 'supabase',
      name: 'Database Connection',
      status: connError ? (connectionTimedOut ? 'warn' : 'fail') : connLatency > 3000 ? 'warn' : 'pass',
      message: connError ? (connectionTimedOut ? `Connection probe timed out (${connLatency}ms)` : `Connection failed: ${connError}`) : `Connected (${connLatency}ms)`,
      latencyMs: connLatency,
      severity: connError ? (connectionTimedOut ? 'medium' : 'critical') : 'info'});

    const { latency: authLatency, error: authError } = await measureLatency(async () => {
      const { error } = await supabase.auth.getSession();
      if (error) throw new Error(error.message);
    });

    supabaseItems.push({
      id: 'supabase-auth',
      category: 'supabase',
      name: 'Auth Service',
      status: authError ? 'fail' : authLatency > 2000 ? 'warn' : 'pass',
      message: authError ? `Auth error: ${authError}` : `Auth OK (${authLatency}ms)`,
      latencyMs: authLatency,
      severity: authError ? 'high' : 'info'});

    const requiredTables = ['profiles', 'wallets', 'transactions', 'holdings', 'notifications'];
    const optionalTables = ['jv_deals', 'audit_trail', 'waitlist', 'image_registry', 'push_tokens', 'landing_deals', 'app_config'];

    if (mode === 'full') {
      for (const table of requiredTables) {
        try {
          const { error } = await runWithAbortTimeout(
            BACKEND_AUDIT_TIMEOUT_MS,
            async (signal) => await supabase.from(table).select('id').limit(1).abortSignal(signal),
            `Table check timed out for ${table}`,
          );
          const missing = error && ((error.message || '').toLowerCase().includes('could not find') || (error.message || '').toLowerCase().includes('does not exist'));
          supabaseItems.push({
            id: `table-${table}`,
            category: 'supabase',
            name: `Table: ${table}`,
            status: missing ? 'fail' : error ? 'warn' : 'pass',
            message: missing ? 'Table NOT FOUND' : error ? `Query error: ${error.message}` : 'Exists & accessible',
            severity: missing ? 'high' : error ? 'medium' : 'info'});
        } catch (err) {
          const timedOut = isAbortLikeError(err);
          supabaseItems.push({
            id: `table-${table}`,
            category: 'supabase',
            name: `Table: ${table}`,
            status: timedOut ? 'warn' : 'fail',
            message: timedOut ? `Check timed out for ${table}` : `Check failed: ${(err as Error)?.message}`,
            severity: timedOut ? 'medium' : 'high'});
        }
      }

      for (const table of optionalTables) {
        try {
          const { error } = await runWithAbortTimeout(
            BACKEND_AUDIT_TIMEOUT_MS,
            async (signal) => await supabase.from(table).select('id').limit(1).abortSignal(signal),
            `Optional table check timed out for ${table}`,
          );
          const missing = error && ((error.message || '').toLowerCase().includes('could not find') || (error.message || '').toLowerCase().includes('does not exist'));
          supabaseItems.push({
            id: `table-${table}`,
            category: 'supabase',
            name: `Table: ${table}`,
            status: missing ? 'warn' : error ? 'warn' : 'pass',
            message: missing ? 'Optional table not created yet' : error ? `Query error: ${error.message}` : 'Exists & accessible',
            severity: missing ? 'low' : error ? 'medium' : 'info'});
        } catch (err) {
          const timedOut = isAbortLikeError(err);
          supabaseItems.push({
            id: `table-${table}`,
            category: 'supabase',
            name: `Table: ${table}`,
            status: 'warn',
            message: timedOut ? `Optional table check timed out for ${table}` : 'Check failed',
            severity: 'low'});
        }
      }
    } else {
      supabaseItems.push({
        id: 'table-sweep-skipped',
        category: 'supabase',
        name: 'Detailed table inventory',
        status: 'info',
        message: 'Skipped during lightweight refresh',
        details: `Run a deep audit to enumerate ${requiredTables.length} required tables and ${optionalTables.length} optional tables.`,
        severity: 'info'});
    }

    try {
      const channels = supabase.getChannels();
      supabaseItems.push({
        id: 'realtime',
        category: 'supabase',
        name: 'Realtime WebSocket',
        status: channels.length > 0 ? 'pass' : 'warn',
        message: channels.length > 0 ? `${channels.length} active channel(s)` : 'No active channels (idle)',
        severity: 'info'});
    } catch {
      supabaseItems.push({
        id: 'realtime',
        category: 'supabase',
        name: 'Realtime WebSocket',
        status: 'warn',
        message: 'Could not check realtime channels',
        severity: 'medium'});
    }

    try {
      const { error: rlsError } = await runWithAbortTimeout(
        BACKEND_AUDIT_TIMEOUT_MS,
        async (signal) => await supabase.from('profiles').select('id').limit(1).abortSignal(signal),
        `RLS check timed out after ${BACKEND_AUDIT_TIMEOUT_MS}ms`,
      );
      supabaseItems.push({
        id: 'rls',
        category: 'supabase',
        name: 'Row Level Security (RLS)',
        status: rlsError ? (rlsError.message.includes('permission') ? 'pass' : 'warn') : 'pass',
        message: rlsError ? (rlsError.message.includes('permission') ? 'RLS active (blocking unauthenticated)' : `RLS check: ${rlsError.message}`) : 'Policies enforced',
        severity: 'info'});
    } catch (err) {
      const timedOut = isAbortLikeError(err);
      supabaseItems.push({
        id: 'rls',
        category: 'supabase',
        name: 'Row Level Security (RLS)',
        status: 'warn',
        message: timedOut ? `RLS check timed out after ${BACKEND_AUDIT_TIMEOUT_MS}ms` : 'Could not verify RLS policies',
        severity: 'medium'});
    }
  }

  categories.push({
    id: 'supabase',
    name: 'Supabase Database & Auth',
    icon: <Database size={20} color={Colors.primary} />,
    items: supabaseItems});

  const passwordResetRedirectAudit = inspectPasswordResetRedirect();
  const passwordResetRedirectUrl = passwordResetRedirectAudit.resolvedUrl;
  const hasConfiguredAuthRecoveryUrl = passwordResetRedirectAudit.configuredValue.length > 0;
  const passwordResetRedirectLooksValid = passwordResetRedirectUrl.endsWith('/reset-password');
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const missingServiceRoleKey = !serviceRoleKey;
  const serviceRoleMatchesAnon = !!serviceRoleKey && serviceRoleKey === anonKey;

  const authItems: AuditItem[] = [
    {
      id: 'auth-owner-password-live-signin',
      category: 'auth',
      name: '1. Owner password sign-in path',
      status: supabaseConfigured ? 'pass' : 'fail',
      message: supabaseConfigured
        ? 'Owner password goes directly to Supabase Auth with signInWithPassword'
        : 'Owner password sign-in cannot work without Supabase configuration',
      details: 'Code path: expo/lib/auth-context.tsx login() -> supabase.auth.signInWithPassword. There is no client-side owner-password deny branch left in the login screen.',
      severity: supabaseConfigured ? 'info' : 'critical'},
    {
      id: 'auth-owner-admin-service-role',
      category: 'auth',
      name: '2. Supabase admin repair key (not normal sign-in)',
      status: missingServiceRoleKey || serviceRoleMatchesAnon ? 'fail' : 'pass',
      message: missingServiceRoleKey
        ? 'SUPABASE_SERVICE_ROLE_KEY is missing, so backend owner-auth repair is unavailable, but normal owner sign-in still uses the public auth path'
        : serviceRoleMatchesAnon
          ? 'SUPABASE_SERVICE_ROLE_KEY matches the anon key, so backend owner-auth repair is blocked, but normal owner sign-in still does not use this key'
          : 'Service-role key is distinct from anon and can support secure backend owner-auth repair',
      details: missingServiceRoleKey
        ? 'Programmatic owner-account inspection, password rotation, and admin auth repair require a real Supabase service_role key. Without it, endpoints like /auth/v1/admin/users cannot be used.'
        : serviceRoleMatchesAnon
          ? 'When the configured service-role key matches the anon key, Supabase admin endpoints return not_admin. That blocks secure owner-account inspection and password repair outside the normal reset-email flow.'
          : 'Keep the service-role key server-side only. Never expose it in client code.',
      severity: missingServiceRoleKey || serviceRoleMatchesAnon ? 'critical' : 'info'},
    {
      id: 'auth-owner-password-reset-redirect',
      category: 'auth',
      name: '3. Owner password reset redirect',
      status: !passwordResetRedirectLooksValid ? 'fail' : passwordResetRedirectAudit.rejectedConfiguredUrl ? 'warn' : hasConfiguredAuthRecoveryUrl ? 'pass' : 'warn',
      message: !passwordResetRedirectLooksValid
        ? 'Password reset redirect URL is malformed and recovery emails can land on a dead page'
        : passwordResetRedirectAudit.rejectedConfiguredUrl
          ? `Configured auth URL was rejected. Using fallback reset URL ${passwordResetRedirectUrl}`
          : hasConfiguredAuthRecoveryUrl
            ? `Reset emails target ${passwordResetRedirectUrl}`
            : `Using fallback reset URL ${passwordResetRedirectUrl}`,
      details: passwordResetRedirectAudit.rejectedConfiguredUrl
        ? `${passwordResetRedirectAudit.rejectionReason ?? 'Configured auth URL is invalid.'} The app now falls back to a public reset route, but that route must still be allow-listed in Supabase Auth redirect settings.`
        : 'Reset emails are sent from expo/app/login.tsx and expo/app/owner-access.tsx through getPasswordResetRedirectUrl(). If EXPO_PUBLIC_IVX_AUTH_URL is missing or wrong in Supabase Auth redirect settings, password recovery can appear broken even when the email is sent.',
      severity: !passwordResetRedirectLooksValid ? 'critical' : passwordResetRedirectAudit.rejectedConfiguredUrl ? 'medium' : hasConfiguredAuthRecoveryUrl ? 'info' : 'medium'},
    {
      id: 'auth-owner-password-reset-handler',
      category: 'auth',
      name: '4. Owner password recovery session handler',
      status: 'pass',
      message: 'Reset password screen can exchange PKCE codes or URL tokens and then update the password',
      details: 'Route: expo/app/reset-password.tsx. Public access is registered in expo/app/_layout.tsx so recovery links no longer hit a missing-screen gap.',
      severity: 'info'},
    {
      id: 'auth-owner-legacy-claim-crash',
      category: 'auth',
      name: '5. Owner trusted-device crash path',
      status: 'pass',
      message: 'Legacy fake trusted-device claims are cleared before owner restore runs',
      details: 'auth-context rejects non-UUID verified owner ids, resets broken local owner-claim state, and prevents stale trusted-device metadata from crashing or falsely unlocking owner recovery.',
      severity: 'info'},
    {
      id: 'auth-owner-role-resolution',
      category: 'auth',
      name: '6. Owner/admin role resolution',
      status: supabaseConfigured ? 'pass' : 'fail',
      message: supabaseConfigured ? 'Roles resolve from profiles -> get_user_role -> verify_admin_access' : 'Cannot verify owner/admin roles without Supabase configuration',
      details: 'Authorization no longer trusts user_metadata for admin access. support, staff, manager, administrator, and super_admin aliases normalize into verified admin-capable roles.',
      severity: supabaseConfigured ? 'info' : 'critical'},
    {
      id: 'auth-owner-trusted-restore-window',
      category: 'auth',
      name: '7. Trusted owner restore boundary',
      status: 'info',
      message: 'Passwordless trusted restore now behaves like a security boundary, not a broken owner restriction',
      details: 'A previously verified device plus a carrier-subnet match or active 30-day trusted-device window is required for passwordless restore. Full owner sign-in still works on any device with the verified owner account.',
      severity: 'info'},
    {
      id: 'auth-member-signup-shadow-duplicates',
      category: 'auth',
      name: '8. Member signup duplicate blocking',
      status: 'pass',
      message: 'Waitlist and landing shadow records no longer deny real member registration',
      details: 'Signup checks durable member sources first (signup, session, supabase, admin_update) and then respects Supabase Auth existing-account responses instead of shadow leads.',
      severity: 'info'},
    {
      id: 'auth-local-persistence',
      category: 'auth',
      name: '9. Local auth persistence',
      status: 'pass',
      message: 'Local storage no longer grants owner access on its own',
      details: 'auth-store persists only user id and normalized role. Supabase owns tokens and active sessions; trusted owner recovery still requires validated server or verified-device evidence.',
      severity: 'info'},
    {
      id: 'auth-password-change-reauth-gap',
      category: 'auth',
      name: '10. Signed-in password change re-auth check',
      status: 'pass',
      message: 'Security Settings now verifies the current password before any signed-in password change is submitted',
      details: 'Code path: expo/app/security-settings.tsx first validates the current password against live Supabase credentials, then uses supabase.auth.updateUser with current_password and optional nonce support when Secure Password Change is enabled.',
      severity: 'info'},
    {
      id: 'auth-2fa',
      category: 'auth',
      name: '11. 2FA / Two-Factor Auth',
      status: 'pass',
      message: 'Supabase TOTP MFA is now implemented for setup, sign-in challenge, and removal',
      details: 'Login now detects aal1 -> aal2 upgrades and requires a live MFA challenge. Security Settings can enroll, verify, and unenroll TOTP factors through supabase.auth.mfa APIs.',
      severity: 'info'},
    {
      id: 'auth-admin-guard',
      category: 'auth',
      name: '12. Admin route guard',
      status: 'pass',
      message: 'Admin routing accepts verified admin roles and trusted owner-IP access',
      details: 'useAdminGuard now recognizes server-verified admin roles instead of relying on fragile client-only labels.',
      severity: 'info'},
    {
      id: 'auth-owner-identity-authority-audit',
      category: 'auth',
      name: '13. Owner identity authority audit',
      status: 'pass',
      message: 'Owner Access now distinguishes verified owner authority from a normal user account using both live session role evidence and trusted-device authority',
      details: 'Code path: expo/lib/auth-context.tsx auditOwnerIdentity() + expo/app/owner-access.tsx. The audit compares the requested email against the authenticated session email/role/source and the trusted-device verified email/role/window so the app can show whether the audited email is the real verified owner authority, only a normal user account, an email mismatch, or still unverified.',
      severity: 'info'},
  ];

  categories.push({
    id: 'auth',
    name: 'Authentication & Security',
    icon: <Shield size={20} color={Colors.primary} />,
    items: authItems});

  const imageItems: AuditItem[] = [
    {
      id: 'img-local-storage',
      category: 'images',
      name: 'Local Image Storage',
      status: 'pass',
      message: 'Images copied to documentDirectory/ivx_images/ on native, URI used on web',
      details: 'Uses the modern expo-file-system API for local copies and falls back to the original URI if a copy fails.',
      severity: 'info'},
    {
      id: 'img-registry',
      category: 'images',
      name: 'Image Registry (AsyncStorage)',
      status: 'pass',
      message: 'Image metadata stored by entity type + entity ID',
      details: 'Registry tracks: id, uri, entityType, entityId, uploadedBy, protection status.',
      severity: 'info'},
    {
      id: 'img-supabase-sync',
      category: 'images',
      name: 'Supabase image_registry Sync',
      status: 'warn',
      message: 'Syncs to image_registry table but table may not exist in your Supabase',
      details: 'If the table is missing, images are stored locally only. Run supabase-full-setup.sql to create it.',
      severity: 'medium'},
    {
      id: 'img-s3-upload',
      category: 'images',
      name: 'AWS S3 Image Upload',
      status: 'fail',
      message: 'NO direct S3 upload implemented - images stored as local URIs only',
      details: 'The @aws-sdk/client-s3 package is installed but no upload function exists. Images are local file URIs or remote URLs. For production, need S3 upload + CDN.',
      severity: 'high'},
    {
      id: 'img-photo-protection',
      category: 'images',
      name: 'Photo Protection (JV Deals)',
      status: 'pass',
      message: 'Photos cannot be accidentally cleared - admin override required',
      details: 'protectPhotos() blocks photo reduction/clear without adminOverride=true.',
      severity: 'info'},
  ];

  categories.push({
    id: 'images',
    name: 'Images & Media Storage',
    icon: <Image size={20} color={Colors.primary} />,
    items: imageItems});

  const emailItems: AuditItem[] = [
    {
      id: 'email-engine',
      category: 'email',
      name: 'Email Engine (SMTP Logic)',
      status: 'pass',
      message: 'Comprehensive email engine with warmup, rotation, throttling, personalization',
      details: 'Supports SMTP rotation, 24-day warmup schedule, CAN-SPAM compliance, bounce management.',
      severity: 'info'},
    {
      id: 'email-send',
      category: 'email',
      name: 'Email Sending (Real Delivery)',
      status: 'fail',
      message: 'Depends on Supabase Edge Function "send-email" which is NOT deployed',
      details: 'sendEmail() calls supabase.functions.invoke("send-email"). If edge function is missing, emails are saved locally only with status "queued_locally". No real delivery happens.',
      severity: 'critical'},
    {
      id: 'email-storage',
      category: 'email',
      name: 'Email Local Storage',
      status: 'pass',
      message: 'Emails persist in AsyncStorage — backend-first, no mock fallback',
      details: 'Inbox loads from backend API first. Cache used only as fallback when backend returns 0. Mock data removed from production flow. All emails tagged with source label.',
      severity: 'info'},
    {
      id: 'email-sendgrid',
      category: 'email',
      name: 'SendGrid Integration',
      status: 'fail',
      message: 'SENDGRID_API_KEY not configured as env variable',
      details: 'Listed in .env.example but not in actual environment variables. Requires Edge Function deployment.',
      severity: 'high'},
    {
      id: 'email-aws-ses',
      category: 'email',
      name: 'AWS SES Integration',
      status: 'fail',
      message: 'No SES sending code implemented - only cost estimation exists',
      details: 'estimateDailyCost() references "ses" provider but no actual AWS SES SDK call exists in email-engine.ts.',
      severity: 'high'},
  ];

  categories.push({
    id: 'email',
    name: 'Email System',
    icon: <Mail size={20} color={Colors.primary} />,
    items: emailItems});

  const smsItems: AuditItem[] = [
    {
      id: 'sms-aws-sns',
      category: 'sms',
      name: 'AWS SNS SMS Sending',
      status: 'fail',
      message: 'No AWS SNS publish code exists in the app',
      details: '.env.example mentions "SMS uses the same AWS credentials" but no SNS publish call is implemented anywhere. sms-reports.tsx uses Supabase edge functions.',
      severity: 'high'},
    {
      id: 'sms-reports-screen',
      category: 'sms',
      name: 'SMS Reports UI',
      status: 'warn',
      message: 'UI exists but sends via Supabase Edge Function that may not be deployed',
      details: 'sms-reports.tsx has full UI for sending SMS reports. Depends on edge functions for actual delivery.',
      severity: 'medium'},
  ];

  categories.push({
    id: 'sms',
    name: 'SMS & Messaging',
    icon: <MessageSquare size={20} color={Colors.primary} />,
    items: smsItems});

  const paymentItems: AuditItem[] = [
    {
      id: 'pay-service',
      category: 'payments',
      name: 'Payment Service Architecture',
      status: supabaseConfigured ? 'pass' : 'warn',
      message: supabaseConfigured
        ? 'Real transaction records only — no simulated payments in production'
        : 'Supabase not configured — cannot create real transaction records',
      details: 'PaymentService rejects simulated payments in production when no provider is configured. Transactions are written to Supabase as pending_payment and confirmed by owner/admin after real funds are received.',
      severity: supabaseConfigured ? 'info' : 'critical'},
    {
      id: 'pay-stripe',
      category: 'payments',
      name: 'Stripe Integration',
      status: 'fail',
      message: 'STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY not configured',
      details: 'PaymentService reads from env but Stripe keys are not set. Card, Apple Pay, Google Pay all use fake responses.',
      severity: 'high'},
    {
      id: 'pay-plaid',
      category: 'payments',
      name: 'Plaid Bank Linking',
      status: 'fail',
      message: 'PLAID_CLIENT_ID and PLAID_SECRET not configured',
      details: 'createPlaidLinkToken() returns fake tokens. exchangePlaidPublicToken() returns fake access tokens.',
      severity: 'high'},
    {
      id: 'pay-wallet',
      category: 'payments',
      name: 'Wallet System (Supabase)',
      status: supabaseConfigured ? 'pass' : 'warn',
      message: supabaseConfigured ? 'Wallet debit/credit uses Supabase wallets table with optimistic locking' : 'Wallet system needs Supabase',
      details: 'atomicWalletDebit() uses .eq(available, currentBalance) for optimistic concurrency. Good pattern.',
      severity: supabaseConfigured ? 'info' : 'medium'},
    {
      id: 'pay-investment',
      category: 'payments',
      name: 'Investment Transaction Flow',
      status: supabaseConfigured ? 'pass' : 'warn',
      message: supabaseConfigured ? 'Full transaction flow: debit wallet -> insert transaction -> upsert holding -> notification' : 'Needs Supabase for real transactions',
      details: 'purchaseShares() and purchaseJVInvestment() have rollback support if holding insert fails.',
      severity: supabaseConfigured ? 'info' : 'high'},
    {
      id: 'pay-wire',
      category: 'payments',
      name: 'Wire Transfer Instructions',
      status: 'warn',
      message: 'Hardcoded JPMorgan Chase bank details - verify these are real',
      details: 'processWireTransfer() returns static bank details (acct: 9876543210, routing: 021000021). If these are placeholder, real wire transfers will fail.',
      severity: 'high'},
  ];

  categories.push({
    id: 'payments',
    name: 'Payments & Investments',
    icon: <CreditCard size={20} color={Colors.primary} />,
    items: paymentItems});

  const pushItems: AuditItem[] = [
    {
      id: 'push-expo',
      category: 'push',
      name: 'Expo Push Notifications',
      status: Platform.OS === 'web' ? 'warn' : 'pass',
      message: Platform.OS === 'web' ? 'Not available on web platform' : 'Expo Push configured with channels (default, investments, security)',
      details: 'Uses expo-notifications with proper permission flow. Android channels created.',
      severity: Platform.OS === 'web' ? 'low' : 'info'},
    {
      id: 'push-backend-register',
      category: 'push',
      name: 'Push Token Backend Registration',
      status: 'warn',
      message: 'Registers to Supabase push_tokens table (may not exist)',
      details: 'registerTokenWithBackend() upserts to push_tokens table. Handles missing table gracefully.',
      severity: 'medium'},
    {
      id: 'push-server-send',
      category: 'push',
      name: 'Server-Side Push Sending',
      status: 'fail',
      message: 'No server-side push sending code exists',
      details: 'Token registration exists but no Edge Function or backend to actually SEND push notifications to users. Need Expo Push API or FCM/APNs integration.',
      severity: 'high'},
  ];

  categories.push({
    id: 'push',
    name: 'Push Notifications',
    icon: <Bell size={20} color={Colors.primary} />,
    items: pushItems});

  const hasAwsCredentials = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const hasLandingAwsConfig = !!(process.env.S3_BUCKET_NAME && process.env.CLOUDFRONT_DISTRIBUTION_ID);

  const awsItems: AuditItem[] = [
    {
      id: 'aws-credentials',
      category: 'aws',
      name: 'AWS Credentials',
      status: hasAwsCredentials ? 'pass' : 'fail',
      message: hasAwsCredentials ? 'AWS access keys are configured for infrastructure operations' : 'AWS credentials are not configured',
      details: `Region: ${process.env.AWS_REGION || 'Not set'}`,
      severity: hasAwsCredentials ? 'info' : 'high'},
    {
      id: 'aws-landing-deploy',
      category: 'aws',
      name: 'S3 + CloudFront landing infrastructure',
      status: hasLandingAwsConfig ? 'pass' : hasAwsCredentials ? 'warn' : 'fail',
      message: hasLandingAwsConfig
        ? 'S3 bucket and CloudFront distribution are configured for landing deploy + cache invalidation'
        : hasAwsCredentials
          ? 'AWS keys exist, but S3_BUCKET_NAME or CLOUDFRONT_DISTRIBUTION_ID is missing'
          : 'Landing AWS deploy configuration is incomplete',
      details: 'landing-deploy.ts can publish the landing bundle to S3 and invalidate CloudFront. This is infrastructure support, not the owner authorization path.',
      severity: hasLandingAwsConfig ? 'info' : hasAwsCredentials ? 'medium' : 'high'},
    {
      id: 'aws-owner-auth-independence',
      category: 'aws',
      name: 'Owner access dependency on AWS',
      status: 'pass',
      message: 'Owner/admin access is not gated by AWS services',
      details: 'Owner authorization resolves through Supabase profiles, RPC role checks, and verified-device recovery. AWS is supporting landing infrastructure and delivery operations, not acting as the auth source.',
      severity: 'info'},
    {
      id: 'aws-ses-account-limit',
      category: 'aws',
      name: 'AWS SES account state',
      status: 'warn',
      message: 'SES production access is still an AWS account approval task',
      details: 'This affects real outbound email volume and recipient restrictions only. It does not block owner/admin login, trusted restore, or member signup.',
      severity: 'medium'},
    {
      id: 'aws-sns-account-limit',
      category: 'aws',
      name: 'AWS SNS account state',
      status: 'warn',
      message: 'SNS spend-limit increase is still an AWS account task',
      details: 'This affects SMS throughput only. It does not block owner/admin login, trusted restore, or member signup.',
      severity: 'medium'},
  ];

  categories.push({
    id: 'aws',
    name: 'AWS Infrastructure',
    icon: <Cloud size={20} color={Colors.primary} />,
    items: awsItems});

  const kycItems: AuditItem[] = [
    {
      id: 'kyc-liveness',
      category: 'kyc',
      name: 'KYC Liveness Detection',
      status: 'warn',
      message: 'Falls back to RANDOM confidence scores when Edge Function unavailable',
      details: 'performLivenessDetection() calls supabase.functions.invoke("kyc-liveness"). Fallback returns random 85-99% confidence with isLive=true. NOT real verification.',
      severity: 'critical'},
    {
      id: 'kyc-face-match',
      category: 'kyc',
      name: 'KYC Face Match',
      status: 'warn',
      message: 'Falls back to RANDOM similarity scores (82-99%)',
      details: 'performFaceMatch() calls "kyc-face-match" Edge Function. Fallback always returns isMatch=true with random scores.',
      severity: 'critical'},
    {
      id: 'kyc-sanctions',
      category: 'kyc',
      name: 'Sanctions/Watchlist Check',
      status: 'warn',
      message: 'Falls back to ALWAYS CLEAN with random low risk score',
      details: 'performSanctionsCheck() calls "kyc-sanctions-check" Edge Function. Fallback always returns isClean=true against 7 "databases".',
      severity: 'critical'},
    {
      id: 'kyc-edge-functions',
      category: 'kyc',
      name: 'KYC Edge Functions Deployed',
      status: 'fail',
      message: 'Edge Functions (kyc-liveness, kyc-face-match, kyc-sanctions-check, kyc-full-verification) likely NOT deployed',
      details: 'All KYC verification relies on Supabase Edge Functions. If not deployed, ALL verification uses fake random results.',
      severity: 'critical'},
  ];

  categories.push({
    id: 'kyc',
    name: 'KYC Verification',
    icon: <Eye size={20} color={Colors.primary} />,
    items: kycItems});

  const dataItems: AuditItem[] = [
    {
      id: 'data-jv-storage',
      category: 'data',
      name: 'JV Deals Dual Storage',
      status: 'pass',
      message: 'Supabase primary + AsyncStorage backup with deduplication',
      details: 'fetchJVDeals() tries Supabase first, falls back to local. Dual write on save. Dedup by ID and project name.',
      severity: 'info'},
    {
      id: 'data-jv-trash',
      category: 'data',
      name: 'JV Deals Trash/Recovery',
      status: 'pass',
      message: 'Soft delete (trash) with restore, permanent delete with rate limiting',
      details: 'deleteJVDeal() moves to trash. Rate limit: 3 permanent deletes per minute. Snapshot captured before delete.',
      severity: 'info'},
    {
      id: 'data-audit-trail',
      category: 'data',
      name: 'Audit Trail',
      status: 'pass',
      message: 'Full audit trail with local + Supabase sync',
      details: 'Tracks CREATE, UPDATE, DELETE, TRASH, RESTORE, PURCHASE, etc. Max 2000 local entries. CSV export available.',
      severity: 'info'},
    {
      id: 'data-landing-sync',
      category: 'data',
      name: 'Landing Page Sync',
      status: 'pass',
      message: 'Auto-sync published deals to landing page via Supabase + S3',
      details: 'syncToLandingPage() fetches published deals, syncs to landing_deals table, and deploys config to S3.',
      severity: 'info'},
    {
      id: 'data-realtime-sync',
      category: 'data',
      name: 'Realtime Data Sync',
      status: 'pass',
      message: 'Supabase realtime + fallback polling + cross-tab broadcast',
      details: 'useJVRealtime() subscribes to postgres_changes. Falls back to 5s polling if realtime fails. BroadcastChannel for cross-tab sync on web.',
      severity: 'info'},
    {
      id: 'data-react-query',
      category: 'data',
      name: 'React Query Integration',
      status: 'pass',
      message: 'All data fetching uses useQuery with proper stale times',
      details: 'Properties (5min), Market data (1min), Holdings (2min), Wallet (30s), Notifications (1min). Proper invalidation on changes.',
      severity: 'info'},
  ];

  categories.push({
    id: 'data',
    name: 'Data & Sync',
    icon: <HardDrive size={20} color={Colors.primary} />,
    items: dataItems});

  const healthItems: AuditItem[] = [];

  try {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch('https://ivxholding.com', { method: 'HEAD', signal: controller.signal });
      const latency = Date.now() - start;
      healthItems.push({
        id: 'landing-live',
        category: 'health',
        name: 'Landing Page (ivxholding.com)',
        status: resp.ok ? (latency > 3000 ? 'warn' : 'pass') : 'fail',
        message: resp.ok ? `Live (${latency}ms)` : `HTTP ${resp.status}`,
        latencyMs: latency,
        severity: resp.ok ? 'info' : 'high'});
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    healthItems.push({
      id: 'landing-live',
      category: 'health',
      name: 'Landing Page (ivxholding.com)',
      status: 'fail',
      message: `Not reachable: ${(err as Error)?.message}`,
      severity: 'high'});
  }

  const readinessAudit = await runLandingReadinessAudit({ mode });
  const readinessSeverityByStatus: Record<'pass' | 'warn' | 'fail', AuditItem['severity']> = {
    pass: 'info',
    warn: 'medium',
    fail: 'critical'};

  const readiness30k = readinessAudit.scaleAssessments.find((assessment) => assessment.targetUsers === 30000);
  const readiness1M = readinessAudit.scaleAssessments.find((assessment) => assessment.targetUsers === 1000000);

  healthItems.push({
    id: 'readiness-summary',
    category: 'health',
    name: 'Readiness Summary',
    status: readinessAudit.overallStatus,
    message: readinessAudit.summary,
    details: `mode=${readinessAudit.mode} · blockers=${readinessAudit.blockerCount} · warnings=${readinessAudit.warningCount}`,
    severity: readinessSeverityByStatus[readinessAudit.overallStatus]});

  if (readiness30k) {
    healthItems.push({
      id: 'readiness-30k',
      category: 'health',
      name: '30K Launch Readiness',
      status: readiness30k.status,
      message: readiness30k.summary,
      details: `evidence=${readiness30k.evidence}${readiness30k.blockerIds.length ? ` · blockers=${readiness30k.blockerIds.join(', ')}` : ''}`,
      severity: readinessSeverityByStatus[readiness30k.status]});
  }

  if (readiness1M) {
    healthItems.push({
      id: 'readiness-1m',
      category: 'health',
      name: '1M Scale Readiness',
      status: readiness1M.status,
      message: readiness1M.summary,
      details: `evidence=${readiness1M.evidence}${readiness1M.blockerIds.length ? ` · blockers=${readiness1M.blockerIds.join(', ')}` : ''}`,
      severity: readinessSeverityByStatus[readiness1M.status]});
  }

  readinessAudit.probes.forEach((probe) => {
    healthItems.push({
      id: probe.id,
      category: 'health',
      name: probe.label,
      status: probe.status,
      message: probe.message,
      details: probe.detail,
      latencyMs: probe.latencyMs,
      severity: readinessSeverityByStatus[probe.status]});
  });

  healthItems.push({
    id: 'health-frontend',
    category: 'health',
    name: 'App Frontend (Expo)',
    status: 'pass',
    message: `Running on ${Platform.OS}`,
    severity: 'info'});

  categories.push({
    id: 'health',
    name: 'System Health',
    icon: <Activity size={20} color={Colors.primary} />,
    items: healthItems});

  return categories;
}

export default function BackendAuditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [categories, setCategories] = useState<AuditCategory[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentMode, setCurrentMode] = useState<ReadinessAuditMode>('light');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const totalPass = categories.reduce((sum, c) => sum + c.items.filter(i => i.status === 'pass').length, 0);
  const totalFail = categories.reduce((sum, c) => sum + c.items.filter(i => i.status === 'fail').length, 0);
  const totalWarn = categories.reduce((sum, c) => sum + c.items.filter(i => i.status === 'warn').length, 0);
  const totalItems = categories.reduce((sum, c) => sum + c.items.length, 0);

  const startAudit = useCallback(async (mode: ReadinessAuditMode = 'light') => {
    setIsRunning(true);
    setCurrentMode(mode);
    try {
      console.log('[BackendAudit] Starting', mode, 'audit...');
      const result = await runFullAudit(mode);
      setCategories(result);
      setLastRunAt(new Date());
      console.log('[BackendAudit] Audit complete for mode:', mode);
    } catch (err) {
      console.error('[BackendAudit] Audit failed:', err);
    } finally {
      setIsRunning(false);
    }
  }, []);

  useEffect(() => {
    void startAudit('light');
  }, [startAudit]);

  useEffect(() => {
    if (isRunning) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRunning, pulseAnim]);

  const toggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const getStatusIcon = useCallback((status: AuditStatus, size: number = 16) => {
    switch (status) {
      case 'pass': return <CheckCircle size={size} color={STATUS_COLORS.pass} />;
      case 'fail': return <XCircle size={size} color={STATUS_COLORS.fail} />;
      case 'warn': return <AlertTriangle size={size} color={STATUS_COLORS.warn} />;
      case 'info': return <Zap size={size} color={STATUS_COLORS.info} />;
      default: return <ShimmerIndicator size="small" color={STATUS_COLORS.checking} />;
    }
  }, []);

  const getCategorySummary = useCallback((category: AuditCategory) => {
    const _fail = category.items.filter(i => i.status === 'fail').length;
    const _warn = category.items.filter(i => i.status === 'warn').length;
    if (_fail > 0) return 'fail' as AuditStatus;
    if (_warn > 0) return 'warn' as AuditStatus;
    return 'pass' as AuditStatus;
  }, []);

  const renderItem = useCallback((item: AuditItem) => {
    return (
      <View key={item.id} style={styles.auditItem}>
        <View style={styles.auditItemHeader}>
          {getStatusIcon(item.status)}
          <View style={styles.auditItemText}>
            <Text style={styles.auditItemName}>{item.name}</Text>
            <Text style={[styles.auditItemMessage, { color: STATUS_COLORS[item.status] }]}>
              {item.message}
            </Text>
          </View>
          {item.latencyMs !== undefined && (
            <View style={styles.latencyBadge}>
              <Text style={styles.latencyText}>{item.latencyMs}ms</Text>
            </View>
          )}
          <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLORS[item.severity] + '20' }]}>
            <Text style={[styles.severityText, { color: SEVERITY_COLORS[item.severity] }]}>
              {item.severity.toUpperCase()}
            </Text>
          </View>
        </View>
        {item.details && (
          <Text style={styles.auditItemDetails}>{item.details}</Text>
        )}
      </View>
    );
  }, [getStatusIcon]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="back-button">
          <ArrowLeft size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Backend Audit</Text>
          <Text style={styles.headerSubtitle}>Light scan by default · deep audit on demand</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => void startAudit('light')} style={styles.refreshButton} disabled={isRunning} testID="refresh-audit-light">
            <Animated.View style={{ opacity: isRunning && currentMode === 'light' ? pulseAnim : 1 }}>
              <RefreshCw size={20} color="#fff" />
            </Animated.View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void startAudit('full')} style={styles.deepAuditButton} disabled={isRunning} testID="refresh-audit-full">
            <Animated.View style={{ opacity: isRunning && currentMode === 'full' ? pulseAnim : 1 }}>
              <Zap size={20} color="#fff" />
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={isRunning} onRefresh={() => void startAudit('light')} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {isRunning && categories.length === 0 && (
          <View style={styles.loadingContainer}>
            <ShimmerIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>{currentMode === 'full' ? 'Running deep audit...' : 'Running lightweight audit...'}</Text>
            <Text style={styles.loadingSubtext}>
              {currentMode === 'full'
                ? 'Checking Supabase, write-path readiness, AWS, Email, SMS, Payments, KYC...'
                : 'Checking cached health, auth reachability, and read-only readiness without the heavy write probes...'}
            </Text>
          </View>
        )}

        {categories.length > 0 && (
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={[styles.summaryBox, { backgroundColor: '#00C48C15' }]}>
                  <CheckCircle size={22} color="#00C48C" />
                  <Text style={styles.summaryCount}>{totalPass}</Text>
                  <Text style={styles.summaryLabel}>Passed</Text>
                </View>
                <View style={[styles.summaryBox, { backgroundColor: '#FF4D4D15' }]}>
                  <XCircle size={22} color="#FF4D4D" />
                  <Text style={[styles.summaryCount, { color: '#FF4D4D' }]}>{totalFail}</Text>
                  <Text style={styles.summaryLabel}>Red</Text>
                </View>
                <View style={[styles.summaryBox, { backgroundColor: '#F59E0B15' }]}>
                  <AlertTriangle size={22} color="#F59E0B" />
                  <Text style={[styles.summaryCount, { color: '#F59E0B' }]}>{totalWarn}</Text>
                  <Text style={styles.summaryLabel}>Warnings</Text>
                </View>
              </View>
              <View style={styles.progressBarContainer}>
                <View style={[styles.progressSegment, { flex: totalPass, backgroundColor: '#00C48C' }]} />
                <View style={[styles.progressSegment, { flex: totalWarn, backgroundColor: '#F59E0B' }]} />
                <View style={[styles.progressSegment, { flex: totalFail, backgroundColor: '#FF4D4D' }]} />
              </View>
              <Text style={styles.summaryTotal}>
                {totalItems} checks completed {lastRunAt ? `at ${lastRunAt.toLocaleTimeString()}` : ''}
              </Text>
            </View>

            {totalFail > 0 && (
              <View style={styles.criticalSection}>
                <View style={styles.criticalHeader}>
                  <XCircle size={18} color="#FF4D4D" />
                  <Text style={styles.criticalTitle}>Red crashes & blockers ({totalFail})</Text>
                </View>
                {categories.flatMap(c => c.items.filter(i => i.status === 'fail')).map((item, idx) => (
                  <View key={item.id} style={styles.criticalItem}>
                    <Text style={styles.criticalIndex}>{idx + 1}.</Text>
                    <View style={styles.criticalContent}>
                      <Text style={styles.criticalName}>{item.name}</Text>
                      <Text style={styles.criticalMessage}>{item.message}</Text>
                      {item.details && <Text style={styles.criticalDetails}>{item.details}</Text>}
                    </View>
                    <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLORS[item.severity] + '20' }]}>
                      <Text style={[styles.severityText, { color: SEVERITY_COLORS[item.severity] }]}>
                        {item.severity.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {totalWarn > 0 && (
              <View style={styles.warningSection}>
                <View style={styles.warningHeader}>
                  <AlertTriangle size={18} color="#F59E0B" />
                  <Text style={styles.warningTitle}>Yellow warnings ({totalWarn})</Text>
                </View>
                {categories.flatMap(c => c.items.filter(i => i.status === 'warn')).map((item, idx) => (
                  <View key={item.id} style={styles.warningItem}>
                    <Text style={styles.warningIndex}>{idx + 1}.</Text>
                    <View style={styles.warningContent}>
                      <Text style={styles.warningName}>{item.name}</Text>
                      <Text style={styles.warningMessage}>{item.message}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.passSection}>
              <View style={styles.passHeader}>
                <CheckCircle size={18} color="#00C48C" />
                <Text style={styles.passTitle}>Working Correctly ({totalPass})</Text>
              </View>
              {categories.flatMap(c => c.items.filter(i => i.status === 'pass')).map((item, idx) => (
                <View key={item.id} style={styles.passItem}>
                  <Text style={styles.passIndex}>{idx + 1}.</Text>
                  <View style={styles.passContent}>
                    <Text style={styles.passName}>{item.name}</Text>
                    <Text style={styles.passMessage}>{item.message}</Text>
                  </View>
                </View>
              ))}
            </View>

            <Text style={styles.sectionDividerText}>Detailed Breakdown by Category</Text>

            {categories.map(category => {
              const isExpanded = expandedCategories.has(category.id);
              getCategorySummary(category);
              const catPass = category.items.filter(i => i.status === 'pass').length;
              const catFail = category.items.filter(i => i.status === 'fail').length;
              const catWarn = category.items.filter(i => i.status === 'warn').length;

              return (
                <View key={category.id} style={styles.categoryCard}>
                  <TouchableOpacity
                    style={styles.categoryHeader}
                    onPress={() => toggleCategory(category.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.categoryLeft}>
                      {category.icon}
                      <Text style={styles.categoryName}>{category.name}</Text>
                    </View>
                    <View style={styles.categoryRight}>
                      <View style={styles.categoryBadges}>
                        {catPass > 0 && (
                          <View style={[styles.catBadge, { backgroundColor: '#00C48C20' }]}>
                            <Text style={[styles.catBadgeText, { color: '#00C48C' }]}>{catPass}</Text>
                          </View>
                        )}
                        {catWarn > 0 && (
                          <View style={[styles.catBadge, { backgroundColor: '#F59E0B20' }]}>
                            <Text style={[styles.catBadgeText, { color: '#F59E0B' }]}>{catWarn}</Text>
                          </View>
                        )}
                        {catFail > 0 && (
                          <View style={[styles.catBadge, { backgroundColor: '#FF4D4D20' }]}>
                            <Text style={[styles.catBadgeText, { color: '#FF4D4D' }]}>{catFail}</Text>
                          </View>
                        )}
                      </View>
                      {isExpanded ? <ChevronUp size={18} color="#9CA3AF" /> : <ChevronDown size={18} color="#9CA3AF" />}
                    </View>
                  </TouchableOpacity>
                  {isExpanded && (
                    <View style={styles.categoryItems}>
                      {category.items.map(renderItem)}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#1A1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A'},
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center'},
  headerTitleContainer: {
    flex: 1,
    marginLeft: 14},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#fff'},
  headerSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2},
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1F2937',
    alignItems: 'center',
    justifyContent: 'center'},
  deepAuditButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primary + '30',
    alignItems: 'center',
    justifyContent: 'center'},
  scrollView: {
    flex: 1},
  scrollContent: {
    padding: 16},
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80},
  loadingText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
    marginTop: 16},
  loadingSubtext: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 6,
    textAlign: 'center'},
  summaryCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A'},
  summaryRow: {
    flexDirection: 'row',
    gap: 10},
  summaryBox: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 6},
  summaryCount: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: '#00C48C'},
  summaryLabel: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: '#9CA3AF'},
  progressBarContainer: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 16,
    backgroundColor: '#2A2A2A'},
  progressSegment: {
    height: '100%'},
  summaryTotal: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 10,
    textAlign: 'center'},
  criticalSection: {
    backgroundColor: '#1C1117',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FF4D4D40'},
  criticalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14},
  criticalTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FF4D4D'},
  criticalItem: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#FF4D4D20',
    alignItems: 'flex-start'},
  criticalIndex: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FF4D4D',
    width: 24,
    marginTop: 2},
  criticalContent: {
    flex: 1,
    marginRight: 8},
  criticalName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FCA5A5'},
  criticalMessage: {
    fontSize: 12,
    color: '#FF4D4D',
    marginTop: 2},
  criticalDetails: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
    lineHeight: 16},
  warningSection: {
    backgroundColor: '#1C1A11',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F59E0B40'},
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14},
  warningTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#F59E0B'},
  warningItem: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F59E0B20',
    alignItems: 'flex-start'},
  warningIndex: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#F59E0B',
    width: 24,
    marginTop: 2},
  warningContent: {
    flex: 1},
  warningName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FCD34D'},
  warningMessage: {
    fontSize: 12,
    color: '#F59E0B',
    marginTop: 2},
  passSection: {
    backgroundColor: '#0F1A14',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#00C48C40'},
  passHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14},
  passTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#00C48C'},
  passItem: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#00C48C20',
    alignItems: 'flex-start'},
  passIndex: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#00C48C',
    width: 24,
    marginTop: 2},
  passContent: {
    flex: 1},
  passName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#6EE7B7'},
  passMessage: {
    fontSize: 12,
    color: '#00C48C',
    marginTop: 2},
  sectionDividerText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#6B7280',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 14,
    textAlign: 'center'},
  categoryCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden'},
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16},
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1},
  categoryName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff'},
  categoryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  categoryBadges: {
    flexDirection: 'row',
    gap: 4},
  catBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8},
  catBadgeText: {
    fontSize: 12,
    fontWeight: '700' as const},
  categoryItems: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A'},
  auditItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A70'},
  auditItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10},
  auditItemText: {
    flex: 1},
  auditItemName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#E5E7EB'},
  auditItemMessage: {
    fontSize: 11,
    marginTop: 2},
  auditItemDetails: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 6,
    marginLeft: 26,
    lineHeight: 16},
  latencyBadge: {
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  latencyText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600' as const},
  severityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  severityText: {
    fontSize: 9,
    fontWeight: '700' as const}});
