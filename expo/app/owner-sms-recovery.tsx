import React, { useState, useCallback, useEffect } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Shield, Smartphone, KeyRound, Lock } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { validateEmail, sanitizeEmail } from '@/lib/auth-helpers';
import {
  fetchOwnerRecoverySmsStatus,
  requestOwnerRecoverySms,
  verifyOwnerRecoverySms,
  type OwnerRecoveryStatus} from '@/lib/owner-recovery-sms';
import { IVX_LOGO_SOURCE } from '@/constants/brand';
import { Image } from 'react-native';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { IVXImage } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { EmptyState } from '@/components/ivx';

export default function OwnerSmsRecoveryScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { login } = useAuth();

  const [email, setEmail] = useState<string>(typeof params.email === 'string' ? params.email : '');
  const [code, setCode] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [step, setStep] = useState<'request' | 'verify' | 'reset' | 'done'>('request');
  const [loading, setLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<OwnerRecoveryStatus | null>(null);
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);

  useEffect(() => {
    fetchOwnerRecoverySmsStatus()
      .then(setStatus)
      .catch(() => setStatus({ ok: false, ready: false, transport: 'aws_sns', snsConfigured: false, awsCredentialsConfigured: false, awsRegion: 'us-east-1', recoveryPhoneConfigured: false, ownerEmailAllowlistConfigured: false }));
  }, []);

  const handleRequestCode = useCallback(async () => {
    const normalized = sanitizeEmail(email);
    if (!validateEmail(normalized)) {
      Alert.alert('Invalid email', 'Enter the owner email address.');
      return;
    }
    setLoading(true);
    try {
      const result = await requestOwnerRecoverySms(normalized);
      if (result.ok) {
        setPhoneMasked(result.phoneMasked);
        setStep('verify');
      } else {
        Alert.alert('Recovery SMS failed', result.message);
      }
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleVerifyCode = useCallback(async () => {
    const normalized = sanitizeEmail(email);
    if (!/^\d{6}$/.test(code)) {
      Alert.alert('Invalid code', 'Enter the 6-digit code from the SMS.');
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOwnerRecoverySms(normalized, code);
      if (result.ok) {
        setRecoveryToken(result.recoveryToken ?? null);
        setStep('reset');
      } else {
        Alert.alert('Code verification failed', result.message);
      }
    } finally {
      setLoading(false);
    }
  }, [email, code]);

  const handleResetPassword = useCallback(async () => {
    const normalized = sanitizeEmail(email);
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      Alert.alert('Weak password', 'Password must be at least 8 characters with 1 uppercase letter and 1 number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Password mismatch', 'The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOwnerRecoverySms(normalized, code, newPassword);
      if (result.ok && result.passwordRepaired) {
        setStep('done');
        // Wait briefly, then sign in with the new password.
        setTimeout(() => {
          void login(normalized, newPassword).then((loginResult) => {
            if (loginResult.success) {
              router.replace('/(tabs)/home' as any);
            } else {
              Alert.alert('Auto sign-in failed', `${loginResult.message}\n\nPlease return to the login screen and sign in manually with the new password.`);
            }
          });
        }, 1500);
      } else {
        Alert.alert('Password reset failed', result.message);
      }
    } finally {
      setLoading(false);
    }
  }, [email, code, newPassword, confirmPassword, login, router]);

  const missingEnv = status && !status.ready;

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
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <ArrowLeft size={22} color={Colors.text} />
            </TouchableOpacity>

            <View style={styles.heroSection}>
              <View style={styles.logoCard}>
                <Image source={IVX_LOGO_SOURCE} style={styles.logo} resizeMode="contain" />
              </View>
              <Text style={styles.brand}>IVX HOLDINGS LLC</Text>
              <Text style={styles.tagline}>Owner SMS Recovery</Text>
            </View>

            <View style={styles.formCard}>
              <View style={styles.headerRow}>
                <Shield size={20} color={Colors.primary} />
                <Text style={styles.title}>Emergency owner recovery</Text>
              </View>
              <Text style={styles.subtitle}>
                A one-time recovery code is sent to the registered owner phone. The code expires in 5 minutes and can be used once.
              </Text>

              {missingEnv ? (
                <View style={styles.warningCard}>
                  <Text style={styles.warningTitle}>SMS provider not configured</Text>
                  <Text style={styles.warningText}>
                    The backend is missing AWS SNS credentials or the recovery phone. Manual email/password login still works.
                  </Text>
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Owner email</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    placeholder="owner@example.com"
                    placeholderTextColor={Colors.inputPlaceholder}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    editable={step === 'request'}
                  />
                </View>
              </View>

              {step === 'request' ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                  onPress={handleRequestCode}
                  disabled={loading}
                >
                  {loading ? <ShimmerIndicator color={Colors.black} /> : <Text style={styles.primaryBtnText}>Send recovery code</Text>}
                </TouchableOpacity>
              ) : null}

              {step === 'verify' || step === 'reset' || step === 'done' ? (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Recovery code</Text>
                    <View style={styles.inputWrap}>
                      <KeyRound size={18} color={Colors.textTertiary} />
                      <TextInput
                        style={styles.input}
                        placeholder="000000"
                        placeholderTextColor={Colors.inputPlaceholder}
                        value={code}
                        onChangeText={setCode}
                        keyboardType="number-pad"
                        maxLength={6}
                        editable={step === 'verify'}
                      />
                    </View>
                    {phoneMasked ? <Text style={styles.hint}>Code sent to {phoneMasked}</Text> : null}
                  </View>

                  {step === 'verify' ? (
                    <TouchableOpacity
                      style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                      onPress={handleVerifyCode}
                      disabled={loading}
                    >
                      {loading ? <ShimmerIndicator color={Colors.black} /> : <Text style={styles.primaryBtnText}>Verify code</Text>}
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : null}

              {step === 'reset' || step === 'done' ? (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>New password</Text>
                    <View style={styles.inputWrap}>
                      <Lock size={18} color={Colors.textTertiary} />
                      <TextInput
                        style={styles.input}
                        placeholder="••••••••"
                        placeholderTextColor={Colors.inputPlaceholder}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        secureTextEntry
                        editable={step === 'reset'}
                      />
                    </View>
                  </View>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Confirm new password</Text>
                    <View style={styles.inputWrap}>
                      <Lock size={18} color={Colors.textTertiary} />
                      <TextInput
                        style={styles.input}
                        placeholder="••••••••"
                        placeholderTextColor={Colors.inputPlaceholder}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        secureTextEntry
                        editable={step === 'reset'}
                      />
                    </View>
                  </View>
                  {step === 'reset' ? (
                    <TouchableOpacity
                      style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                      onPress={handleResetPassword}
                      disabled={loading}
                    >
                      {loading ? <ShimmerIndicator color={Colors.black} /> : <Text style={styles.primaryBtnText}>Reset password & sign in</Text>}
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : null}

              {step === 'done' ? (
                <View style={styles.successCard}>
                  <Text style={styles.successTitle}>Recovery complete</Text>
                  <Text style={styles.successText}>The owner password was reset. Signing you in now...</Text>
                </View>
              ) : null}

              <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/login?ownerMode=1' as any)}>
                <Text style={styles.secondaryBtnText}>Back to owner login</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: 20, paddingBottom: 40 },
  backButton: { width: 40, height: 40, justifyContent: 'center', marginBottom: 8 },
  heroSection: { alignItems: 'center', marginBottom: 24 },
  logoCard: { width: 72, height: 72, borderRadius: 16, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  logo: { width: 48, height: 48 },
  brand: { fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: 1 },
  tagline: { fontSize: 13, color: Colors.textTertiary, marginTop: 4 },
  formCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: Colors.border },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textTertiary, marginBottom: 16, lineHeight: 18 },
  warningCard: { backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14, marginBottom: 16 },
  warningTitle: { fontSize: 14, fontWeight: '700', color: '#92400E', marginBottom: 4 },
  warningText: { fontSize: 13, color: '#92400E' },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.inputBackground, borderRadius: 12, paddingHorizontal: 12, height: 48, borderWidth: 1, borderColor: Colors.border },
  input: { flex: 1, color: Colors.text, fontSize: 15, marginLeft: 8 },
  hint: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 12, height: 48, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: Colors.black, fontSize: 15, fontWeight: '700' },
  secondaryBtn: { marginTop: 16, alignItems: 'center' },
  secondaryBtnText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  successCard: { backgroundColor: '#D1FAE5', borderRadius: 12, padding: 14, marginTop: 8 },
  successTitle: { fontSize: 14, fontWeight: '700', color: '#065F46', marginBottom: 4 },
  successText: { fontSize: 13, color: '#065F46' }});