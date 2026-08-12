import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Activity, AlertTriangle, ArrowLeft, Bot, CheckCircle2, Factory, Lock, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { EmptyState } from '@/components/ivx';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const CONTROL_PLANE_URL = `${API_BASE}/api/ivx/autonomous/control-plane`;
const QA_URL = `${API_BASE}/api/ivx/autonomous/qa`;
const RUNS_SUMMARY_URL = `${API_BASE}/api/ivx/autonomous/runs/summary`;
const POLL_INTERVAL_MS = 15_000;

type CampaignItem = {
  id: string;
  name: string;
  supervisor: string;
  status: string;
  jobId: string | null;
  evidence: string[];
  lastError: string | null;
  updatedAt: string;
};

type WorkforceSection = {
  label?: string;
  total: number;
  verified: number;
  statuses: Record<string, number>;
  items: CampaignItem[];
};

type ControlPlane = {
  ok: boolean;
  marker?: string;
  generatedAt?: string;
  source?: string;
  enterprise?: {
    totalAgents: number;
    expectedAgents: number;
    registryShapeValid: boolean;
    phase: string;
    enabled: boolean;
    completionPercent: number;
    verifiedTotal: number;
    running: number;
    queued: number;
    blocked: number;
    failed: number;
    durableState: boolean;
    productionClaimsRequireProof: boolean;
    paidSpendRequiresOwnerApproval: boolean;
    destructiveActionsRequireOwnerApproval: boolean;
  };
  specialists?: WorkforceSection;
  divisionA?: WorkforceSection;
  divisionB?: WorkforceSection;
  supervisors?: Record<string, number>;
  sms?: {
    phoneConfigured: boolean;
    phoneMasked: string | null;
    schedulerRunning: boolean;
    lastSmsSentAt: string | null;
    smsSentToday: number;
    smsDailyCap: number;
  };
  certification?: {
    liveReady: boolean;
    campaignComplete: boolean;
    proofPolicy: string;
  };
  error?: string;
};

type QAResponse = {
  ok: boolean;
  schedulerRunning?: boolean;
  healthOk?: boolean | null;
  authOk?: boolean | null;
  totalRuns?: number;
  lastHealthAt?: string | null;
  lastMatrixAt?: string | null;
};

type RunsSummary = {
  ok: boolean;
  totalRuns: number;
  runsWithEvidence: number;
  runsWithoutEvidence: number;
  failed: number;
};

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}

function statusColor(status: string): string {
  const value = status.toLowerCase();
  if (value === 'verified' || value === 'complete') return '#34D399';
  if (value === 'running') return '#FBBF24';
  if (value === 'blocked' || value === 'failed') return '#F87171';
  if (value === 'queued' || value === 'pending') return '#94A3B8';
  return '#60A5FA';
}

function SectionHeader({ title, value, icon }: { title: string; value?: string; icon: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
      {value ? <Text style={styles.sectionValue}>{value}</Text> : null}
    </View>
  );
}

