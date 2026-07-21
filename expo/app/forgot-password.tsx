import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Mail, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { IVX_LOGO_SOURCE } from '@/constants/brand';
import { validateEmail, sanitizeEmail } from '@/lib/auth-helpers';
import { supabase, isSupabaseConfigured, getSupabaseConfigAudit } from '@/lib/supabase';
import { getPasswordResetRedirectUrl, inspectPasswordResetRedirect } from '@/lib/auth-password-recovery';
import { clearAuthAttempts } from '@/lib/auth-rate-limiter';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState<string>(typeof params.email === 'string' ? params.email : '');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleSendReset = useCallback(async () => {
    const target = sanitizeEmail(email);
    if (!target || !validateEmail(target)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    if (!isSupabaseConfigured()) {
      const audit = getSupabaseConfigAudit();
      Alert.alert(
        'App Config Issue',
        `Supabase is not configured in this bundle.\n\nAudit: URL=${audit.urlConfigured}, key=${audit.keyConfigured}, fallback=${audit.usingFallback}, host=${audit.host}\n\nClose Expo Go fully, reopen, and reload.`,
      );
      return;
    }

    setLoading(true);
    try {
      const audit = inspectPasswordResetRedirect();
      const redirectTo = audit.resolvedUrl;
      console.log('[ForgotPassword] Sending reset email to:', target, 'redirect:', redirectTo);
      const { error } = await supabase.auth.resetPasswordForEmail(target, { redirectTo });
      if (error) {
        throw error;
      }
      clearAuthAttempts(target);
      setSentTo(target);
      setSent(true);
    } catch (error: unknown) {
      const raw = error instanceof Error ? error.message : String(error ?? '');
      const isRateLimit = raw.toLowerCase().includes('rate limit') || (error as any)?.status === 429;
      console.log('[ForgotPassword] Reset email failed:', raw);
      Alert.alert(
        'Reset Failed',
        isRateLimit
          ? 'Too many reset attempts. Please wait 60 seconds and try again.'
          : raw || 'Could not send the reset email. Try again in a moment.',
      );
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleReturnToLogin = useCallback(() => {
    router.replace({ pathname: '/login', params: sentTo ? { email: sentTo } : undefined } as any);
  }, [router, sentTo]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Forgot Password' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          testID="forgot-password-screen"
        >
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>

          <View style={styles.hero}>
            <View style={styles.logoCard}>
              <Image source={IVX_LOGO_SOURCE} style={styles.logo} resizeMode="contain" />
            </View>
            <Text style={styles.brand}>IVX HOLDINGS LLC</Text>
            <Text style={styles.tagline}>Premium Real Estate Investing</Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.title}>Password recovery</Text>
            <Text style={styles.subtitle}>
              Enter your email and we will send you a secure link to set a new password.
            </Text>

            {sent ? (
              <View style={styles.successCard} testID="forgot-password-success">
                <View style={styles.successIconWrap}>
                  <CheckCircle2 size={28} color={Colors.success} />
                </View>
                <Text style={styles.successTitle}>Reset email sent</Text>
                <Text style={styles.successText}>
                  A password reset link was sent to {sentTo}. Check your inbox and spam folder, then tap the link to choose a new password.
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  activeOpacity={0.85}
                  onPress={handleReturnToLogin}
                  testID="forgot-password-back-to-login"
                >
                  <Text style={styles.primaryButtonText}>Return to Sign In</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
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
                      returnKeyType="send"
                      onSubmitEditing={() => { void handleSendReset(); }}
                      testID="forgot-password-email"
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                  activeOpacity={0.85}
                  disabled={loading}
                  onPress={() => { void handleSendReset(); }}
                  testID="forgot-password-submit"
                >
                  {loading ? (
                    <ActivityIndicator size="small" color={Colors.black} />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Send reset link</Text>
                      <ShieldCheck size={18} color={Colors.black} />
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.infoCard}>
                  <AlertTriangle size={16} color={Colors.warning} />
                  <Text style={styles.infoText}>
                    The reset link will redirect to {getPasswordResetRedirectUrl()}. Make sure this domain is allowed in your Supabase Auth redirect settings.
                  </Text>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 32,
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
  hero: {
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
    marginBottom: 20,
    lineHeight: 20,
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
  infoCard: {
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.warning + '33',
    backgroundColor: Colors.warning + '10',
    padding: 14,
    flexDirection: 'row',
    gap: 10,
  },
  infoText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  successCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.success + '38',
    backgroundColor: Colors.success + '10',
    padding: 20,
    alignItems: 'center' as const,
    gap: 10,
  },
  successIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.success + '1F',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  successTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
  },
  successText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center' as const,
  },
});
