import React, { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Clipboard,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  Globe,
  MapPin,
  Receipt,
  Share2,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { supabase } from '@/lib/supabase';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

type WireInstructions = {
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  accountName: string;
  bankAddress: string;
  beneficiaryAddress: string;
  swiftCode?: string;
  referenceCode?: string;
  note?: string;
};

async function getWireAuthHeaders(): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export default function WireTransferScreen(): React.ReactElement {
  const router = useRouter();
  const [instructions, setInstructions] = useState<WireInstructions | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    amount: '',
    currency: 'USD',
    sentAt: new Date().toISOString().split('T')[0],
    senderBankName: '',
    senderAccountLast4: '',
    notes: '',
  });

  const fetchInstructions = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const headers = await getWireAuthHeaders();
      if (!headers) {
        setInstructions(null);
        router.replace('/login');
        return;
      }

      const res = await fetch(`${API_BASE}/api/ivx/wire-instructions`, { headers });
      const json = await res.json();
      if (res.ok && json.ok && json.authenticated === true && json.instructions) {
        setInstructions(json.instructions);
      } else if (json.authenticated === false || res.status === 401 || res.status === 403) {
        setInstructions(null);
        router.replace('/login');
      } else {
        Alert.alert('Wire instructions unavailable', json.error || 'Please try again later.');
      }
    } catch (error) {
      Alert.alert('Network error', 'Could not load wire instructions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void fetchInstructions();
  }, [fetchInstructions]);

  const onRefresh = () => {
    setRefreshing(true);
    void fetchInstructions(true);
  };

  const copyToClipboard = (value: string, label: string) => {
    Clipboard.setString(value);
    Alert.alert('Copied', `${label} copied to clipboard.`);
  };

  const shareInstructions = async () => {
    if (!instructions) return;
    const text = [
      'Wire transfer instructions for IVX Holdings',
      `Bank: ${instructions.bankName}`,
      `Routing: ${instructions.routingNumber}`,
      `Account: ${instructions.accountNumber}`,
      `Account Name: ${instructions.accountName}`,
      instructions.swiftCode ? `SWIFT: ${instructions.swiftCode}` : '',
      `Bank Address: ${instructions.bankAddress}`,
      `Beneficiary Address: ${instructions.beneficiaryAddress}`,
      instructions.referenceCode ? `Reference Code: ${instructions.referenceCode}` : '',
    ].filter(Boolean).join('\n');
    await Share.share({ message: text });
  };

  const submitWire = async () => {
    if (!instructions?.referenceCode) return;
    if (!form.amount || !form.sentAt) {
      Alert.alert('Missing info', 'Please enter amount and sent date.');
      return;
    }
    setSubmitting(true);
    try {
      const headers = await getWireAuthHeaders();
      if (!headers) {
        router.replace('/login');
        return;
      }

      const res = await fetch(`${API_BASE}/api/ivx/wire-submission`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...form,
          referenceCode: instructions.referenceCode,
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        Alert.alert('Wire reported', 'Thank you. Investor relations will verify and credit your account.');
      } else if (res.status === 401 || res.status === 403) {
        router.replace('/login');
      } else {
        Alert.alert('Failed to report wire', json.error || 'Please try again.');
      }
    } catch (error) {
      Alert.alert('Network error', 'Could not submit wire notification.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ title: 'Wire Transfer', headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Wire Transfer</Text>
          <View style={styles.placeholder} />
        </View>
        <>
          <ShimmerIndicator />
          <Text style={styles.loadingText}>Loading wire instructions...</Text>
        </>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ title: 'Wire Transfer', headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Wire Transfer</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.card}>
          <View style={styles.row}>
            <ShieldCheck size={20} color={Colors.primary} />
            <Text style={styles.notice}>
              Wire transfers are processed by investor relations. Include your unique reference code so we can match your funds.
            </Text>
          </View>
        </View>

        {instructions && (
          <>
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Building2 size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Receiving Bank</Text>
              </View>
              <CopyRow label="Bank Name" value={instructions.bankName} />
              <CopyRow label="Routing Number" value={instructions.routingNumber} />
              <CopyRow label="Bank Address" value={instructions.bankAddress} />
              {instructions.swiftCode && (
                <CopyRow label="SWIFT/BIC (International)" value={instructions.swiftCode} />
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Wallet size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Beneficiary Account</Text>
              </View>
              <CopyRow label="Account Name" value={instructions.accountName} />
              <CopyRow label="Account Number" value={instructions.accountNumber} />
              <CopyRow label="Beneficiary Address" value={instructions.beneficiaryAddress} />
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Receipt size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Your Reference Code</Text>
              </View>
              <Text style={styles.refCode}>{instructions.referenceCode}</Text>
              <Text style={styles.refHint}>
                Add this code to the wire memo / reference field so we can match your funds automatically.
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => instructions.referenceCode && copyToClipboard(instructions.referenceCode, 'Reference code')}
              >
                <Copy size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Copy Reference Code</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.shareBtn} onPress={shareInstructions}>
              <Share2 size={18} color={Colors.primary} />
              <Text style={styles.shareBtnText}>Share All Instructions</Text>
            </TouchableOpacity>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Check size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>I Already Sent the Wire</Text>
              </View>
              <TextInput
                style={styles.input}
                placeholder="Amount (e.g. 50000)"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="decimal-pad"
                value={form.amount}
                onChangeText={(text) => setForm({ ...form, amount: text })}
              />
              <TextInput
                style={styles.input}
                placeholder="Currency (e.g. USD)"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="characters"
                value={form.currency}
                onChangeText={(text) => setForm({ ...form, currency: text.toUpperCase() })}
              />
              <TextInput
                style={styles.input}
                placeholder="Sent Date (YYYY-MM-DD)"
                placeholderTextColor={Colors.textTertiary}
                value={form.sentAt}
                onChangeText={(text) => setForm({ ...form, sentAt: text })}
              />
              <TextInput
                style={styles.input}
                placeholder="Your Bank Name"
                placeholderTextColor={Colors.textTertiary}
                value={form.senderBankName}
                onChangeText={(text) => setForm({ ...form, senderBankName: text })}
              />
              <TextInput
                style={styles.input}
                placeholder="Your Account Last 4 Digits"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="number-pad"
                maxLength={4}
                value={form.senderAccountLast4}
                onChangeText={(text) => setForm({ ...form, senderAccountLast4: text })}
              />
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Notes (optional)"
                placeholderTextColor={Colors.textTertiary}
                multiline
                value={form.notes}
                onChangeText={(text) => setForm({ ...form, notes: text })}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, submitting && styles.disabledBtn]}
                onPress={submitWire}
                disabled={submitting}
              >
                <Text style={styles.primaryBtnText}>{submitting ? 'Submitting...' : 'Notify Investor Relations'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={styles.footer}>
          Questions? Email investors@ivxholding.com
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.copyRow}>
      <View style={styles.copyRowText}>
        <Text style={styles.copyLabel}>{label}</Text>
        <Text style={styles.copyValue}>{value}</Text>
      </View>
      <TouchableOpacity onPress={() => Clipboard.setString(value)} style={styles.copyIcon}>
        <Copy size={18} color={Colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: 8 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  placeholder: { width: 38 },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  scroll: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  notice: { flex: 1, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  copyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  copyRowText: { flex: 1, paddingRight: 12 },
  copyLabel: { fontSize: 12, color: Colors.textTertiary, marginBottom: 2 },
  copyValue: { fontSize: 15, color: Colors.text, fontWeight: '500' },
  copyIcon: { padding: 6 },
  refCode: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 1,
    textAlign: 'center',
    marginVertical: 12,
  },
  refHint: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabledBtn: { opacity: 0.6 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 16,
  },
  shareBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 15 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: Colors.text,
    marginBottom: 12,
    backgroundColor: Colors.background,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  footer: { textAlign: 'center', color: Colors.textTertiary, fontSize: 13, marginTop: 8 },
});