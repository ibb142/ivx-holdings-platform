/**
 * IVX Global Opportunity Intelligence Dashboard.
 *
 * Shows live status of all 9 discovery engines, daily targets,
 * top opportunities, and 5-hour executive reports.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  ArrowLeft,
  BarChart3,
  Brain,
  Building2,
  Coins,
  Globe,
  Handshake,
  Landmark,
  Lightbulb,
  MapPin,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  Users,
  Zap,
  AlertTriangle,
  CheckCircle} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

// ── Types ──────────────────────────────────────────────────────────────────

type CategoryStatus = {
  category: string;
  label: string;
  target: number;
  found: number;
  percentage: number;
  status: 'on_track' | 'behind' | 'exceeded' | 'not_started';
};

type EngineConfig = {
  engineId: string;
  engineName: string;
  category: string;
  categoryLabel: string;
  enabled: boolean;
  dailyTarget: number;
  searchIntervalHours: number;
  queryCount: number;
};

type IntelligenceRecord = {
  id: string;
  category: string;
  name: string;
  company: string;
  website: string;
  location: string;
  capitalRange: string;
  investmentFocus: string;
  confidence: string;
  sourceUrl: string;
  reasonFitsIVX: string;
};

type DashboardState = {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  targets: CategoryStatus[];
  engines: EngineConfig[];
  topRecords: IntelligenceRecord[];
  totalFoundToday: number;
  lastReportTime: string | null;
};

// ── API ────────────────────────────────────────────────────────────────────

const API_BASE = process.env.EXPO_PUBLIC_IVX_API_BASE_URL ?? 'https://api.ivxholding.com';

async function fetchWithAuth<T>(url: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' }});
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

async function postWithAuth<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined});
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${resp.status}`);
  }
  return data as T;
}

// ── Category Icons ─────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  private_investor: <Users size={20} color={Colors.accent} />,
  direct_lender: <Landmark size={20} color={Colors.accent} />,
  tokenized_investor: <Coins size={20} color={Colors.accent} />,
  zip_code_buyer: <MapPin size={20} color={Colors.accent} />,
  corporate_capital: <Building2 size={20} color={Colors.accent} />,
  market_intelligence: <Lightbulb size={20} color={Colors.accent} />,
  jv_match: <Handshake size={20} color={Colors.accent} />};

const CONFIDENCE_COLORS: Record<string, string> = {
  'A+': '#00C48C',
  'A': '#16A34A',
  'B': '#EAB308',
  'C': '#F97316',
  'UNVERIFIED': '#6B7280'};

// ── Progress Bar ───────────────────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.min(100, pct)}%`, backgroundColor: color }]} />
    </View>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function OpportunityIntelligenceScreen() {
  const router = useRouter();
  const [state, setState] = useState<DashboardState>({
    loading: true,
    refreshing: false,
    error: null,
    targets: [],
    engines: [],
    topRecords: [],
    totalFoundToday: 0,
    lastReportTime: null});
  const [runningEngine, setRunningEngine] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setState((s) => ({ ...s, refreshing: true }));
      else setState((s) => ({ ...s, loading: true, error: null }));

      const [targetsRes, enginesRes, topRes] = await Promise.all([
        fetchWithAuth<{ ok: boolean; targets: CategoryStatus[]; totalFoundToday: number }>('/api/ivx/intelligence/targets'),
        fetchWithAuth<{ ok: boolean; engines: EngineConfig[] }>('/api/ivx/intelligence/engines'),
        fetchWithAuth<{ ok: boolean; top20: IntelligenceRecord[] }>('/api/ivx/intelligence/top'),
      ]);

      setState({
        loading: false,
        refreshing: false,
        error: null,
        targets: targetsRes.targets ?? [],
        engines: enginesRes.engines ?? [],
        topRecords: topRes.top20 ?? [],
        totalFoundToday: targetsRes.totalFoundToday ?? 0,
        lastReportTime: null});
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: (err as Error).message}));
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRunAll = useCallback(async () => {
    setRunningAll(true);
    try {
      const res = await postWithAuth<{ ok: boolean; result: { totalSaved: number; errors: string[] } }>(
        '/api/ivx/intelligence/run-all',
      );
      void loadData(true);
      Alert.alert(
        'Engines Complete',
        `${res.result.totalSaved} new records discovered.${res.result.errors.length > 0 ? `\n${res.result.errors.length} errors.` : ''}`,
      );
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setRunningAll(false);
    }
  }, [loadData]);

  const handleRunEngine = useCallback(async (engineId: string) => {
    setRunningEngine(engineId);
    try {
      await postWithAuth(`/api/ivx/intelligence/run/${engineId}`);
      void loadData(true);
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setRunningEngine(null);
    }
  }, [loadData]);

  // ── Render ───────────────────────────────────────────────────────────

  if (state.loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <ShimmerIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading Intelligence Engine...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Opportunity Intelligence</Text>
          <Text style={styles.headerSub}>
            {state.totalFoundToday} records today • {state.engines.filter((e) => e.enabled).length} engines
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.runAllBtn, runningAll && styles.btnDisabled]}
          onPress={handleRunAll}
          disabled={runningAll}
        >
          {runningAll ? (
            <ShimmerIndicator size="small" color="#fff" />
          ) : (
            <Zap size={18} color="#fff" />
          )}
          <Text style={styles.runAllText}>Run All</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={state.refreshing}
            onRefresh={() => void loadData(true)}
            tintColor={Colors.accent}
          />
        }
      >
        {state.error && (
          <View style={styles.errorBanner}>
            <AlertTriangle size={16} color="#FF4D4D" />
            <Text style={styles.errorText}>{state.error}</Text>
          </View>
        )}

        {/* Daily Targets Summary */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Target size={18} color={Colors.accent} />
            <Text style={styles.sectionTitle}>Daily Targets</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{state.totalFoundToday} found</Text>
            </View>
          </View>

          {state.targets.map((t) => {
            const statusColor =
              t.status === 'exceeded' ? '#00C48C' :
              t.status === 'on_track' ? '#4A90D9' :
              t.status === 'behind' ? '#EAB308' : '#6B7280';

            const statusIcon =
              t.status === 'exceeded' ? <CheckCircle size={14} color="#00C48C" /> :
              t.status === 'on_track' ? <TrendingUp size={14} color="#4A90D9" /> :
              t.status === 'behind' ? <AlertTriangle size={14} color="#EAB308" /> :
              <Zap size={14} color="#6B7280" />;

            return (
              <View key={t.category} style={styles.targetRow}>
                <View style={styles.targetIcon}>
                  {CATEGORY_ICONS[t.category] ?? <Globe size={20} color={Colors.accent} />}
                </View>
                <View style={styles.targetInfo}>
                  <View style={styles.targetNameRow}>
                    <Text style={styles.targetName}>{t.label}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                      {statusIcon}
                      <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                        {t.status === 'not_started' ? 'Not Started' :
                         t.status === 'exceeded' ? 'Exceeded' :
                         t.status === 'behind' ? 'Behind' : 'On Track'}
                      </Text>
                    </View>
                  </View>
                  <ProgressBar pct={t.percentage} color={statusColor} />
                  <Text style={styles.targetNumbers}>
                    {t.found} / {t.target} ({t.percentage}%)
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Engines */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Search size={18} color={Colors.accent} />
            <Text style={styles.sectionTitle}>Discovery Engines</Text>
          </View>

          {state.engines.filter((e) => e.enabled).map((engine) => (
            <TouchableOpacity
              key={engine.engineId}
              style={styles.engineRow}
              onPress={() => handleRunEngine(engine.engineId)}
              disabled={runningEngine === engine.engineId}
              activeOpacity={0.7}
            >
              <View style={styles.engineIcon}>
                {CATEGORY_ICONS[engine.category] ?? <Globe size={20} color={Colors.accent} />}
              </View>
              <View style={styles.engineInfo}>
                <Text style={styles.engineName}>{engine.engineName}</Text>
                <Text style={styles.engineMeta}>
                  {engine.categoryLabel} • Target: {engine.dailyTarget}/day • {engine.queryCount} queries
                </Text>
              </View>
              {runningEngine === engine.engineId ? (
                <ShimmerIndicator size="small" color={Colors.accent} />
              ) : (
                <RefreshCw size={16} color={Colors.textSecondary} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Top Opportunities */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <TrendingUp size={18} color={Colors.accent} />
            <Text style={styles.sectionTitle}>Top Opportunities</Text>
          </View>

          {state.topRecords.length === 0 ? (
            <View style={styles.emptyState}>
              <Brain size={40} color={Colors.textSecondary} />
              <Text style={styles.emptyText}>No records yet</Text>
              <Text style={styles.emptySub}>Run the engines to start discovering opportunities</Text>
            </View>
          ) : (
            state.topRecords.slice(0, 10).map((record, idx) => (
              <View key={record.id ?? idx} style={styles.recordRow}>
                <View style={styles.recordRank}>
                  <Text style={styles.recordRankText}>{idx + 1}</Text>
                </View>
                <View style={styles.recordInfo}>
                  <Text style={styles.recordName} numberOfLines={2}>{record.company}</Text>
                  <Text style={styles.recordMeta}>
                    {record.location} • {record.capitalRange} • {record.investmentFocus}
                  </Text>
                </View>
                <View style={[styles.confidenceBadge, { backgroundColor: (CONFIDENCE_COLORS[record.confidence] ?? '#6B7280') + '20' }]}>
                  <Text style={[styles.confidenceText, { color: CONFIDENCE_COLORS[record.confidence] ?? '#6B7280' }]}>
                    {record.confidence}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Quick Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{state.engines.filter((e) => e.enabled).length}</Text>
            <Text style={styles.statLabel}>Active Engines</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{state.targets.filter((t) => t.status === 'exceeded').length}</Text>
            <Text style={styles.statLabel}>On/Exceeded Target</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{state.targets.filter((t) => t.status === 'not_started').length}</Text>
            <Text style={styles.statLabel}>Not Started</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{state.topRecords.length}</Text>
            <Text style={styles.statLabel}>Ranked Leads</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A'},
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12},
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A'},
  backBtn: {
    padding: 4},
  headerCenter: {
    flex: 1,
    marginLeft: 12},
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text},
  headerSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2},
  runAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8},
  btnDisabled: {
    opacity: 0.6},
  runAllText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600'},
  scroll: {
    flex: 1},
  scrollContent: {
    padding: 16,
    paddingBottom: 40},
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FF4D4D20',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16},
  errorText: {
    color: '#FF4D4D',
    fontSize: 13,
    flex: 1},
  section: {
    marginBottom: 20},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12},
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flex: 1},
  badge: {
    backgroundColor: Colors.accent + '20',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10},
  badgeText: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '600'},
  targetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#141414',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8},
  targetIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.accent + '15',
    justifyContent: 'center',
    alignItems: 'center'},
  targetInfo: {
    flex: 1},
  targetNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6},
  targetName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text},
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600'},
  progressTrack: {
    height: 4,
    backgroundColor: '#1F1F1F',
    borderRadius: 2,
    marginBottom: 4,
    overflow: 'hidden'},
  progressFill: {
    height: '100%',
    borderRadius: 2},
  targetNumbers: {
    fontSize: 11,
    color: Colors.textSecondary},
  engineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#141414',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6},
  engineIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.accent + '15',
    justifyContent: 'center',
    alignItems: 'center'},
  engineInfo: {
    flex: 1},
  engineName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text},
  engineMeta: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2},
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#141414',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6},
  recordRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.accent + '20',
    justifyContent: 'center',
    alignItems: 'center'},
  recordRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent},
  recordInfo: {
    flex: 1},
  recordName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text},
  recordMeta: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2},
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  confidenceText: {
    fontSize: 11,
    fontWeight: '700'},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8},
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600'},
  emptySub: {
    color: Colors.textSecondary,
    fontSize: 12},
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#141414',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center'},
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.accent},
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: 'center'}});
