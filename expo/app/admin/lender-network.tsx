import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Building2,
  Landmark,
  TrendingUp,
  Hammer,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  CheckCircle2} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { getIVXOwnerAIResolvedEndpoint } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

/**
 * IVX Private Lender Network — Admin UI (Module 3 of the Autonomous Business
 * Execution Engine). Owner-only. Calls the live backend:
 *   GET  /api/ivx/lender-network/dashboard
 *   GET  /api/ivx/lender-network/lenders
 *   POST /api/ivx/lender-network/scan
 *
 * Shows dashboard, lender list, scan, status, top lender match, category filter,
 * contact channel, fit score, and compliance note.
 */

type LenderCategory = 'hard_money' | 'private' | 'bridge' | 'construction' | 'commercial';

type LenderProfile = {
  id: string;
  category: LenderCategory;
  name: string;
  companyType: string;
  loanTypes: string[];
  maxLtvPercent: number | null;
  interestRateRangeLowPct: number | null;
  interestRateRangeHighPct: number | null;
  marketsServed: string[];
  loanSizeMinUsd: number | null;
  loanSizeMaxUsd: number | null;
  approvalRequirements: string[];
  publicSource: string;
  contactChannel: string;
  fitScore: number;
  rationale: string;
  nextAction: string;
  matchedDealNames: string[];
  complianceNote: string;
  status: string;
};

type Dashboard = {
  ok: boolean;
  marker: string;
  lenders: LenderProfile[];
  countsByCategory: Record<LenderCategory, number>;
  totalLenders: number;
  topByCategory: Record<LenderCategory, LenderProfile | null>;
};

type ScanResult = {
  ok: boolean;
  marker: string;
  scannedAt: string;
  dealsScanned: number;
  lendersUpserted: number;
  lenders: LenderProfile[];
  countsByCategory: Record<LenderCategory, number>;
  reason: string | null;
};

type OwnerProof = {
  ownerEmail: string | null;
  ownerRole: string | null;
  kycStatus: string | null;
  allowlisted: boolean | null;
  error: string | null;
};

const CATEGORY_LABELS: Record<LenderCategory, string> = {
  hard_money: 'Hard Money',
  private: 'Private',
  bridge: 'Bridge',
  construction: 'Construction',
  commercial: 'Commercial'};

const CATEGORY_ICONS: Record<LenderCategory, React.ComponentType<{ size?: number; color?: string }>> = {
  hard_money: Hammer,
  private: Building2,
  bridge: Building2,
  construction: TrendingUp,
  commercial: Landmark};

const CATEGORY_ORDER: readonly LenderCategory[] = ['hard_money', 'private', 'bridge', 'construction', 'commercial'];

