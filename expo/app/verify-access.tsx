import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/colors';

const API_BASE = process.env.EXPO_PUBLIC_IVX_API_BASE_URL
  ? process.env.EXPO_PUBLIC_IVX_API_BASE_URL.replace(/\/+$/, '')
  : 'https://api.ivxholding.com';

type AccessStatus = {
  access_status: string;
  access_reason: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  verification_required: boolean;
};

async function authenticatedPost(path: string, body: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your secure session expired. Please sign in again.');
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `Verification request failed (${response.status}).`);
  }
  return payload;
}

export default function VerifyAccessScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      router.replace('/login');
      return;
    }
    const { data, error } = await supabase.rpc('ivx_my_platform_access_status');
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as AccessStatus | null;
    setStatus(row);
    if (row && row.access_status === 'active') {
      router.replace('/(tabs)/home');
    }
  }, [router]);

  useEffect(() => {
    void refresh()
      .catch((error) => Alert.alert('Verification status', (error as Error).message))
      .finally(() => setLoading(false));
  }, [refresh]);

  const run = useCallback(async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      Alert.alert('IVX Verification', successMessage);
    } catch (error) {
      Alert.alert('Verification required', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={Colors.primary} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Verify your IVX account</Text>
        <Text style={styles.subtitle}>For account security, email and mobile verification are required before private platform access.</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Email</Text>
          <Text style={status?.email_verified ? styles.ok : styles.required}>{status?.email_verified ? 'Verified' : 'Verification required'}</Text>
          {!status?.email_verified && (
            <>
              <TouchableOpacity disabled={busy} style={styles.secondaryButton} onPress={() => void run(() => authenticatedPost('/api/members/send-email-code', {}), 'Email verification code sent.')}>
                <Text style={styles.secondaryText}>Send email code</Text>
              </TouchableOpacity>
              <TextInput value={emailCode} onChangeText={setEmailCode} keyboardType="number-pad" maxLength={6} placeholder="6-digit email code" placeholderTextColor="#777" style={styles.input} />
              <TouchableOpacity disabled={busy || emailCode.length !== 6} style={styles.primaryButton} onPress={() => void run(() => authenticatedPost('/api/members/verify-email', { code: emailCode }), 'Email verified.')}>
                <Text style={styles.primaryText}>Verify email</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Mobile phone</Text>
          <Text style={status?.phone_verified ? styles.ok : styles.required}>{status?.phone_verified ? 'Verified' : 'Verification required'}</Text>
          {!status?.phone_verified && (
            <>
              <TouchableOpacity disabled={busy} style={styles.secondaryButton} onPress={() => void run(() => authenticatedPost('/api/members/send-phone-code', {}), 'SMS verification code sent.')}>
                <Text style={styles.secondaryText}>Send SMS code</Text>
              </TouchableOpacity>
              <TextInput value={phoneCode} onChangeText={setPhoneCode} keyboardType="number-pad" maxLength={6} placeholder="6-digit SMS code" placeholderTextColor="#777" style={styles.input} />
              <TouchableOpacity disabled={busy || phoneCode.length !== 6} style={styles.primaryButton} onPress={() => void run(() => authenticatedPost('/api/members/verify-phone', { code: phoneCode }), 'Mobile phone verified.')}>
                <Text style={styles.primaryText}>Verify mobile</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {busy && <ActivityIndicator color={Colors.primary} style={{ marginTop: 16 }} />}
        <TouchableOpacity style={styles.signOut} onPress={() => void supabase.auth.signOut().then(() => router.replace('/login'))}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#121219', borderRadius: 20, padding: 22, borderWidth: 1, borderColor: '#2A2A34' },
  title: { color: '#FFF', fontSize: 24, fontWeight: '800', marginBottom: 8 },
  subtitle: { color: '#B4B4BD', fontSize: 14, lineHeight: 20, marginBottom: 20 },
  section: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#2A2A34' },
  label: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  ok: { color: '#53D769', marginTop: 4, marginBottom: 10 },
  required: { color: '#FFB84D', marginTop: 4, marginBottom: 10 },
  input: { backgroundColor: '#0A0A0F', color: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#33333D', paddingHorizontal: 14, paddingVertical: 12, marginTop: 10 },
  primaryButton: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  primaryText: { color: '#050505', fontWeight: '800' },
  secondaryButton: { borderColor: Colors.primary, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryText: { color: Colors.primary, fontWeight: '700' },
  signOut: { marginTop: 22, alignItems: 'center' },
  signOutText: { color: '#A0A0AA' },
});
