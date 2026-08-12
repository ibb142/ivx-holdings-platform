import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  XCircle} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import {
  getRuntimeVariablesReport,
  syncRuntimeVariable,
  verifyAllRuntimeVariables,
  type RuntimeVariableStatus,
  type RuntimeVariablesReport,
  type VarStatus} from '@/src/modules/ivx-developer/runtimeVariablesService';

const STATUS_COLOR: Record<VarStatus, string> = {
  VERIFIED: Colors.success,
  PRESENT_IN_RUNTIME: Colors.warning,
  PRESENT_BUT_INVALID: Colors.error,
  PRESENT_BUT_UNAUTHORIZED: Colors.error,
  PRESENT_IN_RORK_NOT_INJECTED: Colors.warning,
  MISSING_FROM_RORK: Colors.error};

const STATUS_LABEL: Record<VarStatus, string> = {
  VERIFIED: 'VERIFIED',
  PRESENT_IN_RUNTIME: 'PRESENT IN RUNTIME',
  PRESENT_BUT_INVALID: 'PRESENT BUT INVALID',
  PRESENT_BUT_UNAUTHORIZED: 'UNAUTHORIZED',
  PRESENT_IN_RORK_NOT_INJECTED: 'IN RORK · NOT INJECTED',
  MISSING_FROM_RORK: 'MISSING FROM RORK'};

function StatusIcon({ status }: { status: VarStatus }) {
  if (status === 'VERIFIED') return <CheckCircle2 size={16} color={Colors.success} />;
  if (status === 'PRESENT_IN_RUNTIME' || status === 'PRESENT_IN_RORK_NOT_INJECTED') {
    return <AlertTriangle size={16} color={Colors.warning} />;
  }
  return <XCircle size={16} color={Colors.error} />;
}

function VariableCard({
  variable,
  onSync,
  syncing}: {
  variable: RuntimeVariableStatus;
  onSync: (name: string) => void;
  syncing: boolean;
}) {
  const color = STATUS_COLOR[variable.status];
  const onCopyMasked = useCallback(() => {
    if (variable.masked) void Clipboard.setStringAsync(variable.masked);
  }, [variable.masked]);

  return (
    <View style={[styles.varCard, { borderColor: color }]}>
      <View style={styles.varHeaderRow}>
        <StatusIcon status={variable.status} />
        <Text style={styles.varName} numberOfLines={1}>{variable.name}</Text>
        <View style={[styles.statusPill, { backgroundColor: color }]}>
          <Text style={styles.statusPillText}>{STATUS_LABEL[variable.status]}</Text>
        </View>
      </View>

      <Text style={styles.varDesc} numberOfLines={3}>{variable.description}</Text>

      {variable.publicWarning ? (
        <View style={styles.publicWarn}>
          <AlertTriangle size={12} color={Colors.warning} />
          <Text style={styles.publicWarnText}>
            Public variable — inlined into the client bundle. Never store a secret here.
          </Text>
        </View>
      ) : null}

      <View style={styles.metaGrid}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Scope</Text>
          <Text style={styles.metaValue}>{variable.scopes.join(' · ')}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Value</Text>
          <Text style={styles.metaValue}>{variable.present ? `${variable.masked} (${variable.valueLength})` : '—'}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Resolved from</Text>
          <Text style={styles.metaValue}>{variable.resolvedFrom ?? '—'}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Last verified</Text>
          <Text style={styles.metaValue}>
            {variable.lastVerifiedAt ? new Date(variable.lastVerifiedAt).toLocaleTimeString() : 'not yet'}
          </Text>
        </View>
      </View>

      <Text style={styles.usedByLabel}>
        Used by: <Text style={styles.usedByValue}>{variable.usedBy.join(' · ')}</Text>
      </Text>

      {variable.verifyDetail ? <Text style={styles.verifyDetail}>{variable.verifyDetail}</Text> : null}

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionBtn, !variable.present && styles.actionBtnDisabled]}
          disabled={!variable.present}
          onPress={onCopyMasked}
          testID={`ivx-rtvar-copy-${variable.name}`}
        >
          <Copy size={13} color={variable.present ? Colors.text : Colors.textTertiary} />
          <Text style={[styles.actionBtnText, !variable.present && styles.actionBtnTextDisabled]}>Copy masked</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.syncBtn, (!variable.present || syncing) && styles.actionBtnDisabled]}
          disabled={!variable.present || syncing}
          onPress={() => onSync(variable.name)}
          testID={`ivx-rtvar-sync-${variable.name}`}
        >
          {syncing ? (
            <ShimmerIndicator size="small" color={Colors.black} />
          ) : (
            <CloudUpload size={13} color={Colors.black} />
          )}
          <Text style={styles.syncBtnText}>Sync → Render</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RuntimeVariablesContent() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [syncingVar, setSyncingVar] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const query = useQuery<RuntimeVariablesReport>({
    queryKey: ['ivx-runtime-variables'],
    queryFn: getRuntimeVariablesReport});

  const verifyMutation = useMutation({
    mutationFn: verifyAllRuntimeVariables,
    onSuccess: (report) => {
      queryClient.setQueryData(['ivx-runtime-variables'], report);
      setActionNote(`Verified ${report.variables.length} variables · ${report.variables.filter((v) => v.status === 'VERIFIED').length} VERIFIED.`);
    },
    onError: (error) => setActionNote(error instanceof Error ? error.message : 'Verification failed.')});

  const syncMutation = useMutation({
    mutationFn: syncRuntimeVariable,
    onMutate: (name: string) => setSyncingVar(name),
    onSettled: () => setSyncingVar(null),
    onSuccess: (result) => {
      setActionNote(result.detail);
      void query.refetch();
    },
    onError: (error) => setActionNote(error instanceof Error ? error.message : 'Sync failed.')});

  const data = query.data ?? null;
  const onRefresh = useCallback(() => { void query.refetch(); }, [query]);
  const onSync = useCallback((name: string) => { syncMutation.mutate(name); }, [syncMutation]);

  const counts = useMemo(() => {
    const vars = data?.variables ?? [];
    return {
      verified: vars.filter((v) => v.status === 'VERIFIED').length,
      present: vars.filter((v) => v.present).length,
      notInjected: vars.filter((v) => v.status === 'PRESENT_IN_RORK_NOT_INJECTED').length,
      missing: vars.filter((v) => v.status === 'MISSING_FROM_RORK').length};
  }, [data]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
      refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={query.isFetching} onRefresh={onRefresh} />}
      testID="ivx-runtime-variables-scroll"
    >
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <KeyRound size={18} color={Colors.primary} />
          <Text style={styles.heroTitle}>Runtime Variables</Text>
        </View>
        <Text style={styles.heroSub}>
          Every required credential — status, scope, and live verification. Values are masked and never leave the
          backend; verification runs real probes against GitHub, Render, Supabase, and production.
        </Text>
      </View>

      {data ? (
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <ShieldCheck size={16} color={Colors.primary} />
            <Text style={styles.summaryTitle}>Runtime: {data.runtimeLabel}</Text>
          </View>
          <View style={styles.capRow}>
            {([
              ['Verified', counts.verified, Colors.success],
              ['Present', counts.present, Colors.warning],
              ['Not injected', counts.notInjected, Colors.warning],
              ['Missing', counts.missing, Colors.error],
            ] as const).map(([label, value, c]) => (
              <View key={label} style={[styles.capChip, { borderColor: c }]}>
                <Text style={[styles.capChipText, { color: c }]}>{value} {label}</Text>
              </View>
            ))}
          </View>
          <Pressable
            style={[styles.verifyAllBtn, verifyMutation.isPending && styles.actionBtnDisabled]}
            disabled={verifyMutation.isPending}
            onPress={() => verifyMutation.mutate()}
            testID="ivx-rtvar-verify-all"
          >
            {verifyMutation.isPending ? (
              <ShimmerIndicator size="small" color={Colors.black} />
            ) : (
              <RefreshCw size={14} color={Colors.black} />
            )}
            <Text style={styles.verifyAllText}>{verifyMutation.isPending ? 'Verifying…' : 'Run verification (all)'}</Text>
          </Pressable>
          {actionNote ? <Text style={styles.actionNote}>{actionNote}</Text> : null}
        </View>
      ) : null}

      {query.isLoading && !data ? (
        <View style={styles.loadingBox}>
          <ShimmerIndicator color={Colors.primary} />
          <Text style={styles.loadingText}>Loading runtime variables…</Text>
        </View>
      ) : null}

      {query.isError && !data ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            {query.error instanceof Error ? query.error.message : 'Failed to load runtime variables.'}
          </Text>
        </View>
      ) : null}

      {data?.variables.map((v) => (
        <VariableCard key={v.name} variable={v} onSync={onSync} syncing={syncingVar === v.name} />
      ))}

      {data ? (
        <Text style={styles.footerNote}>
          {data.marker} · {new Date(data.generatedAt).toLocaleString()} · values are masked; never exposed.
        </Text>
      ) : null}
    </ScrollView>
  );
}

