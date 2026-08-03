import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { Stack } from 'expo-router';
import { CircleX, Filter, Mail, MapPin, Phone, Search } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type LeadCategory =
  | 'buyer'
  | 'investor'
  | 'jv_partner'
  | 'private_lender'
  | 'family_office'
  | 'fund'
  | 'tokenization_contact'
  | 'developer'
  | 'broker'
  | 'strategic_acquirer';

type DealCapacity = { estimatedUsd: number | null; minUsd: number | null; maxUsd: number | null };

type MasterLead = {
  id: string;
  sequentialId: number;
  pipelineStatus: string;
  name: string;
  company: string;
  title: string | null;
  category: LeadCategory;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string;
  southFloridaRelevance: string;
  phone: string | null;
  email: string | null;
  linkedinUrl: string | null;
  contactPath: string;
  dealCapacity: DealCapacity;
  score: number;
  source: string;
  sourceUrl: string;
  discoveredAt: string;
  lastVerifiedAt: string;
};

type MasterCounts = {
  totalReal: number;
  withEmail: number;
  withPhone: number;
  withLinkedin: number;
  southFlorida: number;
  byCategory: Record<LeadCategory, number>;
  lastDiscoveryAt: string | null;
};

type MasterResponse = { leads: MasterLead[]; counts: MasterCounts | null };

const CATEGORY_LABELS: Record<LeadCategory, string> = {
  buyer: 'Buyer',
  investor: 'Investor',
  jv_partner: 'JV Partner',
  private_lender: 'Private Lender',
  family_office: 'Family Office',
  fund: 'Fund',
  tokenization_contact: 'Tokenization',
  developer: 'Developer',
  broker: 'Broker',
  strategic_acquirer: 'Strategic Acquirer'};

const CATEGORY_FILTERS: (LeadCategory | 'all')[] = [
  'all', 'buyer', 'investor', 'jv_partner', 'private_lender', 'family_office',
  'fund', 'tokenization_contact', 'developer', 'broker', 'strategic_acquirer',
];

