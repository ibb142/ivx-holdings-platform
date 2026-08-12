import React, { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
// Realtime: auto-invalidate on DB changes
// useRealtimeTable called in component body
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItem} from "react-native";
import { Stack } from 'expo-router';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleX,
  Hammer,
  RefreshCw,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Undo2} from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import { renderSafeViewChildren } from '@/components/SafeViewChildren';
import Colors from '@/constants/colors';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type IncidentStatus =
  | 'open'
  | 'diagnosing'
  | 'awaiting_approval'
  | 'awaiting_production_approval'
  | 'staging_deploying'
  | 'staging_passed'
  | 'staging_failed'
  | 'fix_proposed'
  | 'rolled_back'
  | 'resolved'
  | 'ignored';

type IncidentSeverity = 'info' | 'warning' | 'error' | 'critical';

type IncidentSource =
  | 'frontend'
  | 'backend'
  | 'provider'
  | 'auth'
  | 'render'
  | 'timeout'
  | 'rollback'
  | 'silent_failure'
  | 'unknown';

type Incident = {
  id: string;
  createdAt: string;
  source: IncidentSource;
  severity: IncidentSeverity;
  status: IncidentStatus;
  message: string;
  checkpoint?: string | null;
  fileLine?: string | null;
  stack?: string | null;
  responseStatus?: number | null;
  traceId?: string | null;
  conversationId?: string | null;
  suggestedFix?: string | null;
  diagnosis?: {
    rootCause?: string;
    fileLine?: string;
    patchPlan?: string;
    riskLevel?: 'low' | 'medium' | 'high';
    rollbackPlan?: string;
  } | null;
  lifecycle?: { at: string; event: string; detail?: string | null }[];
  approval?: { approvedBy: string; approvedAt: string; note: string | null } | null;
};

type ProductionHealth = {
  ok: boolean;
  failureRate: number;
  sampleSize: number;
  lastFailureAt: string | null;
  status: 'healthy' | 'degraded' | 'critical' | 'unknown';
};

function resolveBaseUrl(): string {
  const candidates = [
    process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL,
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL,
    process.env.EXPO_PUBLIC_API_BASE_URL,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim().replace(/\/+$/, '');
    }
  }
  return '';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIVXAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchIncidents(): Promise<Incident[]> {
  const base = resolveBaseUrl();
  if (!base) return [];
  const res = await fetch(`${base}/api/ivx/incidents?limit=100`, { headers: await authHeaders() });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; items?: Incident[]; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
  return Array.isArray(json.items) ? json.items : [];
}

async function fetchHealth(): Promise<ProductionHealth | null> {
  const base = resolveBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/ivx/production-guard/health`);
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; health?: ProductionHealth };
    return json.health ?? null;
  } catch {
    return null;
  }
}

async function postIncidentAction(id: string, action: 'diagnose' | 'stage' | 'replay' | 'approve' | 'promote', body?: Record<string, unknown>): Promise<unknown> {
  const base = resolveBaseUrl();
  if (!base) throw new Error('API base URL is not configured.');
  const res = await fetch(`${base}/api/ivx/incidents/${id}/${action}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body ?? {})});
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

async function triggerRollback(): Promise<void> {
  const base = resolveBaseUrl();
  if (!base) throw new Error('API base URL is not configured.');
  const res = await fetch(`${base}/api/ivx/production-guard/rollback`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ reason: 'Manual owner trigger from Incidents screen.' })});
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
}

