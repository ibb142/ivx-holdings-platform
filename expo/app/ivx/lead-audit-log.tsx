import React, { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { Stack } from 'expo-router';
import {
  Bot,
  CheckCircle2,
  CircleX,
  Search,
  ShieldX,
  Trash2} from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';

type AuditEntry = {
  type: string;
  at: string;
  leadId: string | null;
  name: string | null;
  actor: string;
  detail: string;
};

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

async function fetchAuditLog(): Promise<AuditEntry[]> {
  const base = resolveBaseUrl();
  if (!base) throw new Error('API base URL is not configured.');
  const headers = await authHeaders();
  const res = await fetch(`${base}/api/growth/leads/audit?limit=300`, { headers });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; entries?: AuditEntry[]; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || 'Could not load the audit log. Confirm you are signed in as owner.');
  }
  return Array.isArray(json.entries) ? json.entries : [];
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function iconFor(type: string): React.ReactNode {
  switch (type) {
    case 'discover': return <Search size={15} color={Colors.info ?? '#38bdf8'} />;
    case 'approve': return <CheckCircle2 size={15} color={Colors.success ?? '#10b981'} />;
    case 'reject': return <CircleX size={15} color={Colors.error ?? '#FF4D4D'} />;
    case 'quarantine': return <ShieldX size={15} color={Colors.warning ?? '#f59e0b'} />;
    case 'delete': return <Trash2 size={15} color={Colors.error ?? '#FF4D4D'} />;
    default: return <Bot size={15} color={Colors.muted ?? '#94a3b8'} />;
  }
}

function LeadAuditLogScreen() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['ivx', 'lead-audit-log'] as const,
    queryFn: fetchAuditLog,
    refetchInterval: 45_000});

  const onRefresh = useCallback(() => { void refetch(); }, [refetch]);
  const entries = data ?? [];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Lead Audit Log' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={Colors.text} />}
      >
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Every change, tracked</Text>
          <Text style={styles.headerSub}>
            Discover · approve · reject · quarantine — each with the acting agent and a server timestamp.
            {entries.length > 0 ? ` Showing ${entries.length} most recent.` : ''}
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.center}><ShimmerIndicator color={Colors.text} /></View>
        ) : isError ? (
          <View style={styles.errorCard}>
            <CircleX size={18} color={Colors.error ?? '#FF4D4D'} />
            <Text style={styles.errorText}>{error instanceof Error ? error.message : 'Failed to load.'}</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardBody}>
              No audit events recorded yet. Events appear here as the autonomous engine discovers leads
              and as you approve or reject them.
            </Text>
          </View>
        ) : (
          entries.map((e, i) => (
            <View key={`${e.at}-${i}`} style={styles.row}>
              <View style={styles.rowIcon}>{iconFor(e.type)}</View>
              <View style={styles.rowBody}>
                <Text style={styles.rowDetail}>{e.detail}</Text>
                <Text style={styles.rowMeta}>
                  {e.actor}{e.name ? ` · ${e.name}` : ''}{e.leadId ? ` · ${e.leadId.slice(0, 12)}…` : ''}
                </Text>
                <Text style={styles.rowTime}>{formatTime(e.at)}</Text>
              </View>
              <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{e.type.toUpperCase()}</Text></View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export default function LeadAuditLogScreenWithBoundary() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <LeadAuditLogScreen />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  center: { paddingVertical: 40, alignItems: 'center' },
  headerCard: {
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    gap: 4},
  headerTitle: { color: Colors.text, fontSize: 16, fontWeight: '800' as const },
  headerSub: { color: Colors.muted ?? '#94a3b8', fontSize: 12, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    alignItems: 'flex-start'},
  rowIcon: { marginTop: 1 },
  rowBody: { flex: 1, gap: 2 },
  rowDetail: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  rowMeta: { color: Colors.muted ?? '#94a3b8', fontSize: 11 },
  rowTime: { color: Colors.muted ?? '#94a3b8', fontSize: 10 },
  typeBadge: { backgroundColor: 'rgba(148,163,184,0.15)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  typeBadgeText: { color: Colors.muted ?? '#94a3b8', fontSize: 9, fontWeight: '800' as const },
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
