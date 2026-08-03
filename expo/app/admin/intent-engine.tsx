import React, { useState, useCallback, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Alert,
  useWindowDimensions} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Globe,
  Search,
  Target,
  FileText,
  Languages,
  Eye,
  Bot,
  RefreshCw,
  Zap,
  TrendingUp,
  Users,
  DollarSign,
  Activity,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  MapPin,
  Sparkles} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  fetchIntentDashboard,
  fetchIntentStatus,
  runPhase1,
  runPhase2,
  runPhase3,
  runPhase4,
  runPhase8,
  type IntentDashboard,
  type PhaseResult} from '@/lib/intent-engine-api';

type TabType = 'overview' | 'keywords' | 'pages' | 'content' | 'visitors' | 'optimization';

const TABS: { label: string; value: TabType; icon: React.ReactNode }[] = [
  { label: 'Overview', value: 'overview', icon: <BarChart3 size={14} color="#97A0AF" /> },
  { label: 'Keywords', value: 'keywords', icon: <Search size={14} color="#97A0AF" /> },
  { label: 'Pages', value: 'pages', icon: <FileText size={14} color="#97A0AF" /> },
  { label: 'Countries', value: 'visitors', icon: <Globe size={14} color="#97A0AF" /> },
  { label: 'Optimize', value: 'optimization', icon: <Zap size={14} color="#97A0AF" /> },
];

const CLUSTER_COLORS: Record<string, string> = {
  BUY_NOW: '#00C48C',
  LEARN: '#4A90D9',
  COMPARE: '#F59E0B',
  INVEST: '#FFD700',
  FINANCE: '#A855F7',
  PARTNER: '#EC4899',
  SELL: '#FF4D4D',
  DEVELOP: '#06B6D4'};