function formatUsd(value: number | null): string {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function fitScoreColor(score: number): string {
  if (score >= 85) return Colors.success;
  if (score >= 75) return Colors.primary;
  if (score >= 60) return Colors.warning;
  return Colors.error;
}

export default function LenderNetworkScreen() {
  const router = useRouter();
  const apiBase = getIVXOwnerAIResolvedEndpoint() ?? 'https://api.ivxholding.com';

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [lenders, setLenders] = useState<LenderProfile[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [ownerProof, setOwnerProof] = useState<OwnerProof | null>(null);
  const [loading, setLoading] = useState<'idle' | 'dashboard' | 'lenders' | 'scan' | 'owner'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<LenderCategory | 'all'>('all');

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const fetchOwnerProof = useCallback(async () => {
    setLoading('owner');
    setError(null);
    try {
      const token = await getAuthToken();
      if (!token) {
        setOwnerProof({ ownerEmail: null, ownerRole: null, kycStatus: null, allowlisted: null, error: 'No owner session token. Sign in as owner first.' });
        setLoading('idle');
        return;
      }
      const res = await fetch(`${apiBase}/api/ivx/owner-signup-audit?email=${encodeURIComponent('iperez4242@gmail.com')}`, {
        headers: { Authorization: `Bearer ${token}` }});
      const json = (await res.json()) as Record<string, unknown>;
      setOwnerProof({
        ownerEmail: (json.ownerEmail as string) ?? (json.requestedEmail as string) ?? null,
        ownerRole: (json.role as string) ?? null,
        kycStatus: (json.kycStatus as string) ?? null,
        allowlisted: json.ownerAllowlist && typeof json.ownerAllowlist === 'object'
          ? ((json.ownerAllowlist as Record<string, unknown>).allowed as boolean) ?? null
          : null,
        error: res.ok ? null : `HTTP ${res.status}`});
    } catch (err) {
      setOwnerProof({ ownerEmail: null, ownerRole: null, kycStatus: null, allowlisted: null, error: err instanceof Error ? err.message : 'network_error' });
    } finally {
      setLoading('idle');
    }
  }, [apiBase, getAuthToken]);

  const fetchDashboard = useCallback(async () => {
    setLoading('dashboard');
    setError(null);
    try {
      const token = await getAuthToken();
      if (!token) {
        setError('No owner session token. Sign in as owner first.');
        setLoading('idle');
        return;
      }
      const res = await fetch(`${apiBase}/api/ivx/lender-network/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }});
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(`Dashboard HTTP ${res.status}: ${(json.error as string) ?? 'failed'}`);
        setLoading('idle');
        return;
      }
      setDashboard(json.dashboard as Dashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setLoading('idle');
    }
  }, [apiBase, getAuthToken]);

  const fetchLenders = useCallback(async () => {
    setLoading('lenders');
    setError(null);
    try {
      const token = await getAuthToken();
      if (!token) {
        setError('No owner session token. Sign in as owner first.');
        setLoading('idle');
        return;
      }
      const res = await fetch(`${apiBase}/api/ivx/lender-network/lenders`, {
        headers: { Authorization: `Bearer ${token}` }});
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(`Lenders HTTP ${res.status}: ${(json.error as string) ?? 'failed'}`);
        setLoading('idle');
        return;
      }
      setLenders((json.lenders as LenderProfile[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setLoading('idle');
    }
  }, [apiBase, getAuthToken]);

  const runScan = useCallback(async () => {
    setLoading('scan');
    setError(null);
    try {
      const token = await getAuthToken();
      if (!token) {
        setError('No owner session token. Sign in as owner first.');
        setLoading('idle');
        return;
      }
      const res = await fetch(`${apiBase}/api/ivx/lender-network/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }});
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(`Scan HTTP ${res.status}: ${(json.error as string) ?? 'failed'}`);
        setLoading('idle');
        return;
      }
      setScanResult(json.scan as ScanResult);
      // Refresh dashboard + lenders after scan
      await Promise.all([fetchDashboard(), fetchLenders()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
      setLoading('idle');
    }
  }, [apiBase, getAuthToken, fetchDashboard, fetchLenders]);

  useEffect(() => {
    fetchOwnerProof();
    fetchDashboard();
    fetchLenders();
  }, [fetchOwnerProof, fetchDashboard, fetchLenders]);

  const filteredLenders = useMemo(() => {
    const source = lenders.length > 0 ? lenders : (dashboard?.lenders ?? []);
    const ranked = [...source].sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));
    if (categoryFilter === 'all') return ranked;
    return ranked.filter((l) => l.category === categoryFilter);
  }, [lenders, dashboard, categoryFilter]);

  const topMatch = useMemo(() => {
    return [...filteredLenders].sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))[0] ?? null;
  }, [filteredLenders]);

  const counts = dashboard?.countsByCategory ?? scanResult?.countsByCategory ?? null;

  const is404 = error?.includes('404');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Landmark size={18} color={Colors.primary} />
          <Text style={styles.headerTitle}>Private Lender Network</Text>
        </View>
        <Pressable
          style={[styles.scanBtn, loading === 'scan' && styles.scanBtnDisabled]}
          onPress={runScan}
          disabled={loading === 'scan'}
          hitSlop={12}
        >
          {loading === 'scan' ? (
            <ShimmerIndicator size="small" color={Colors.primary} />
          ) : (
            <RefreshCw size={18} color={Colors.primary} />
          )}
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Owner proof */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <ShieldCheck size={16} color={Colors.primary} />
            <Text style={styles.cardTitle}>Owner Access</Text>
          </View>
          {loading === 'owner' && !ownerProof ? (
            <ShimmerIndicator size="small" color={Colors.primary} style={styles.rowSpacing} />
          ) : ownerProof?.error ? (
            <View style={styles.row}>
              <AlertTriangle size={14} color={Colors.error} />
              <Text style={styles.errorText}>{ownerProof.error}</Text>
            </View>
          ) : ownerProof ? (
            <View style={styles.proofGrid}>
              <View style={styles.proofRow}>
                <Text style={styles.proofLabel}>Email</Text>
                <Text style={styles.proofValue}>{ownerProof.ownerEmail ?? '—'}</Text>
              </View>
              <View style={styles.proofRow}>
                <Text style={styles.proofLabel}>Role</Text>
                <Text style={[styles.proofValue, { color: ownerProof.ownerRole === 'owner' ? Colors.success : Colors.error }]}>
                  {ownerProof.ownerRole ?? '—'}
                </Text>
              </View>
              <View style={styles.proofRow}>
                <Text style={styles.proofLabel}>KYC</Text>
                <Text style={[styles.proofValue, { color: ownerProof.kycStatus === 'approved' ? Colors.success : Colors.warning }]}>
                  {ownerProof.kycStatus ?? '—'}
                </Text>
              </View>
              <View style={styles.proofRow}>
                <Text style={styles.proofLabel}>Allowlist</Text>
                <Text style={[styles.proofValue, { color: ownerProof.allowlisted ? Colors.success : Colors.error }]}>
                  {ownerProof.allowlisted === null ? '—' : ownerProof.allowlisted ? 'Allowed' : 'Blocked'}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Not-deployed warning */}
        {is404 && (
          <View style={styles.warnCard}>
            <AlertTriangle size={16} color={Colors.warning} />
            <Text style={styles.warnText}>
              Backend returned 404 — the Private Lender Network module is not yet deployed to production. Trigger a backend deploy from Admin → Developer Workspace (or the device Owner UI) to push commit 8533573+ live.
            </Text>
          </View>
        )}

        {/* Dashboard counts */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Sparkles size={16} color={Colors.primary} />
            <Text style={styles.cardTitle}>Dashboard</Text>
            {loading === 'dashboard' ? <ShimmerIndicator size="small" color={Colors.primary} /> : null}
          </View>
          {counts ? (
            <View style={styles.countsGrid}>
              {CATEGORY_ORDER.map((cat) => {
                const Icon = CATEGORY_ICONS[cat];
                return (
                  <View key={cat} style={styles.countChip}>
                    <Icon size={14} color={Colors.primary} />
                    <Text style={styles.countChipLabel}>{CATEGORY_LABELS[cat]}</Text>
                    <Text style={styles.countChipValue}>{counts[cat] ?? 0}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>{loading === 'dashboard' ? 'Loading…' : 'No dashboard data'}</Text>
          )}
          <Text style={styles.totalText}>Total lenders: {dashboard?.totalLenders ?? lenders.length ?? 0}</Text>
        </View>

        {/* Top lender match */}
        {topMatch && (
          <View style={styles.topMatchCard}>
            <View style={styles.cardHeader}>
              <TrendingUp size={16} color={Colors.primary} />
              <Text style={styles.cardTitle}>Top Lender Match</Text>
            </View>
            <Text style={styles.topMatchName}>{topMatch.name}</Text>
            <Text style={styles.topMatchCompany}>{topMatch.companyType}</Text>
            <View style={styles.fitScoreRow}>
              <Text style={styles.fitScoreLabel}>Fit Score</Text>
              <Text style={[styles.fitScoreValue, { color: fitScoreColor(topMatch.fitScore) }]}>{topMatch.fitScore}/100</Text>
            </View>
            <Text style={styles.rationaleText}>{topMatch.rationale}</Text>
            <Text style={styles.nextActionText}>Next: {topMatch.nextAction}</Text>
          </View>
        )}

        {/* Category filter */}
        <View style={styles.filterRow}>
          <Pressable
            style={[styles.filterChip, categoryFilter === 'all' && styles.filterChipActive]}
            onPress={() => setCategoryFilter('all')}
          >
            <Text style={[styles.filterChipText, categoryFilter === 'all' && styles.filterChipTextActive]}>All</Text>
          </Pressable>
          {CATEGORY_ORDER.map((cat) => {
            const Icon = CATEGORY_ICONS[cat];
            const active = categoryFilter === cat;
            return (
              <Pressable
                key={cat}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setCategoryFilter(cat)}
              >
                <Icon size={12} color={active ? Colors.text : Colors.textTertiary} />
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{CATEGORY_LABELS[cat]}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Lender list */}
        <View style={styles.listSection}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Lender List ({filteredLenders.length})</Text>
            {loading === 'lenders' ? <ShimmerIndicator size="small" color={Colors.primary} /> : null}
          </View>

          {filteredLenders.length === 0 && loading !== 'lenders' ? (
            <Text style={styles.emptyText}>No lenders yet. Tap the scan icon to derive lender profiles from live deals.</Text>
          ) : (
            filteredLenders.map((lender) => {
              const Icon = CATEGORY_ICONS[lender.category] ?? Building2;
              return (
                <View key={lender.id} style={styles.lenderCard}>
                  <View style={styles.lenderCardHeader}>
                    <View style={styles.lenderNameRow}>
                      <Icon size={16} color={Colors.primary} />
                      <Text style={styles.lenderName}>{lender.name}</Text>
                    </View>
                    <View style={[styles.fitBadge, { backgroundColor: fitScoreColor(lender.fitScore) + '22' }]}>
                      <Text style={[styles.fitBadgeText, { color: fitScoreColor(lender.fitScore) }]}>
                        {lender.fitScore}/100
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.lenderCompany}>{lender.companyType}</Text>
                  <Text style={styles.lenderCategory}>{CATEGORY_LABELS[lender.category]}</Text>

                  <View style={styles.fieldGrid}>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Loan types</Text>
                      <Text style={styles.fieldValue}>{lender.loanTypes.join(', ')}</Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Max LTV</Text>
                      <Text style={styles.fieldValue}>{lender.maxLtvPercent !== null ? `${lender.maxLtvPercent}%` : '—'}</Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Interest range</Text>
                      <Text style={styles.fieldValue}>
                        {lender.interestRateRangeLowPct !== null && lender.interestRateRangeHighPct !== null
                          ? `${lender.interestRateRangeLowPct}–${lender.interestRateRangeHighPct}%`
                          : '—'}
                      </Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Markets</Text>
                      <Text style={styles.fieldValue}>{lender.marketsServed.join(', ')}</Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Loan size</Text>
                      <Text style={styles.fieldValue}>
                        {lender.loanSizeMinUsd !== null || lender.loanSizeMaxUsd !== null
                          ? `${formatUsd(lender.loanSizeMinUsd)} – ${formatUsd(lender.loanSizeMaxUsd)}`
                          : '—'}
                      </Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Approval reqs</Text>
                      <Text style={styles.fieldValue}>{lender.approvalRequirements.join(', ')}</Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Public source</Text>
                      <Text style={styles.fieldValue}>{lender.publicSource}</Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Contact channel</Text>
                      <Text style={styles.fieldValue}>{lender.contactChannel}</Text>
                    </View>
                  </View>

                  {lender.matchedDealNames && lender.matchedDealNames.length > 0 && (
                    <View style={styles.matchedRow}>
                      <CheckCircle2 size={12} color={Colors.success} />
                      <Text style={styles.matchedText}>Matched deals: {lender.matchedDealNames.join(', ')}</Text>
                    </View>
                  )}

                  {lender.complianceNote ? (
                    <View style={styles.complianceRow}>
                      <ShieldCheck size={12} color={Colors.textTertiary} />
                      <Text style={styles.complianceText}>{lender.complianceNote}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {/* Last scan result */}
        {scanResult && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <RefreshCw size={16} color={Colors.primary} />
              <Text style={styles.cardTitle}>Last Scan</Text>
            </View>
            <Text style={styles.scanText}>Scanned at: {scanResult.scannedAt}</Text>
            <Text style={styles.scanText}>Deals scanned: {scanResult.dealsScanned}</Text>
            <Text style={styles.scanText}>Lenders upserted: {scanResult.lendersUpserted}</Text>
            <Text style={styles.scanText}>Status: {scanResult.ok ? 'OK' : 'Partial'}</Text>
            {scanResult.reason ? <Text style={styles.scanReason}>{scanResult.reason}</Text> : null}
          </View>
        )}

        {error && !is404 ? (
          <View style={styles.warnCard}>
            <AlertTriangle size={16} color={Colors.error} />
            <Text style={styles.warnText}>{error}</Text>
          </View>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
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
    borderBottomColor: Colors.border},
  backBtn: { padding: 4 },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  scanBtn: { padding: 8 },
  scanBtnDisabled: { opacity: 0.5 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border},
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowSpacing: { marginVertical: 8 },
  errorText: { color: Colors.error, fontSize: 13, flex: 1 },
  proofGrid: { gap: 6 },
  proofRow: { flexDirection: 'row', justifyContent: 'space-between' },
  proofLabel: { color: Colors.textTertiary, fontSize: 13 },
  proofValue: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  warnCard: {
    backgroundColor: Colors.warning + '18',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.warning + '40'},
  warnText: { color: Colors.warning, fontSize: 13, flex: 1, lineHeight: 18 },
  countsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8},
  countChipLabel: { color: Colors.textTertiary, fontSize: 12 },
  countChipValue: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
  totalText: { color: Colors.textTertiary, fontSize: 12 },
  topMatchCard: {
    backgroundColor: Colors.primary + '12',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '40'},
  topMatchName: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  topMatchCompany: { color: Colors.textTertiary, fontSize: 12 },
  fitScoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fitScoreLabel: { color: Colors.textTertiary, fontSize: 13 },
  fitScoreValue: { fontSize: 16, fontWeight: '700' },
  rationaleText: { color: Colors.text, fontSize: 13, lineHeight: 18 },
  nextActionText: { color: Colors.primary, fontSize: 12, fontWeight: '600' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary },
  filterChipText: { color: Colors.textTertiary, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: Colors.text },
  listSection: { gap: 10 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { color: Colors.textTertiary, fontSize: 13, lineHeight: 18 },
  lenderCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border},
  lenderCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  lenderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  lenderName: { color: Colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  fitBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  fitBadgeText: { fontSize: 12, fontWeight: '700' },
  lenderCompany: { color: Colors.textTertiary, fontSize: 12 },
  lenderCategory: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'},
  fieldGrid: { gap: 6 },
  fieldRow: { flexDirection: 'row', gap: 8 },
  fieldLabel: { color: Colors.textTertiary, fontSize: 12, minWidth: 110 },
  fieldValue: { color: Colors.text, fontSize: 12, flex: 1 },
  matchedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  matchedText: { color: Colors.success, fontSize: 11, flex: 1 },
  complianceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  complianceText: { color: Colors.textTertiary, fontSize: 10, flex: 1, lineHeight: 15 },
  scanText: { color: Colors.text, fontSize: 12 },
  scanReason: { color: Colors.textTertiary, fontSize: 11, fontStyle: 'italic' }});
