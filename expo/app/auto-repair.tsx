import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Globe,
  Lock,
  Radio,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
  Wrench,
  Zap} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  executeSafeRepairAction,
  runAIOpsScan,
  type AIOpsCapability,
  type AIOpsIncident,
  type AIOpsModuleStatus,
  type AIOpsOverallStatus,
  type AIOpsRepairAction,
  type AIOpsRepairResult,
  type AIOpsSeverity,
  type AIOpsSnapshot} from '@/lib/ai-ops';

type Tone = AIOpsOverallStatus | AIOpsSeverity;

interface ToneConfig {
  color: string;
  background: string;
  border: string;
  label: string;
}

const TONE_CONFIG: Record<Tone, ToneConfig> = {
  healthy: {
    color: '#00C48C',
    background: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.22)',
    label: 'Healthy'},
  degraded: {
    color: '#F59E0B',
    background: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.24)',
    label: 'Degraded'},
  warning: {
    color: '#F59E0B',
    background: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.24)',
    label: 'Warning'},
  critical: {
    color: '#FF5A5A',
    background: 'rgba(255,90,90,0.12)',
    border: 'rgba(255,90,90,0.24)',
    label: 'Critical'}};

const MODULE_ICONS = {
  frontend: Globe,
  backend: Server,
  storage: Database,
  realtime: Radio,
  infrastructure: Cpu,
  security: Lock} as const;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'});
}

function getTone(tone: Tone): ToneConfig {
  return TONE_CONFIG[tone];
}

const SectionHeader = memo(function SectionHeader({
  icon,
  title,
  subtitle}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderIcon}>{icon}</View>
      <View style={styles.sectionHeaderTextWrap}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
});