function MetricCard({
  icon,
  label,
  value,
  color,
  delay}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  delay: number;
}) {
  const fadeAnim = useState(new Animated.Value(0))[0];
  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      delay,
      useNativeDriver: true}).start();
  }, [fadeAnim, delay]);

  return (
    <Animated.View style={[styles.metricCard, { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      <View style={[styles.metricIcon, { backgroundColor: color + '20' }]}>
        {icon}
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Animated.View>
  );
}

function PhaseButton({
  phase,
  title,
  description,
  icon,
  onPress,
  loading,
  result,
  color}: {
  phase: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  onPress: () => void;
  loading: boolean;
  result: PhaseResult | null;
  color: string;
}) {
  const scaleAnim = useState(new Animated.Value(1))[0];

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={styles.phaseButton}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={loading}
        activeOpacity={0.8}
      >
        <View style={styles.phaseHeader}>
          <View style={[styles.phaseIcon, { backgroundColor: color + '20' }]}>
            {icon}
          </View>
          <View style={styles.phaseInfo}>
            <Text style={styles.phaseLabel}>{phase}</Text>
            <Text style={styles.phaseTitle}>{title}</Text>
            <Text style={styles.phaseDesc}>{description}</Text>
          </View>
          {loading ? (
            <ShimmerIndicator size="small" color={color} />
          ) : result ? (
            <CheckCircle2 size={20} color={Colors.success} />
          ) : (
            <ChevronRight size={20} color={Colors.textTertiary} />
          )}
        </View>
        {result && (
          <View style={styles.phaseResult}>
            <Text style={styles.phaseResultText}>
              {result.keywords_discovered != null && `${result.keywords_discovered} keywords · `}
              {result.keywords_upserted != null && `${result.keywords_upserted} upserted · `}
              {result.clusters_computed != null && `${result.clusters_computed} clusters · `}
              {result.pages_created != null && `${result.pages_created} pages · `}
              {result.content_created != null && `${result.content_created} content pieces · `}
              {result.pages_updated != null && `${result.pages_updated} updated · `}
              {result.campaigns_recommended != null && `${result.campaigns_recommended} recommendations`}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function IntentEngineScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [runningPhase, setRunningPhase] = useState<number | null>(null);
  const [phaseResults, setPhaseResults] = useState<Record<number, PhaseResult | null>>({});
  const { width } = useWindowDimensions();

  const statusQuery = useQuery({
    queryKey: ['intent-engine-status'],
    queryFn: fetchIntentStatus});

  const dashboardQuery = useQuery<IntentDashboard>({
    queryKey: ['intent-engine-dashboard'],
    queryFn: fetchIntentDashboard,
    retry: 1});

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['intent-engine-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['intent-engine-status'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  const runPhase = useCallback(async (phase: number, fn: () => Promise<PhaseResult>) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setRunningPhase(phase);
      const result = await fn();
      setPhaseResults((prev) => ({ ...prev, [phase]: result }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries({ queryKey: ['intent-engine-dashboard'] });
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Phase Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRunningPhase(null);
    }
  }, [queryClient]);

  const runAll = useCallback(async () => {
    Alert.alert(
      'Run Full Optimization',
      'This runs all 8 phases: keyword discovery, clustering, landing pages, content, and autonomous optimization. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Run All',
          onPress: async () => {
            await runPhase(8, runPhase8);
          }},
      ],
    );
  }, [runPhase]);

  const dashboard = dashboardQuery.data;
  const configured = statusQuery.data?.configured ?? false;

  const renderOverview = () => {
    if (dashboardQuery.isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading intent engine data…</Text>
        </View>
      );
    }
    if (dashboardQuery.isError || !dashboard) {
      return (
        <View style={styles.errorContainer}>
          <AlertCircle size={32} color={Colors.error} />
          <Text style={styles.errorText}>Unable to load dashboard</Text>
          <Text style={styles.errorSubtext}>
            {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'Check owner session and backend status'}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => dashboardQuery.refetch()}>
            <RefreshCw size={16} color={Colors.white} />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const m = dashboard.metrics;
    return (
      <View style={styles.tabContent}>
        {/* Status banner */}
        <View style={[styles.statusBanner, { borderLeftColor: configured ? Colors.success : Colors.warning }]}>
          <View style={styles.statusBannerLeft}>
            {configured ? (
              <CheckCircle2 size={16} color={Colors.success} />
            ) : (
              <AlertCircle size={16} color={Colors.warning} />
            )}
            <Text style={styles.statusText}>
              {configured ? 'Engine Live — Supabase connected' : 'Engine needs Supabase configuration'}
            </Text>
          </View>
          <Text style={styles.statusLangs}>
            {dashboard.languages_active.length} languages
          </Text>
        </View>

        {/* Metrics grid */}
        <Text style={styles.sectionTitle}>Performance Metrics</Text>
        <View style={styles.metricsGrid}>
          <MetricCard icon={<Search size={18} color={Colors.primary} />} label="Keywords" value={m.total_keywords} color={Colors.primary} delay={0} />
          <MetricCard icon={<FileText size={18} color={Colors.blue} />} label="Landing Pages" value={m.total_landing_pages} color={Colors.blue} delay={50} />
          <MetricCard icon={<FileText size={18} color={Colors.info} />} label="Content" value={m.total_content} color={Colors.info} delay={100} />
          <MetricCard icon={<Eye size={18} color={Colors.success} />} label="Visitors" value={m.total_visitors} color={Colors.success} delay={150} />
          <MetricCard icon={<Bot size={18} color={Colors.orange} />} label="AI Chats" value={m.total_conversations} color={Colors.orange} delay={200} />
          <MetricCard icon={<Users size={18} color={Colors.gold} />} label="Registrations" value={m.total_registrations} color={Colors.gold} delay={250} />
          <MetricCard icon={<Target size={18} color={Colors.primary} />} label="Qualified" value={m.total_qualified_investors} color={Colors.primary} delay={300} />
          <MetricCard icon={<TrendingUp size={18} color={Colors.success} />} label="Conv. Rate" value={`${m.conversion_rate}%`} color={Colors.success} delay={350} />
        </View>

        {/* Cluster summary */}
        {dashboard.cluster_summary.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Intent Clusters</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.clusterScroll}>
              {dashboard.cluster_summary.map((c) => {
                const color = CLUSTER_COLORS[c.cluster] ?? Colors.primary;
                return (
                  <View key={c.cluster} style={[styles.clusterCard, { borderLeftColor: color }]}>
                    <Text style={[styles.clusterName, { color }]}>{c.cluster.replace('_', ' ')}</Text>
                    <Text style={styles.clusterCount}>{c.keyword_count} keywords</Text>
                    <Text style={styles.clusterVolume}>{(c.total_volume / 1000).toFixed(1)}K searches/mo</Text>
                    <Text style={styles.clusterIntent}>Intent: {c.avg_intent_score}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* Top keywords preview */}
        {dashboard.top_keywords.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Top Keywords</Text>
            {dashboard.top_keywords.slice(0, 5).map((kw, i) => (
              <View key={i} style={styles.keywordRow}>
                <View style={styles.keywordRank}>
                  <Text style={styles.keywordRankText}>{i + 1}</Text>
                </View>
                <View style={styles.keywordInfo}>
                  <Text style={styles.keywordText} numberOfLines={1}>{kw.keyword}</Text>
                  <Text style={styles.keywordMeta}>{kw.country} · {kw.cluster.replace('_', ' ')}</Text>
                </View>
                <View style={styles.keywordStats}>
                  <Text style={styles.keywordVolume}>{(kw.volume / 1000).toFixed(1)}K</Text>
                  <Text style={styles.keywordIntent}>{kw.intent_score}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </View>
    );
  };

  const renderKeywords = () => {
    if (!dashboard) return null;
    return (
      <View style={styles.tabContent}>
        <Text style={styles.sectionTitle}>All Keywords ({dashboard.top_keywords.length})</Text>
        {dashboard.top_keywords.map((kw, i) => {
          const color = CLUSTER_COLORS[kw.cluster] ?? Colors.primary;
          return (
            <View key={i} style={styles.keywordCard}>
              <View style={styles.keywordCardHeader}>
                <Text style={styles.keywordCardText} numberOfLines={2}>{kw.keyword}</Text>
                <View style={[styles.clusterBadge, { backgroundColor: color + '20' }]}>
                  <Text style={[styles.clusterBadgeText, { color }]}>{kw.cluster.replace('_', ' ')}</Text>
                </View>
              </View>
              <View style={styles.keywordCardMeta}>
                <View style={styles.keywordMetaItem}>
                  <MapPin size={12} color={Colors.textTertiary} />
                  <Text style={styles.keywordMetaText}>{kw.country}</Text>
                </View>
                <View style={styles.keywordMetaItem}>
                  <Search size={12} color={Colors.textTertiary} />
                  <Text style={styles.keywordMetaText}>{(kw.volume / 1000).toFixed(1)}K/mo</Text>
                </View>
                <View style={styles.keywordMetaItem}>
                  <Target size={12} color={Colors.textTertiary} />
                  <Text style={styles.keywordMetaText}>Intent: {kw.intent_score}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderPages = () => {
    if (!dashboard) return null;
    return (
      <View style={styles.tabContent}>
        <Text style={styles.sectionTitle}>Landing Pages ({dashboard.top_landing_pages.length})</Text>
        {dashboard.top_landing_pages.map((page, i) => (
          <View key={i} style={styles.pageCard}>
            <View style={styles.pageCardHeader}>
              <FileText size={16} color={Colors.blue} />
              <Text style={styles.pageSlug}>/{page.slug}</Text>
              <View style={styles.langBadge}>
                <Text style={styles.langBadgeText}>{page.language.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={styles.pageTitle} numberOfLines={1}>{page.title}</Text>
            <View style={styles.pageStats}>
              <View style={styles.pageStat}>
                <Eye size={12} color={Colors.textTertiary} />
                <Text style={styles.pageStatText}>{page.visitors} visitors</Text>
              </View>
              <View style={styles.pageStat}>
                <Users size={12} color={Colors.textTertiary} />
                <Text style={styles.pageStatText}>{page.registrations} registrations</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderCountries = () => {
    if (!dashboard) return null;
    return (
      <View style={styles.tabContent}>
        <Text style={styles.sectionTitle}>Countries ({dashboard.top_countries.length})</Text>
        {dashboard.top_countries.map((c, i) => (
          <View key={i} style={styles.countryCard}>
            <View style={styles.countryFlag}>
              <Globe size={18} color={Colors.primary} />
            </View>
            <View style={styles.countryInfo}>
              <Text style={styles.countryName}>{c.country}</Text>
              <Text style={styles.countryMeta}>{c.keyword_count} keywords · {c.visitor_count} visitors</Text>
            </View>
            <View style={styles.countryBar}>
              <View style={[styles.countryBarFill, { width: `${Math.min(100, c.keyword_count * 10)}%` }]} />
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderOptimization = () => (
    <View style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Autonomous Optimization Engine</Text>
      <Text style={styles.sectionDesc}>
        Run each phase independently or trigger the full daily optimization cycle.
        The engine discovers keywords, clusters intent, generates landing pages,
        creates content, and produces an executive report.
      </Text>

      <PhaseButton
        phase="Phase 1"
        title="Global Search Intelligence"
        description="Discover & rank high-intent keywords across 23 categories × 11 languages"
        icon={<Search size={20} color={Colors.primary} />}
        onPress={() => runPhase(1, runPhase1)}
        loading={runningPhase === 1}
        result={phaseResults[1] ?? null}
        color={Colors.primary}
      />

      <PhaseButton
        phase="Phase 2"
        title="Intent Clustering"
        description="Group keywords into BUY_NOW, LEARN, COMPARE, INVEST, FINANCE, PARTNER, SELL, DEVELOP"
        icon={<Target size={20} color={Colors.blue} />}
        onPress={() => runPhase(2, runPhase2)}
        loading={runningPhase === 2}
        result={phaseResults[2] ?? null}
        color={Colors.blue}
      />

      <PhaseButton
        phase="Phase 3"
        title="Automatic Landing Pages"
        description="Generate SEO pages with ROI calculator, AI chat, registration, KYC"
        icon={<FileText size={20} color={Colors.info} />}
        onPress={() => runPhase(3, runPhase3)}
        loading={runningPhase === 3}
        result={phaseResults[3] ?? null}
        color={Colors.info}
      />

      <PhaseButton
        phase="Phase 4"
        title="AI Content Engine"
        description="Create market reports, investment guides, country reports, ROI studies"
        icon={<Sparkles size={20} color={Colors.success} />}
        onPress={() => runPhase(4, runPhase4)}
        loading={runningPhase === 4}
        result={phaseResults[4] ?? null}
        color={Colors.success}
      />

      <PhaseButton
        phase="Phase 8"
        title="Autonomous Daily Optimization"
        description="Run all phases + discover new keywords, create pages, detect declining traffic, generate executive report"
        icon={<Zap size={20} color={Colors.gold} />}
        onPress={runAll}
        loading={runningPhase === 8}
        result={phaseResults[8] ?? null}
        color={Colors.gold}
      />

      {/* Recent optimization runs */}
      {dashboard && dashboard.recent_optimizations.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Recent Optimization Runs</Text>
          {dashboard.recent_optimizations.map((run) => (
            <View key={run.id} style={styles.runCard}>
              <View style={styles.runHeader}>
                <Activity size={14} color={Colors.success} />
                <Text style={styles.runType}>{run.run_type.replace(/_/g, ' ')}</Text>
                <Text style={styles.runDate}>
                  {new Date(run.completed_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.runStats}>
                <Text style={styles.runStat}>{run.keywords_discovered} keywords</Text>
                <Text style={styles.runStat}>{run.pages_created} pages</Text>
                <Text style={styles.runStat}>{run.pages_updated} content</Text>
                <Text style={styles.runStat}>{run.campaigns_recommended} recommendations</Text>
              </View>
            </View>
          ))}
        </>
      )}

      {/* Executive report */}
      {phaseResults[8]?.executive_report && (
        <>
          <Text style={styles.sectionTitle}>Executive Report</Text>
          <View style={styles.reportCard}>
            <Text style={styles.reportDate}>
              {new Date(phaseResults[8].executive_report!.date).toLocaleString()}
            </Text>
            <Text style={styles.reportSection}>SEO Growth:</Text>
            <Text style={styles.reportValue}>{phaseResults[8].executive_report!.seo_growth}</Text>
            <Text style={styles.reportSection}>Recommendations:</Text>
            {phaseResults[8].executive_report!.recommendations.map((rec, i) => (
              <View key={i} style={styles.recommendationRow}>
                <ChevronRight size={12} color={Colors.primary} />
                <Text style={styles.recommendationText}>{rec}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={22} color={Colors.white} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Globe size={18} color={Colors.primary} />
          <Text style={styles.headerText}>Intent Engine</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshButton}>
          <RefreshCw size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarContent}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab.value}
              style={[styles.tab, activeTab === tab.value && styles.tabActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveTab(tab.value);
              }}
            >
              {tab.icon}
              <Text style={[styles.tabText, activeTab === tab.value && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'keywords' && renderKeywords()}
        {activeTab === 'pages' && renderPages()}
        {activeTab === 'visitors' && renderCountries()}
        {activeTab === 'optimization' && renderOptimization()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border},
  backButton: { padding: 8 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { color: Colors.white, fontSize: 17, fontWeight: '700' },
  refreshButton: { padding: 8 },
  tabBar: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBarContent: { paddingHorizontal: 16, gap: 8 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent'},
  tabActive: { borderBottomColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: Colors.primary },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  tabContent: { gap: 16 },
  loadingContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  loadingText: { color: Colors.textSecondary, fontSize: 14, marginTop: 12 },
  errorContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 8 },
  errorText: { color: Colors.error, fontSize: 16, fontWeight: '600' },
  errorSubtext: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' },
  retryButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
    backgroundColor: Colors.primary, marginTop: 8},
  retryButtonText: { color: Colors.black, fontWeight: '700' },
  statusBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
    backgroundColor: Colors.surface, borderLeftWidth: 3},
  statusBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  statusLangs: { color: Colors.textSecondary, fontSize: 12 },
  sectionTitle: { color: Colors.white, fontSize: 16, fontWeight: '700', marginTop: 8 },
  sectionDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    width: '48%', backgroundColor: Colors.surface, borderRadius: 12,
    padding: 14, alignItems: 'flex-start'},
  metricIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  metricValue: { color: Colors.white, fontSize: 24, fontWeight: '800' },
  metricLabel: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  clusterScroll: { gap: 10, paddingRight: 16 },
  clusterCard: {
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12,
    borderLeftWidth: 3, minWidth: 130},
  clusterName: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  clusterCount: { color: Colors.textSecondary, fontSize: 11, marginTop: 4 },
  clusterVolume: { color: Colors.textTertiary, fontSize: 11 },
  clusterIntent: { color: Colors.primary, fontSize: 11, fontWeight: '600', marginTop: 4 },
  keywordRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12},
  keywordRank: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primary + '20',
    justifyContent: 'center', alignItems: 'center'},
  keywordRankText: { color: Colors.primary, fontWeight: '700', fontSize: 12 },
  keywordInfo: { flex: 1 },
  keywordText: { color: Colors.white, fontSize: 13, fontWeight: '600' },
  keywordMeta: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  keywordStats: { alignItems: 'flex-end' },
  keywordVolume: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  keywordIntent: { color: Colors.primary, fontSize: 11 },
  keywordCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, gap: 10 },
  keywordCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  keywordCardText: { color: Colors.white, fontSize: 14, fontWeight: '600', flex: 1, lineHeight: 19 },
  clusterBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  clusterBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  keywordCardMeta: { flexDirection: 'row', gap: 14 },
  keywordMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  keywordMetaText: { color: Colors.textTertiary, fontSize: 11 },
  pageCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, gap: 8 },
  pageCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageSlug: { color: Colors.blue, fontSize: 13, fontWeight: '600', flex: 1 },
  langBadge: { backgroundColor: Colors.surfaceLight, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  langBadgeText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
  pageTitle: { color: Colors.white, fontSize: 13 },
  pageStats: { flexDirection: 'row', gap: 16 },
  pageStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pageStatText: { color: Colors.textTertiary, fontSize: 11 },
  countryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: 10, padding: 12 },
  countryFlag: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary + '20', justifyContent: 'center', alignItems: 'center' },
  countryInfo: { flex: 1 },
  countryName: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  countryMeta: { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  countryBar: { width: 60, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceLight, overflow: 'hidden' },
  countryBarFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },
  phaseButton: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, gap: 10 },
  phaseHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  phaseIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  phaseInfo: { flex: 1 },
  phaseLabel: { color: Colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  phaseTitle: { color: Colors.white, fontSize: 14, fontWeight: '700', marginTop: 2 },
  phaseDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  phaseResult: { backgroundColor: Colors.backgroundSecondary, borderRadius: 8, padding: 10, marginTop: 4 },
  phaseResultText: { color: Colors.success, fontSize: 11, fontWeight: '600' },
  runCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, gap: 8 },
  runHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  runType: { color: Colors.white, fontSize: 13, fontWeight: '600', flex: 1, textTransform: 'capitalize' },
  runDate: { color: Colors.textTertiary, fontSize: 11 },
  runStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  runStat: { color: Colors.textSecondary, fontSize: 11, backgroundColor: Colors.backgroundSecondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  reportCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 16, gap: 6 },
  reportDate: { color: Colors.textTertiary, fontSize: 12, marginBottom: 4 },
  reportSection: { color: Colors.primary, fontSize: 12, fontWeight: '700', marginTop: 8 },
  reportValue: { color: Colors.white, fontSize: 13 },
  recommendationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  recommendationText: { color: Colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 }});
