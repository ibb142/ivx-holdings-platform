import React, { useCallback, useMemo } from 'react';
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
  Activity,
  Briefcase,
  CheckCircle2,
  CircleX,
  Clock,
  Handshake,
  Moon,
  Search,
  TrendingUp,
  Users} from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';

type ScaleResult = 'VERIFIED' | 'FAILED' | 'BLOCKED_FOR_APPROVAL' | 'never';

type ScaleClaim = { claim: string; status: 'VERIFIED' | 'FAILED'; evidence: string };

type ScaleInspection = {
  productionHealthy: boolean;
  failureRate: number;
  watchdogFailures: number;
  chatFailures: number;
  openIncidents: number;
  leads: number;
  deals: number;
  pipelineEntries: number;
  totalOpen: number;
};

type ScaleReport = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: ScaleResult;
  inspection: ScaleInspection;
  improvement: { category: string; title: string; rationale: string; source: string };
  claims: ScaleClaim[];
};

type ScaleState = {
  enabled: boolean;
  job: {
    lastRunAt: string | null;
    nextDueAt: string | null;
    runCount: number;
    failureCount: number;
    improvementsCompleted: number;
    lastResult: ScaleResult;
    currentJob: string | null;
  };
};

type ReportsResponse = { state: ScaleState; reports: ScaleReport[] };

type GrowthOverview = {
  ideas: number;
  jvDeals: number;
  tokenizationConcepts: number;
  moduleSpecs: number;
  outreachDrafts: number;
};

type AgentBrainDashboard = {
  totalAgents: number;
  brain?: {
    mode: string;
    escalationEnabled: boolean;
    quantumDiscoveryEnabled: boolean;
    continuousImprovement: boolean;
    liveInferenceRequired: boolean;
    providerConfigured: boolean;
    model: string;
    endpoint: string | null;
    certificationStatus: string;
  };
};

type StagedLead = {
  id: string;
  name: string;
  company: string;
  partyType: 'investor' | 'buyer' | 'partner';
  status: 'pending_approval' | 'approved' | 'rejected';
  score: number;
  location: string | null;
  source: string;
  discoveredAt: string;
};

