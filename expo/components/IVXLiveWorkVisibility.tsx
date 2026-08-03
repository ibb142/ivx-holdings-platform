/**
 * IVX Live Work Visibility Panel
 *
 * Owner-only panel that surfaces the IVX Senior Developer AI's active
 * work — proof reports, structured evidence, OTEL status, repo-search
 * probe, E2E plan, and recent incidents. Polls the
 * `/api/ivx/senior-dev/evidence` route.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from '@tanstack/react-query';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

let LIVE_WORK_INSTANCE_COUNT = 0;
const LIVE_WORK_POLL_MS = 20_000;
const LIVE_WORK_STALE_MS = 10_000;

type ProofRow = { file: string; workItem: string; resolvedAt: string };
type OTelStatus = { status: 'enabled' | 'waiting_external_setup'; configuredEnvName: string | null; missingEnvNames: string[]; note: string };
type RepoSearchProbe = { status: 'verified' | 'missing_access' | 'not_verified'; totalCount?: number; missingEnvNames: string[]; error?: string };
type E2EStep = { id: string; title: string; surface: string; status: string; detail: string };
type IncidentRow = { id: string; severity: string; status: string; createdAt: string; checkpoint: string };

type EvidenceBundle = {
  ok: boolean;
  generatedAt: string;
  proofs: ProofRow[];
  otel: OTelStatus;
  repoSearchProbe: RepoSearchProbe;
  e2ePlan: { steps: E2EStep[] };
  recentIncidents: IncidentRow[];
};

function getBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_IVX_API_BASE_URL ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
}

async function fetchEvidence(): Promise<EvidenceBundle | null> {
  const base = getBaseUrl();
  if (!base) return null;
  const token = await getIVXAccessToken().catch(() => null);
  if (!token) return null;
  const response = await fetch(`${base}/api/ivx/senior-dev/evidence`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }});
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as EvidenceBundle | null;
}

export function IVXLiveWorkVisibility(): React.ReactElement | null {
  const [isPrimary, setIsPrimary] = useState<boolean>(false);
  const [appActive, setAppActive] = useState<boolean>(
    (AppState.currentState ?? 'active') === 'active',
  );
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    LIVE_WORK_INSTANCE_COUNT += 1;
    const primary = LIVE_WORK_INSTANCE_COUNT === 1;
    setIsPrimary(primary);
    if (!primary) {
      console.log('[IVX_LIVE_WORK] DUPLICATE_MOUNT_SUPPRESSED', { totalInstances: LIVE_WORK_INSTANCE_COUNT });
    }
    return () => {
      mountedRef.current = false;
      LIVE_WORK_INSTANCE_COUNT = Math.max(0, LIVE_WORK_INSTANCE_COUNT - 1);
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (!mountedRef.current) return;
      setAppActive(next === 'active');
    });
    return () => { sub.remove(); };
  }, []);

  const pollingEnabled = isPrimary && appActive;
  const query = useQuery<EvidenceBundle | null>({
    queryKey: ['ivx-senior-dev', 'evidence'],
    queryFn: fetchEvidence,
    refetchInterval: pollingEnabled ? LIVE_WORK_POLL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: pollingEnabled,
    refetchOnReconnect: pollingEnabled,
    staleTime: LIVE_WORK_STALE_MS,
    enabled: isPrimary});

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  if (!isPrimary) return null;

  if (query.isLoading) {
    return (
      <View style={styles.container} testID="ivx-live-work-visibility-loading">
        <ShimmerIndicator />
        <Text style={styles.muted}>Loading senior-dev evidence…</Text>
      </View>
    );
  }

  const data = query.data ?? null;

  return (
    <ScrollView style={styles.container} testID="ivx-live-work-visibility">
      <View style={styles.headerRow}>
        <Text style={styles.title}>IVX Senior Developer — Live Work</Text>
        <Pressable onPress={onRefresh} style={styles.refreshButton} testID="ivx-live-work-refresh">
          <Text style={styles.refreshLabel}>Refresh</Text>
        </Pressable>
      </View>
      <Text style={styles.muted}>{data ? `Generated ${data.generatedAt}` : 'Evidence not available yet.'}</Text>

      <Section title="Proof reports (recent)">
        {data && data.proofs.length > 0 ? data.proofs.map((p) => (
          <Text key={p.file} style={styles.row}>• {p.workItem}  <Text style={styles.muted}>({p.file})</Text></Text>
        )) : <Text style={styles.muted}>No persisted proof reports yet.</Text>}
      </Section>

      <Section title="OpenTelemetry">
        {data ? (
          <>
            <Text style={styles.row}>Status: <Text style={statusStyle(data.otel.status === 'enabled' ? 'pass' : 'pending')}>{data.otel.status}</Text></Text>
            <Text style={styles.row}>Exporter env: {data.otel.configuredEnvName ?? '—'}</Text>
            <Text style={styles.muted}>{data.otel.note}</Text>
          </>
        ) : <Text style={styles.muted}>—</Text>}
      </Section>

      <Section title="Cross-repo search probe (org:ivxholding)">
        {data ? (
          <>
            <Text style={styles.row}>Status: <Text style={statusStyle(data.repoSearchProbe.status === 'verified' ? 'pass' : data.repoSearchProbe.status === 'missing_access' ? 'error' : 'pending')}>{data.repoSearchProbe.status}</Text></Text>
            <Text style={styles.row}>Total: {data.repoSearchProbe.totalCount ?? 'n/a'}</Text>
            {data.repoSearchProbe.missingEnvNames.length > 0 ? (
              <Text style={styles.muted}>Missing env: {data.repoSearchProbe.missingEnvNames.join(', ')}</Text>
            ) : null}
          </>
        ) : <Text style={styles.muted}>—</Text>}
      </Section>

      <Section title="E2E pipeline">
        {data && data.e2ePlan.steps.length > 0 ? data.e2ePlan.steps.map((s) => (
          <Text key={s.id} style={styles.row}>• {s.title} — <Text style={statusStyle(s.status.includes('pass') ? 'pass' : s.status.includes('fail') ? 'error' : 'pending')}>{s.status}</Text></Text>
        )) : <Text style={styles.muted}>No plan loaded.</Text>}
      </Section>

      <Section title="Recent incidents">
        {data && data.recentIncidents.length > 0 ? data.recentIncidents.slice(0, 10).map((i) => (
          <Text key={i.id} style={styles.row}>• [{i.severity}] {i.checkpoint} <Text style={styles.muted}>({i.status})</Text></Text>
        )) : <Text style={styles.muted}>No incidents recorded yet.</Text>}
      </Section>
    </ScrollView>
  );
}

type SectionProps = { title: string; children: React.ReactNode };

function Section({ title, children }: SectionProps): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function statusStyle(tone: 'pass' | 'error' | 'pending') {
  if (tone === 'pass') return styles.statusPass;
  if (tone === 'error') return styles.statusError;
  return styles.statusPending;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' as const, color: '#111' },
  muted: { color: '#666', fontSize: 12 },
  row: { color: '#111', fontSize: 13, paddingVertical: 2 },
  section: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eee', gap: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '600' as const, color: '#222', marginBottom: 6 },
  refreshButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1f6feb' },
  refreshLabel: { color: '#fff', fontWeight: '600' as const, fontSize: 12 },
  statusPass: { color: '#0a7d2c', fontWeight: '600' as const },
  statusError: { color: '#b42318', fontWeight: '600' as const },
  statusPending: { color: '#7a5b00', fontWeight: '600' as const }});

export default IVXLiveWorkVisibility;
