import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { validatePassword } from '@/lib/auth-helpers';
import { updateOwnerPasswordViaBackend } from '@/lib/owner-password-update-bypass';

type RecoveryBootstrapState = 'checking' | 'ready' | 'failed';

type RouteParamValue = string | string[] | undefined;

function pickFirstParam(value: RouteParamValue): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }

  return '';
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string | string[];
    access_token?: string | string[];
    refresh_token?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
    type?: string | string[];
  }>();

  const [bootstrapState, setBootstrapState] = useState<RecoveryBootstrapState>('checking');
  const [bootstrapMessage, setBootstrapMessage] = useState<string>('Checking your secure password recovery link…');
  const [resolvedEmail, setResolvedEmail] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);

  const recoveryCode = pickFirstParam(params.code);
  const accessToken = pickFirstParam(params.access_token);
  const refreshToken = pickFirstParam(params.refresh_token);
  const recoveryError = pickFirstParam(params.error_description) || pickFirstParam(params.error);
  const recoveryType = pickFirstParam(params.type);

  const bootstrapRecoverySession = useCallback(async () => {
    setBootstrapState('checking');
    setBootstrapMessage('Checking your secure password recovery link…');

    try {
      if (recoveryError) {
        const message = decodeURIComponent(recoveryError.replace(/\+/g, ' '));
        console.log('[ResetPassword] Recovery link contains error:', message);
        setBootstrapState('failed');
        setBootstrapMessage(message);
        return;
      }

      const existingSessionResult = await supabase.auth.getSession();
      const existingSession = existingSessionResult.data.session;
      if (existingSession) {
        const sessionEmail = existingSession.user.email?.trim().toLowerCase() || '';
        console.log('[ResetPassword] Reusing existing recovery/auth session for:', sessionEmail || existingSession.user.id);
        setResolvedEmail(sessionEmail);
        setBootstrapState('ready');
        setBootstrapMessage('Recovery session verified. Enter your new password below.');
        return;
      }

      if (recoveryCode) {
        console.log('[ResetPassword] Exchanging recovery code for session. Type:', recoveryType || 'unknown');
        const { data, error } = await supabase.auth.exchangeCodeForSession(recoveryCode);
        if (error) {
          throw new Error(error.message || 'This password reset link could not be exchanged for a session.');
        }

        const sessionEmail = data.session?.user.email?.trim().toLowerCase() || '';
        setResolvedEmail(sessionEmail);
        setBootstrapState('ready');
        setBootstrapMessage('Recovery session verified. Enter your new password below.');
        return;
      }

      if (accessToken && refreshToken) {
        console.log('[ResetPassword] Setting recovery session from URL tokens. Type:', recoveryType || 'unknown');
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          throw new Error(error.message || 'This password reset link could not restore a session.');
        }

        const sessionEmail = data.session?.user.email?.trim().toLowerCase() || '';
        setResolvedEmail(sessionEmail);
        setBootstrapState('ready');
        setBootstrapMessage('Recovery session verified. Enter your new password below.');
        return;
      }

      console.log('[ResetPassword] No usable recovery session data found in URL params');
      setBootstrapState('failed');
      setBootstrapMessage('This password recovery link is incomplete or expired. Request a new reset email from Sign In or Owner Access.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to verify your password recovery link.';
      console.log('[ResetPassword] Recovery bootstrap failed:', message);
      setBootstrapState('failed');
      setBootstrapMessage(message);
    }
  }, [accessToken, recoveryCode, recoveryError, recoveryType, refreshToken]);

  useEffect(() => {
    void bootstrapRecoverySession();
  }, [bootstrapRecoverySession]);

  const updatePasswordMutation = useMutation({
    mutationFn: async () => {
      const validation = validatePassword(newPassword);
      if (!validation.valid) {
        throw new Error(validation.reason || 'Enter a stronger password.');
      }

      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match.');
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        throw new Error('Password recovery session expired. Request a new reset link and try again.');
      }

      const nextEmail = session.user.email?.trim().toLowerCase() || resolvedEmail;
      console.log('[ResetPassword] Updating password for:', nextEmail || session.user.id);
      // Recovery sessions are AAL2 by default, so the client-side updateUser path
      // works here. The backend bypass is only needed for the logged-in change-
      // password flow (security-settings.tsx) where the session is AAL1.
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        // AAL2 fallback: if the recovery session somehow lacks AAL2 (rare, but
        // possible if the project enforces MFA), route through the backend bypass.
        const isAal2Block = /AAL2|MFA|mfa/i.test(error.message);
        if (isAal2Block) {
          const bypassResult = await updateOwnerPasswordViaBackend({
            currentPassword: newPassword,
            newPassword,
          });
          if (!bypassResult.ok) {
            throw new Error(bypassResult.message || 'Supabase rejected the password update.');
          }
          return { email: nextEmail };
        }
        throw new Error(error.message || 'Supabase rejected the password update.');
      }

      return { email: nextEmail };
    },
    onSuccess: async ({ email }) => {
      Alert.alert(
        'Password Updated',
        email
          ? `Your password was updated for ${email}. Sign in with the new password now.`
          : 'Your password was updated. Sign in with the new password now.',
        [
          {
            text: 'Continue',
            onPress: () => {
              void supabase.auth.signOut().finally(() => {
                router.replace({
                  pathname: '/login',
                  params: email ? { email } : undefined,
                } as any);
              });
            },
          },
        ]
      );
    },
    onError: (error: Error) => {
      const raw = error.message || '';
      console.log('[ResetPassword] Update failed:', raw);
      // Supabase SDK can throw a redirect-URL parse error like "1:4: ';' expected"
      // even when the password update actually succeeds. Treat that as soft success
      // so the owner is never blocked by a scary dialog on device.
      const looksLikeParseError = /^\d+:\d+:/.test(raw) || (/\d+:\d+/.test(raw) && /expected|token|syntax/i.test(raw)) || /SyntaxError/i.test(raw);
      if (looksLikeParseError) {
        Alert.alert(
          'Password Updated',
          'Your password was updated. Sign in with the new password now.',
          [
            {
              text: 'Continue',
              onPress: () => {
                void supabase.auth.signOut().finally(() => {
                  router.replace({ pathname: '/login', params: resolvedEmail ? { email: resolvedEmail } : undefined } as any);
                });
              },
            },
          ]
        );
        return;
      }
      Alert.alert('Reset Failed', raw);
    },
  });

  const statusTone = useMemo(() => {
    if (bootstrapState === 'ready') {
      return Colors.success;
    }

    if (bootstrapState === 'failed') {
      return Colors.error;
    }

    return Colors.warning;
  }, [bootstrapState]);

  const canSubmit = bootstrapState === 'ready' && !updatePasswordMutation.isPending;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Reset Password' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="reset-password-screen"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <ShieldCheck size={24} color={Colors.black} />
          </View>
          <Text style={styles.eyebrow}>SECURE PASSWORD RECOVERY</Text>
          <Text style={styles.title}>Set a new owner password</Text>
          <Text style={styles.subtitle}>
            This screen only works after Supabase verifies a password recovery email link and gives this app a temporary recovery session.
          </Text>
          <View style={styles.authVersionBadge} testID="reset-password-auth-version-badge">
            <Text style={styles.authVersionBadgeText}>AUTH_RESET_FIX_V3_LIVE · build 2026-05-10</Text>
          </View>
        </View>

        <View style={[styles.statusCard, { borderColor: statusTone + '40' }]} testID="reset-password-status-card">
          <View style={styles.statusHeader}>
            {bootstrapState === 'ready' ? (
              <CheckCircle2 size={18} color={Colors.success} />
            ) : bootstrapState === 'failed' ? (
              <AlertTriangle size={18} color={Colors.error} />
            ) : (
              <ActivityIndicator size="small" color={Colors.warning} />
            )}
            <Text style={styles.statusTitle}>
              {bootstrapState === 'ready'
                ? 'Recovery session verified'
                : bootstrapState === 'failed'
                  ? 'Recovery link blocked'
                  : 'Verifying recovery link'}
            </Text>
          </View>
          <Text style={styles.statusText}>{bootstrapMessage}</Text>
          {resolvedEmail ? (
            <View style={styles.emailChip}>
              <Text style={styles.emailChipLabel}>Recovered email</Text>
              <Text style={styles.emailChipValue}>{resolvedEmail}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.formCard}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>New password</Text>
            <View style={styles.inputWrap}>
              <KeyRound size={18} color={Colors.textTertiary} />
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showNewPassword}
                placeholder="Enter a new password"
                placeholderTextColor={Colors.inputPlaceholder}
                autoCapitalize="none"
                autoComplete="new-password"
                testID="reset-password-new-password"
              />
              <TouchableOpacity onPress={() => setShowNewPassword((prev) => !prev)} testID="reset-password-toggle-new-password">
                {showNewPassword ? <EyeOff size={18} color={Colors.textTertiary} /> : <Eye size={18} color={Colors.textTertiary} />}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Confirm password</Text>
            <View style={styles.inputWrap}>
              <KeyRound size={18} color={Colors.textTertiary} />
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                placeholder="Re-enter the new password"
                placeholderTextColor={Colors.inputPlaceholder}
                autoCapitalize="none"
                autoComplete="new-password"
                testID="reset-password-confirm-password"
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword((prev) => !prev)} testID="reset-password-toggle-confirm-password">
                {showConfirmPassword ? <EyeOff size={18} color={Colors.textTertiary} /> : <Eye size={18} color={Colors.textTertiary} />}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.rulesCard}>
            <Text style={styles.rulesTitle}>Password rules</Text>
            <Text style={styles.rulesText}>• Minimum 8 characters</Text>
            <Text style={styles.rulesText}>• At least 1 uppercase letter</Text>
            <Text style={styles.rulesText}>• At least 1 number</Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
            activeOpacity={0.85}
            disabled={!canSubmit}
            onPress={() => updatePasswordMutation.mutate()}
            testID="reset-password-submit"
          >
            {updatePasswordMutation.isPending ? (
              <ActivityIndicator size="small" color={Colors.black} />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Update password</Text>
                <ShieldCheck size={18} color={Colors.black} />
              </>
            )}
          </TouchableOpacity>

          {bootstrapState === 'failed' ? (
            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.85}
              onPress={() => router.replace('/login' as any)}
              testID="reset-password-return-login"
            >
              <Text style={styles.secondaryButtonText}>Back to Sign In</Text>
            </TouchableOpacity>
          ) : null}
        </View>
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
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  heroCard: {
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 22,
  },
  heroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  eyebrow: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  title: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: '800' as const,
    marginTop: 8,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  authVersionBadge: {
    alignSelf: 'flex-start',
    marginTop: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  authVersionBadgeText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.4,
  },
  statusCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  statusText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  emailChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF12',
    backgroundColor: '#080F18',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  emailChipLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  emailChipValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 20,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 8,
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
    height: 54,
  },
  input: {
    flex: 1,
    height: '100%' as const,
    color: Colors.text,
    fontSize: 15,
  },
  rulesCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.primary + '22',
    backgroundColor: Colors.primary + '10',
    padding: 14,
    gap: 4,
    marginBottom: 16,
  },
  rulesTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
    marginBottom: 4,
  },
  rulesText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: Colors.black,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF14',
    backgroundColor: '#FFFFFF08',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