function formatTime(value: string): string {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

function severityColor(severity: IncidentSeverity): string {
  switch (severity) {
    case 'critical': return '#FF4D4D';
    case 'error': return '#f97316';
    case 'warning': return '#f59e0b';
    default: return '#4A90D9';
  }
}

function statusColor(status: IncidentStatus): string {
  if (status === 'resolved') return '#10b981';
  if (status === 'rolled_back') return '#a855f7';
  if (status === 'staging_passed' || status === 'fix_proposed') return '#4A90D9';
  if (status === 'staging_failed') return '#FF4D4D';
  if (status.startsWith('awaiting')) return '#f59e0b';
  if (status === 'diagnosing' || status === 'staging_deploying') return '#06b6d4';
  return '#94a3b8';
}

const SCREEN_OPTIONS = { title: 'Incidents' } as const;

type IncidentRowProps = {
  incident: Incident;
  isOpen: boolean;
  onToggle: (id: string) => void;
  onAction: (id: string, action: 'diagnose' | 'stage' | 'replay' | 'approve' | 'promote') => void;
  pendingAction: { id: string; action: string } | null;
};

const IncidentRow = React.memo<IncidentRowProps>(({ incident, isOpen, onToggle, onAction, pendingAction }) => {
  const sev = severityColor(incident.severity);
  const stat = statusColor(incident.status);
  const handleToggle = useCallback(() => onToggle(incident.id), [incident.id, onToggle]);
  const isPending = useCallback((a: string) => pendingAction?.id === incident.id && pendingAction.action === a, [incident.id, pendingAction]);

  const safeMessage = typeof incident.message === 'string' && incident.message.length > 0 ? incident.message : '(no message)';
  const safeSource = typeof incident.source === 'string' && incident.source.length > 0 ? incident.source : 'unknown';
  const safeStatusLabel = typeof incident.status === 'string' ? incident.status.replace(/_/g, ' ') : '';
  const safeCreatedAt = formatTime(incident.createdAt ?? '');

  return (
    <View style={styles.card} testID={`incident-${incident.id}`}>
      <Pressable onPress={handleToggle} style={styles.cardHeader}>
        <View style={[styles.severityDot, { backgroundColor: sev }]} />
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle} numberOfLines={2}>{safeMessage}</Text>
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardMeta}>{safeSource}</Text>
            <Text style={styles.cardMetaDot}>·</Text>
            <View style={[styles.statusPill, { borderColor: stat }]}>
              <Text style={[styles.statusPillText, { color: stat }]}>{safeStatusLabel}</Text>
            </View>
            <Text style={styles.cardMetaDot}>·</Text>
            <Text style={styles.cardMeta}>{safeCreatedAt}</Text>
          </View>
        </View>
        <ChevronRight size={16} color={Colors.subtitle} style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }} />
      </Pressable>

      {isOpen && (
        <View style={styles.cardBody}>
          {incident.checkpoint ? <Detail label="Checkpoint" value={incident.checkpoint} /> : null}
          {incident.fileLine ? <Detail label="File:Line" value={incident.fileLine} mono /> : null}
          {incident.responseStatus != null ? <Detail label="HTTP" value={String(incident.responseStatus)} /> : null}
          {incident.traceId ? <Detail label="Trace" value={incident.traceId} mono /> : null}
          {incident.suggestedFix ? <Detail label="Hint" value={incident.suggestedFix} /> : null}

          {incident.diagnosis ? (
            <View style={styles.diagnosisBox}>
              <View style={styles.diagnosisHeader}>
                <Brain size={14} color={Colors.primary} />
                <Text style={styles.diagnosisTitle}>Repair Brain Diagnosis</Text>
                {incident.diagnosis.riskLevel ? (
                  <View style={[styles.riskPill, { borderColor: incident.diagnosis.riskLevel === 'high' ? '#FF4D4D' : incident.diagnosis.riskLevel === 'medium' ? '#f59e0b' : '#10b981' }]}>
                    <Text style={[styles.riskPillText, { color: incident.diagnosis.riskLevel === 'high' ? '#FF4D4D' : incident.diagnosis.riskLevel === 'medium' ? '#f59e0b' : '#10b981' }]}>
                      {`${incident.diagnosis.riskLevel} risk`}
                    </Text>
                  </View>
                ) : null}
              </View>
              {incident.diagnosis.rootCause ? <Detail label="Root cause" value={incident.diagnosis.rootCause} /> : null}
              {incident.diagnosis.fileLine ? <Detail label="Target" value={incident.diagnosis.fileLine} mono /> : null}
              {incident.diagnosis.patchPlan ? <Detail label="Patch plan" value={incident.diagnosis.patchPlan} /> : null}
              {incident.diagnosis.rollbackPlan ? <Detail label="Rollback" value={incident.diagnosis.rollbackPlan} /> : null}
            </View>
          ) : null}

          {incident.stack ? (
            <View style={styles.stackBox}>
              <Text style={styles.stackTitle}>Stack</Text>
              <Text style={styles.stackText} numberOfLines={8}>{incident.stack}</Text>
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <ActionButton
              icon={<Brain size={14} color={Colors.text} />}
              label="Diagnose"
              onPress={() => onAction(incident.id, 'diagnose')}
              loading={isPending('diagnose')}
            />
            <ActionButton
              icon={<Hammer size={14} color={Colors.text} />}
              label="Stage"
              onPress={() => onAction(incident.id, 'stage')}
              loading={isPending('stage')}
            />
            <ActionButton
              icon={<RefreshCw size={14} color={Colors.text} />}
              label="Replay"
              onPress={() => onAction(incident.id, 'replay')}
              loading={isPending('replay')}
            />
            <ActionButton
              icon={<CheckCircle2 size={14} color={Colors.background} />}
              label="Approve"
              onPress={() => onAction(incident.id, 'approve')}
              loading={isPending('approve')}
              variant="primary"
            />
            <ActionButton
              icon={<Rocket size={14} color={Colors.background} />}
              label="Promote"
              onPress={() => onAction(incident.id, 'promote')}
              loading={isPending('promote')}
              variant="primary"
            />
          </View>

          {incident.lifecycle && incident.lifecycle.length > 0 ? (
            <View style={styles.lifecycleBox}>
              <Text style={styles.lifecycleTitle}>Lifecycle</Text>
              {incident.lifecycle.slice(-6).map((evt, idx) => {
                const safeAt = typeof evt?.at === 'string' && evt.at.length > 0 ? formatTime(evt.at) : '—';
                const safeEvent = typeof evt?.event === 'string' && evt.event.length > 0 ? evt.event : '—';
                const safeDetail = typeof evt?.detail === 'string' && evt.detail.length > 0 ? evt.detail : null;
                return (
                  <View key={`${incident.id}-evt-${idx}`} style={styles.lifecycleRow}>
                    <Text style={styles.lifecycleTime}>{safeAt}</Text>
                    <Text style={styles.lifecycleEvent}>{safeEvent}</Text>
                    {safeDetail ? <Text style={styles.lifecycleDetail} numberOfLines={2}>{safeDetail}</Text> : null}
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
});
IncidentRow.displayName = 'IncidentRow';

type DetailProps = { label: string; value: string; mono?: boolean };
function Detail({ label, value, mono }: DetailProps) {
  const safeLabel = typeof label === 'string' && label.length > 0 ? label : '—';
  const safeValue = typeof value === 'string' && value.length > 0 ? value : '—';
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{safeLabel}</Text>
      <Text style={[styles.detailValue, mono && styles.monoText]} selectable>{safeValue}</Text>
    </View>
  );
}

type ActionButtonProps = {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'default' | 'primary';
};
function ActionButton({ icon, label, onPress, loading, variant }: ActionButtonProps) {
  const safeLabel = typeof label === 'string' && label.length > 0 ? label : '—';
  const safeIcon = React.isValidElement(icon) ? icon : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={[styles.actionBtn, variant === 'primary' && styles.actionBtnPrimary, loading && styles.actionBtnDisabled]}
    >
      {loading ? (
        <ShimmerIndicator size="small" color={variant === 'primary' ? Colors.background : Colors.text} />
      ) : (
        <View style={styles.actionBtnInner}>
          {safeIcon}
          <Text style={[styles.actionBtnText, variant === 'primary' && styles.actionBtnTextPrimary]}>{safeLabel}</Text>
        </View>
      )}
    </Pressable>
  );
}

function HealthBanner({ health, onRollback, rolling }: { health: ProductionHealth | null; onRollback: () => void; rolling: boolean }) {
  if (!health) return null;
  const critical = health.status === 'critical';
  const degraded = health.status === 'degraded';
  const Icon = critical ? CircleX : degraded ? CircleAlert : ShieldCheck;
  const color = critical ? '#FF4D4D' : degraded ? '#f59e0b' : '#10b981';
  const statusLabel = typeof health.status === 'string' && health.status.length > 0 ? health.status : 'unknown';
  const rateLabel = `${(Number.isFinite(health.failureRate) ? health.failureRate * 100 : 0).toFixed(1)}%`;
  const sampleLabel = String(health.sampleSize ?? 0);
  return (
    <View style={[styles.healthBanner, { borderColor: color }]}>
      <Icon size={18} color={color} />
      <View style={styles.healthBannerText}>
        <Text style={styles.healthBannerTitle}>{`Production: ${statusLabel}`}</Text>
        <Text style={styles.healthBannerMeta}>{`Failure rate ${rateLabel} over ${sampleLabel} samples`}</Text>
      </View>
      {(critical || degraded) && (
        <Pressable onPress={onRollback} disabled={rolling} style={styles.rollbackBtn}>
          {rolling ? <ShimmerIndicator size="small" color={Colors.text} /> : <Undo2 size={14} color={Colors.text} />}
          <Text style={styles.rollbackBtnText}>Rollback</Text>
        </Pressable>
      )}
    </View>
  );
}

function IncidentsScreen() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ id: string; action: string } | null>(null);

  const { data: incidents = [], isLoading, isRefetching, refetch, error } = useQuery<Incident[]>({
    queryKey: ['ivx-incidents'],
    queryFn: fetchIncidents,
    refetchInterval: 15_000});

  const { data: health = null } = useQuery<ProductionHealth | null>({
    queryKey: ['ivx-production-health'],
    queryFn: fetchHealth,
    refetchInterval: 20_000});

  const rollbackMutation = useMutation({
    mutationFn: triggerRollback,
    onSuccess: () => {
      Alert.alert('Rollback triggered', 'Production rollback request sent to Render.');
      void qc.invalidateQueries({ queryKey: ['ivx-incidents'] });
      void qc.invalidateQueries({ queryKey: ['ivx-production-health'] });
    },
    onError: (err: Error) => Alert.alert('Rollback failed', err.message)});

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  }, []);

  const handleAction = useCallback(async (id: string, action: 'diagnose' | 'stage' | 'replay' | 'approve' | 'promote') => {
    setPendingAction({ id, action });
    try {
      await postIncidentAction(id, action);
      await qc.invalidateQueries({ queryKey: ['ivx-incidents'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert(`${action} failed`, message);
    } finally {
      setPendingAction(null);
    }
  }, [qc]);

  const handleRollback = useCallback(() => {
    Alert.alert(
      'Trigger production rollback?',
      'This will roll the live service back to the previous Render deploy.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rollback', style: 'destructive', onPress: () => rollbackMutation.mutate() },
      ],
    );
  }, [rollbackMutation]);

  const counts = useMemo(() => {
    const out = { open: 0, awaiting: 0, critical: 0 };
    for (const inc of incidents) {
      if (inc.status === 'open' || inc.status === 'diagnosing') out.open += 1;
      if (inc.status.startsWith('awaiting')) out.awaiting += 1;
      if (inc.severity === 'critical') out.critical += 1;
    }
    return out;
  }, [incidents]);

  const renderItem: ListRenderItem<Incident> = useCallback(({ item }) => (
    <IncidentRow
      incident={item}
      isOpen={expanded === item.id}
      onToggle={handleToggle}
      onAction={handleAction}
      pendingAction={pendingAction}
    />
  ), [expanded, handleToggle, handleAction, pendingAction]);

  const keyExtractor = useCallback((item: Incident) => item.id, []);

  const ListHeader = useMemo(() => (
    <View style={styles.headerWrap}>
      <HealthBanner health={health} onRollback={handleRollback} rolling={rollbackMutation.isPending} />
      <View style={styles.summaryRow}>
        <SummaryChip icon={<AlertTriangle size={14} color={Colors.warning} />} label="Open" value={counts.open} />
        <SummaryChip icon={<ShieldAlert size={14} color="#f59e0b" />} label="Awaiting" value={counts.awaiting} />
        <SummaryChip icon={<CircleX size={14} color={Colors.danger} />} label="Critical" value={counts.critical} />
      </View>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error instanceof Error ? error.message : String(error)}</Text>
        </View>
      ) : null}
    </View>
  ), [counts, error, handleRollback, health, rollbackMutation.isPending]);

  return (
    <ErrorBoundary>
      <Stack.Screen options={SCREEN_OPTIONS} />
      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading incidents…</Text>
        </View>
      ) : incidents.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyWrap}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
        >
          {ListHeader}
          <View style={styles.emptyBox}>
            <CheckCircle2 size={28} color="#10b981" />
            <Text style={styles.emptyTitle}>No incidents</Text>
            <Text style={styles.emptyMeta}>The autonomous repair brain has nothing to do right now.</Text>
          </View>
        </ScrollView>
      ) : (
        <FlatList
        onEndReachedThreshold={5}
        onEndReached={() => { /* IVX: pagination hook point */ }}
          data={incidents}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
        />
      )}
    </ErrorBoundary>
  );
}

function SummaryChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  const safeIcon = React.isValidElement(icon) ? icon : null;
  const safeLabel = typeof label === 'string' && label.length > 0 ? label : '—';
  const safeValue = Number.isFinite(value) ? String(value) : '0';
  return (
    <View style={styles.summaryChip}>
      {safeIcon}
      <Text style={styles.summaryChipValue}>{safeValue}</Text>
      <Text style={styles.summaryChipLabel}>{safeLabel}</Text>
    </View>
  );
}

export default IncidentsScreen;

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  loadingText: { color: Colors.subtitle ?? '#94a3b8', marginTop: 12, fontSize: 13 },
  listContent: { padding: 16, paddingBottom: 32, backgroundColor: Colors.background },
  emptyWrap: { padding: 16, backgroundColor: Colors.background, flexGrow: 1 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, marginTop: 16 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginTop: 12 },
  emptyMeta: { color: Colors.subtitle ?? '#94a3b8', fontSize: 13, marginTop: 6, textAlign: 'center' },

  headerWrap: { marginBottom: 12 },
  healthBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, backgroundColor: Colors.card, marginBottom: 12 },
  healthBannerText: { flex: 1 },
  healthBannerTitle: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  healthBannerMeta: { color: Colors.subtitle ?? '#94a3b8', fontSize: 12, marginTop: 2 },
  rollbackBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1f1f1f', borderWidth: 1, borderColor: Colors.border },
  rollbackBtnText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },

  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  summaryChip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  summaryChipValue: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  summaryChipLabel: { color: Colors.subtitle ?? '#94a3b8', fontSize: 12 },

  errorBox: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#2a1414', borderWidth: 1, borderColor: '#FF4D4D' },
  errorText: { color: '#fecaca', fontSize: 12 },

  card: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 10, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  cardHeaderText: { flex: 1 },
  cardTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  cardMeta: { color: Colors.subtitle ?? '#94a3b8', fontSize: 11 },
  cardMetaDot: { color: Colors.subtitle ?? '#94a3b8', fontSize: 11 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  statusPillText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },

  cardBody: { borderTopWidth: 1, borderTopColor: Colors.border, padding: 14, gap: 10 },
  detailRow: { gap: 2 },
  detailLabel: { color: Colors.subtitle ?? '#94a3b8', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  detailValue: { color: Colors.text, fontSize: 13 },
  monoText: { fontFamily: 'Menlo, Courier, monospace' as const, fontSize: 12 },

  diagnosisBox: { padding: 12, backgroundColor: '#0f1115', borderRadius: 10, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  diagnosisHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  diagnosisTitle: { color: Colors.text, fontSize: 12, fontWeight: '700' as const, flex: 1 },
  riskPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  riskPillText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const },

  stackBox: { padding: 10, backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  stackTitle: { color: Colors.subtitle ?? '#94a3b8', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  stackText: { color: '#cbd5e1', fontSize: 11, fontFamily: 'Menlo, Courier, monospace' as const },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: Colors.border },
  actionBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  actionBtnTextPrimary: { color: Colors.background },

  lifecycleBox: { padding: 10, backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: Colors.border, gap: 6 },
  lifecycleTitle: { color: Colors.subtitle ?? '#94a3b8', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  lifecycleRow: { gap: 2 },
  lifecycleTime: { color: Colors.subtitle ?? '#94a3b8', fontSize: 10 },
  lifecycleEvent: { color: Colors.text, fontSize: 12, fontWeight: '600' as const },
  lifecycleDetail: { color: Colors.subtitle ?? '#94a3b8', fontSize: 11 }});