const ACTIVITY_KEY = ['ivx', 'autonomous-activity'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function authHeaders(): Promise<Array<[string, string]>> {
  const token = await getIVXAccessToken();
  const headers: Array<[string, string]> = [['Content-Type', 'application/json']];
  if (token) headers.push(['Authorization', `Bearer ${token}`]);
  return headers;
}

type ActivityData = {
  reports: ReportsResponse | null;
  growth: GrowthOverview | null;
  leads: StagedLead[];
  agentBrain: AgentBrainDashboard | null;
};

async function fetchActivity(): Promise<ActivityData> {
  const base = resolveBaseUrl();
  if (!base) throw new Error('API base URL is not configured.');
  const headers = await authHeaders();

  const [reportsRes, growthRes, leadsRes, agentBrainRes] = await Promise.all([
    fetch(`${base}/api/ivx/autonomous-scale/reports?limit=50`, { headers }).catch(() => null),
    fetch(`${base}/api/growth/overview`, { headers }).catch(() => null),
    fetch(`${base}/api/growth/leads`, { headers }).catch(() => null),
    fetch(`${base}/api/ivx/agents/dashboard`, { headers }).catch(() => null),
  ]);

  let reports: ReportsResponse | null = null;
  if (reportsRes) {
    const json = (await reportsRes.json().catch(() => ({}))) as {
      ok?: boolean;
      state?: ScaleState;
      reports?: ScaleReport[];
    };
    if (reportsRes.ok && json.ok !== false && json.state) {
      reports = { state: json.state, reports: Array.isArray(json.reports) ? json.reports : [] };
    }
  }

  let growth: GrowthOverview | null = null;
  if (growthRes) {
    const json = (await growthRes.json().catch(() => ({}))) as { ok?: boolean; overview?: GrowthOverview };
    if (growthRes.ok && json.ok !== false && json.overview) growth = json.overview;
  }

  let leads: StagedLead[] = [];
  if (leadsRes) {
    const json = (await leadsRes.json().catch(() => ({}))) as { ok?: boolean; leads?: StagedLead[] };
    if (leadsRes.ok && json.ok !== false && Array.isArray(json.leads)) leads = json.leads;
  }

  let agentBrain: AgentBrainDashboard | null = null;
  if (agentBrainRes) {
    const json = (await agentBrainRes.json().catch(() => ({}))) as AgentBrainDashboard & { ok?: boolean };
    if (agentBrainRes.ok && json.ok !== false && typeof json.totalAgents === 'number') agentBrain = json;
  }

  if (!reports && !growth && leads.length === 0 && !agentBrain) {
    throw new Error('Could not reach the autonomous endpoints. Confirm you are signed in as owner.');
  }

  return { reports, growth, leads, agentBrain };
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

function relativeAge(value: string | null | undefined): string {
  if (!value) return 'never';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  const diff = Date.now() - t;
  if (diff < 0) return `in ${humanDuration(-diff)}`;
  return `${humanDuration(diff)} ago`;
}

function humanDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function resultColor(result: ScaleResult): string {
  if (result === 'VERIFIED') return Colors.success;
  if (result === 'FAILED') return Colors.error ?? '#FF4D4D';
  if (result === 'BLOCKED_FOR_APPROVAL') return Colors.warning ?? '#f59e0b';
  return Colors.muted ?? '#94a3b8';
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={[styles.statValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function AutonomousActivityScreen() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ACTIVITY_KEY,
    queryFn: fetchActivity,
    refetchInterval: 30_000});

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const state = data?.reports?.state ?? null;
  const allReports = data?.reports?.reports ?? [];

  const last24h = useMemo(() => {
    const cutoff = Date.now() - DAY_MS;
    return allReports.filter((r) => {
      const t = Date.parse(r.startedAt);
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [allReports]);

  // "Sleeping" = enabled but the last run is older than ~25h (the daily cadence + a grace hour).
  const lastRunAt = state?.job.lastRunAt ?? null;
  const lastRunMs = lastRunAt ? Date.parse(lastRunAt) : NaN;
  const isStale = Number.isFinite(lastRunMs) ? Date.now() - lastRunMs > DAY_MS + 60 * 60 * 1000 : true;
  const enabled = state?.enabled ?? false;

  const liveTone = !enabled ? (Colors.muted ?? '#94a3b8') : isStale ? (Colors.warning ?? '#f59e0b') : Colors.success;
  const liveLabel = !enabled ? 'DISABLED' : isStale ? 'IDLE / SLEEPING' : 'WORKING';

  const leadsByType = useMemo(() => {
    const out = { investor: 0, buyer: 0, partner: 0 };
    for (const l of data?.leads ?? []) out[l.partyType] += 1;
    return out;
  }, [data?.leads]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Autonomous Activity (24h)' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={Colors.text} />}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroRow}>
            {enabled && !isStale ? <Activity size={20} color={Colors.success} /> : <Moon size={20} color={liveTone} />}
            <Text style={styles.heroTitle}>Is it working or sleeping?</Text>
          </View>
          <View style={[styles.liveBadge, { backgroundColor: liveTone }]}>
            <Text style={styles.liveBadgeText}>{liveLabel}</Text>
          </View>
          <View style={styles.heroLineRow}>
            <Clock size={14} color={Colors.muted ?? '#94a3b8'} />
            <Text style={styles.heroLine}>Last run: {formatTime(lastRunAt)}  ({relativeAge(lastRunAt)})</Text>
          </View>
          <View style={styles.heroLineRow}>
            <Clock size={14} color={Colors.muted ?? '#94a3b8'} />
            <Text style={styles.heroLine}>Next due: {formatTime(state?.job.nextDueAt)}  ({relativeAge(state?.job.nextDueAt)})</Text>
          </View>
          {state?.job.currentJob ? (
            <View style={styles.heroLineRow}>
              <Activity size={14} color={Colors.success} />
              <Text style={styles.heroLine}>Running now: {state.job.currentJob}</Text>
            </View>
          ) : null}
          {enabled && isStale ? (
            <Text style={styles.warnNote}>
              Loop is enabled but hasn&apos;t run within its daily window. It runs server-side every 24h and only wakes on a live backend. Pull to refresh, or trigger a cycle from Autonomous Scale Mode.
            </Text>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.center}><ShimmerIndicator color={Colors.text} /></View>
        ) : isError ? (
          <View style={styles.errorCard}>
            <CircleX size={18} color={Colors.error ?? '#FF4D4D'} />
            <Text style={styles.errorText}>{error instanceof Error ? error.message : 'Failed to load activity.'}</Text>
          </View>
        ) : (
          <>
            <View style={styles.statGrid}>
              <StatCard icon={<Activity size={16} color={Colors.text} />} label="Runs (24h)" value={String(last24h.length)} />
              <StatCard icon={<TrendingUp size={16} color={Colors.success} />} label="Improvements" value={String(state?.job.improvementsCompleted ?? 0)} tone={Colors.success} />
              <StatCard icon={<CircleX size={16} color={Colors.error ?? '#FF4D4D'} />} label="Failures" value={String(state?.job.failureCount ?? 0)} tone={(state?.job.failureCount ?? 0) > 0 ? (Colors.error ?? '#FF4D4D') : Colors.text} />
              <StatCard icon={<Users size={16} color={Colors.info ?? '#38bdf8'} />} label="Investors" value={String(leadsByType.investor)} tone={Colors.info ?? '#38bdf8'} />
              <StatCard icon={<Briefcase size={16} color={Colors.info ?? '#38bdf8'} />} label="Buyers" value={String(leadsByType.buyer)} tone={Colors.info ?? '#38bdf8'} />
              <StatCard icon={<Handshake size={16} color={Colors.info ?? '#38bdf8'} />} label="JV deals" value={String(data?.growth?.jvDeals ?? 0)} tone={Colors.info ?? '#38bdf8'} />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>IA Brain Escalation</Text>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Registered IA agents</Text><Text style={styles.pipeValue}>{data?.agentBrain?.totalAgents ?? 0}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Brain mode</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.mode ?? 'not deployed'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Live inference required</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.liveInferenceRequired ? 'YES' : 'NO'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>AI provider configured</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.providerConfigured ? 'YES' : 'NO'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Continuous improvement</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.continuousImprovement ? 'ON' : 'OFF'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Quantum technology discovery</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.quantumDiscoveryEnabled ? 'ON' : 'OFF'}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Model</Text><Text style={styles.pipeValue}>{data?.agentBrain?.brain?.model ?? 'unknown'}</Text></View>
              <Text style={styles.cardBody}>Certificate: {data?.agentBrain?.brain?.certificationStatus ?? 'not deployed'}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Growth pipeline (where the work lands)</Text>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Leads staged (investors/buyers/partners)</Text><Text style={styles.pipeValue}>{data?.leads.length ?? 0}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>JV deal drafts</Text><Text style={styles.pipeValue}>{data?.growth?.jvDeals ?? 0}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Tokenization concepts</Text><Text style={styles.pipeValue}>{data?.growth?.tokenizationConcepts ?? 0}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Ideas generated</Text><Text style={styles.pipeValue}>{data?.growth?.ideas ?? 0}</Text></View>
              <View style={styles.pipeRow}><Text style={styles.pipeLabel}>Outreach drafts (awaiting approval)</Text><Text style={styles.pipeValue}>{data?.growth?.outreachDrafts ?? 0}</Text></View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Search size={15} color={Colors.text} />
                <Text style={styles.cardTitle}>Activity timeline (last 24h)</Text>
              </View>
              {last24h.length === 0 ? (
                <Text style={styles.cardBody}>
                  No autonomous runs recorded in the last 24h. The most recent run was {relativeAge(lastRunAt)}. {enabled ? 'It runs once per day on the live backend.' : 'The loop is currently disabled.'}
                </Text>
              ) : (
                last24h.map((r) => (
                  <View key={r.runId} style={styles.runRow}>
                    <View style={[styles.dot, { backgroundColor: resultColor(r.result) }]} />
                    <View style={styles.runBody}>
                      <Text style={styles.runTitle} numberOfLines={2}>{r.improvement.title}</Text>
                      <Text style={styles.runMeta}>{r.improvement.category} · {formatTime(r.startedAt)}</Text>
                      <Text style={styles.runMeta}>
                        Inspected: {r.inspection.leads} leads · {r.inspection.deals} deals · {r.inspection.pipelineEntries} pipeline · {r.inspection.openIncidents} incidents
                      </Text>
                      {r.claims.slice(0, 4).map((c, i) => (
                        <View key={`${r.runId}-${i}`} style={styles.claimRow}>
                          {c.status === 'VERIFIED' ? (
                            <CheckCircle2 size={12} color={Colors.success} />
                          ) : (
                            <CircleX size={12} color={Colors.error ?? '#FF4D4D'} />
                          )}
                          <Text style={styles.claimText} numberOfLines={1}>{c.claim}: {c.evidence}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={[styles.runResult, { color: resultColor(r.result) }]}>{r.result}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Users size={15} color={Colors.text} />
                <Text style={styles.cardTitle}>Discovered leads ({data?.leads.length ?? 0})</Text>
              </View>
              {(data?.leads.length ?? 0) === 0 ? (
                <Text style={styles.cardBody}>
                  No staged leads yet. Investor/buyer discovery stages leads for your approval — none have been captured in the durable store.
                </Text>
              ) : (
                (data?.leads ?? []).slice(0, 50).map((l, i) => (
                  <View key={l.id} style={styles.leadRow}>
                    <Text style={styles.leadIndex}>{i + 1}</Text>
                    <View style={styles.leadBody}>
                      <Text style={styles.leadName} numberOfLines={1}>{l.name || l.company || 'Unnamed'}</Text>
                      <Text style={styles.leadMeta} numberOfLines={1}>
                        {l.partyType} · {l.location ?? 'n/a'} · {formatTime(l.discoveredAt)}
                      </Text>
                    </View>
                    <View style={styles.leadRight}>
                      <Text style={styles.leadScore}>{l.score}</Text>
                      <Text style={[styles.leadStatus, { color: l.status === 'approved' ? Colors.success : l.status === 'rejected' ? (Colors.error ?? '#FF4D4D') : (Colors.warning ?? '#f59e0b') }]}>
                        {l.status === 'pending_approval' ? 'PENDING' : l.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function AutonomousActivityScreenWithBoundary() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <AutonomousActivityScreen />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  center: { paddingVertical: 40, alignItems: 'center' },
  heroCard: {
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    gap: 8},
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  liveBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, marginTop: 2 },
  liveBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' as const, letterSpacing: 0.5 },
  heroLineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLine: { color: Colors.muted ?? '#94a3b8', fontSize: 13, flex: 1 },
  warnNote: { color: Colors.warning ?? '#f59e0b', fontSize: 12, lineHeight: 18, marginTop: 4 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    width: '31%',
    flexGrow: 1,
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    gap: 4},
  statIcon: { marginBottom: 2 },
  statValue: { color: Colors.text, fontSize: 16, fontWeight: '800' as const },
  statLabel: { color: Colors.muted ?? '#94a3b8', fontSize: 11 },
  card: {
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    gap: 8},
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  cardBody: { color: Colors.muted ?? '#94a3b8', fontSize: 13, lineHeight: 19 },
  pipeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border ?? '#1f2937'},
  pipeLabel: { color: Colors.muted ?? '#94a3b8', fontSize: 13, flex: 1 },
  pipeValue: { color: Colors.text, fontSize: 15, fontWeight: '800' as const },
  runRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border ?? '#1f2937'},
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  runBody: { flex: 1, gap: 2 },
  runTitle: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  runMeta: { color: Colors.muted ?? '#94a3b8', fontSize: 11 },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  claimText: { color: Colors.muted ?? '#94a3b8', fontSize: 11, flex: 1 },
  runResult: { fontSize: 11, fontWeight: '800' as const },
  leadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border ?? '#1f2937'},
  leadIndex: { color: Colors.muted ?? '#94a3b8', fontSize: 12, fontWeight: '700' as const, width: 22 },
  leadBody: { flex: 1 },
  leadName: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  leadMeta: { color: Colors.muted ?? '#94a3b8', fontSize: 11 },
  leadRight: { alignItems: 'flex-end' },
  leadScore: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  leadStatus: { fontSize: 10, fontWeight: '800' as const },
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