function Metric({ label, value, tone = '#E2E8F0' }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: tone }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function WorkforceCard({ title, section, icon }: { title: string; section?: WorkforceSection; icon: React.ReactNode }) {
  if (!section) return null;
  return (
    <View style={styles.card}>
      <SectionHeader title={title} value={`${section.verified}/${section.total} VERIFIED`} icon={icon} />
      <View style={styles.metricGrid}>
        <Metric label="Verified" value={section.verified} tone="#34D399" />
        <Metric label="Running" value={section.statuses.running || 0} tone="#FBBF24" />
        <Metric label="Queued" value={(section.statuses.queued || 0) + (section.statuses.pending || 0)} tone="#94A3B8" />
        <Metric label="Blocked" value={(section.statuses.blocked || 0) + (section.statuses.failed || 0)} tone="#F87171" />
      </View>
      {section.items.slice(0, 8).map((item) => (
        <View key={item.id} style={styles.agentRow}>
          <View style={[styles.dot, { backgroundColor: statusColor(item.status) }]} />
          <View style={styles.agentTextWrap}>
            <Text style={styles.agentName}>{item.name}</Text>
            <Text style={styles.agentMeta}>{item.supervisor} · {item.jobId || 'no job yet'}</Text>
            {item.lastError ? <Text style={styles.agentError}>{item.lastError}</Text> : null}
          </View>
          <Text style={[styles.statusText, { color: statusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
        </View>
      ))}
      {section.items.length > 8 ? <Text style={styles.moreText}>+ {section.items.length - 8} more agents in this workforce</Text> : null}
    </View>
  );
}

export default function AutonomousDashboardScreen() {
  const router = useRouter();
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('autonomous_tasks', [['autonomous_tasks']]);
  const [control, setControl] = useState<ControlPlane | null>(null);
  const [qa, setQa] = useState<QAResponse | null>(null);
  const [runs, setRuns] = useState<RunsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const token = await getIVXAccessToken();
      if (!token) {
        setUnauthorized(true);
        setError('Owner session required.');
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const [controlResponse, qaResponse, runsResponse] = await Promise.all([
        fetch(CONTROL_PLANE_URL, { headers }),
        fetch(QA_URL, { headers }),
        fetch(RUNS_SUMMARY_URL, { headers }),
      ]);
      if ([controlResponse.status, qaResponse.status, runsResponse.status].some((s) => s === 401 || s === 403)) {
        setUnauthorized(true);
        setError('This control plane is restricted to the IVX owner.');
        return;
      }
      const controlJson = (await controlResponse.json()) as ControlPlane;
      const qaJson = (await qaResponse.json()) as QAResponse;
      const runsJson = (await runsResponse.json()) as RunsSummary;
      if (!controlResponse.ok || !controlJson.ok) throw new Error(controlJson.error || `Control plane HTTP ${controlResponse.status}`);
      setUnauthorized(false);
      setControl(controlJson);
      if (qaResponse.ok && qaJson.ok) setQa(qaJson);
      if (runsResponse.ok && runsJson.ok) setRuns(runsJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Autonomous control plane.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    pollRef.current = setInterval(() => void load(true), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const enterprise = control?.enterprise;
  const certificationReady = Boolean(
    control?.certification?.liveReady &&
    control?.certification?.campaignComplete &&
    qa?.schedulerRunning &&
    qa?.healthOk === true &&
    qa?.authOk === true &&
    runs && runs.runsWithoutEvidence === 0 && runs.failed === 0,
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton} testID="autonomous-dashboard-back">
          <ArrowLeft size={22} color="#E2E8F0" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Autonomous Control Plane</Text>
          <Text style={styles.subtitle}>12 Specialists · 50 IVX · 50 Factory · proof-first</Text>
        </View>
        <TouchableOpacity onPress={() => { setRefreshing(true); void load(true); }} style={styles.iconButton} testID="autonomous-dashboard-refresh">
          <RefreshCw size={18} color="#FBBF24" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ShimmerIndicator size="large" color="#FBBF24" />
          <Text style={styles.muted}>Loading live control plane…</Text>
        </View>
      ) : unauthorized ? (
        <View style={styles.center}>
          <Lock size={42} color="#F87171" />
          <Text style={styles.errorTitle}>Owner access required</Text>
          <Text style={styles.muted}>{error}</Text>
        </View>
      ) : error && !control ? (
        <View style={styles.center}>
          <AlertTriangle size={42} color="#F87171" />
          <Text style={styles.errorTitle}>Control plane unavailable</Text>
          <Text style={styles.muted}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}
        >
          <View style={styles.heroCard}>
            <SectionHeader title="Enterprise Autonomous" value={enterprise?.phase?.toUpperCase() || '—'} icon={<Activity size={18} color="#FBBF24" />} />
            <Text style={styles.bigPercent}>{enterprise?.completionPercent ?? 0}%</Text>
            <Text style={styles.heroCaption}>{enterprise?.verifiedTotal ?? 0}/{enterprise?.totalAgents ?? 0} agents verified</Text>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${enterprise?.completionPercent ?? 0}%` }]} /></View>
            <View style={styles.metricGrid}>
              <Metric label="Running" value={enterprise?.running ?? 0} tone="#FBBF24" />
              <Metric label="Queued" value={enterprise?.queued ?? 0} tone="#94A3B8" />
              <Metric label="Blocked" value={enterprise?.blocked ?? 0} tone="#F87171" />
              <Metric label="Failed" value={enterprise?.failed ?? 0} tone="#F87171" />
            </View>
            <View style={styles.checkRow}><CheckCircle2 size={15} color={enterprise?.registryShapeValid ? '#34D399' : '#F87171'} /><Text style={styles.checkText}>Registry 12/50/50 {enterprise?.registryShapeValid ? 'valid' : 'invalid'}</Text></View>
            <View style={styles.checkRow}><ShieldCheck size={15} color={enterprise?.durableState ? '#34D399' : '#F87171'} /><Text style={styles.checkText}>Durable runtime state {enterprise?.durableState ? 'connected' : 'not confirmed'}</Text></View>
          </View>

          <WorkforceCard title="12 Specialist IA" section={control?.specialists} icon={<Bot size={18} color="#60A5FA" />} />
          <WorkforceCard title="50 IVX Operations Agents" section={control?.divisionA} icon={<ShieldCheck size={18} color="#34D399" />} />
          <WorkforceCard title="50 Factory Agents" section={control?.divisionB} icon={<Factory size={18} color="#A78BFA" />} />

          <View style={styles.card}>
            <SectionHeader title="24/7 Runtime" icon={<Smartphone size={18} color="#60A5FA" />} />
            <View style={styles.metricGrid}>
              <Metric label="QA Scheduler" value={qa?.schedulerRunning ? 'ON' : 'OFF'} tone={qa?.schedulerRunning ? '#34D399' : '#F87171'} />
              <Metric label="Health" value={qa?.healthOk === true ? 'PASS' : qa?.healthOk === false ? 'FAIL' : '—'} tone={qa?.healthOk ? '#34D399' : '#F87171'} />
              <Metric label="Auth Matrix" value={qa?.authOk === true ? 'PASS' : qa?.authOk === false ? 'FAIL' : '—'} tone={qa?.authOk ? '#34D399' : '#F87171'} />
              <Metric label="QA Runs" value={qa?.totalRuns ?? 0} />
            </View>
            <Text style={styles.muted}>Last health: {formatTime(qa?.lastHealthAt)}</Text>
            <Text style={styles.muted}>Last auth matrix: {formatTime(qa?.lastMatrixAt)}</Text>
          </View>

          <View style={styles.card}>
            <SectionHeader title="SMS & Evidence" icon={<ShieldCheck size={18} color="#34D399" />} />
            <View style={styles.metricGrid}>
              <Metric label="SMS Scheduler" value={control?.sms?.schedulerRunning ? 'ON' : 'OFF'} tone={control?.sms?.schedulerRunning ? '#34D399' : '#F87171'} />
              <Metric label="Phone" value={control?.sms?.phoneConfigured ? control?.sms?.phoneMasked || 'SET' : 'MISSING'} tone={control?.sms?.phoneConfigured ? '#34D399' : '#F87171'} />
              <Metric label="Evidence Runs" value={runs?.runsWithEvidence ?? 0} tone="#34D399" />
              <Metric label="No Evidence" value={runs?.runsWithoutEvidence ?? 0} tone={(runs?.runsWithoutEvidence ?? 0) === 0 ? '#34D399' : '#F87171'} />
            </View>
            <Text style={styles.muted}>Last SMS: {formatTime(control?.sms?.lastSmsSentAt)}</Text>
          </View>

          <View style={[styles.card, certificationReady ? styles.certPass : styles.certHold]}>
            <SectionHeader title="Enterprise Certificate Gate" value={certificationReady ? 'VERIFIED' : 'HOLD'} icon={<ShieldCheck size={18} color={certificationReady ? '#34D399' : '#FBBF24'} />} />
            <Text style={styles.certText}>{control?.certification?.proofPolicy || 'No PASS without runtime evidence.'}</Text>
            <Text style={styles.certText}>Campaign complete: {control?.certification?.campaignComplete ? 'YES' : 'NO'}</Text>
            <Text style={styles.certText}>Live runtime ready: {control?.certification?.liveReady ? 'YES' : 'NO'}</Text>
            <Text style={styles.certText}>Permanent run failures: {runs?.failed ?? '—'}</Text>
          </View>

          <Text style={styles.footer}>Source: {control?.source || 'runtime_state'} · {formatTime(control?.generatedAt)}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#07101D' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  iconButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111C2D' },
  headerTextWrap: { flex: 1, paddingHorizontal: 12 },
  title: { color: '#F8FAFC', fontSize: 19, fontWeight: '800' },
  subtitle: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '700' },
  muted: { color: '#94A3B8', fontSize: 12, marginTop: 4 },
  scrollContent: { padding: 14, paddingBottom: 40, gap: 12 },
  heroCard: { backgroundColor: '#0C1728', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#334155' },
  card: { backgroundColor: '#0C1728', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#1E293B' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { flex: 1, color: '#E2E8F0', fontSize: 15, fontWeight: '800' },
  sectionValue: { color: '#FBBF24', fontSize: 11, fontWeight: '800' },
  bigPercent: { color: '#F8FAFC', fontSize: 44, lineHeight: 50, fontWeight: '900' },
  heroCaption: { color: '#94A3B8', fontSize: 12, marginBottom: 10 },
  progressTrack: { height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: '#1E293B', marginBottom: 12 },
  progressFill: { height: '100%', backgroundColor: '#34D399' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 },
  metric: { minWidth: '22%', flexGrow: 1, backgroundColor: '#101D30', borderRadius: 12, padding: 10 },
  metricValue: { fontSize: 18, fontWeight: '900' },
  metricLabel: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  checkText: { color: '#CBD5E1', fontSize: 12 },
  agentRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#162235' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 9 },
  agentTextWrap: { flex: 1 },
  agentName: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' },
  agentMeta: { color: '#64748B', fontSize: 10, marginTop: 2 },
  agentError: { color: '#F87171', fontSize: 10, marginTop: 3 },
  statusText: { fontSize: 10, fontWeight: '900', marginLeft: 8 },
  moreText: { color: '#64748B', fontSize: 11, marginTop: 8 },
  certPass: { borderColor: '#166534', backgroundColor: '#082719' },
  certHold: { borderColor: '#854D0E', backgroundColor: '#231A07' },
  certText: { color: '#CBD5E1', fontSize: 12, marginTop: 5 },
  footer: { color: '#64748B', textAlign: 'center', fontSize: 10, marginTop: 4 },
});
