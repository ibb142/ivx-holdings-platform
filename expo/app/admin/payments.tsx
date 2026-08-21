/**
 * IVX Admin Payment Settings
 *
 * Route: /admin/payments
 *
 * Owner-only page showing:
 * - Payment statistics by state and pathway
 * - Recent transactions
 * - Admin quick actions
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  Building2,
  Receipt,
  RefreshCw,
  Banknote} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { DIRECT_API_BASE_URL } from '@/lib/public-api';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface PaymentStats {
  byState: Record<string, { count: number; totalCents: number }>;
  byPathway: Record<string, { total: number; succeeded: number; processing: number; failed: number }>;
  totalPayments: number;
  totalVolumeCents: number;
}

export default function AdminPaymentSettings() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    const base = DIRECT_API_BASE_URL || 'https://api.ivxholding.com';

    // Get auth token
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    try {
      const statsRes = await fetch(`${base}/api/ivx/payments/admin/stats`, { headers });
      const statsData = await statsRes.json();
      if (statsData.ok) setStats(statsData.stats);
    } catch (err) {
      console.error('[AdminPayments] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ShimmerIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading payment settings...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft color={Colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Statistics */}
        {stats && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Transaction Statistics</Text>
            <View style={styles.statsGrid}>
              <StatBox label="Total Payments" value={String(stats.totalPayments)} icon="payments" />
              <StatBox label="Total Volume" value={`$${(stats.totalVolumeCents / 100).toLocaleString()}`} icon="dollar" />
            </View>

            {/* By state */}
            <Text style={styles.subTitle}>By Status</Text>
            {Object.entries(stats.byState).map(([state, data]) => (
              <View key={state} style={styles.statRow}>
                <Text style={styles.statLabel}>{state}</Text>
                <Text style={styles.statValue}>{data.count} · ${(data.totalCents / 100).toLocaleString()}</Text>
              </View>
            ))}

            {/* By pathway */}
            <Text style={styles.subTitle}>By Pathway</Text>
            {Object.entries(stats.byPathway).map(([pathway, data]) => (
              <View key={pathway} style={styles.statRow}>
                <Text style={styles.statLabel}>{pathway}</Text>
                <Text style={styles.statValue}>
                  {data.total} total · {data.succeeded} ok · {data.processing} pending · {data.failed} failed
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Admin Actions</Text>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => { onRefresh(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <RefreshCw color={Colors.primary} size={20} />
            <Text style={styles.actionButtonText}>Refresh Data</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push('/admin/transactions')}
          >
            <Receipt color={Colors.primary} size={20} />
            <Text style={styles.actionButtonText}>View All Transactions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push('/admin/applications')}
          >
            <Banknote color={Colors.primary} size={20} />
            <Text style={styles.actionButtonText}>Review JV Applications</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push('/admin/applications')}
          >
            <Building2 color={Colors.primary} size={20} />
            <Text style={styles.actionButtonText}>Review Buyer Offers</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Payment infrastructure v1.0 · Bank wire & ACH rails · RLS-protected
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statBoxValue}>{value}</Text>
      <Text style={styles.statBoxLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  loadingContainer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#909090', marginTop: 12, fontSize: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' },
  backButton: { padding: 4 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  statusCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  statusTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  envBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, marginBottom: 16 },
  envText: { fontSize: 13, fontWeight: '700' },
  statusGrid: { gap: 8 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusRowLabel: { color: '#909090', fontSize: 14 },
  statusRowValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusRowText: { fontSize: 13, fontWeight: '600' },
  sectionCard: { backgroundColor: '#141414', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  subTitle: { color: '#909090', fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  capRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  capLabel: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  capLabelDisabled: { color: '#666' },
  statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: '#1A1A1A', borderRadius: 12, padding: 16, alignItems: 'center' },
  statBoxValue: { color: '#E6C200', fontSize: 22, fontWeight: '700' },
  statBoxLabel: { color: '#909090', fontSize: 12, marginTop: 4 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel: { color: '#909090', fontSize: 13 },
  statValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  warningCard: { backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  warningTitle: { color: '#F59E0B', fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  warningText: { color: '#909090', fontSize: 13, marginBottom: 12 },
  warningCode: { color: '#E6C200', fontSize: 12, fontFamily: 'monospace', marginVertical: 2 },
  warningHint: { color: '#666', fontSize: 11, marginTop: 12, lineHeight: 16 },
  actionButton: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#1A1A1A', borderRadius: 12, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  actionButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  footer: { padding: 16, alignItems: 'center' },
  footerText: { color: '#555', fontSize: 11 }});