const MetricCard = memo(function MetricCard({
  label,
  value,
  tone}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  const palette = getTone(tone);

  return (
    <View style={[styles.metricCard, { borderColor: palette.border }]}> 
      <View style={[styles.metricToneDot, { backgroundColor: palette.color }]} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
});

const ModuleStatusCard = memo(function ModuleStatusCard({ module }: { module: AIOpsModuleStatus }) {
  const palette = getTone(module.status);
  const Icon = MODULE_ICONS[module.id as keyof typeof MODULE_ICONS] ?? Server;

  return (
    <View style={styles.moduleCard} testID={`module-status-${module.id}`}>
      <View style={styles.moduleTopRow}>
        <View style={[styles.moduleIconWrap, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <Icon size={18} color={palette.color} />
        </View>
        <View style={styles.moduleCopy}>
          <Text style={styles.moduleTitle}>{module.title}</Text>
          <Text style={styles.moduleSubtitle}>{module.subtitle}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <Text style={[styles.pillText, { color: palette.color }]}>{palette.label}</Text>
        </View>
      </View>
      <Text style={styles.moduleDetail}>{module.detail}</Text>
    </View>
  );
});

const CapabilityCard = memo(function CapabilityCard({ capability }: { capability: AIOpsCapability }) {
  const isAutomatic = capability.level === 'automatic';
  const tone: Tone = capability.status === 'blocked'
    ? 'critical'
    : capability.status === 'partial'
      ? 'warning'
      : isAutomatic
        ? 'healthy'
        : 'degraded';
  const palette = getTone(tone);

  return (
    <View style={styles.capabilityCard} testID={`capability-${capability.id}`}>
      <View style={styles.capabilityHeader}>
        <View style={[styles.capabilityIconWrap, { backgroundColor: palette.background, borderColor: palette.border }]}>
          {isAutomatic ? <Bot size={18} color={palette.color} /> : <Shield size={18} color={palette.color} />}
        </View>
        <View style={styles.capabilityCopy}>
          <Text style={styles.capabilityTitle}>{capability.title}</Text>
          <Text style={styles.capabilityMeta}>
            {capability.level.replace('_', ' ')} · {capability.status}
          </Text>
        </View>
      </View>
      <Text style={styles.capabilityDetail}>{capability.detail}</Text>
    </View>
  );
});

const RepairLogCard = memo(function RepairLogCard({ result }: { result: AIOpsRepairResult }) {
  const palette = getTone(result.success ? 'healthy' : 'critical');

  return (
    <View style={[styles.resultCard, { borderColor: palette.border }]} testID={`repair-log-${result.action}`}>
      <View style={styles.resultTopRow}>
        <View style={[styles.resultIconWrap, { backgroundColor: palette.background, borderColor: palette.border }]}>
          {result.success ? <CheckCircle size={16} color={palette.color} /> : <AlertTriangle size={16} color={palette.color} />}
        </View>
        <View style={styles.resultCopy}>
          <Text style={styles.resultTitle}>{result.title}</Text>
          <Text style={styles.resultTimestamp}>{formatTime(result.executedAt)}</Text>
        </View>
      </View>
      <Text style={styles.resultMessage}>{result.message}</Text>
      {result.details.map((detail) => (
        <View key={`${result.action}-${detail}`} style={styles.resultDetailRow}>
          <View style={[styles.resultDetailDot, { backgroundColor: palette.color }]} />
          <Text style={styles.resultDetailText}>{detail}</Text>
        </View>
      ))}
    </View>
  );
});

function IncidentCard({
  incident,
  isPending,
  onRepair}: {
  incident: AIOpsIncident;
  isPending: boolean;
  onRepair: (action: AIOpsRepairAction) => void;
}) {
  const palette = getTone(incident.severity);

  return (
    <View style={[styles.incidentCard, { borderColor: palette.border }]} testID={`incident-${incident.id}`}>
      <View style={styles.incidentTopRow}>
        <View style={[styles.incidentIconWrap, { backgroundColor: palette.background, borderColor: palette.border }]}>
          {incident.severity === 'critical' ? (
            <AlertTriangle size={18} color={palette.color} />
          ) : (
            <Clock size={18} color={palette.color} />
          )}
        </View>
        <View style={styles.incidentCopy}>
          <Text style={styles.incidentTitle}>{incident.title}</Text>
          <Text style={styles.incidentSource}>{incident.source}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <Text style={[styles.pillText, { color: palette.color }]}>{palette.label}</Text>
        </View>
      </View>

      <Text style={styles.incidentSummary}>{incident.summary}</Text>

      <View style={styles.incidentFooter}>
        <View style={styles.eligibilityPill}>
          <Sparkles size={12} color={incident.autoRepairEligible ? Colors.success : Colors.warning} />
          <Text style={styles.eligibilityText}>
            {incident.autoRepairEligible ? 'Safe AI action available' : 'Human approval required'}
          </Text>
        </View>

        {incident.autoRepairEligible && incident.recommendedAction ? (
          <TouchableOpacity
            style={[styles.repairActionButton, isPending && styles.disabledButton]}
            onPress={() => onRepair(incident.recommendedAction as AIOpsRepairAction)}
            activeOpacity={0.8}
            disabled={isPending}
            testID={`incident-fix-${incident.id}`}
          >
            {isPending ? <ShimmerIndicator size="small" color={Colors.black} /> : <Wrench size={15} color={Colors.black} />}
            <Text style={styles.repairActionText}>{isPending ? 'Running...' : 'Run Safe Fix'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export default function AutoRepairScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pulseAnim = useRef(new Animated.Value(0.85)).current;
  const [actionHistory, setActionHistory] = useState<AIOpsRepairResult[]>([]);
  const [activeAction, setActiveAction] = useState<AIOpsRepairAction | null>(null);

  const snapshotQuery = useQuery<AIOpsSnapshot>({
    queryKey: ['ai-ops', 'snapshot'],
    queryFn: () => runAIOpsScan(),
    staleTime: 120000,
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false});

  const repairMutation = useMutation<AIOpsRepairResult, Error, AIOpsRepairAction>({
    mutationFn: async (action) => executeSafeRepairAction(action),
    onMutate: async (action) => {
      setActiveAction(action);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onSuccess: async (result) => {
      setActionHistory((current) => [result, ...current].slice(0, 6));
      await snapshotQuery.refetch();
      await Haptics.notificationAsync(
        result.success ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
      );
      Alert.alert(result.title, result.message);
    },
    onError: async (error) => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Safe repair failed', error.message);
    },
    onSettled: () => {
      setActiveAction(null);
    }});

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true}),
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 1400,
          useNativeDriver: true}),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  const snapshot = snapshotQuery.data;
  const overallTone = getTone(snapshot?.overallStatus ?? 'degraded');

  const automaticCapabilities = useMemo(() => {
    return snapshot?.capabilities.filter((capability) => capability.level === 'automatic') ?? [];
  }, [snapshot?.capabilities]);

  const humanCapabilities = useMemo(() => {
    return snapshot?.capabilities.filter((capability) => capability.level !== 'automatic') ?? [];
  }, [snapshot?.capabilities]);

  const handleRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const nextSnapshot = await runAIOpsScan({ force: true });
      queryClient.setQueryData(['ai-ops', 'snapshot'], nextSnapshot);
    } catch (error) {
      Alert.alert('Refresh failed', (error as Error).message);
    }
  }, [queryClient]);

  const handleRepair = useCallback((action: AIOpsRepairAction) => {
    repairMutation.mutate(action);
  }, [repairMutation]);

  const handleRescan = useCallback(() => {
    handleRepair('rerun-scan');
  }, [handleRepair]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            activeOpacity={0.8}
            testID="auto-repair-back"
          >
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>

          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>AI Ops Control</Text>
            <Text style={styles.headerSubtitle}>Honest self-healing and escalation center</Text>
          </View>

          <TouchableOpacity
            onPress={handleRescan}
            style={styles.headerAction}
            activeOpacity={0.8}
            disabled={repairMutation.isPending}
            testID="aiops-rescan"
          >
            {repairMutation.isPending && activeAction === 'rerun-scan' ? (
              <ShimmerIndicator size="small" color={Colors.primary} />
            ) : (
              <RefreshCw size={18} color={Colors.primary} />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={snapshotQuery.isRefetching}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          <View style={[styles.heroCard, { borderColor: overallTone.border }]}>
            <View style={styles.heroTopRow}>
              <Animated.View
                style={[
                  styles.heroOrb,
                  {
                    backgroundColor: overallTone.background,
                    borderColor: overallTone.border,
                    transform: [{ scale: pulseAnim }]},
                ]}
              >
                <Bot size={28} color={overallTone.color} />
              </Animated.View>

              <View style={styles.heroCopy}>
                <View style={[styles.heroBadge, { backgroundColor: overallTone.background, borderColor: overallTone.border }]}>
                  <View style={[styles.heroBadgeDot, { backgroundColor: overallTone.color }]} />
                  <Text style={[styles.heroBadgeText, { color: overallTone.color }]}>{overallTone.label}</Text>
                </View>
                <Text style={styles.heroTitle}>AI-assisted operations, not unsupervised magic</Text>
                <Text style={styles.heroBody}>
                  {snapshot?.honestyStatement ?? 'Loading AI operations status...'}
                </Text>
              </View>
            </View>

            <View style={styles.promiseCard}>
              <Shield size={16} color={Colors.primary} />
              <Text style={styles.promiseText}>{snapshot?.promise ?? 'Preparing safety boundaries...'}</Text>
            </View>

            <View style={styles.heroActionsRow}>
              <TouchableOpacity
                style={[styles.primaryButton, repairMutation.isPending && styles.disabledButton]}
                onPress={handleRescan}
                activeOpacity={0.85}
                disabled={repairMutation.isPending}
                testID="hero-run-rescan"
              >
                {repairMutation.isPending && activeAction === 'rerun-scan' ? (
                  <ShimmerIndicator size="small" color={Colors.black} />
                ) : (
                  <Zap size={16} color={Colors.black} />
                )}
                <Text style={styles.primaryButtonText}>Run AI scan</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryButton, repairMutation.isPending && styles.disabledButton]}
                onPress={() => handleRepair('check-storage-integrity')}
                activeOpacity={0.85}
                disabled={repairMutation.isPending}
                testID="hero-storage-check"
              >
                {repairMutation.isPending && activeAction === 'check-storage-integrity' ? (
                  <ShimmerIndicator size="small" color={Colors.text} />
                ) : (
                  <Database size={16} color={Colors.text} />
                )}
                <Text style={styles.secondaryButtonText}>Check storage</Text>
              </TouchableOpacity>
            </View>
          </View>

          {snapshotQuery.isLoading && !snapshot ? (
            <View style={styles.loadingCard}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingTitle}>Scanning live app safeguards</Text>
              <Text style={styles.loadingBody}>Checking frontend, backend, storage, realtime, and safe-repair boundaries.</Text>
            </View>
          ) : null}

          {snapshotQuery.isError && !snapshot ? (
            <View style={styles.errorCard}>
              <AlertTriangle size={20} color={Colors.error} />
              <Text style={styles.errorTitle}>AI Ops scan failed</Text>
              <Text style={styles.errorBody}>{snapshotQuery.error?.message ?? 'Unknown error'}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={handleRefresh} testID="retry-aiops-scan">
                <RefreshCw size={14} color={Colors.black} />
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {snapshot ? (
            <>
              <View style={styles.section}>
                <SectionHeader
                  icon={<Cpu size={18} color={Colors.primary} />}
                  title="Operations snapshot"
                  subtitle={`Last scan ${formatTime(snapshot.scannedAt)}`}
                />
                <View style={styles.metricsGrid}>
                  {snapshot.metrics.map((metric) => (
                    <MetricCard key={metric.id} label={metric.label} value={metric.value} tone={metric.tone} />
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <SectionHeader
                  icon={<Server size={18} color={Colors.primary} />}
                  title="Live module status"
                  subtitle="What the app can verify right now"
                />
                {snapshot.modules.map((module) => (
                  <ModuleStatusCard key={module.id} module={module} />
                ))}
              </View>

              <View style={styles.section}>
                <SectionHeader
                  icon={<AlertTriangle size={18} color={Colors.primary} />}
                  title="Open incidents"
                  subtitle="AI will only run safe recoveries"
                />
                {snapshot.incidents.length === 0 ? (
                  <View style={styles.emptyStateCard}>
                    <CheckCircle size={20} color={Colors.success} />
                    <Text style={styles.emptyStateTitle}>No active incidents</Text>
                    <Text style={styles.emptyStateBody}>The current scan did not detect a blocking issue that needs action.</Text>
                  </View>
                ) : (
                  snapshot.incidents.map((incident) => (
                    <IncidentCard
                      key={incident.id}
                      incident={incident}
                      isPending={repairMutation.isPending && activeAction === incident.recommendedAction}
                      onRepair={handleRepair}
                    />
                  ))
                )}
              </View>

              <View style={styles.section}>
                <SectionHeader
                  icon={<Bot size={18} color={Colors.primary} />}
                  title="What AI can do automatically"
                  subtitle="Safe, reversible, low-risk operations"
                />
                {automaticCapabilities.map((capability) => (
                  <CapabilityCard key={capability.id} capability={capability} />
                ))}
              </View>

              <View style={styles.section}>
                <SectionHeader
                  icon={<Shield size={18} color={Colors.primary} />}
                  title="What still needs humans"
                  subtitle="Real control boundaries"
                />
                {humanCapabilities.map((capability) => (
                  <CapabilityCard key={capability.id} capability={capability} />
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.section}>
            <SectionHeader
              icon={<Wrench size={18} color={Colors.primary} />}
              title="Recent safe actions"
              subtitle="Executed from this control center"
            />
            {actionHistory.length === 0 ? (
              <View style={styles.emptyStateCard}>
                <ChevronRight size={18} color={Colors.textSecondary} />
                <Text style={styles.emptyStateTitle}>No repair actions yet</Text>
                <Text style={styles.emptyStateBody}>Run a scan or a safe storage check to create the first verified action log.</Text>
              </View>
            ) : (
              actionHistory.map((result) => <RepairLogCard key={`${result.action}-${result.executedAt}`} result={result} />)
            )}
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#040607'},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)'},
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  headerCopy: {
    flex: 1},
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: -0.3},
  headerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2},
  headerAction: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primary + '26'},
  scroll: {
    flex: 1},
  scrollContent: {
    padding: 16,
    paddingBottom: 44},
  heroCard: {
    backgroundColor: '#0C1012',
    borderRadius: 26,
    padding: 20,
    marginBottom: 18,
    borderWidth: 1,
    overflow: 'hidden'},
  heroTopRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start'},
  heroOrb: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1},
  heroCopy: {
    flex: 1,
    gap: 8},
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1},
  heroBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4},
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  heroTitle: {
    color: Colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800' as const,
    letterSpacing: -0.5},
  heroBody: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21},
  promiseCard: {
    marginTop: 16,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.18)',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start'},
  promiseText: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    lineHeight: 19},
  heroActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16},
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8},
  primaryButtonText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '800' as const},
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8},
  secondaryButtonText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const},
  disabledButton: {
    opacity: 0.6},
  loadingCard: {
    backgroundColor: '#0C1012',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    marginBottom: 18},
  loadingTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  loadingBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center' as const},
  errorCard: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.18)',
    gap: 8},
  errorTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  errorBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19},
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  retryButtonText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '800' as const},
  section: {
    marginBottom: 22},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12},
  sectionHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primary + '14',
    borderWidth: 1,
    borderColor: Colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center'},
  sectionHeaderTextWrap: {
    flex: 1},
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: -0.2},
  sectionSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2},
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  metricCard: {
    width: '48%' as const,
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 110,
    backgroundColor: '#0C1012',
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    justifyContent: 'space-between'},
  metricToneDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  metricValue: {
    color: Colors.text,
    fontSize: 26,
    fontWeight: '800' as const,
    letterSpacing: -0.6},
  metricLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17},
  moduleCard: {
    backgroundColor: '#0C1012',
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  moduleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  moduleIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  moduleCopy: {
    flex: 1},
  moduleTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  moduleSubtitle: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  moduleDetail: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12},
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5},
  pillText: {
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4},
  incidentCard: {
    backgroundColor: '#0C1012',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    marginBottom: 10},
  incidentTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  incidentIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  incidentCopy: {
    flex: 1},
  incidentTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  incidentSource: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  incidentSummary: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12},
  incidentFooter: {
    marginTop: 14,
    gap: 10},
  eligibilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  eligibilityText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  repairActionButton: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8},
  repairActionText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '800' as const},
  capabilityCard: {
    backgroundColor: '#0C1012',
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 10},
  capabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  capabilityIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  capabilityCopy: {
    flex: 1},
  capabilityTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  capabilityMeta: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
    textTransform: 'capitalize' as const},
  capabilityDetail: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12},
  resultCard: {
    backgroundColor: '#0C1012',
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    marginBottom: 10},
  resultTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12},
  resultIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'},
  resultCopy: {
    flex: 1},
  resultTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700' as const},
  resultTimestamp: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  resultMessage: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12},
  resultDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8},
  resultDetailDot: {
    width: 6,
    height: 6,
    borderRadius: 4,
    marginTop: 6},
  resultDetailText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18},
  emptyStateCard: {
    backgroundColor: '#0C1012',
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'},
  emptyStateTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  emptyStateBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center' as const},
  bottomSpacer: {
    height: 24}});