function resolveBaseUrl(): string {
  const candidates = [
    process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL,
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL,
    process.env.EXPO_PUBLIC_API_BASE_URL,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim().replace(/\/+$/, '');
  }
  return '';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIVXAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchMasterList(category: string, southFlorida: boolean, search: string): Promise<MasterResponse> {
  const base = resolveBaseUrl();
  if (!base) throw new Error('API base URL is not configured.');
  const headers = await authHeaders();
  const params = new URLSearchParams();
  if (category !== 'all') params.set('category', category);
  if (southFlorida) params.set('southFlorida', 'true');
  if (search.trim()) params.set('search', search.trim());
  const res = await fetch(`${base}/api/growth/leads/master?${params.toString()}`, { headers });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    leads?: MasterLead[];
    counts?: MasterCounts;
    error?: string;
  };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || 'Could not load the master lead list. Confirm you are signed in as owner.');
  }
  return { leads: Array.isArray(json.leads) ? json.leads : [], counts: json.counts ?? null };
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function MasterLeadListScreen() {
  const [category, setCategory] = useState<string>('all');
  const [southFlorida, setSouthFlorida] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [debounced, setDebounced] = useState<string>('');

  const onSubmitSearch = useCallback(() => setDebounced(search), [search]);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['ivx', 'master-lead-list', category, southFlorida, debounced] as const,
    queryFn: () => fetchMasterList(category, southFlorida, debounced),
    refetchInterval: 60_000});

  const onRefresh = useCallback(() => { void refetch(); }, [refetch]);
  const leads = data?.leads ?? [];
  const counts = data?.counts ?? null;

  const headerStats = useMemo(() => ([
    { label: 'Real leads', value: counts?.totalReal ?? leads.length },
    { label: 'With email', value: counts?.withEmail ?? 0 },
    { label: 'With phone', value: counts?.withPhone ?? 0 },
    { label: 'South FL', value: counts?.southFlorida ?? 0 },
  ]), [counts, leads.length]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Master Lead List' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={Colors.text} />}
      >
        <View style={styles.statGrid}>
          {headerStats.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
        {counts?.lastDiscoveryAt ? (
          <Text style={styles.lastDiscovery}>Last discovery: {formatTime(counts.lastDiscoveryAt)}</Text>
        ) : null}

        <View style={styles.searchRow}>
          <Search size={16} color={Colors.muted ?? '#94a3b8'} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, company, location…"
            placeholderTextColor={Colors.muted ?? '#94a3b8'}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={onSubmitSearch}
            returnKeyType="search"
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {CATEGORY_FILTERS.map((c) => {
            const active = category === c;
            const label = c === 'all' ? 'All' : CATEGORY_LABELS[c];
            const n = c === 'all' ? undefined : counts?.byCategory?.[c];
            return (
              <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {label}{typeof n === 'number' ? ` ${n}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable onPress={() => setSouthFlorida((v) => !v)} style={[styles.sfToggle, southFlorida && styles.sfToggleActive]}>
          <Filter size={14} color={southFlorida ? '#fff' : (Colors.muted ?? '#94a3b8')} />
          <Text style={[styles.sfToggleText, southFlorida && styles.sfToggleTextActive]}>South Florida only</Text>
        </Pressable>

        {isLoading ? (
          <View style={styles.center}><ShimmerIndicator color={Colors.text} /></View>
        ) : isError ? (
          <View style={styles.errorCard}>
            <CircleX size={18} color={Colors.error ?? '#FF4D4D'} />
            <Text style={styles.errorText}>{error instanceof Error ? error.message : 'Failed to load.'}</Text>
          </View>
        ) : leads.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardBody}>
              No real (SEC-sourced) leads match this filter yet. The autonomous engine sources verifiable
              SEC EDGAR filings on its daily cycle — staged leads appear here once discovered.
            </Text>
          </View>
        ) : (
          leads.map((l) => (
            <View key={l.id} style={styles.leadCard}>
              <View style={styles.leadHeader}>
                <Text style={styles.seq}>#{l.sequentialId}</Text>
                <View style={styles.leadHeaderBody}>
                  <Text style={styles.leadName} numberOfLines={1}>{l.name || l.company || 'Unnamed'}</Text>
                  {l.title ? <Text style={styles.leadTitle} numberOfLines={1}>{l.title}</Text> : null}
                </View>
                <View style={styles.scorePill}><Text style={styles.scoreText}>{l.score}</Text></View>
              </View>

              <View style={styles.badgeRow}>
                <View style={styles.catBadge}><Text style={styles.catBadgeText}>{CATEGORY_LABELS[l.category] ?? l.category}</Text></View>
                <View style={styles.statusBadge}><Text style={styles.statusBadgeText}>{l.pipelineStatus.toUpperCase()}</Text></View>
                {l.southFloridaRelevance ? (
                  <View style={styles.sfBadge}><Text style={styles.sfBadgeText}>{l.southFloridaRelevance.replace('_', ' ')}</Text></View>
                ) : null}
              </View>

              <View style={styles.metaRow}>
                <MapPin size={13} color={Colors.muted ?? '#94a3b8'} />
                <Text style={styles.metaText} numberOfLines={1}>{l.location ?? (`${l.city ?? ''} ${l.state ?? ''}`.trim() || l.country)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Mail size={13} color={Colors.muted ?? '#94a3b8'} />
                <Text style={styles.metaText} numberOfLines={1}>{l.email ?? 'No public email'}</Text>
              </View>
              <View style={styles.metaRow}>
                <Phone size={13} color={Colors.muted ?? '#94a3b8'} />
                <Text style={styles.metaText} numberOfLines={1}>{l.phone ?? 'No public phone'}</Text>
              </View>

              <View style={styles.capRow}>
                <Text style={styles.capLabel}>Deal capacity</Text>
                <Text style={styles.capValue}>
                  est {formatUsd(l.dealCapacity.estimatedUsd)} · min {formatUsd(l.dealCapacity.minUsd)} · max {formatUsd(l.dealCapacity.maxUsd)}
                </Text>
              </View>

              <Text style={styles.sourceText} numberOfLines={1}>Source: {l.sourceUrl}</Text>
              <Text style={styles.tsText}>Discovered {formatTime(l.discoveredAt)} · verified {formatTime(l.lastVerifiedAt)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export default function MasterLeadListScreenWithBoundary() {
  return (
    <ErrorBoundary>
      <MasterLeadListScreen />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  center: { paddingVertical: 40, alignItems: 'center' },
  statGrid: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    alignItems: 'center',
    gap: 2},
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  statLabel: { color: Colors.muted ?? '#94a3b8', fontSize: 10 },
  lastDiscovery: { color: Colors.muted ?? '#94a3b8', fontSize: 12 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937'},
  searchInput: { flex: 1, color: Colors.text, fontSize: 14, paddingVertical: 10 },
  filterRow: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.card ?? '#111827',
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937'},
  chipActive: { backgroundColor: Colors.tint ?? '#2563eb', borderColor: Colors.tint ?? '#2563eb' },
  chipText: { color: Colors.muted ?? '#94a3b8', fontSize: 12, fontWeight: '600' as const },
  chipTextActive: { color: '#fff' },
  sfToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.card ?? '#111827',
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937'},
  sfToggleActive: { backgroundColor: Colors.tint ?? '#2563eb', borderColor: Colors.tint ?? '#2563eb' },
  sfToggleText: { color: Colors.muted ?? '#94a3b8', fontSize: 12, fontWeight: '600' as const },
  sfToggleTextActive: { color: '#fff' },
  leadCard: {
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    gap: 6},
  leadHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seq: { color: Colors.muted ?? '#94a3b8', fontSize: 13, fontWeight: '800' as const, minWidth: 34 },
  leadHeaderBody: { flex: 1 },
  leadName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  leadTitle: { color: Colors.muted ?? '#94a3b8', fontSize: 12 },
  scorePill: { backgroundColor: Colors.tint ?? '#2563eb', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  scoreText: { color: '#fff', fontSize: 13, fontWeight: '800' as const },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catBadge: { backgroundColor: 'rgba(37,99,235,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  catBadgeText: { color: Colors.info ?? '#38bdf8', fontSize: 11, fontWeight: '700' as const },
  statusBadge: { backgroundColor: 'rgba(148,163,184,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { color: Colors.muted ?? '#94a3b8', fontSize: 11, fontWeight: '700' as const },
  sfBadge: { backgroundColor: 'rgba(16,185,129,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  sfBadgeText: { color: Colors.success ?? '#10b981', fontSize: 11, fontWeight: '700' as const, textTransform: 'capitalize' as const },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { color: Colors.muted ?? '#94a3b8', fontSize: 12, flex: 1 },
  capRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  capLabel: { color: Colors.muted ?? '#94a3b8', fontSize: 12 },
  capValue: { color: Colors.text, fontSize: 12, fontWeight: '700' as const },
  sourceText: { color: Colors.muted ?? '#94a3b8', fontSize: 11 },
  tsText: { color: Colors.muted ?? '#94a3b8', fontSize: 10 },
  card: {
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937'},
  cardBody: { color: Colors.muted ?? '#94a3b8', fontSize: 13, lineHeight: 19 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.error ?? '#FF4D4D'},
  errorText: { color: Colors.error ?? '#FF4D4D', fontSize: 13, flex: 1 }});