export default function RuntimeVariablesScreen() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <Stack.Screen options={{ title: 'Runtime Variables', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.text }} />
      <RuntimeVariablesContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14 },
  heroCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heroHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' as const },
  heroSub: { color: Colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
  summaryCard: { backgroundColor: Colors.surfaceElevated, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.primary },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const, flex: 1 },
  capRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  capChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  capChipText: { fontSize: 11, fontWeight: '600' as const },
  verifyAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10, marginTop: 12 },
  verifyAllText: { color: Colors.black, fontSize: 14, fontWeight: '700' as const },
  actionNote: { color: Colors.textSecondary, fontSize: 12, marginTop: 10, lineHeight: 17 },
  loadingBox: { padding: 24, alignItems: 'center', gap: 10 },
  loadingText: { color: Colors.textSecondary, fontSize: 13 },
  errorBox: { backgroundColor: Colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.error },
  errorText: { color: Colors.error, fontSize: 13 },
  varCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1 },
  varHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  varName: { color: Colors.text, fontSize: 14, fontWeight: '700' as const, flex: 1 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusPillText: { color: Colors.black, fontSize: 9, fontWeight: '800' as const },
  varDesc: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 8, lineHeight: 18 },
  publicWarn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: Colors.backgroundTertiary, borderRadius: 8, padding: 8 },
  publicWarnText: { color: Colors.warning, fontSize: 11.5, flex: 1, lineHeight: 16 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  metaItem: { width: '50%', paddingVertical: 4 },
  metaLabel: { color: Colors.textTertiary, fontSize: 10, fontWeight: '600' as const, textTransform: 'uppercase' as const },
  metaValue: { color: Colors.text, fontSize: 12.5, marginTop: 1 },
  usedByLabel: { color: Colors.textTertiary, fontSize: 11.5, marginTop: 8 },
  usedByValue: { color: Colors.textSecondary },
  verifyDetail: { color: Colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 17, fontStyle: 'italic' as const },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.backgroundTertiary, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 10, flex: 1 },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: { color: Colors.text, fontSize: 12.5, fontWeight: '600' as const },
  actionBtnTextDisabled: { color: Colors.textTertiary },
  syncBtn: { backgroundColor: Colors.primary },
  syncBtnText: { color: Colors.black, fontSize: 12.5, fontWeight: '700' as const },
  footerNote: { color: Colors.textTertiary, fontSize: 11, marginTop: 8, textAlign: 'center' }});
